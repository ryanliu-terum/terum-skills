import { board, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, nextInstall, nextSkillInfo, skillsTable, str } from './shared.js';

/** The term and the active filters, read from the verb's own argv (`search <term> [--category x] [--author y] [--project z]`). */
function describe(argv: readonly string[]): string {
  const args = argv[1] === '--' ? argv.slice(2) : argv.slice(1);
  const term = args[0] ?? '';
  const filters: string[] = [];
  for (const flag of ['category', 'author', 'project']) {
    const at = argv.indexOf(`--${flag}`);
    if (at !== -1 && argv[at + 1] !== undefined) filters.push(`${flag} ${argv[at + 1]}`);
  }
  return `Search "${term}"${filters.length ? ` · ${filters.join(' · ')}` : ''}`;
}

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const hits = asArray(raw).map(asRecord);
  const teams = new Set(hits.map((hit) => str(hit['team'])));
  const b = board(describe(ctx.argv), {
    headline: hits.length === 0 ? 'No skills found.' : `${hits.length} hit${hits.length === 1 ? '' : 's'}`,
  });
  if (hits.length) {
    b.sections.push(skillsTable(hits.map((hit) => ({
      id: str(hit['id']),
      name: str(hit['name']) ?? '—',
      description: hit['description'],
      author: hit['author'],
      category: hit['category'],
      latest: hit['latest'],
      installs: hit['installs'],
      updated: hit['updated'],
      team: hit['team'],
    })), ctx, { eval: false, team: teams.size > 1 }));
  }
  const first = str(hits[0]?.['name']);
  if (first !== null) b.next.push(nextSkillInfo(first), nextInstall(first));
  return b;
};

// R3: "may be stale; run …" is represented nowhere on this board (no column shows it), so it stays a note — the multi-team
// header (`/^\S+:$/`) stays covered: it is represented by the Team column, and the catch-path header is redundant with
// the line that follows it, which already names the team.
export const covered: RegExp[] = [/^\S+:$/, /^  .+ — .+; \d+ installs; /, /^No skills found\.$/];
export const renderer: Renderer = { render, covered };
