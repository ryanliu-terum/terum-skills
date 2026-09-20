import { board, kv, path, status, table, text, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asRecord, bool, num, str, nextListSkills, nextProjectAdd } from './shared.js';

/** `project list | add | remove` share one renderer: the value has no discriminant, so the keys decide. */
export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw);
  if (Array.isArray(value['projects'])) {
    const rows = value['projects'].map(asRecord);
    const b = board('Library projects', { headline: rows.length === 0 ? 'none' : `${rows.length} project${rows.length === 1 ? '' : 's'}` });
    if (rows.length) b.sections.push(table([{ key: 'label', label: 'Label', priority: 1 }, { key: 'path', label: 'Path', priority: 1 }, { key: 'state', label: 'State', priority: 1 }, { key: 'folders', label: 'Skill folders', priority: 2, align: 'right' }],
      rows.map((r) => { const state = str(r['rootState']) ?? '—'; return { label: text(r['label']), path: path(r['path']), state: status(state === 'scanned' ? 'ok' : state === 'absent' ? 'bad' : 'warn', state), folders: { kind: 'count', n: num(r['skillFolders']) } }; }), { cap: ctx.rows }));
    b.next.push(nextProjectAdd, nextListSkills(true));
    return b;
  }
  if ('placementsRemaining' in value) {
    const remaining = num(value['placementsRemaining']) ?? 0;
    const b = board('Project removed', { headline: `Removed ${str(value['path']) ?? '—'} from your library.` });
    b.sections.push(kv([['path', path(value['path'])], ['placements still recorded', text(remaining)]]));
    if (remaining > 0) { b.notes.push(`${remaining} placement${remaining === 1 ? '' : 's'} recorded under ${str(value['path']) ?? '—'} ${remaining === 1 ? 'stays' : 'stay'} in the ledger; uninstall-skill removes them.`); b.next.push({ label: 'Remove placements', verb: 'uninstall-skill', args: ['<ref>'] }); }
    b.next.push({ label: 'Projects', verb: 'project list', args: [] });
    return b;
  }
  const added = bool(value['added']);
  const b = board(added ? 'Project added' : 'Project already in your library', { headline: added ? `Added ${str(value['path']) ?? '—'} to your library.` : `${str(value['path']) ?? '—'} is already in your library.` });
  b.sections.push(kv([['path', path(value['path'])], ['label', text(value['label'])]]));
  b.next.push(nextListSkills(true));
  return b;
};
export const covered: RegExp[] = [/^.+ — .+; (scanned|absent|unreadable); \d+ skill folders$/, /^none$/, /^Added .+ to your library\.$/, /^.+ is already in your library\.$/, /^Removed .+ from your library\.$/, /^\d+ placements recorded under .+ stay in the ledger; uninstall-skill removes them\.$/];
export const renderer: Renderer = { render, covered };
