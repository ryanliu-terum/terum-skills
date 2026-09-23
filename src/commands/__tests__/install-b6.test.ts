import { mkdir, readFile, readdir, writeFile, access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { run } from '../install.js';
import { run as uninstall } from '../uninstall.js';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, NonInteractivePrompter, wrapRunner } from '../../lib/__tests__/fixtures.js';
import { systemRunner } from '../../lib/runner.js';
import { pendingReceipt } from './pending-eval-fixtures.js';

async function fixture() {
  const f = await bareTeam(), home = join(f.root, 'home'), store = createConfigStore(join(home, '.terum/skills'));
  const id = '11111111-1111-4111-8111-111111111111';
  const bytes = `---\nname: sample\ndescription: sample\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n`;
  await pushFromSeed(f.seed, 'skills/sample/v1/SKILL.md', bytes);
  const clone = await cloneWithIdentity(f.bare, store.teamClone('team'));
  await store.update(c => { c.teams.team = { remote: f.bare, handle: 'seed' }; });
  return { ...f, home, store, id, bytes, clone, args: { ref: 'sample', config: store, home }, target: join(home, '.claude/skills/sample') };
}
it('asks even when Global is the only interactive destination, never about the profile; headless defaults to Global', async () => {
  const f = await fixture(), io = new ScriptedPrompter([''], [], true);
  expect(await run(f.args, io)).toMatchObject({ ok: true, value: [{ profiled: true }] });
  expect(io.offered).toEqual([['Global (~/.claude/skills)']]);
  expect(io.asked.filter(question => /profile/i.test(question))).toEqual([]);
  const other = await fixture();
  expect(await run(other.args, new NonInteractivePrompter())).toMatchObject({ ok: true, value: [{ profiled: true }] });
});
it.each(['global', 'project'])('keeps a collision in %s old-skills, copies whole version, and never quarantines', async mode => {
  const f = await fixture(), root = mode === 'global' ? f.home : f.seed;
  if (mode === 'project') await f.store.update(c => { c.projects = [{ root, label: 'project' }]; });
  // `resolveDestination`/`installOne` canonicalize a project destination via `projectPath` (realpath),
  // so the message they print is built from the realpath'd root — canonicalize the expectation too
  // (macOS: os.tmpdir() is a /private/var symlink, so the raw fixture path never matches otherwise).
  const target = join(root, '.claude/skills/sample'), backup = join(mode === 'project' ? await realpath(root) : root, '.claude/old-skills/sample');
  await mkdir(target, { recursive: true }); await writeFile(join(target, 'mine.txt'), 'my copy');
  await mkdir(join(f.clone, 'skills/sample/v1/evals/cases'), { recursive: true });
  await writeFile(join(f.clone, 'skills/sample/v1/evals/cases/case.yaml'), 'case bytes');
  const io = new ScriptedPrompter([], [true, false], true);
  expect(await run({ ...f.args, into: mode === 'global' ? 'global' : root }, io)).toMatchObject({ ok: true });
  expect(await readFile(join(backup, 'mine.txt'), 'utf8')).toBe('my copy');
  expect(await readFile(join(target, 'evals/cases/case.yaml'), 'utf8')).toBe('case bytes');
  expect(io.details['Replace it with Version 1?']).toEqual(['You already have a skill named sample.', `Your copy is kept at ${backup}.`]);
  expect(io.lines).toContain(`Your copy is kept at ${backup}.`);
  await expect(access(join(f.store.root, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
  if (mode === 'project') expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toContain('.claude/old-skills/');
});
it('refused replacement leaves the folder and people file unchanged', async () => {
  const f = await fixture(); await mkdir(f.target, { recursive: true }); await writeFile(join(f.target, 'mine'), 'keep');
  const before = await readFile(join(f.clone, 'people/seed.json'), 'utf8');
  expect(await run(f.args, new ScriptedPrompter([], [false]))).toMatchObject({ ok: false, cancelled: true });
  expect(await readFile(join(f.target, 'mine'), 'utf8')).toBe('keep');
  expect(await readFile(join(f.clone, 'people/seed.json'), 'utf8')).toBe(before);
});
it('seeds by each receipt’s own digest verbatim and announces a pre-migration skip', async () => {
  const f = await fixture(), digest = 'a'.repeat(64);
  await pendingReceipt(f.clone, { skillName: 'sample', id: f.id });
  const path = join(f.clone, 'evals', f.id, 'v1/20260101T000000Z.json');
  const legacy = await readFile(path, 'utf8');
  const seeded = JSON.stringify({ ...JSON.parse(legacy), content_digest: `sha256:${digest}` }, null, 3);
  await writeFile(path, seeded); await writeFile(join(f.clone, 'evals', f.id, 'v1/20260102T000000Z.json'), legacy);
  const io = new ScriptedPrompter(); expect(await run(f.args, io)).toMatchObject({ ok: true });
  expect(await readFile(join(f.store.root, 'evals/local', digest, '20260101T000000Z/receipt.json'), 'utf8')).toBe(seeded);
  expect(JSON.parse(seeded).provenance.runner_handle).toBe('alice');
  expect(io.lines).toContain('Skipped 20260102T000000Z: no content digest (pre-migration receipt).');
});
it('an unparseable receipt is skipped, not fatal, and the rest of the seed still lands', async () => {
  const f = await fixture(), digest = 'a'.repeat(64);
  await pendingReceipt(f.clone, { skillName: 'sample', id: f.id });
  const path = join(f.clone, 'evals', f.id, 'v1/20260101T000000Z.json');
  const seeded = JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), content_digest: `sha256:${digest}` }, null, 3);
  await writeFile(path, seeded);
  // One receipt a newer client wrote (schema 3, unknown here) and one that is not JSON at all: both
  // skip paths, neither fatal — the skill is already on disk by the time this loop runs.
  await writeFile(join(f.clone, 'evals', f.id, 'v1/20260103T000000Z.json'), '{"schema_version": 3}');
  await writeFile(join(f.clone, 'evals', f.id, 'v1/20260104T000000Z.json'), 'not json');
  const io = new ScriptedPrompter(); expect(await run(f.args, io)).toMatchObject({ ok: true });
  expect(await readFile(join(f.store.root, 'evals/local', digest, '20260101T000000Z/receipt.json'), 'utf8')).toBe(seeded);
  expect(io.lines).toContain('Skipped 20260103T000000Z: invalid receipt.');
  expect(io.lines).toContain('Skipped 20260104T000000Z: invalid receipt.');
  // The steps after the seed loop still ran: the people file records the install and the pending row is drained.
  expect((await f.store.read()).pending).toEqual([]);
  expect(JSON.parse(await readFile(join(f.clone, 'people/seed.json'), 'utf8')).installed).toEqual([expect.objectContaining({ id: f.id, version: 'v1' })]);
});
it.each(['install', 'uninstall'] as const)('%s replaces duplicate pending rows with one new attempt, preserving unrelated work', async op => {
  const f = await fixture();
  if (op === 'uninstall') expect(await run(f.args, new ScriptedPrompter())).toMatchObject({ ok: true });
  const row = { op, id: f.id, team: 'team', scope: { kind: 'global' as const }, destination: { kind: 'global' as const }, started: '2000-01-01', ...(op === 'install' ? { version: 'v1' } : {}) };
  const other = { ...row, id: '22222222-2222-4222-8222-222222222222' };
  await f.store.update(c => { c.pending = [row, row, other]; });
  const runner = wrapRunner(systemRunner, async (_command, args, _options, next) => args[0] === 'fetch' ? { code: 1, stdout: '', stderr: 'offline' } : next());
  const invoke = op === 'install' ? run : uninstall;
  expect(await invoke({ ...f.args, runner, safeWrite: { deadlineMs: 0 } }, new ScriptedPrompter([], [true]))).toMatchObject({ ok: false });
  const pending = (await f.store.read()).pending;
  expect(pending.filter(p => p.id === f.id)).toEqual([expect.objectContaining({ started: expect.not.stringContaining('2000') })]);
  expect(pending.filter(p => p.id === other.id)).toEqual([other]);
  expect(await invoke(f.args, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true });
  expect((await f.store.read()).pending).toEqual([other]);
});
it('adds to the profile with no question, refreshes one profile entry, and uninstall preserves it without writing declined', async () => {
  const f = await fixture();
  expect(await run(f.args, new ScriptedPrompter())).toMatchObject({ ok: true, value: [{ profiled: true }] });
  const path = join(f.clone, 'people/seed.json');
  const before = JSON.parse(await readFile(path, 'utf8'));
  expect(before.profile).toEqual([expect.objectContaining({ id: f.id, name: 'sample', version: 'v1', via: 'install' })]);
  expect(before.local_skills).toBe(1);
  expect(await run(f.args, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true });
  expect(JSON.parse(await readFile(path, 'utf8')).profile).toHaveLength(1);
  const io = new ScriptedPrompter([], [true]);
  expect(await uninstall(f.args, io)).toMatchObject({ ok: true });
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ installed: [], profile: before.profile, declined: [] });
  expect(io.lines).toContain('Your profile is unchanged.');
});
it('rotates the kept copy so a repeated replace neither overwrites the older backup nor refuses', async () => {
  const f = await fixture(), backups = join(f.home, '.claude/old-skills'), backup = join(backups, 'sample');
  await mkdir(f.target, { recursive: true }); await writeFile(join(f.target, 'mine'), 'current');
  await mkdir(backup, { recursive: true }); await writeFile(join(backup, 'mine'), 'older');
  expect(await run(f.args, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true });
  // The first backup is untouched, the displaced folder is beside it under a stamped name, and
  // the install landed: no copy was overwritten and nothing had to be moved by hand.
  expect(await readFile(join(backup, 'mine'), 'utf8')).toBe('older');
  const rotated = (await readdir(backups)).filter(entry => entry.startsWith('sample-'));
  expect(rotated).toHaveLength(1);
  expect(await readFile(join(backups, rotated[0]!, 'mine'), 'utf8')).toBe('current');
  expect(await readFile(join(f.target, 'SKILL.md'), 'utf8')).toContain('sample');
});
it('retries an uninstall after both the disk copy and people record are already gone', async () => {
  const f = await fixture();
  const pending = { op: 'uninstall' as const, id: f.id, team: 'team', scope: { kind: 'global' as const }, destination: { kind: 'global' as const }, started: '2000-01-01' };
  await f.store.update(c => { c.pending = [pending]; });
  expect(await uninstall(f.args, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true });
  expect((await f.store.read()).pending).toEqual([]);
});
it('self-drains the sole interrupted project destination even after its ledger row is gone', async () => {
  const f = await fixture();
  await f.store.update(c => { c.pending = [{ op: 'uninstall', id: f.id, team: 'team', scope: { kind: 'global' }, destination: { kind: 'checkout', root: f.seed }, started: '2000-01-01' }]; });
  expect(await uninstall(f.args, new ScriptedPrompter([], [true]))).toMatchObject({ ok: true });
  expect((await f.store.read()).pending).toEqual([]);
});
it('refuses retired --force and accepts the retired --yes-profile without effect in CLI grammar', async () => {
  const { buildProgram } = await import('../../cli.js');
  let received: unknown;
  const program = buildProgram(async invoke => { await invoke(new ScriptedPrompter()); }, {
    login: async () => ({ ok: false, error: 'unused' }), team: async () => ({ ok: false, error: 'unused' }),
    install: async args => { received = args; return { ok: true, value: [] }; },
  });
  program.configureOutput({ writeErr: () => {} });
  await expect(program.parseAsync(['install', 'sample', '--force'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
  expect(received).toBeUndefined();
  await program.parseAsync(['install', 'sample', '--yes-profile', '--into', 'global'], { from: 'user' });
  expect(received).toMatchObject({ ref: 'sample', into: 'global' });
});
it('a failed profile write after the install landed reports itself on one line and in profiled: false, never as a failed install', async () => {
  const f = await fixture();
  // The install record is the first push; the profile entry is a second, separate safeWrite. Only the second push goes offline.
  let pushes = 0;
  const runner = wrapRunner(systemRunner, async (_command, args, _options, next) => args[0] === 'push' && ++pushes === 2 ? { code: 1, stdout: '', stderr: 'offline' } : next());
  const io = new ScriptedPrompter();
  expect(await run({ ...f.args, runner, safeWrite: { deadlineMs: 0 } }, io)).toMatchObject({ ok: true, value: [{ id: f.id, version: 'v1', profiled: false }] });
  expect(io.lines.filter(line => line.startsWith('Installed sample, but could not add it to your profile: '))).toHaveLength(1);
  expect(await readFile(join(f.target, 'SKILL.md'), 'utf8')).toBe(f.bytes);
  const person = JSON.parse(await readFile(join(f.clone, 'people/seed.json'), 'utf8'));
  expect(person.installed).toEqual([expect.objectContaining({ id: f.id, version: 'v1' })]);
  expect(person.profile ?? []).toEqual([]);
});
