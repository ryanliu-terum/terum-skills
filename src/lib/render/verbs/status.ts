import { getStartedLines } from '../../invocation.js';
import { board, kv, path, status as statusCell, table, text, textBlock, type Board, type Cell, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { relativeDate } from '../text.js';
import { asArray, asRecord, bool, escapeRegExp, num, str, versionText, nextInstall, nextListSkills, nextSync } from './shared.js';

function cloneText(team: Record<string, unknown>): Cell {
  const clone = asRecord(team['clone']); const where = str(team['clonePath']) ?? 'The team clone';
  switch (clone['state']) {
    case 'ok': return statusCell('ok', 'ok');
    case 'absent': return statusCell('bad', `${where} is missing.`);
    case 'foreign': return statusCell('bad', `${where} is a clone of ${str(clone['origin']) ?? '?'}, not ${str(team['repository']) ?? '?'}.`);
    case 'incomplete': return statusCell('bad', clone['reason'] === 'unverifiable' ? `${where} could not be verified (${str(clone['error']) ?? 'unknown error'}); check that git is installed before repairing anything.` : `${where} exists but is not a complete clone.`);
    default: return statusCell('muted', null);
  }
}

export const render = (raw: unknown, ctx: RenderContext): Board => {
  const value = asRecord(raw); const version = str(value['version']);
  const b = board(version === null ? 'terum-skills (version unknown)' : `terum-skills ${version}`);
  const teams = asArray(value['teams']).map(asRecord);
  if (teams.length === 0) { b.headline = 'No team on this machine yet.'; b.sections.push(textBlock([...getStartedLines(ctx.form)])); b.next.push({ label: 'Set up', verb: 'setup', args: [] }, nextListSkills(true)); }
  for (const team of teams) {
    const handle = str(team['handle']) ?? '?'; const ok = asRecord(team['clone'])['state'] === 'ok';
    const synced = str(team['syncedAt']); const stale = bool(team['stale']);
    b.sections.push(kv([
      ['repository', text(team['repository'])], ['clone', cloneText(team)],
      ['synced', synced === null ? text(null) : statusCell(stale ? 'warn' : 'ok', `${relativeDate(synced, ctx.now)}${stale ? ' stale' : ''}`)],
      ['membership', text(team['membership'])], ['policy license', text(asRecord(team['policy'])['skill_license'])], ['categories', text(asArray(team['categories']).join(', ') || null)],
    ], `Team ${str(team['team']) ?? '?'} — ${ok ? 'you are' : 'configured handle'} @${handle}`));
    const members = asArray(team['members']).map(asRecord);
    if (members.length) b.sections.push(table([{ key: 'handle', label: 'Handle', priority: 1 }, { key: 'name', label: 'Name', priority: 2 }, { key: 'role', label: 'Role', priority: 3 }, { key: 'joined', label: 'Joined', priority: 3 }],
      members.map((m) => ({ handle: text(`@${str(m['handle']) ?? '?'}${str(m['handle']) === handle ? ' (you)' : ''}`), name: text(m['displayName']), role: text(m['role']), joined: { kind: 'date', iso: str(m['joined']) } })), { title: `Members (${num(team['memberCount']) ?? members.length}${num(team['unreadableMembers']) ? `; ${team['unreadableMembers']} unreadable` : ''})`, cap: ctx.rows }));
    const pending = asArray(team['pending']).map(asRecord);
    if (pending.length) {
      b.sections.push(table([{ key: 'op', label: 'Op', priority: 1 }, { key: 'id', label: 'Skill id', priority: 1 }, { key: 'scope', label: 'Scope', priority: 2 }, { key: 'version', label: 'Version', priority: 2 }, { key: 'started', label: 'Started', priority: 3 }],
        pending.map((p) => { const scope = asRecord(p['scope']); return { op: text(p['op']), id: text(str(p['id'])?.slice(0, 8)), scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])), version: text(versionText(p['version'])), started: { kind: 'date', iso: str(p['started']) } }; }), { title: 'Pending', cap: ctx.rows }));
      for (const p of pending) { const id = str(p['id']); if (id !== null) b.next.push(p['op'] === 'uninstall' ? { label: 'Retry', verb: 'uninstall-skill', args: [id] } : nextInstall(id)); }
    }
    if (stale) b.next.push(nextSync);
  }
  const placements = asArray(asRecord(value['ledger'])['placements']).map(asRecord);
  if (placements.length) b.sections.push(table([{ key: 'path', label: 'Path', priority: 1 }, { key: 'team', label: 'Team', priority: 2 }, { key: 'version', label: 'Version', priority: 1 }, { key: 'scope', label: 'Scope', priority: 2 }, { key: 'placed', label: 'Placed', priority: 3 }],
    placements.map((p) => { const scope = asRecord(p['scope']); return { path: path(p['path']), team: text(p['team']), version: text(versionText(p['version'])), scope: text(scope['kind'] === 'project' ? `project ${scope['project']}` : str(scope['kind'])), placed: { kind: 'date', iso: str(p['placed_at']) } }; }), { title: 'Placements', cap: ctx.rows }));
  const identity = asRecord(value['identity']);
  if (Object.keys(identity).length) b.sections.push(kv([['handle', text(identity['default_handle'])], ['name', text(identity['display_name'])], ['email', text(identity['email'])], ['github', text(identity['github'])]], 'Identity'));
  const tools = asRecord(value['tools']);
  if (Object.keys(tools).length) b.sections.push(kv([['git', statusCell(bool(tools['git']) ? 'ok' : 'bad', bool(tools['git']) ? 'installed' : 'not found')], ['gh', statusCell(bool(tools['gh']) ? 'ok' : 'bad', bool(tools['gh']) ? 'installed' : 'not found')]], 'Tools'));
  const host = str(value['hostArch']); const proc = str(value['processArch']);
  if (host !== null && proc !== null && host !== proc) b.sections.push(kv([['host', text(host)], ['node', text(proc)]], 'Architecture'));
  return b;
};

export const covered: RegExp[] = [
  /^terum-skills /, /^Team .+ \((you are|configured handle) @/, /^  Repository: /, /^  Clone: /, /^  From the local clone; GitHub access is not checked\.$/,
  /^  Members: \d+/, /^    @\S+ — /, /^    … and \d+ more$/, /^  Your membership: /, /^  Shared skills: \d+/, /^  Evaluated skills: not yet available$/, /^  \S+ may be stale; run /,
  ...[...getStartedLines(undefined), ...getStartedLines('bare')].map((line) => new RegExp(`^${escapeRegExp(line)}$`)),
];
export const renderer: Renderer = { render, covered };
