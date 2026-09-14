/** What every renderer needs: null-safe readers over an `unknown` value, the receipt sections, the skills table, the Next items. */
import { bar, bars, code, count, date, kv, table, text, textBlock, verdict, type Cell, type NextItem, type RenderContext, type Section, type Table } from '../board.js';
import { displayName, liftText, marketplaceOrder, parseVersionOrdinal, roiFractions, shortDescription, stripText, summariseReceipt, updateAvailable, type ReceiptLike } from '../policies.js';
import { relativeDate } from '../text.js';

export const asRecord = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
export const bool = (value: unknown): boolean => value === true;
export function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function versionText(folder: unknown): string { const n = parseVersionOrdinal(str(folder)); return n === null ? '—' : `Version ${n}`; }

const receiptCount = (value: unknown): number => {
  const n = num(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
/** Unlike receiptCount, a missing or malformed row count stays null (not 0) — R6: a partial cell must render — / —, never a false 0/0. */
const receiptCountOrNull = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function receiptLike(value: unknown): ReceiptLike | null {
  const r = asRecord(value);
  const verdictValue = r['verdict'];
  if (verdictValue !== 'PASS' && verdictValue !== 'NEUTRAL' && verdictValue !== 'FAIL') return null;
  const status = r['execution_status'];
  const comparisons: ReceiptLike['comparisons'] = {};
  for (const [name, value] of Object.entries(asRecord(r['comparisons']))) {
    const comparison = asRecord(value);
    const signP = num(comparison['sign_p']);
    comparisons[name] = {
      win: receiptCount(comparison['win']),
      loss: receiptCount(comparison['loss']),
      tie: receiptCount(comparison['tie']),
      ...(signP === null ? {} : { sign_p: signP }),
    };
  }
  return { verdict: verdictValue, execution_status: status === 'partial' || status === 'failed' ? status : 'complete', expected_rows: receiptCountOrNull(r['expected_rows']), scored_rows: receiptCountOrNull(r['scored_rows']), comparisons };
}

export function receiptVerdict(receipt: unknown, extra: { stale?: boolean; from?: string | null; invalid?: boolean } = {}): Cell {
  const summary = summariseReceipt(receiptLike(receipt));
  if (summary === null) return verdict({ verdict: null, stale: extra.stale, invalid: extra.invalid });
  return verdict({ verdict: summary.verdict, lift: summary.lift, partial: summary.partial, stale: extra.stale, from: extra.from ?? null, invalid: extra.invalid });
}

/** `✓ PASS +33% · 4W 2L 0T (n=6) · p=0.031 · complete · sonnet k=1 · @mira · 12d ago` */
export function receiptHeadline(receipt: unknown, ctx: RenderContext): string {
  const summary = summariseReceipt(receiptLike(receipt));
  if (summary === null) return '— not evaluated';
  const r = asRecord(receipt); const provenance = asRecord(r['provenance']);
  const glyph = summary.verdict === 'PASS' ? '✓' : summary.verdict === 'FAIL' ? '✗' : '●';
  const parts = [`${glyph} ${summary.verdict} ${liftText(summary.lift)}`, `${summary.w}W ${summary.l}L ${summary.t}T (n=${summary.n})`];
  if (summary.signP !== null) parts.push(`p=${summary.signP}`);
  // R6: same "partial X/Y" wording as today when both counts exist; an absent count renders — rather than a false 0.
  parts.push(summary.partial ? `partial ${summary.partial.scored ?? '—'}/${summary.partial.expected ?? '—'}` : str(r['execution_status']) ?? 'complete');
  const model = str(provenance['model']); const k = num(provenance['k']);
  if (model !== null) parts.push(k === null ? model : `${model} k=${k}`);
  const runner = str(provenance['runner_handle']); if (runner !== null) parts.push(`@${runner}`);
  const when = str(provenance['timestamp']); if (when !== null) parts.push(relativeDate(when, ctx.now));
  return parts.join(' · ');
}

/** The receipt's own sections, one receipt only (never combined, §5): comparisons, arm scores, efficiency + ROI, triggers, provenance. */
export function receiptSections(receipt: unknown, triggers: unknown, ctx: RenderContext): Section[] {
  void ctx; // The shared renderer signature carries context; date cells defer using it to the backend.
  const r = asRecord(receipt); const sections: Section[] = [];
  const comparisons = Object.entries(asRecord(r['comparisons']));
  if (comparisons.length) {
    sections.push(table([{ key: 'name', label: 'Comparison', priority: 1 }, { key: 'w', label: 'W', priority: 1, align: 'right' }, { key: 'l', label: 'L', priority: 1, align: 'right' }, { key: 't', label: 'T', priority: 1, align: 'right' }, { key: 'lift', label: 'Lift', priority: 1 }, { key: 'p', label: 'p', priority: 2 }, { key: 'strip', label: 'Record', priority: 3 }],
      comparisons.map(([name, value]) => { const c = asRecord(value); const w = receiptCount(c['win']), l = receiptCount(c['loss']), t = receiptCount(c['tie']); const signP = num(c['sign_p']); const s = summariseReceipt({ verdict: 'NEUTRAL', execution_status: 'complete', expected_rows: 0, scored_rows: 0, comparisons: { 'candidate-vs-baseline': { win: w, loss: l, tie: t, ...(signP === null ? {} : { sign_p: signP }) } } })!; return { name: text(name), w: count(w), l: count(l), t: count(t), lift: text(liftText(s.lift)), p: text(s.signP), strip: { kind: 'strip', text: stripText(w, l, t) } as Cell }; }),
      { title: 'Comparisons' }));
  }
  const scores = Object.entries(asRecord(r['arm_scores']));
  if (scores.length) sections.push(bars(scores.map(([arm, score]) => ({ label: arm, fraction: num(score), value: num(score) === null ? 'n/a' : num(score)!.toFixed(2) })), 'Arm scores'));
  const efficiency = Object.entries(asRecord(r['efficiency']));
  if (efficiency.length) {
    sections.push(table([{ key: 'arm', label: 'Arm', priority: 1 }, { key: 'turns', label: 'Turns', priority: 2, align: 'right' }, { key: 'time', label: 'Time', priority: 1 }, { key: 'cost', label: 'Cost', priority: 1 }],
      efficiency.map(([arm, value]) => { const e = asRecord(value); const turns = num(e['turns']); const ms = num(e['duration_ms']); const cost = num(e['cost_usd']); return { arm: text(arm), turns: text(turns === null ? null : turns.toFixed(1)), time: text(ms === null ? null : `${(ms / 1000).toFixed(1)}s`), cost: text(cost === null ? null : `$${cost.toFixed(2)}`) }; }),
      { title: 'Efficiency' }));
    const candidate = num(asRecord(asRecord(r['efficiency'])['candidate'])['cost_usd']); const baseline = num(asRecord(asRecord(r['efficiency'])['baseline'])['cost_usd']);
    const roi = roiFractions(candidate, baseline);
    if (roi !== null) sections.push(bars([{ label: 'candidate', fraction: roi[0], value: `$${candidate!.toFixed(2)}` }, { label: 'baseline', fraction: roi[1], value: `$${baseline!.toFixed(2)}` }], 'Cost, over the costlier arm'));
  }
  const trig = asRecord(triggers ?? r['triggers']);
  if (Object.keys(trig).length) {
    const f = (value: unknown): string => (num(value) === null ? 'n/a' : num(value)!.toFixed(2));
    const lines = [`recall ${f(trig['recall'])} · precision ${f(trig['precision'])} (tp ${num(trig['tp']) ?? '—'} fn ${num(trig['fn']) ?? '—'} fp ${num(trig['fp']) ?? '—'} tn ${num(trig['tn']) ?? '—'})`];
    for (const rowValue of asArray(trig['rows'])) { const row = asRecord(rowValue); if (row['correct'] === false) lines.push(`${row['expected'] === true ? 'MISS' : 'FALSE-FIRE'}: ${JSON.stringify(str(row['prompt']) ?? '')}${str(row['error']) === null ? '' : ` (selection call errored: ${str(row['error'])!.slice(0, 120)})`}`); }
    sections.push(textBlock(lines, { title: 'Triggers' }));
  }
  const provenance = asRecord(r['provenance']);
  if (Object.keys(provenance).length) sections.push(kv([['model', text(provenance['model'])], ['judge', text(provenance['judge_model'])], ['k', count(provenance['k'])], ['cases', text(asArray(provenance['cases']).length || null)], ['engine', text(str(provenance['engine_version']) === null ? null : `${provenance['engine_version']} (${provenance['engine_commit'] ?? '—'})`)], ['claude code', text(provenance['cc_version'])], ['runner', text(str(provenance['runner_handle']) === null ? null : `@${provenance['runner_handle']}`)], ['when', date(provenance['timestamp'])]], 'Provenance'));
  return sections;
}

export interface SkillRowInput {
  id: string | null;
  name: string;
  description: unknown;
  author: unknown;
  category: unknown;
  latest: unknown;
  installs: unknown;
  updated: unknown;
  receipt?: unknown;
  evalVersion?: unknown;
  latestEvalState?: unknown;
  team?: unknown;
}

/** Skill(1) · Desc(2, max 60) · Author(3) · Category(2) · Ver(1) · Installs(1, ▲) · Eval(1) · Updated(3) — the Marketplace shape, reused by Project and Search. */
export function skillsTable(rows: readonly SkillRowInput[], ctx: RenderContext, options: { title?: string; viewerInstalled?: ReadonlyMap<string, string | null>; eval: boolean; team?: boolean }): Table {
  const columns = [
    ...(options.team ? [{ key: 'team', label: 'Team', priority: 2 as const }] : []),
    { key: 'skill', label: 'Skill', priority: 1 as const }, { key: 'desc', label: 'Desc', priority: 2 as const, max: 60 }, { key: 'author', label: 'Author', priority: 3 as const }, { key: 'category', label: 'Category', priority: 2 as const },
    { key: 'ver', label: 'Ver', priority: 1 as const }, { key: 'installs', label: 'Installs', priority: 1 as const, align: 'right' as const },
    ...(options.eval ? [{ key: 'eval', label: 'Eval', priority: 1 as const }] : []), { key: 'updated', label: 'Updated', priority: 3 as const },
  ];
  const sorted = [...rows].sort((a, b) => marketplaceOrder({ installs: num(a.installs) ?? 0, name: a.name }, { installs: num(b.installs) ?? 0, name: b.name }));
  return table(columns, sorted.map((row) => {
    const held = row.id === null ? undefined : options.viewerInstalled?.get(row.id);
    const marker = held !== undefined && updateAvailable(str(row.latest) ?? '', held);
    const latestN = parseVersionOrdinal(str(row.latest)); const evalN = num(row.evalVersion);
    return {
      ...(options.team ? { team: text(row.team) } : {}),
      skill: text(row.name), desc: text(shortDescription(str(row.description), 60)), author: text(displayName(str(row.author))), category: text(row.category),
      ver: text(versionText(row.latest)), installs: marker ? text(`${num(row.installs) ?? '—'} ▲`, 'right') : count(row.installs),
      ...(options.eval ? { eval: receiptVerdict(row.receipt, { invalid: row.latestEvalState === 'invalid', from: evalN !== null && latestN !== null && evalN !== latestN ? `Version ${evalN}` : null }) } : {}),
      updated: date(row.updated),
    };
  }), { ...(options.title === undefined ? {} : { title: options.title }), cap: ctx.rows });
}

export const nextSkillInfo = (name: string): NextItem => ({ label: 'Details', skill: 'skill-info', verb: 'ls skill', args: [name] });
export const nextEval = (name: string, ...flags: string[]): NextItem => ({ label: 'Evaluate', skill: 'eval', verb: 'eval', args: [name, ...flags] });
export const nextEvalReport = (name: string): NextItem => ({ label: 'Eval report', skill: 'eval-report', verb: 'eval-report', args: [name] });
export function nextDrain(label = 'Drain'): NextItem { return { label, skill: 'eval', verb: 'eval', args: ['--drain'] }; }
export const nextInstall = (...args: string[]): NextItem => ({ label: 'Install', verb: 'install', args });
export const nextListSkills = (local = false): NextItem => ({ label: local ? 'Library' : 'Marketplace', skill: 'list-skills', verb: 'ls', args: local ? ['--local'] : [] });
export const nextSearch = (term: string): NextItem => ({ label: 'Search', skill: 'search-skills', verb: 'search', args: [term] });
export const nextSync: NextItem = { label: 'Sync', skill: 'sync-skills', verb: 'sync', args: [] };
export const nextStatus: NextItem = { label: 'Status', skill: 'skill-status', verb: 'status', args: [] };
export const nextProjectAdd: NextItem = { label: 'Add a project', verb: 'project add', args: [] };
export { bar, bars, code, count, date, kv, table, text, textBlock };
