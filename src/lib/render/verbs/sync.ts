import { board, code, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, bool, str, nextListSkills } from './shared.js';

const TONE = { refreshed: 'ok', fresh: 'muted', busy: 'pending', unreachable: 'bad', 'no-clone': 'warn', error: 'bad' } as const; // `fresh`: hook mode left a clone fetched within the hour alone (PR #206)
export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw); const teams = asArray(value['teams']).map(asRecord);
  const b = board('Sync', { headline: teams.length === 0 ? 'No team configured.' : bool(value['changed']) ? 'The read verbs see new commits.' : 'Nothing changed.' });
  b.sections.push(table([{ key: 'team', label: 'Team', priority: 1 }, { key: 'state', label: 'State', priority: 1 }, { key: 'changed', label: 'Changed', priority: 2 }, { key: 'head', label: 'HEAD', priority: 3 }, { key: 'detail', label: 'Detail', priority: 2 }],
    teams.map((t) => { const state = str(t['state']) ?? 'error'; return { team: text(t['team']), state: status(TONE[state as keyof typeof TONE] ?? 'bad', state), changed: text(bool(t['changed']) ? 'yes' : 'no'), head: code(str(t['head'])?.slice(0, 12)), detail: text(str(t['detail']) ?? str(t['summary'])) }; }), { cap: ctx.rows }));
  for (const t of teams) {
    const ownerRepo = str(asRecord(asArray(t['successors'])[0])['ownerRepo']);
    if (ownerRepo !== null) b.next.push({ label: 'Follow the move', verb: 'team move', args: [ownerRepo] });
  }
  b.notes.push(...asArray(value['notices']).map(String));
  if (b.next.length === 0) b.next.push(nextListSkills());
  return b;
};
export const covered: RegExp[] = [/^\S+: not refreshed \(/, /^To follow it, run /];
export const renderer: Renderer = { render, covered };
