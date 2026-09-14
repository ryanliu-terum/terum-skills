import { board, code, date, kv, path, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, nextDrain, nextEvalReport, num, receiptHeadline, receiptSections, str, versionText } from './shared.js';

function queueTable(items: Record<string, unknown>[], ctx: RenderContext, title: string) {
  return table([
    { key: 'skill', label: 'Skill', priority: 1 },
    { key: 'team', label: 'Team', priority: 2 },
    { key: 'digest', label: 'Digest', priority: 3 },
    { key: 'window', label: 'Window', priority: 2 },
    { key: 'queued', label: 'Queued', priority: 2 },
    { key: 'error', label: 'Last error', priority: 1 },
  ], items.map((item) => ({
    skill: text(item['skill']),
    team: text(item['team']),
    digest: code(str(item['contentHash'])?.replace(/^sha256:/, '').slice(0, 12)),
    window: text(item['window']),
    queued: date(item['requestedAt']),
    error: text(item['lastError']),
  })), { title, cap: ctx.rows });
}

function queue(value: Record<string, unknown>, ctx: RenderContext): Board {
  const items = asArray(value['items']).map(asRecord);
  const outcomes = asArray(value['outcomes']).map(asRecord);
  const attempted = num(value['attempted']);
  // R2: an empty drain (nothing attempted, nothing to report) is the list board — `eval.ts` prints "No queued evals." on
  // that path. With --window the full queue may still hold items for other windows; the list board shows them (truthful).
  if (attempted === null || (attempted === 0 && outcomes.length === 0)) {
    const b = board('Eval queue', { headline: items.length === 0 ? 'No queued evals.' : `${items.length} queued` });
    if (items.length) { b.sections.push(queueTable(items, ctx, 'Queued')); b.next.push(nextDrain()); }
    return b;
  }
  const ok = outcomes.filter((outcome) => bool(outcome['ok'])).length;
  const b = board('Eval queue — drain', { headline: `Evaluated ${ok} of ${outcomes.length}; ${outcomes.length - ok} failed.` });
  if (outcomes.length) {
    b.sections.push(table([
      { key: 'skill', label: 'Skill', priority: 1 },
      { key: 'outcome', label: 'Outcome', priority: 1 },
      { key: 'detail', label: 'Detail', priority: 2 },
    ], outcomes.map((outcome) => ({
      skill: text(str(outcome['team']) === null ? str(outcome['skill']) : `${outcome['team']}/${outcome['skill']}`),
      outcome: status(bool(outcome['ok']) ? 'ok' : 'bad', bool(outcome['ok']) ? 'ok' : 'failed'),
      detail: text(outcome['error']),
    })), { title: 'Outcomes' }));
  }
  if (items.length) b.sections.push(queueTable(items, ctx, 'Still queued'));
  const first = outcomes.find((outcome) => bool(outcome['ok']));
  if (first) b.next.push(nextEvalReport(str(first['skill']) ?? ''));
  if (items.length) b.next.push(nextDrain('Drain again'));
  return b;
}

/** `runMany` (PR #206): several skills, `--batch`, `--window`, `--pending` — `EvalManyResult { mode: 'ran' | 'queued', team, skills, ok, failed, queued, stoppedAfter? }`. */
function many(value: Record<string, unknown>, ctx: RenderContext): Board {
  const skills = asArray(value['skills']).map(String);
  const queued = asArray(value['queued']).map(asRecord);
  const ok = num(value['ok']) ?? 0;
  const failed = num(value['failed']) ?? 0;
  const stopped = num(value['stoppedAfter']);
  const isQueued = str(value['mode']) === 'queued';
  const b = board(isQueued ? 'Eval — queued' : 'Eval — batch', {
    // R4: the exact sentence `runMany` prints — `Evaluated ${ok} of ${skills.length}; ${failed} failed.`, not ok+failed.
    headline: isQueued ? `Queued ${queued.length} of ${skills.length}; nothing was run.` : `Evaluated ${ok} of ${skills.length}; ${failed} failed.`,
  });
  if (skills.length) b.sections.push(table([{ key: 'skill', label: 'Skill', priority: 1 }], skills.map((skill) => ({ skill: text(skill) })), { title: 'Requested', cap: ctx.rows }));
  if (queued.length) b.sections.push(queueTable(queued, ctx, 'Queued'));
  if (stopped !== null) b.notes.push(`Stopped after ${stopped} of ${skills.length}: a declined "Continue?" queued the rest for later.`);
  if (queued.length) b.next.push(nextDrain('Drain the queue'));
  for (const skill of skills.slice(0, 3)) b.next.push(nextEvalReport(skill));
  return b;
}

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw);
  if (Array.isArray(value['items'])) return queue(value, ctx);
  if (str(value['mode']) !== null) return many(value, ctx);
  const name = str(value['name']) ?? '—';
  if (bool(value['alreadyEvaluated'])) {
    const b = board(`Eval — ${name}`, { headline: 'Already evaluated these exact bytes; nothing was run.' });
    b.next.push(nextEvalReport(name));
    return b;
  }
  const report = asRecord(value['report']);
  const aggregate = report['aggregate'];
  const b = board(`Eval — ${name}`);
  b.headline = aggregate === undefined ? `${str(value['executionStatus']) ?? '—'}` : receiptHeadline({ ...asRecord(aggregate), provenance: {} }, ctx);
  const why = str(asRecord(aggregate)['attribution']);
  if (why !== null && why !== '') b.sections.push({ kind: 'text', title: 'Why', lines: [why] });
  const skips = Object.entries(asRecord(asRecord(aggregate)['environment_skips']));
  if (skips.length) b.sections.push({ kind: 'text', title: 'Skipped (environment)', lines: skips.map(([caseName, missing]) => `${caseName} — missing ${asArray(missing).join(', ')}`) });
  if (aggregate !== undefined) b.sections.push(...receiptSections(aggregate, report['triggers'], ctx));
  const published = str(value['publishedTo']);
  b.sections.push(kv([
    ['run dir', path(value['runDir'])],
    ['receipt', path(value['receiptPath'])],
    ['claude code', text(value['ccVersion'])],
    ['execution', status(value['executionStatus'] === 'complete' ? 'ok' : 'warn', value['executionStatus'])],
    ['team', text(value['team'])],
    ['published to', text(published === null ? null : `${str(value['team']) ?? '?'} (${versionText(published)})`)],
  ], 'Run'));
  const failed = str(asRecord(aggregate)['verdict']) === 'FAIL';
  if (bool(value['shareHint']) && !failed) b.next.push({ label: 'Publish', verb: 'publish', args: [name] }); // eval.ts advises against publishing a FAIL; the board must not invert it
  b.next.push(nextEvalReport(name));
  return b;
};

export const covered: RegExp[] = [
  /^verdict: /,
  /^why: /,
  /^skipped \(environment\): /,
  /^[\w-]+-vs-[\w-]+: /,
  /^arm scores: /,
  /^triggers: recall=/,
  /^  (MISS|FALSE-FIRE): /,
  /^efficiency: /,
  /^Published this receipt to /,
  // R1: narrowed to the non-FAIL variant only — eval.ts:619-625 deliberately advises against publishing a FAIL, and the
  // board's covered list must not swallow that advice as if the board already represented it.
  /^These bytes are not a published version, so nothing was shared\. To share these results, publish the skill again: /,
  /^Already evaluated these exact bytes of /,
  /^No queued evals\.$/,
  /^(\S+\/)?\S+@sha256:[0-9a-f]{64} · /,
  /^Evaluating \d+ skills?, \d+ at a time…$/,
  /^Evaluated \d+ of \d+; \d+ failed\.$/,
  /^Queued \d+ for (overnight|later): /,
  /^── .+ ──$/,
  /^[✓✗] /,
];

/** A buffered drain sub-run is not the drain board's own receipt, so keep its framing line and verdict as notes. */
export const uncovered = (lines: readonly string[], raw: unknown): string[] => {
  const value = asRecord(raw);
  const draining = Array.isArray(value['items']) && num(value['attempted']) !== null;
  const rescued = [/^── .+ ──$/, /^verdict: /];
  return lines.filter((line) => (draining && rescued.some((pattern) => pattern.test(line))) || !covered.some((pattern) => pattern.test(line)));
};

export const renderer: Renderer = { render, covered, uncovered };
