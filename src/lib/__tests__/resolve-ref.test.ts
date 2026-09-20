import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../config.js';
import { CWD_MISS, nearestSkillFolder, resolveSkillRef, type ResolveInput } from '../resolve-ref.js';
import { temporaryDirectory } from './fixtures.js';

const ID = '11111111-1111-4111-8111-111111111111';
const record = (name: string, id = ID) => `---\nname: ${name}\ndescription: Team ${name}\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: ops\n---\n# ${name}\n`;

async function library() {
  const home = await temporaryDirectory();
  const store = createConfigStore(join(home, 'state'));
  const root = join(home, '.claude', 'skills');
  for (const name of ['deploy-check', 'decision-walk', 'Notes']) { await mkdir(join(root, name), { recursive: true }); await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: local ${name}\n---\n`); }
  await mkdir(join(root, 'broken'), { recursive: true }); await writeFile(join(root, 'broken', 'SKILL.md'), '---\nname: [\n---\n');
  const clone = join(home, 'clone');
  await mkdir(join(clone, 'skills', 'tdd', 'v1'), { recursive: true }); await mkdir(join(clone, 'people'), { recursive: true });
  await writeFile(join(clone, 'skills', 'tdd', 'v1', 'SKILL.md'), record('tdd'));
  await mkdir(join(clone, 'skills', 'deploy-check', 'v1'), { recursive: true });
  await writeFile(join(clone, 'skills', 'deploy-check', 'v1', 'SKILL.md'), record('deploy-check', '22222222-2222-4222-8222-222222222222'));
  const config = await store.read();
  const printed: string[] = [];
  const base: ResolveInput = { ref: undefined, cwd: home, home, config, stateRoot: store.root, team: { clone, name: 'acme' }, rungs: 4, print: (line) => printed.push(line), miss: (ref) => `No skill named ${ref}.` };
  return { home, root, clone, base, printed };
}

describe('resolveSkillRef (§6.1)', () => {
  it('rung 0: a bare ref resolves the skill folder above cwd and prints the resolved line', async () => {
    const { root, base, printed } = await library();
    const inside = join(root, 'deploy-check', 'sub'); await mkdir(inside, { recursive: true });
    expect(await nearestSkillFolder(inside)).toBe(join(root, 'deploy-check'));
    expect(await resolveSkillRef({ ...base, cwd: inside })).toMatchObject({ ok: true, value: { name: 'deploy-check', how: 'cwd', source: 'library', match: { path: join(root, 'deploy-check') } } });
    expect(printed).toEqual(['Resolved: deploy-check from the working directory']);
  });
  it('treats empty and whitespace-only refs exactly like an absent ref', async () => {
    const { root, base, printed } = await library();
    const inside = join(root, 'deploy-check', 'sub'); await mkdir(inside, { recursive: true });
    const absent = await resolveSkillRef({ ...base, cwd: inside });
    printed.length = 0;
    for (const ref of ['', '  ']) expect(await resolveSkillRef({ ...base, ref, cwd: inside })).toEqual(absent);
    expect(printed).toEqual(['Resolved: deploy-check from the working directory', 'Resolved: deploy-check from the working directory']);
  });
  it('rung 0: outside every skill folder, or inside one that is not in a Library root, is the one sentence', async () => {
    const { home, base } = await library();
    expect(await resolveSkillRef({ ...base, cwd: home })).toEqual({ ok: false, error: CWD_MISS });
    const elsewhere = join(home, 'elsewhere', 'skill'); await mkdir(elsewhere, { recursive: true }); await writeFile(join(elsewhere, 'SKILL.md'), '---\nname: skill\ndescription: x\n---\n');
    expect(await resolveSkillRef({ ...base, cwd: elsewhere })).toEqual({ ok: false, error: CWD_MISS });
    expect(CWD_MISS).toBe('Name a skill; the working directory is not inside a library skill folder.');
  });
  it('rung 1: an exact Library name, a path, and a team name or id prefix resolve without a printed line', async () => {
    const { root, base, printed } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'deploy-check' })).toMatchObject({ ok: true, value: { how: 'exact', source: 'library', name: 'deploy-check' } });
    expect(await resolveSkillRef({ ...base, ref: join(root, 'Notes') })).toMatchObject({ ok: true, value: { how: 'exact', source: 'library', name: 'Notes' } });
    expect(await resolveSkillRef({ ...base, ref: 'tdd' })).toMatchObject({ ok: true, value: { how: 'exact', source: 'team', name: 'tdd', record: { name: 'tdd' } } });
    expect(await resolveSkillRef({ ...base, ref: ID.slice(0, 8) })).toMatchObject({ ok: true, value: { how: 'exact', source: 'team', name: 'tdd' } });
    expect(printed).toEqual([]);
    expect(await resolveSkillRef({ ...base, ref: 'broken' })).toMatchObject({ ok: true, value: { how: 'exact', source: 'library', match: { inspection: { kind: 'rejected' } } } });
  });
  it('rung 1: a path that misses stops with the path sentence and never climbs the ladder', async () => {
    const { home, base } = await library();
    expect(await resolveSkillRef({ ...base, ref: join(home, 'nowhere'), pathMiss: (ref) => `path miss ${ref}` })).toEqual({ ok: false, error: `path miss ${join(home, 'nowhere')}` });
    expect(await resolveSkillRef({ ...base, ref: './deploy' })).toEqual({ ok: false, error: 'No skill named ./deploy.' });
  });
  it('rungs 2–4: case, prefix and substring over Library and team names, each printing its line', async () => {
    const { base, printed } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'notes' })).toMatchObject({ ok: true, value: { name: 'Notes', how: 'case', source: 'library' } });
    expect(await resolveSkillRef({ ...base, ref: 'TD' })).toMatchObject({ ok: true, value: { name: 'tdd', how: 'prefix', source: 'team' } });
    expect(await resolveSkillRef({ ...base, ref: 'walk' })).toMatchObject({ ok: true, value: { name: 'decision-walk', how: 'substring', source: 'library' } });
    expect(printed).toEqual(['Resolved: "notes" → Notes (case-insensitive match)', 'Resolved: "TD" → tdd (unique prefix)', 'Resolved: "walk" → decision-walk (unique substring)']);
  });
  it('refuses an ambiguous match alphabetically and never guesses; a miss is the verb\'s own sentence', async () => {
    const { base } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'de' })).toEqual({ ok: false, error: 'Ambiguous skill name "de": decision-walk, deploy-check. Name one.' });
    expect(await resolveSkillRef({ ...base, ref: 'zzz' })).toEqual({ ok: false, error: 'No skill named zzz.' });
  });
  it('D9: rungs 2 stops after the case rung, and a team-less machine resolves Library names only', async () => {
    const { base } = await library();
    expect(await resolveSkillRef({ ...base, ref: 'DEPLOY-CHECK', rungs: 2 })).toMatchObject({ ok: true, value: { name: 'deploy-check', how: 'case' } });
    expect(await resolveSkillRef({ ...base, ref: 'depl', rungs: 2 })).toEqual({ ok: false, error: 'No skill named depl.' });
    const { team: _team, ...teamless } = base;
    void _team;
    expect(await resolveSkillRef({ ...teamless, ref: 'tdd' })).toEqual({ ok: false, error: 'No skill named tdd.' });
    expect(await resolveSkillRef({ ...teamless, ref: 'DEPLOY' })).toMatchObject({ ok: true, value: { name: 'deploy-check', how: 'prefix', source: 'library' } });
  });
  it('a team lookup that throws (an ambiguous id prefix) surfaces as a failure', async () => {
    const { base, clone } = await library();
    await mkdir(join(clone, 'skills', 'other', 'v1'), { recursive: true });
    await writeFile(join(clone, 'skills', 'other', 'v1', 'SKILL.md'), record('other', '11111111-1111-4111-8111-999999999999'));
    expect(await resolveSkillRef({ ...base, ref: '11111111' })).toEqual({ ok: false, error: 'Skill ID prefix 11111111 is ambiguous.' });
  });
});
