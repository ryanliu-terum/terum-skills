import { board, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, num, str, nextListSkills } from './shared.js';

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const rows = asArray(raw).map(asRecord);
  // A null count in any row makes the total unknown — never silently treat a missing count as 0.
  const counts = rows.map((r) => num(r['removed']));
  const removed = counts.every((n): n is number => n !== null) ? counts.reduce((sum, n) => sum + n, 0) : null;
  const b = board('Uninstall', { headline: rows.length === 0 ? 'Nothing was placed on this machine.' : removed === null ? 'Folders removed: —' : `${removed} folder${removed === 1 ? '' : 's'} removed` });
  if (rows.length) b.sections.push(table([{ key: 'id', label: 'Id', priority: 1 }, { key: 'team', label: 'Team', priority: 2 }, { key: 'removed', label: 'Removed', priority: 1, align: 'right' }], rows.map((r) => ({ id: text(str(r['id'])?.slice(0, 8)), team: text(r['team']), removed: { kind: 'count', n: num(r['removed']) } })), { cap: ctx.rows }));
  b.next.push(nextListSkills(true));
  return b;
};
export const renderer: Renderer = { render, covered: [] };
