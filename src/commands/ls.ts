import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { localSkillRoots, localSkills, type LocalEntry, type LocalRoot } from '../lib/local-skills.js';
import { printable } from '../lib/skill-source.js';
import { readTeam, skillRecords } from '../lib/skills.js';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { normalizeAuthor } from '../lib/guard.js';
import { Prompter } from '../lib/prompt.js';
import { installCounts, isActivePerson, latestTree, readPeople, shortHash, skillEndorsement } from '../lib/readme.js';
import { failure, Result, success } from '../lib/result.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { handleSchema, parseJson, parseOrExplain, parseSkillFrontmatter, teamSchema } from '../lib/schema.js';

export interface LsArgs extends WithForm { local?: boolean; home?: string; cwd?: string; kind?: 'all' | 'member' | 'project'; value?: string; team?: string; config?: ConfigStore; runner?: Runner; }
export interface LsSkill { id: string; name: string; author: string; category: string; installs: number; latest: string; endorsement: string; }
export interface LocalSection extends LocalRoot { rows: { name: string; path: string; state: string; problem?: string }[]; notOffered: { name: string; path: string; reason: string }[]; problems: { path: string; reason: string }[]; }
export interface LsResult { local?: LocalSection[]; roster: readonly { handle: string; active: boolean }[]; skills: readonly LsSkill[]; }

/** §6 read-only team inventory; it deliberately neither pulls nor prompts. */
export async function run(args: LsArgs, io: Prompter): Promise<Result<LsResult>> {
  try {
    if (args.local && (args.kind === 'member' || args.kind === 'project')) throw new Error('--local cannot be combined with member or project.');
    if (args.local && args.team) throw new Error('--local lists every configured team; drop --team.');
    const store = args.config ?? createConfigStore();
    if (args.local) return await showLocal(store, args.home ?? homedir(), io, args.cwd);
    const [teamName] = selectTeam((await store.read()).teams, args.team, args.form);
    const clone = store.teamClone(teamName);
    const runner = args.runner ?? systemRunner;
    const team = parseJson(teamSchema, await readFile(join(clone, 'team.json'), 'utf8'), 'team.json');
    const people = await readPeople(clone);
    const roster = people.sort((a, b) => a.handle.localeCompare(b.handle)).map((person) => ({ handle: person.handle, active: isActivePerson(person, team.archived) }));
    const skills = await listSkills(team, people, clone, runner, io);
    // `return await`: a returned promise leaves the try block before it settles, so a throw inside
    // showMember/showProject would reject run() instead of becoming the failure Result every verb returns.
    if (args.kind === 'member') return await showMember(args.value, people, skills, io, roster);
    if (args.kind === 'project') return await showProject(args.value, team, skills, io, roster);
    io.print('Members:');
    for (const member of roster) io.print(`  ${member.handle}${member.active ? '' : ' (inactive)'}`);
    io.print('Skills:');
    for (const skill of skills) io.print(format(skill));
    io.print(`Local skills: ${invocation(args.form, 'ls --local')}`);
    return success({ roster, skills });
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

async function listSkills(team: ReturnType<typeof teamSchema.parse>, people: Awaited<ReturnType<typeof readPeople>>, clone: string, runner: Runner, io: Prompter): Promise<LsSkill[]> {
  const names = (await readdir(join(clone, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const counts = installCounts(people);
  return Promise.all(names.map(async (name) => {
    const parsed = parseSkillFrontmatter(await readFile(join(clone, 'skills', name, 'SKILL.md'), 'utf8'));
    if (!parsed.ok) throw new Error(`Invalid skills/${name}/SKILL.md: ${parsed.error}`);
    const id = parsed.data.metadata.id;
    // One folder git cannot resolve — present on disk but not in HEAD, the leftover of an interrupted
    // write — costs one row's version and one reported line, never the roster or the other rows
    // (rulings walk R11, 2026-09-06; search degrades the same way).
    const latest = await latestTree(runner, clone, name).catch((error: unknown) => { io.print(`${name}: ${error instanceof Error ? error.message : String(error)}`); return '—'; });
    return { id, name, author: parsed.data.metadata.author, category: parsed.data.metadata['terum-category'], installs: counts.get(id) ?? 0, latest: shortHash(latest), endorsement: skillEndorsement(team, id) };
  }));
}
async function showMember(handle: string | undefined, people: Awaited<ReturnType<typeof readPeople>>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster']): Promise<Result<LsResult>> {
  if (!handle) throw new Error('Specify a member handle.');
  const normalizedHandle = parseOrExplain(handleSchema, handle, 'member handle');
  const member = people.find((person) => person.handle === normalizedHandle);
  if (!member) throw new Error(`No member named ${handle}.`);
  const authored = skills.filter((skill) => normalizeAuthor(skill.author) === normalizeAuthor(`${member.display_name} <${member.email}>`));
  const namesById = new Map(skills.map((skill) => [skill.id, skill.name]));
  io.print(`Member ${member.handle}:`);
  io.print(`  Authored: ${authored.map((skill) => skill.name).join(', ') || '—'}`);
  io.print(`  Installed: ${member.installed.map((item) => namesById.get(item.id) ?? item.id).join(', ') || '—'}`);
  return success({ roster, skills: authored });
}
async function showProject(projectName: string | undefined, team: ReturnType<typeof teamSchema.parse>, skills: readonly LsSkill[], io: Prompter, roster: LsResult['roster']): Promise<Result<LsResult>> {
  if (!projectName || !Object.hasOwn(team.projects, projectName)) throw new Error(`No project named ${projectName ?? ''}.`);
  const projectIds = new Set(team.projects[projectName]!.skills);
  const selected = skills.filter((skill) => projectIds.has(skill.id));
  io.print(`Project ${projectName}:`);
  for (const skill of selected) io.print(format(skill));
  return success({ roster, skills: selected });
}
/** One skill per line, the §6 `ls` format; `search` prints hits through the same function. */
export function format(skill: LsSkill): string { return `  ${skill.name} — ${skill.author}; ${skill.category}; ${skill.installs} installs; ${skill.latest}; ${skill.endorsement}`; }


/** Local discovery is independent of team selection, and only enriches ledger references. */
async function showLocal(store: ConfigStore, home: string, io: Prompter, cwd?: string): Promise<Result<LsResult>> {
  const discovery = await localSkillRoots(home, cwd);
  const config = await store.read();
  const inventories = await Promise.all(discovery.roots.map(async (root) => ({ ...root, inventory: await localSkills(root.root, config, { scope: root.scope, stateRoot: store.root }) })));
  const sections: LocalSection[] = [];
  const snapshots = new Map<string, { teamJson?: Awaited<ReturnType<typeof readTeam>>; ids?: Set<string>; complete: boolean }>();
  const stateOf = (entry: LocalEntry): string => {
    const states = entry.shared.map((ref) => {
      const snapshot = snapshots.get(ref.team)!;
      let status = 'repository status unknown';
      if (snapshot.complete && snapshot.ids && snapshot.teamJson) {
        if (!snapshot.ids.has(ref.id)) status = 'repository copy missing from local clone';
        else {
          // skillEndorsement prioritizes global over the sorted project list.
          const badge = skillEndorsement(snapshot.teamJson, ref.id);
          status = badge === '—' ? 'not endorsed in local clone' : `endorsed (${badge})`;
        }
      }
      return `connected source for ${ref.team}; ${status}`;
    });
    if (entry.placement) states.push(`placement recorded from ${entry.placement.team}${entry.placement.version === null ? '' : ` @${entry.placement.version.slice(0, 8)}`}`);
    return states.length > 1 ? `conflicting tracking: ${states.join('; ')}` : states[0] ?? 'untracked locally';
  };
  for (const { inventory, repoRoot } of inventories) {
    const local: LocalSection = { root: inventory.root, scope: inventory.scope, ...(repoRoot === undefined ? {} : { repoRoot }), rows: [], notOffered: [], problems: [...inventory.problems] };
    sections.push(local);
    io.print(`Local Claude Code skills (${printable(inventory.root)}; ${inventory.scope}):`);
    for (const entry of inventory.entries) {
      for (const ref of [...entry.shared, ...(entry.placement ? [entry.placement] : [])]) {
        if (snapshots.has(ref.team)) continue;
        const snapshot: { teamJson?: Awaited<ReturnType<typeof readTeam>>; ids?: Set<string>; complete: boolean } = { complete: false };
        snapshots.set(ref.team, snapshot);
        try {
          const clone = store.teamClone(ref.team);
          snapshot.teamJson = await readTeam(clone);
          let complete = true;
          const records = await skillRecords(clone, ref.team, { onProblem: () => { complete = false; } });
          snapshot.ids = new Set(records.map((record) => record.id));
          snapshot.complete = complete;
        } catch { /* A ledger fact survives an unavailable clone. */ }
      }
    }
    for (const entry of inventory.entries) {
      const tracked = entry.shared.length > 0 || entry.placement !== undefined;
      const inspection = entry.inspection;
      if (tracked || inspection.kind === 'candidate') {
        const problem = inspection.kind === 'rejected' ? inspection.detail : inspection.kind === 'failed' ? inspection.reason : inspection.privileged ? 'contains plugin or hook definitions (connect needs --allow-privileged)' : undefined;
        local.rows.push({ name: entry.name, path: entry.path, state: stateOf(entry), ...(problem === undefined ? {} : { problem }) });
      } else if (inspection.kind === 'rejected') local.notOffered.push({ name: entry.name, path: entry.path, reason: inspection.detail });
      if (inspection.kind === 'failed') local.problems.push({ path: entry.path, reason: inspection.reason });
    }
    for (const row of local.rows) io.print(`  ${printable(row.name)} — ${printable(row.state)}${row.problem === undefined ? '' : `; source problem: ${printable(row.problem)}`}; path: ${printable(row.path)}`);
    if (local.notOffered.length) {
      io.print('Cannot be connected:');
      for (const entry of local.notOffered) io.print(`  ${printable(entry.name)} — ${printable(entry.reason)}; path: ${printable(entry.path)}`);
    }
    if (inventory.rootState === 'absent') io.print(`  none (${printable(inventory.root)} does not exist)`);
    else if (inventory.rootState === 'scanned' && !inventory.entries.length) io.print('  none');
    for (const problem of local.problems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
  }
  for (const problem of discovery.problems) io.print(`Could not inspect ${printable(problem.path)}: ${printable(problem.reason)}`);
  if (discovery.noRepository !== undefined) io.print(`Project skills: none (${printable(discovery.noRepository)} is not inside a git repository).`);
  io.print('Team status is from local clones and may be stale; open endorsement requests are not checked.');
  return success({ roster: [], skills: [], local: sections });
}
