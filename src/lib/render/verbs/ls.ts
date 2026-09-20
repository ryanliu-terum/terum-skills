import { board, kv, path, status, table, text, textBlock, type Board, type RenderContext, type Section } from '../board.js';
import { attentionCounts, compareText, groupNotOffered, libraryOrder, libraryState, parseVersionOrdinal, peopleOrder, projectsOrder, shortDescription, verdictCounts, type Verdict } from '../policies.js';
import type { Renderer } from '../renderer.js';
import { tildePath } from '../text.js';
import { asArray, asRecord, bool, nextEval, nextEvalReport, nextInstall, nextProjectAdd, nextSkillInfo, num, receiptHeadline, receiptVerdict, skillsTable, str, versionText, type SkillRowInput } from './shared.js';

const BODY_PREVIEW_LINES = 30;

interface SelectedLibraryEval {
  receipt: Record<string, unknown>;
  source: 'local' | 'team';
}

/** Newest run wins across stores; the committed team receipt wins the equal-run tie (PR #208). */
function selectedLibraryEval(row: Record<string, unknown>): SelectedLibraryEval | null {
  const local = asRecord(row['localEval']);
  const team = asRecord(row['teamEval']);
  const hasLocal = Object.keys(local).length > 0;
  const hasTeam = Object.keys(team).length > 0;
  if (!hasLocal && !hasTeam) return null;
  if (!hasLocal) return { receipt: team, source: 'team' };
  if (!hasTeam) return { receipt: local, source: 'local' };
  const localRun = str(local['run_id']) ?? '';
  const teamRun = str(team['run_id']) ?? '';
  return compareText(teamRun, localRun) >= 0 ? { receipt: team, source: 'team' } : { receipt: local, source: 'local' };
}

function localVerdict(row: Record<string, unknown>): Verdict | null {
  const v = selectedLibraryEval(row)?.receipt['verdict'];
  return v === 'PASS' || v === 'NEUTRAL' || v === 'FAIL' ? v : null;
}

function libraryRow(row: Record<string, unknown>) {
  return {
    name: str(row['name']) ?? '—',
    edited: bool(row['edited']),
    tracked: bool(row['tracked']),
    known: bool(row['knownToTeam']) || str(row['skillId']) !== null,
    ...(str(row['problem']) === null ? {} : { problem: str(row['problem'])! }),
  };
}

function stateText(row: Record<string, unknown>): string {
  const state = libraryState(libraryRow(row));
  const placement = asRecord(row['placement']);
  const placedN = parseVersionOrdinal(str(placement['version']));
  const matchedN = parseVersionOrdinal(str(row['matchedVersion']));
  const base = state === 'placed'
    ? (placedN === null ? 'placed' : `placed Version ${placedN}`)
    : state === 'edited'
      ? 'edited ✎'
      : state;
  return matchedN !== null && matchedN !== placedN ? `${base} = Version ${matchedN}` : base;
}

/** PR #208 (D3): a runner is named iff the shown receipt's `mine` is false; a `localEval` without `mine` comes from an older CLI and keeps its earlier reading (an own run). */
function runnerOf(receipt: Record<string, unknown>): string | undefined {
  if (receipt['mine'] === undefined || bool(receipt['mine'])) return undefined;
  return `@${str(asRecord(receipt['provenance'])['runner_handle']) ?? '?'}`;
}

function evalCell(row: Record<string, unknown>) {
  const selected = selectedLibraryEval(row);
  if (selected !== null) {
    const runner = runnerOf(selected.receipt);
    if (selected.source === 'team') return receiptVerdict(selected.receipt, { from: runner ?? 'team' });
    return receiptVerdict(selected.receipt, runner === undefined ? {} : { from: runner });
  }
  return receiptVerdict(null, { stale: bool(row['localEvalStale']) });
}

function libraryRowLine(row: Record<string, unknown>): string {
  return `  ${row['name']} — ${row['state']}${str(row['problem']) === null ? '' : `; source problem: ${row['problem']}`}; path: ${row['path']}`;
}

function library(value: Record<string, unknown>, ctx: RenderContext): Board {
  const sections = asArray(value['local']).map(asRecord);
  const rows = sections.flatMap((section) => asArray(section['rows']).map(asRecord));
  const attention = attentionCounts(rows.map((row) => ({ localVerdict: localVerdict(row), edited: bool(row['edited']), broken: str(row['problem']) !== null })));
  const b = board('Library', { headline: `${rows.length} skill${rows.length === 1 ? '' : 's'} across ${sections.length} root${sections.length === 1 ? '' : 's'} · attention ${attention.failing} failing · ${attention.notEvaluated} not evaluated · ${attention.edited} edited` });
  for (const section of sections) {
    const root = str(section['root']) ?? '—';
    const remote = asRecord(section['remote']);
    const slug = str(remote['slug']);
    const rootState = str(section['rootState']);
    const title = `${str(section['label']) ?? 'Root'} — ${tildePath(root, ctx.home)}${slug === null ? '' : ` (${slug})`}${rootState === null || rootState === 'scanned' ? '' : ` (${rootState})`}`;
    const sorted = asArray(section['rows']).map(asRecord).sort((a, c) => libraryOrder(libraryRow(a), libraryRow(c)));
    b.sections.push(table([
      { key: 'skill', label: 'Skill', priority: 1 },
      { key: 'state', label: 'State', priority: 1 },
      { key: 'eval', label: 'Eval', priority: 2 },
      { key: 'desc', label: 'Desc', priority: 2, max: 60 },
      { key: 'path', label: 'Path', priority: 3 },
    ], sorted.map((row) => ({
      skill: text(row['name']),
      state: text(stateText(row)),
      eval: evalCell(row),
      desc: text(shortDescription(str(row['description']))),
      path: path(row['path']),
    })), { title, cap: ctx.rows }));
    const notOffered = asArray(section['notOffered']).map(asRecord);
    if (notOffered.length) {
      const grouped = groupNotOffered(notOffered.map((entry) => ({ reason: str(entry['reason']) ?? 'failed' })), ctx.rows);
      b.sections.push(grouped.grouped
        ? table([
          { key: 'reason', label: 'Reason', priority: 1 },
          { key: 'n', label: 'Folders', priority: 1, align: 'right' },
        ], grouped.groups.map((group) => ({ reason: text(group.reason), n: text(`×${group.count}`, 'right') })), { title: 'Cannot be connected' })
        : table([
          { key: 'skill', label: 'Skill', priority: 1 },
          { key: 'reason', label: 'Reason', priority: 1 },
          { key: 'path', label: 'Path', priority: 3 },
        ], notOffered.map((entry) => ({
          skill: text(entry['name']),
          reason: text(entry['detail'] ?? entry['reason']),
          path: path(entry['path']),
        })), { title: 'Cannot be connected', cap: ctx.rows }));
    }
  }
  const firstUnevaluated = rows.find((row) => localVerdict(row) === null && str(row['problem']) === null);
  if (firstUnevaluated) {
    const name = str(firstUnevaluated['name']) ?? '';
    b.next.push(nextSkillInfo(name), nextEval(name));
  }
  if (!sections.some((section) => bool(section['registered']))) b.next.push(nextProjectAdd);
  return b;
}

function viewerInstalled(value: Record<string, unknown>): Map<string, string | null> {
  const viewer = asRecord(value['viewer']);
  const handle = str(viewer['handle']);
  const person = asArray(value['people']).map(asRecord).find((p) => str(p['handle']) === handle);
  return new Map(asArray(person?.['installed']).map(asRecord).map((item) => [str(item['id']) ?? '', str(item['version'])]));
}

function skillRows(value: Record<string, unknown>): SkillRowInput[] {
  return asArray(value['skills']).map(asRecord).map((s) => ({
    id: str(s['id']),
    name: str(s['name']) ?? '—',
    description: s['description'],
    author: s['author'],
    category: s['category'],
    latest: s['latest'],
    installs: s['installs'],
    updated: s['updated'],
    receipt: s['receipt'],
    evalVersion: s['evalVersion'],
    latestEvalState: s['latestEvalState'],
  }));
}

function marketplace(value: Record<string, unknown>, ctx: RenderContext): Board {
  const viewer = asRecord(value['viewer']);
  const skills = skillRows(value);
  const people = asArray(value['people']).map(asRecord);
  const projects = asArray(value['projects']).map(asRecord);
  const verdicts = verdictCounts(asArray(value['skills']).map(asRecord).map((s) => (s['latestEvalState'] === 'invalid' ? null : (asRecord(s['receipt'])['verdict'] as Verdict | undefined) ?? null)));
  const b = board(`Marketplace — ${str(viewer['team']) ?? 'team'}`, { headline: `${skills.length} skills · ${asArray(value['roster']).length} members · ${projects.length} projects · PASS ${verdicts.PASS} · NEUTRAL ${verdicts.NEUTRAL} · FAIL ${verdicts.FAIL} · not evaluated ${verdicts.notEvaluated}` });
  const held = viewerInstalled(value);
  b.sections.push(skillsTable(skills, ctx, { title: 'Skills', viewerInstalled: held, eval: true }));
  const installs = new Map(skills.map((s) => [s.id ?? '', num(s.installs) ?? 0]));
  const peopleSorted = [...people].sort((a, c) => peopleOrder(installs)(
    { handle: str(a['handle']) ?? '', authored: asArray(a['authored']).map(String) },
    { handle: str(c['handle']) ?? '', authored: asArray(c['authored']).map(String) },
  ));
  if (people.length) {
    b.sections.push(table([
      { key: 'handle', label: 'Handle', priority: 1 },
      { key: 'name', label: 'Name', priority: 2 },
      { key: 'role', label: 'Role', priority: 3 },
      { key: 'installed', label: 'Installed', priority: 1, align: 'right' },
      { key: 'authored', label: 'Authored', priority: 1, align: 'right' },
      { key: 'local', label: 'Local skills (self-reported)', priority: 3, align: 'right' },
    ], peopleSorted.map((p) => ({
      handle: text(`@${str(p['handle']) ?? '?'}`),
      name: text(p['display_name']),
      role: text(p['role']),
      installed: { kind: 'count', n: asArray(p['installed']).length },
      authored: { kind: 'count', n: asArray(p['authored']).length },
      local: { kind: 'count', n: num(p['local_skills']) },
    })), { title: 'People', cap: ctx.rows }));
  }
  const members = new Map<string, number>();
  for (const person of asArray(value['roster']).map(asRecord)) {
    for (const name of asArray(person['projects']).map(String)) members.set(name, (members.get(name) ?? 0) + 1);
  }
  const projectsSorted = [...projects].sort((a, c) => projectsOrder(members)({ name: str(a['name']) ?? '' }, { name: str(c['name']) ?? '' }));
  if (projects.length) {
    b.sections.push(table([
      { key: 'project', label: 'Project', priority: 1 },
      { key: 'skills', label: 'Skills', priority: 1, align: 'right' },
      { key: 'members', label: 'Members', priority: 2, align: 'right' },
      { key: 'remotes', label: 'Remotes', priority: 3 },
    ], projectsSorted.map((p) => ({
      project: text(p['name']),
      skills: { kind: 'count', n: asArray(p['skills']).length },
      members: { kind: 'count', n: members.get(str(p['name']) ?? '') ?? 0 },
      remotes: text(asArray(p['remotes']).join(', ') || null),
    })), { title: 'Projects', cap: ctx.rows }));
  }
  const top = [...skills].sort((a, c) => (num(c.installs) ?? 0) - (num(a.installs) ?? 0) || compareText(a.name, c.name))[0];
  if (top) b.next.push(nextSkillInfo(top.name));
  const unevaluated = skills.find((s) => s.receipt === null || s.receipt === undefined);
  if (unevaluated) b.next.push(nextEval(unevaluated.name));
  const notInstalled = skills.find((s) => s.id !== null && !held.has(s.id));
  if (notInstalled) b.next.push(nextInstall(notInstalled.name));
  return b;
}

function member(value: Record<string, unknown>, ctx: RenderContext): Board {
  const m = asRecord(value['member']);
  const b = board(`@${str(m['handle']) ?? '?'} — ${str(m['displayName']) ?? '—'}`);
  b.sections.push(kv([
    ['role', text(m['role'])],
    ['projects', text(asArray(m['projects']).join(', ') || null)],
    ['authored', text(asArray(value['skills']).map(asRecord).map((s) => str(s['name'])).join(', ') || null)],
  ]));
  b.sections.push(table([
    { key: 'skill', label: 'Skill', priority: 1 },
    { key: 'version', label: 'Version', priority: 1 },
    { key: 'scope', label: 'Scope', priority: 2 },
    { key: 'since', label: 'Since', priority: 3 },
  ], asArray(m['installed']).map(asRecord).map((i) => {
    const scope = asRecord(i['scope']);
    return {
      skill: text(str(i['name']) ?? str(i['id'])?.slice(0, 8)),
      version: text(versionText(i['version'])),
      scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])),
      since: { kind: 'date', iso: str(i['since']) },
    };
  }), { title: 'Installed', cap: ctx.rows }));
  b.sections.push(table([
    { key: 'skill', label: 'Skill', priority: 1 },
    { key: 'version', label: 'Version', priority: 1 },
    { key: 'via', label: 'Via', priority: 2 },
    { key: 'added', label: 'Added', priority: 3 },
  ], asArray(m['profile']).map(asRecord).map((p) => ({
    skill: text(p['name']),
    version: text(versionText(p['version'])),
    via: text(p['via']),
    added: { kind: 'date', iso: str(p['added']) },
  })), { title: 'Profile', cap: ctx.rows }));
  const first = asRecord(asArray(value['skills'])[0])['name'];
  if (typeof first === 'string') b.next.push(nextSkillInfo(first));
  return b;
}

function project(value: Record<string, unknown>, ctx: RenderContext): Board {
  const selection = asRecord(value['selection']);
  const name = str(selection['name']) ?? '—';
  const record = asArray(value['projects']).map(asRecord).find((p) => str(p['name']) === name) ?? {};
  const members = asArray(value['roster']).map(asRecord)
    .filter((p) => asArray(p['projects']).includes(name))
    .map((p) => `@${str(p['handle'])}`);
  const b = board(`Project ${name}`);
  b.sections.push(kv([
    ['remotes', text(asArray(record['remotes']).join(', ') || null)],
    ['members', text(members.join(', ') || null)],
  ]));
  b.sections.push(skillsTable(skillRows(value), ctx, { title: 'Skills', viewerInstalled: viewerInstalled(value), eval: true }));
  b.next.push(nextInstall('project', name));
  return b;
}

function selectedDetailRow(value: Record<string, unknown>, selection: Record<string, unknown>): Record<string, unknown> | undefined {
  const name = str(selection['name']);
  if (name === null) return undefined;
  const rows = asArray(value['local']).map(asRecord).flatMap((section) => asArray(section['rows']).map(asRecord));
  const namedRows = rows.filter((row) => str(row['name']) === name);
  const selectedPath = str(selection['path']);
  return (selectedPath === null ? undefined : namedRows.find((row) => str(row['path']) === selectedPath)) ?? namedRows[0];
}

function detail(value: Record<string, unknown>, ctx: RenderContext): Board {
  const selection = asRecord(value['selection']);
  const name = str(selection['name']) ?? '—';
  const skill = asArray(value['skills']).map(asRecord)[0];
  const row = selectedDetailRow(value, selection);
  const b = board(name);
  const sections: Section[] = [];
  const body = str(skill?.['body'] ?? row?.['body']);
  if (skill) {
    const latestN = parseVersionOrdinal(str(skill['latest']));
    const versions = num(skill['versionCount']) ?? 0;
    b.title = `${name} — ${latestN === null ? '—' : `Version ${latestN}`} (${versions} version${versions === 1 ? '' : 's'})`;
    const description = str(skill['description']);
    if (description !== null && description !== '') sections.push(textBlock([description]));
    const evalN = num(skill['evalVersion']);
    const from = evalN !== null && latestN !== null && evalN !== latestN ? `from Version ${evalN}` : null;
    sections.push(kv([
      ['id', text(skill['id'])],
      ['author', text(skill['author'])],
      ['category', text(skill['category'])],
      ['endorsement', text(skill['endorsement'])],
      ['grants', text(skill['grants'])],
      ['installs', { kind: 'count', n: num(skill['installs']) }],
      ['updated', { kind: 'date', iso: str(skill['updated']) }],
      ['latest', text(versionText(skill['latest']))],
      ['eval', text(skill['latestEvalState'] === 'invalid' ? '⚠ invalid receipt at the latest version' : `${receiptHeadline(skill['receipt'], ctx)}${from === null ? '' : ` (${from})`}`)],
    ]));
    const installedBy = asArray(skill['installedBy']).map(asRecord);
    if (installedBy.length) {
      sections.push(table([
        { key: 'handle', label: 'Handle', priority: 1 },
        { key: 'version', label: 'Version', priority: 1 },
        { key: 'scope', label: 'Scope', priority: 2 },
        { key: 'since', label: 'Since', priority: 3 },
      ], installedBy.map((i) => {
        const scope = asRecord(i['scope']);
        return {
          handle: text(`@${str(i['handle']) ?? '?'}`),
          version: text(versionText(i['version'])),
          scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])),
          since: { kind: 'date', iso: str(i['since']) },
        };
      }), { title: 'Installed by', cap: ctx.rows }));
    }
  }
  if (row) {
    if (!skill) {
      b.title = `${name} — Library`;
      const description = str(row['description']);
      if (description !== null && description !== '') sections.push(textBlock([description]));
    }
    sections.push(kv([
      ['state', text(stateText(row))],
      ['path', path(row['path'])],
      ['health', status(bool(row['edited']) ? 'warn' : 'ok', bool(row['edited']) ? 'edited since placement' : str(row['health']) === 'unknown' ? 'unchanged or untracked' : str(row['health']))],
      ['local eval', text(row['localEval'] ? receiptHeadline(row['localEval'], ctx) : bool(row['localEvalStale']) ? '⚠ stale — edited since the eval' : '— not evaluated')],
      ['team eval for these bytes', text(row['teamEval'] ? receiptHeadline(row['teamEval'], ctx) : null)],
    ], skill ? 'Your copy' : undefined));
  }
  if (body !== null && body.trim() !== '') {
    const lines = body.trimEnd().split('\n');
    sections.push(textBlock(lines.slice(0, BODY_PREVIEW_LINES), { title: 'Body preview', fenced: 'md' }));
    if (lines.length > BODY_PREVIEW_LINES) b.notes.push(`… ${lines.length - BODY_PREVIEW_LINES} more lines in the body`);
  }
  b.sections.push(...sections);
  const held = viewerInstalled(value);
  const id = str(skill?.['id']);
  if (skill && id !== null && !held.has(id) && !row) b.next.push(nextInstall(name));
  b.next.push(nextEval(name));
  if (skill) b.next.push(nextEvalReport(name));
  return b;
}

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw);
  const selection = asRecord(value['selection']);
  if (selection['kind'] === 'skill') return detail(value, ctx);
  if (selection['kind'] === 'member') return member(value, ctx);
  if (selection['kind'] === 'project') return project(value, ctx);
  if (Array.isArray(value['local'])) return library(value, ctx);
  return marketplace(value, ctx);
};

/** The listing prints reproduced by the boards; everything else (problems, overlay notices, unreadable receipts) is a note. */
export const covered: RegExp[] = [
  /^Local Claude Code skills \(/,
  /^  GitHub: /,
  /^  .+ — .+; path: /,
  /^Could not inspect as skills:$/,
  /^  none( \(.+ does not exist\))?$/,
  /^  \d+ skill folders? \(\d+ connectable\)$/,
  /^Members:$/,
  /^  \S+( \(inactive\))?$/,
  /^Skills:$/,
  /^  .+ — .+; \d+ installs; /,
  /^Local skills: /,
  /^Member \S+:$/,
  /^  Authored: /,
  /^  Installed: /,
  /^Project .+:$/,
];

/** The detail prints its description and body verbatim: those lines are the board, not notes. */
export function uncovered(lines: readonly string[], raw: unknown): string[] {
  const value = asRecord(raw);
  const selection = asRecord(value['selection']);
  if (selection['kind'] !== 'skill') return lines.filter((line) => !covered.some((pattern) => pattern.test(line)));
  const skill = asArray(value['skills']).map(asRecord)[0];
  const row = selectedDetailRow(value, selection);
  const shown = new Set<string>();
  const body = str(skill?.['body'] ?? row?.['body']);
  if (body !== null) for (const line of body.trimEnd().split('\n')) shown.add(line);
  const description = str(skill?.['description'] ?? row?.['description']);
  if (description !== null) shown.add(description);
  if (row) shown.add(libraryRowLine(row));
  return lines.filter((line) => !shown.has(line) && !covered.some((pattern) => pattern.test(line)));
}

export const renderer: Renderer = { render, covered, uncovered };
