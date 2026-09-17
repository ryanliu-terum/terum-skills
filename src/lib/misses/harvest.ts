/**
 * Layer 3, stage 1–3 (spec §3, §5.2a): transcript text → judgeable prompts, each carrying the
 * context the judge needs and the observation set reconciliation compares against.
 *
 * The load-bearing correction this module exists to honour is parent §2.3: a typed slash command
 * writes **no `Skill` record at all**. A harvester that only looked for `Skill` tool_use blocks
 * would hold no evidence that an explicit firing ever happened, and would then report every
 * human-typed `/decision-walk` as a candidate miss — the exact false-miss failure §5.3 calls the
 * worse error. So the `<command-name>` envelope is skipped as a *prompt* and kept as a D2
 * *observation*.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_COMMANDS, defaultProjectsRoot, type FiringKind } from '../usage/transcripts.js';

/** §5.2a.4 — named here, never a flag. A knob on these is a knob on what a judgment *means*. */
export const CONTEXT_EXCHANGES = 3;
/** Set against §6's ~3,000-input-token budget: a full window plus the catalog stays inside it. */
export const CONTEXT_CHAR_CAP = 1000;

/** One firing seen in a prompt's association window. Per skill, per kind — never a boolean (§3). */
export interface Observation { skill: string; kind: FiringKind }

export interface HarvestedPrompt {
  text: string;
  ts: string;
  /** Up to `CONTEXT_EXCHANGES` preceding turns, oldest first. */
  context: string[];
  noPriorContext: boolean;
  observations: Observation[];
}

const COMMAND_NAME = /<command-name>\/?([a-zA-Z0-9:_-]+)<\/command-name>/g;
/** Harness-injected notifications. They carry `promptSource` like a real prompt, so only content
 * distinguishes them — measured 2026-09-17: 238 of them on this machine, none typed by a person. */
const TASK_NOTIFICATION = '<task-notification>';
/** Appended context, not the person's words. Stripped before judging so it neither steers the judge
 * nor inflates the ~3,000-token budget §6 sizes the window against. */
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** §5.2a.1 — layer 2's filter, unchanged. `sdk-cli` is every eval sandbox, every subagent, and
 * every call this feature's own judge makes (§8): it is what closes the self-ingestion loop. */
const isHuman = (record: Record<string, unknown>): boolean => record['entrypoint'] === 'cli' && record['isSidechain'] !== true;

/** Message content is a bare string or a block array; only text blocks carry prose. */
function messageText(message: unknown): string {
  if (typeof message !== 'object' || message === null) return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
    .filter((text) => text.length > 0)
    .join('\n');
}

/**
 * Records Claude Code injects into the user role rather than a person typing (§5.2a.2).
 *
 * `isMeta` is the field that matters, and the failure it prevents is embarrassing without it: when a
 * slash command runs, the skill's own body is injected as a `type:'user'` record. Harvested as a
 * prompt, `/codex-spec` becomes the prompt *"Base directory for this skill: …/codex-spec"* — and the
 * screener then reports that codex-spec looked applicable and never fired, about the literal text of
 * codex-spec firing. Measured 2026-09-17: 20 such records locally, every one `isMeta: true` with no
 * `promptSource`, against 605 genuine prompts that have `promptSource` and no `isMeta`.
 */
const isInjected = (record: Record<string, unknown>, text: string): boolean =>
  record['isMeta'] === true || text.includes(TASK_NOTIFICATION);

/** True when every block is a tool_result — the record is plumbing, not a person talking (§5.2a.2). */
function isToolResult(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_result');
}

/** Every `Skill` tool_use block in one assistant record — the D1 detector. */
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

/** Skill names named by `<command-name>` envelopes in this text, builtins excluded — the D2 detector. */
function commandNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(COMMAND_NAME)) {
    const name = match[1];
    if (name !== undefined && !BUILTIN_COMMANDS.has(name)) names.push(name);
  }
  return names;
}

/** §5.2a.4 — keep the TAIL. The referent for "do that" is at the end, not the start. */
const trimTail = (text: string): string => (text.length <= CONTEXT_CHAR_CAP ? text : `…${text.slice(-CONTEXT_CHAR_CAP)}`);

interface OpenTurn { prompt: HarvestedPrompt; parts: string[] }

/**
 * One transcript's harvested prompts. Pure, exported, and the whole parser — the shape
 * `usage/transcripts.ts` established.
 *
 * The turn machine (§5.2a.2): a turn OPENS at a user record carrying human text and CLOSES at the
 * next one. Assistant records, their `tool_use` blocks, `tool_result` user records and
 * `<command-name>` envelopes all belong to the turn that is currently open — which is why a `Skill`
 * call in a *later* turn is not this prompt's firing.
 */
export function harvestTranscript(text: string): HarvestedPrompt[] {
  const done: HarvestedPrompt[] = [];
  const turnText: string[] = [];
  let open: OpenTurn | null = null;

  const close = (): void => {
    if (open === null) return;
    turnText.push(open.parts.join('\n'));
    done.push(open.prompt);
    open = null;
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: Record<string, unknown>;
    // A malformed or half-written line is a smaller corpus, never a fatal error (§10 fail open).
    try { record = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }
    if (!isHuman(record)) continue;

    const message = record['message'];
    const body = messageText(message);

    if (record['type'] === 'assistant') {
      if (open !== null) {
        for (const skill of skillCalls(message)) open.prompt.observations.push({ skill, kind: 'D1' });
        if (body.length > 0) open.parts.push(body);
      }
      continue;
    }

    if (record['type'] !== 'user') continue;
    // Plumbing, not a person: never opens a turn, never joins the context (§5.2a.2, §5.2a.4).
    if (isToolResult(message)) continue;

    if (isInjected(record, body)) continue;

    const named = commandNames(body);
    if (named.length > 0) {
      // §5.2a.3 — an envelope does NOT open a turn. It is a D2 observation in the open turn; with
      // no open turn it is an orphan firing, real but with no prompt to be a candidate against.
      if (open !== null) for (const skill of named) open.prompt.observations.push({ skill, kind: 'D2' });
      continue;
    }
    const spoken = body.replace(SYSTEM_REMINDER, '').trim();
    if (spoken.length === 0) continue;

    const ts = record['timestamp'];
    if (typeof ts !== 'string' || ts.length === 0) continue;

    close();
    const context = turnText.slice(-CONTEXT_EXCHANGES).map(trimTail).filter((part) => part.length > 0);
    open = {
      prompt: { text: spoken, ts, context, noPriorContext: context.length === 0, observations: [] },
      parts: [spoken],
    };
  }
  close();
  return done;
}

export interface HarvestOptions {
  root?: string;
  onProblem?: (path: string, reason: string) => void;
}

/**
 * The corpus walk. §12.5 records the open call to export layer 2's walk and share it; until that is
 * decided this duplicates it, deliberately — the alternative edits shipped code in a release
 * candidate. One level of project dirs only: nested paths are subagent transcripts (parent §3).
 */
export async function harvestCorpus(options: HarvestOptions = {}): Promise<HarvestedPrompt[]> {
  const root = options.root ?? defaultProjectsRoot();
  let projects: string[];
  try { projects = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
  const prompts: HarvestedPrompt[] = [];
  for (const project of projects.sort()) {
    const dir = join(root, project);
    let files: string[];
    try { files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')); }
    catch (error) { options.onProblem?.(dir, error instanceof Error ? error.message : String(error)); continue; }
    for (const file of files.sort()) {
      const path = join(dir, file);
      try { prompts.push(...harvestTranscript(await readFile(path, 'utf8'))); }
      catch (error) { options.onProblem?.(path, error instanceof Error ? error.message : String(error)); }
    }
  }
  return prompts;
}
