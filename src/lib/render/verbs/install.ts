import { board, path, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, str, versionText, nextListSkills } from './shared.js';

export const render = (raw: unknown, ctx: RenderContext): Board => {
  // `install` returns an array of placements; `install --adopt` returns ONE record (AdoptedResult) — a folder recorded where it is.
  const adopted = !Array.isArray(raw) && raw !== null && typeof raw === 'object';
  const rows = adopted ? [asRecord(raw)] : asArray(raw).map(asRecord);
  const b = board('Install', { headline: rows.length === 0 ? 'Nothing installed.' : adopted ? 'Adopted where it is.' : `${rows.length} skill${rows.length === 1 ? '' : 's'} placed` });
  if (rows.length) b.sections.push(table([{ key: 'id', label: 'Id', priority: 2 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'path', label: 'Path', priority: 1 }, { key: 'team', label: 'Team', priority: 3 }, { key: 'profiled', label: 'Profiled', priority: 2 }],
    rows.map((r) => {
      // Tri-state: `status()` always prepends a tone glyph (renderCell in cells.ts), so a null
      // profiled must go through `text(null)` for a bare `—` — `status('muted', null)` would print
      // the muted glyph itself (also `—`) plus the em dash again, doubling it.
      const profiled = r['profiled'] === true ? 'yes' : r['profiled'] === false ? 'no' : null;
      return { id: text(str(r['id'])?.slice(0, 8)), version: text(versionText(r['version'])), path: path(r['path']), team: text(r['team']), profiled: profiled === null ? text(null) : status(profiled === 'yes' ? 'ok' : 'muted', profiled) };
    }), { cap: ctx.rows }));
  b.next.push(nextListSkills(true));
  return b;
};
export const renderer: Renderer = { render, covered: [] };
