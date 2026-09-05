/**
 * Eval spec §3 / §7.1 / §7.4: the trust boundary. This is the ONLY module that spawns the agent
 * binary; everything that executes teammate skill content goes through `runAgent`/`askJson`.
 * Ported from skilldeck `evals/runner.py` (commit 42084dc). The binary name comes from
 * `TERUM_SKILLS_AGENT_CMD` (default `claude`) so tests can substitute a stub.
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

export const DEFAULT_MODEL = 'sonnet'; // §16.9 [provisional]
export const DEFAULT_TIMEOUT_MS = 600_000;
const AGENT_TOOLS = 'Bash Read Write Edit Glob Grep';

const agentCmd = (): string => process.env['TERUM_SKILLS_AGENT_CMD'] ?? 'claude';

export class AgentRunError extends Error {}

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

  /** §7.3: the arm's resolved skill list from the init event, or null when the field is absent (VE1). */
  skillList(): string[] | null {
    const init = this.events.find((event) => event.type === 'system' && event.subtype === 'init') as Record<string, unknown> | undefined;
    const skills = init?.['skills'];
    if (!Array.isArray(skills)) return null;
    return skills.map((entry) => (typeof entry === 'string' ? entry : String((entry as Record<string, unknown>)?.['name'] ?? ''))).filter(Boolean);
  }
}

interface SpawnOutcome { code: number; stdout: string; stderr: string; timedOut: boolean; }

function spawnCollect(args: readonly string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs: number }): Promise<SpawnOutcome> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(agentCmd(), [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
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
  timeoutMs?: number;
  model?: string;
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
  if (outcome.timedOut) throw new AgentRunError(`agent run timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
  if (outcome.code !== 0 && !outcome.stdout.trim()) throw new AgentRunError(`agent run failed (rc=${outcome.code}): ${outcome.stderr.slice(-2000)}`);
  return Transcript.fromStream(outcome.stdout);
}

function run(task: string, cwd: string, options: RunAgentOptions): Promise<SpawnOutcome> {
  return spawnCollect([
    '-p', task,
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(options.maxTurns ?? 25),
    '--permission-mode', 'acceptEdits',
    '--allowedTools', AGENT_TOOLS,
    // §7.3 contamination control by construction: the sandbox is the entire project scope.
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--model', options.model ?? DEFAULT_MODEL,
  ], { cwd, env: { CLAUDE_PROJECT_DIR: cwd }, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
}

/** §7.2 / §7.5: single-turn, tool-free model call that must return a JSON object. */
async function askJson(prompt: string, options: AskJsonOptions = {}): Promise<Record<string, unknown>> {
  const outcome = await spawnCollect([
    '-p', prompt,
    '--output-format', 'json',
    '--max-turns', '1', '--disallowedTools', '*',
    '--setting-sources', 'project', '--strict-mcp-config',
    '--model', options.model ?? DEFAULT_MODEL,
  ], { timeoutMs: options.timeoutMs ?? 120_000 });
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
    version = await spawnCollect(['--version'], { timeoutMs: 15_000 });
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
