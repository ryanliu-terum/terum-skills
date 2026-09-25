/**
 * Eval spec §3 / §7.1 / §7.4: the trust boundary. This is the ONLY module that spawns the agent
 * binary; everything that executes teammate skill content goes through `runAgent`/`askJson`.
 * Ported from skilldeck `evals/runner.py` (commit 42084dc). The binary name comes from
 * `TERUM_SKILLS_AGENT_CMD` (default `claude`) so tests can substitute a stub.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';
import { onShutdown, runShutdownHooks } from '../shutdown.js';
import { resolveAgentCommand, type AgentCommandEvidence } from './agent-command.js';

export const DEFAULT_MODEL = 'sonnet'; // §16.9 [provisional]
export const DEFAULT_TIMEOUT_MS = 7_200_000;
/**
 * Eval purpose suites §5 / §6.2: a heavy skill does its work through the subagent (`Task`) and
 * `Workflow` tools. Without them on the allowlist the headless session's permission gate
 * ("Review dynamic workflow before running") blocks the launch and the skill degrades to prose —
 * measured 2026-09-16 on the hybrid-review suite: three blocked Workflow calls, no `codex exec`.
 * Every arm gets the same list, so the comparison stays fair.
 */
const AGENT_TOOLS = 'Bash Read Write Edit Glob Grep Task Workflow';
/**
 * Rev 7: appended to every arm run, identically, so the comparison stays fair. A headless agent
 * that stops to ask a question dies silently and scores as skill failure (measured: the dominant
 * noise source in the 2026-09-04 determinism probe).
 */
export const HEADLESS_NOTE =
  'You are running inside an automated, unattended evaluation. No human can answer questions; never stop to ask one — act on your best judgment and complete the task.';

const agentCmd = (): string => process.env['TERUM_SKILLS_AGENT_CMD'] ?? 'claude';
/** Host facts for the Windows shim resolution; every other platform spawns the name as is. */
const hostEvidence = (): AgentCommandEvidence => ({
  platform: process.platform, env: process.env, execPath: process.execPath,
  isFile: (path) => { try { return statSync(path).isFile(); } catch { return false; } }, // a candidate that does not exist is simply not the binary
  readText: (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } }, // an unreadable shim is reported by the resolver, not thrown here
});

export class AgentRunError extends Error {}
/** A session cap is deterministic work exhaustion, not the transient crash retry is for. */
export class AgentTimeoutError extends AgentRunError {}

interface StreamEvent {
  type?: string;
  subtype?: string;
  result?: string;
  message?: { content?: unknown };
  [key: string]: unknown;
}

/** Parsed stream-json transcript of one agent run. */
export class Transcript {
  constructor(readonly events: StreamEvent[], readonly resultText: string) {}

  static fromStream(raw: string): Transcript {
    const events: StreamEvent[] = [];
    let resultText = '';
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: unknown;
      try { event = JSON.parse(trimmed); } catch { continue; }
      if (event === null || typeof event !== 'object') continue;
      const parsed = event as StreamEvent;
      events.push(parsed);
      if (parsed.type === 'result') resultText = typeof parsed.result === 'string' ? parsed.result : '';
    }
    return new Transcript(events, resultText);
  }

  private blocks(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const event of this.events) {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) if (block !== null && typeof block === 'object') out.push(block as Record<string, unknown>);
    }
    return out;
  }

  bashCommands(): string[] {
    return this.blocks()
      .filter((block) => block['type'] === 'tool_use' && block['name'] === 'Bash')
      .map((block) => String((block['input'] as Record<string, unknown> | undefined)?.['command'] ?? ''));
  }

  /** Tool-use names in transcript order; used only by the local eval run record. */
  toolUses(): string[] {
    return this.blocks()
      .filter((block) => block['type'] === 'tool_use')
      .map((block) => String(block['name'] ?? ''))
      .filter(Boolean);
  }

  allText(): string {
    const parts = [this.resultText];
    for (const block of this.blocks()) {
      if (block['type'] === 'text') parts.push(String(block['text'] ?? ''));
      else if (block['type'] === 'tool_use') parts.push(JSON.stringify(block['input'] ?? {}));
    }
    return parts.join('\n');
  }

  /** §5.3 efficiency fields from the result event. Field names are VE2's to confirm; read defensively. */
  efficiency(): { turns: number | null; duration_ms: number | null; cost_usd: number | null } {
    const result = this.events.find((event) => event.type === 'result') as Record<string, unknown> | undefined;
    const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return {
      turns: num(result?.['num_turns']),
      duration_ms: num(result?.['duration_ms']),
      cost_usd: num(result?.['total_cost_usd']) ?? num(result?.['cost_usd']),
    };
  }

  /** Rev 7: the resolved model snapshot from the init event — the alias (`sonnet`) floats day to day. */
  modelId(): string | null {
    const init = this.events.find((event) => event.type === 'system' && event.subtype === 'init') as Record<string, unknown> | undefined;
    return typeof init?.['model'] === 'string' && init['model'] ? init['model'] : null;
  }

  /** §7.3: the arm's resolved skill list from the init event, or null when the field is absent (VE1). */
  skillList(): string[] | null {
    const init = this.events.find((event) => event.type === 'system' && event.subtype === 'init') as Record<string, unknown> | undefined;
    const skills = init?.['skills'];
    if (!Array.isArray(skills)) return null;
    return skills.map((entry) => (typeof entry === 'string' ? entry : String((entry as Record<string, unknown>)?.['name'] ?? ''))).filter(Boolean);
  }
}

interface SpawnOutcome { code: number; stdout: string; stderr: string; timedOut: boolean; }

/**
 * A prompt longer than this goes to `claude -p` on stdin instead of as an argv value. Windows caps a
 * whole command line at 32,767 UTF-16 units (spawn ENAMETOOLONG), Linux one argument at 128 KiB, and
 * generation and trigger prompts carry the full SKILL.md: a 31 KB skill failed on Windows on
 * 2026-09-25. Quoting can double a value on Windows, so the cut sits well below half the cap.
 */
export const ARGV_PROMPT_LIMIT = 8_000;
/** `-p <prompt>` when it fits on the command line; otherwise `-p` alone, and the prompt on stdin. */
function promptArgs(prompt: string): { args: string[]; input?: string } {
  return prompt.length > ARGV_PROMPT_LIMIT ? { args: ['-p'], input: prompt } : { args: ['-p', prompt] };
}

const liveChildren = new Set<ChildProcess>();
let terminationHandlerInstalled = false;

function spawnCollect(args: readonly string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal; input?: string }): Promise<SpawnOutcome> {
  if (!terminationHandlerInstalled) {
    terminationHandlerInstalled = true;
    // One implementation, two entry points: a POSIX SIGTERM (the shell's process-group kill) and the
    // frame-mode cancel in src/index.ts, which on Windows is the only one that can arrive.
    onShutdown(() => { for (const child of liveChildren) child.kill('SIGKILL'); });
    process.once('SIGTERM', () => {
      runShutdownHooks();
      // eslint-disable-next-line no-restricted-properties -- C6: the agent trust boundary must kill children before terminating the leader.
      process.exit(143);
    });
  }
  const command = resolveAgentCommand(agentCmd(), args, hostEvidence());
  if (!command.ok) return Promise.reject(new Error(command.error));
  // C6 again, for a caller that no longer wants the answer: a spawn is piped stdio, and node will not
  // let the process exit while it is open. A verb that starts a model call CONCURRENTLY with other
  // work (publish, whose category ask overlaps its `git fetch`) must be able to drop it, or a failure
  // in that other work waits out the full timeout before the CLI can report it. Aborting kills the
  // child; the `close` handler then settles this promise as an ordinary non-zero run.
  if (options.signal?.aborted) return Promise.resolve({ code: 143, stdout: '', stderr: 'the caller abandoned this model call', timedOut: false });
  return new Promise((resolvePromise, reject) => {
    const spawnOptions = {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      // Under the desktop app the agent must never flash a console window (matches the CLI runner).
      windowsHide: true,
    };
    const child = options.input === undefined
      ? spawn(command.value.file, command.value.args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(command.value.file, command.value.args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    liveChildren.add(child);
    if (options.input !== undefined && child.stdin) {
      // A child that exits before reading everything closes the pipe (EPIPE); its exit code and stderr say why.
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input, 'utf8');
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs);
    const onAbort = (): void => { child.kill('SIGKILL'); };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const settle = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); };
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => { settle(); reject(error); });
    child.on('close', (code) => {
      liveChildren.delete(child);
      settle();
      resolvePromise({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut });
    });
  });
}

export interface RunAgentOptions {
  transcriptPath?: string;
  maxTurns?: number;
  timeoutMs?: number;
  model?: string;
}

export interface AskJsonOptions {
  /** Defaults to project; an empty string disables settings for classification. */
  settingSources?: string;
  timeoutMs?: number;
  model?: string;
  /** Kills the spawned model call when the caller stops wanting it; the call then fails like any other. */
  signal?: AbortSignal;
}

/** Injection seam: judge/triggers/execution depend on this, never on the spawning functions directly. */
export interface AgentApi {
  runAgent(task: string, cwd: string, options?: RunAgentOptions): Promise<Transcript>;
  askJson(prompt: string, options?: AskJsonOptions): Promise<Record<string, unknown>>;
}

/** §7.1: one sandboxed agent run, cwd pinned to the sandbox, transcript optionally persisted. */
async function runAgent(task: string, cwd: string, options: RunAgentOptions = {}): Promise<Transcript> {
  const outcome = await run(task, cwd, options);
  if (options.transcriptPath !== undefined) await writeFile(options.transcriptPath, outcome.stdout, 'utf8');
  if (outcome.timedOut) throw new AgentTimeoutError(`agent run timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
  // Partial stream-json is still an unsuccessful agent run. Persist it first for
  // inspection, then let execution retry it in a fresh sandbox.
  if (outcome.code !== 0) throw new AgentRunError(`agent run failed (rc=${outcome.code}): ${outcome.stderr.slice(-2000)}`);
  return Transcript.fromStream(outcome.stdout);
}

function run(task: string, cwd: string, options: RunAgentOptions): Promise<SpawnOutcome> {
  const prompt = promptArgs(task);
  return spawnCollect([
    ...prompt.args,
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(options.maxTurns ?? 200),
    '--permission-mode', 'acceptEdits',
    '--allowedTools', AGENT_TOOLS,
    // Also the only thing keeping an eval out of its own way: the user's ~/.claude/settings.json is
    // where this product installs its SessionStart hook, and loading it here would make every agent
    // spawn start a sync that takes the very clone lock this run is holding (W-06). Do not drop it.
    // §7.3 contamination control by construction: the sandbox is the entire project scope.
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--append-system-prompt', HEADLESS_NOTE,
    '--model', options.model ?? DEFAULT_MODEL,
  ], { cwd, env: { CLAUDE_PROJECT_DIR: cwd }, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(prompt.input === undefined ? {} : { input: prompt.input }) });
}

/** §7.2 / §7.5: single-turn, tool-free model call that must return a JSON object. */
async function askJson(prompt: string, options: AskJsonOptions = {}): Promise<Record<string, unknown>> {
  const delivered = promptArgs(prompt);
  const outcome = await spawnCollect([
    ...delivered.args,
    '--output-format', 'json',
    '--max-turns', '1', '--disallowedTools', '*',
    '--setting-sources', options.settingSources ?? 'project', '--strict-mcp-config',
    '--model', options.model ?? DEFAULT_MODEL,
    // TCC hygiene: under the desktop app an inherited cwd is `/`, and agent startup work
    // scanning an unexpected root walks into macOS-protected dirs. Pin every spawn, like
    // runCase pins the sandbox; tool-free calls get the tmpdir.
  ], { cwd: tmpdir(), timeoutMs: options.timeoutMs ?? 120_000, ...(options.signal ? { signal: options.signal } : {}), ...(delivered.input === undefined ? {} : { input: delivered.input }) });
  if (outcome.timedOut) throw new AgentRunError(`model call timed out after ${options.timeoutMs ?? 120_000}ms`);
  if (outcome.code !== 0) throw new AgentRunError(`model call failed (rc=${outcome.code}): ${outcome.stderr.slice(-2000)}`);
  let text = outcome.stdout;
  try {
    const outer: unknown = JSON.parse(outcome.stdout);
    if (outer !== null && typeof outer === 'object' && typeof (outer as Record<string, unknown>)['result'] === 'string') {
      text = (outer as Record<string, unknown>)['result'] as string;
    }
  } catch { /* fall through to the raw stdout */ }
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new AgentRunError(`model did not return JSON: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch (error) {
    throw new AgentRunError(`model returned unparseable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const systemAgent: AgentApi = { runAgent, askJson };

/**
 * §7.4 preflight: record the CLI version, then one tiny real agent task in a throwaway dir.
 * Failure aborts before paid/slow work — SkillEvaluator's measured lesson (seconds, not six trials).
 */
export async function preflight(model: string = DEFAULT_MODEL): Promise<Result<{ ccVersion: string }>> {
  let version: SpawnOutcome;
  try {
    // cwd pinned for the same TCC reason as askJson: never probe from an inherited `/`.
    version = await spawnCollect(['--version'], { cwd: tmpdir(), timeoutMs: 15_000 });
  } catch (error) {
    return failure(`\`${agentCmd()}\` is not runnable (${error instanceof Error ? error.message : String(error)}) — is Claude Code installed and on PATH?`);
  }
  if (version.code !== 0) return failure(`\`${agentCmd()} --version\` failed (rc=${version.code}): ${version.stderr.slice(-500)}`);
  const ccVersion = version.stdout.trim();
  const scratch = await mkdtemp(join(tmpdir(), 'terum-evals-preflight-'));
  try {
    await runAgent('Reply with the single word: ok', scratch, { maxTurns: 1, timeoutMs: 120_000, model });
  } catch (error) {
    return failure(`preflight agent task failed — check that \`${agentCmd()}\` is logged in and the model '${model}' is available: ${error instanceof Error ? error.message : String(error)}`);
  }
  return success({ ccVersion });
}
