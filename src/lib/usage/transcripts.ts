/**
 * Local firing scanner (build spec §4.1, §5). Streams Claude Code session transcripts and yields
 * one event per observed skill invocation. No aggregation, no I/O policy, no filesystem writes.
 *
 * Two detectors, because a slash-invoked skill writes no `Skill` record at all (§2.3):
 *
 * - **D1 autonomous** — an assistant `tool_use` block named `Skill`; the model chose it from the
 *   catalog. Skill name is `input.skill`.
 * - **D2 explicit** — a user message carrying `<command-name>/name</command-name>`; the human
 *   named it. Skill name is the capture group.
 *
 * D2 is ADDITIONAL to D1, never a subset: measured 2026-09-15 over 706 local transcripts, all 168
 * `Skill` records were `caller: {type:'direct'}` and `isSidechain: false`, and not one of the
 * slash-invoked skills appeared among them.
 *
 * This is deliberately NOT `Transcript` in `src/lib/evals/agent.ts`. That class parses
 * **stream-json** output from a spawned eval run and is the agent trust boundary; session
 * transcripts are a different format (§2.1). Two parsers is correct here.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Claude Code keeps session transcripts. One level of project dirs, then `*.jsonl`. */
export const defaultProjectsRoot = (): string => join(homedir(), '.claude', 'projects');

export type FiringKind = 'D1' | 'D2';

/** One observed invocation. These four fields are the whole record — see §8's privacy rule. */
export interface UsageEvent {
  kind: FiringKind;
  skill: string;
  /** ISO-8601, straight from the record. */
  ts: string;
  /** `cli` is a human at a terminal; `sdk-cli` is a headless run — every eval sandbox, every subagent. */
  entrypoint: string;
}

/**
 * §2.4 — the pollution filter is a field, not a heuristic. Measured 2026-09-15: 155 of 168 `Skill`
 * records were `sdk-cli`. One field, no path list, no naming conventions to maintain.
 */
const isHuman = (record: Record<string, unknown>): boolean => record['entrypoint'] === 'cli' && record['isSidechain'] !== true;

/**
 * Claude Code's own slash commands. They travel in exactly the same `<command-name>` envelope a
 * skill does, so counting them as skills is a straight-up error (§4.1).
 *
 * The list's job is narrow and stays narrow: under §4.2 a row exists only for a PLACED skill, so a
 * builtin can never become a row. This keeps builtins out of the `unrecognised` tail, nothing more.
 * Measured 2026-09-15: these are 19 of the 30 `<command-name>` messages on this machine.
 */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  'add-dir', 'agents', 'bug', 'clear', 'compact', 'config', 'context', 'cost', 'doctor', 'exit',
  'export', 'help', 'hooks', 'ide', 'init', 'install-github-app', 'login', 'logout', 'mcp',
  'memory', 'migrate-installer', 'model', 'output-style', 'permissions', 'plan', 'pr-comments',
  'privacy-settings', 'release-notes', 'resume', 'review', 'rewind', 'status', 'statusline',
  'terminal-setup', 'todos', 'upgrade', 'usage', 'vim', 'workflows',
]);

const COMMAND_NAME = /<command-name>\/?([a-zA-Z0-9:_-]+)<\/command-name>/g;

/** Message content is a bare string or a block array; only text blocks can carry a command name. */
function messageText(message: unknown): string {
  if (typeof message !== 'object' || message === null) return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '')).join('\n');
}

/** Every `Skill` tool_use block in one assistant record. */
function skillCalls(message: unknown): string[] {
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as { type?: unknown; name?: unknown; input?: unknown };
    if (b.type !== 'tool_use' || b.name !== 'Skill') continue;
    const skill = (b.input as { skill?: unknown } | undefined)?.skill;
    if (typeof skill === 'string' && skill.length > 0) names.push(skill);
  }
  return names;
}

/**
 * Events from one transcript's text. Exported for tests: it is the whole parser, and it is pure.
 *
 * A malformed line is skipped, never fatal — the `localReceiptsFor` precedent, fail open. A
 * truncated final line is the common case (Claude Code appends while we read) and is just one more
 * unparsable line.
 */
export function parseTranscript(text: string): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: Record<string, unknown>;
    try { record = JSON.parse(trimmed) as Record<string, unknown>; }
    catch { continue; }
    if (typeof record !== 'object' || record === null) continue;
    if (!isHuman(record)) continue;
    const ts = record['timestamp'];
    const entrypoint = record['entrypoint'];
    if (typeof ts !== 'string' || typeof entrypoint !== 'string') continue;
    if (record['type'] === 'assistant') {
      for (const skill of skillCalls(record['message'])) events.push({ kind: 'D1', skill, ts, entrypoint });
    } else if (record['type'] === 'user') {
      const text = messageText(record['message']);
      if (text.length === 0) continue;
      COMMAND_NAME.lastIndex = 0;
      for (const match of text.matchAll(COMMAND_NAME)) {
        const skill = match[1]!;
        if (BUILTIN_COMMANDS.has(skill)) continue;
        events.push({ kind: 'D2', skill, ts, entrypoint });
      }
    }
  }
  return events;
}

export interface ScanOptions {
  /** Defaults to `~/.claude/projects`. */
  root?: string;
  /** Called once per unreadable transcript. Fail open, never quietly — §10. */
  onProblem?: (path: string, reason: string) => void;
}

/**
 * Every firing in every session transcript. A missing projects root is an empty result, not an
 * error (§10) — a machine that has never run Claude Code is not a failure case.
 *
 * The glob is deliberately one level deep, matching `~/.claude/projects/<project>/<session>.jsonl`.
 * Nested subagent and workflow transcripts live deeper and are excluded: measured 2026-09-15, one
 * level matches 707 files where recursing finds 1032.
 */
export async function scanTranscripts(options: ScanOptions = {}): Promise<UsageEvent[]> {
  const root = options.root ?? defaultProjectsRoot();
  let projects: string[];
  try { projects = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
  const events: UsageEvent[] = [];
  for (const project of projects.sort()) {
    const dir = join(root, project);
    let files: string[];
    try { files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')); }
    catch (error) { options.onProblem?.(dir, error instanceof Error ? error.message : String(error)); continue; }
    for (const file of files.sort()) {
      const path = join(dir, file);
      try { events.push(...parseTranscript(await readFile(path, 'utf8'))); }
      catch (error) { options.onProblem?.(path, error instanceof Error ? error.message : String(error)); }
    }
  }
  return events;
}
