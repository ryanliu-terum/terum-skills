import { chmod, mkdir, realpath, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { frameChannel, type Frame } from '../../lib/frames.js';
import { configSchema } from '../../lib/schema.js';
import { ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run } from '../checkout.js';

async function fixture() {
  const home = await realpath(await temporaryDirectory()); const config = createConfigStore(join(home, 'state'));
  const root = join(home, 'repo'); const cwd = join(root, 'src');
  await mkdir(cwd, { recursive: true }); await mkdir(join(root, '.git'));
  return { home, config, root, cwd };
}

describe('checkout registry', () => {
  it('asks for the nearest repository, stores a realpath, and adds idempotently without a team', async () => {
    const args = await fixture(); const io = new ScriptedPrompter(['']);
    expect(await run({ ...args, kind: 'add' }, io)).toMatchObject({ ok: true, value: { path: args.root, registered: true } });
    expect(io.asked).toEqual(['Which folder?']);
    expect(io.lines).toEqual([`Registered ${args.root}`]);
    const alias = join(args.home, 'alias'); await symlink(args.root, alias);
    const again = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'add', path: alias }, again)).toMatchObject({ ok: true, value: { path: args.root, registered: false } });
    expect(again.lines).toEqual([`Already registered ${args.root}`]);
    expect((await args.config.read()).checkouts).toEqual([args.root]);
  });
  it('registers a non-git folder through an alias', async () => {
    const args = await fixture(); const root = join(args.home, 'plain'); await mkdir(root);
    const alias = join(args.home, 'alias'); await symlink(root, alias);
    expect(await run({ ...args, kind: 'add', path: alias }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { path: root } });
    expect((await args.config.read()).checkouts).toEqual([root]);
  });
  it.each(['state', 'home', 'missing'])('refuses %s without writing', async (kind) => {
    const args = await fixture(); await args.config.update(() => undefined);
    const before = await readFile(join(args.config.root, 'config.json'), 'utf8');
    const path = kind === 'state' ? args.config.root : kind === 'home' ? args.home : join(args.home, 'missing');
    const result = await run({ ...args, kind: 'add', path }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(kind === 'missing' ? 'does not exist' : kind === 'state' ? 'state directory' : 'Global') });
    expect(await readFile(join(args.config.root, 'config.json'), 'utf8')).toBe(before);
  });
  it('removes only registry membership, retaining the empty key and ledger', async () => {
    const args = await fixture(); const target = join(args.root, '.claude', 'skills', 'one');
    await args.config.update(c => {
      c.checkouts = [args.root];
      c.placements[target] = { id: '11111111-1111-4111-8111-111111111111', team: 'team', version: null, scope: { kind: 'project', project: 'app' }, placed_at: '', fingerprint: '' };
    });
    const before = (await args.config.read()).placements; const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'remove', path: args.root }, io)).toMatchObject({ ok: true, value: { path: args.root, placementsRemaining: 1 } });
    expect(io.lines).toEqual([`Removed ${args.root} from your library.`, `1 placements recorded under ${args.root} stay in the ledger; uninstall-skill removes them.`]);
    const after = configSchema.parse(JSON.parse(await readFile(join(args.config.root, 'config.json'), 'utf8')));
    expect(after.checkouts).toEqual([]); expect(after.placements).toEqual(before);
    expect(await run({ ...args, kind: 'remove', path: args.root }, new ScriptedPrompter())).toMatchObject({ ok: false, error: `${args.root} is not registered.` });
  });
  it('lists scanned and absent roots with skill-folder counts and no team', async () => {
    const args = await fixture(); const absent = join(args.home, 'missing');
    const skill = join(args.root, '.claude', 'skills', 'one'); await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), '---\nname: mismatch\ndescription: x\n---\n');
    await args.config.update(c => { c.checkouts = [absent, args.root]; });
    const io = new ScriptedPrompter();
    expect(await run({ ...args, kind: 'list' }, io)).toMatchObject({ ok: true, value: { checkouts: [
      { path: absent, rootState: 'absent', skillFolders: 0 }, { path: args.root, rootState: 'scanned', skillFolders: 1 },
    ] } });
    expect(io.lines).toEqual([`${absent} — absent; 0 skill folders`, `${args.root} — scanned; 1 skill folders`]);
    expect(io.asked).toEqual([]);
    await args.config.update(c => { c.checkouts = []; });
    const empty = new ScriptedPrompter(); await run({ ...args, kind: 'list' }, empty); expect(empty.lines).toEqual(['none']);
  });
});


it('preserves unrelated formatting and counts missing placements by lexical registry evidence', async () => {
  const args = await fixture(); const alias = join(args.home, 'alias'); await symlink(args.root, alias);
  const target = join(alias, '.claude', 'skills', 'missing');
  await args.config.update(c => {
    c.checkouts = [alias]; c.extra = { kept: true };
    c.placements[target] = { id: '11111111-1111-4111-8111-111111111111', team: 'team', version: null, scope: { kind: 'project', project: 'app' }, placed_at: '', fingerprint: '' };
  });
  const file = join(args.config.root, 'config.json');
  const original = (await readFile(file, 'utf8')).replace('"kept": true', '"kept"  :  true'); await writeFile(file, original);
  const result = await run({ ...args, kind: 'remove', path: args.root }, new ScriptedPrompter());
  expect(result).toMatchObject({ ok: true, value: { placementsRemaining: 1 } });
  expect(await readFile(file, 'utf8')).toContain('"kept"  :  true');
});

async function discoverFixture() {
  const home = await temporaryDirectory(); const config = createConfigStore(join(home, 'state'));
  async function skill(root: string) { const dir = join(root, '.claude', 'skills', 'sample'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'SKILL.md'), '---\nname: sample\ndescription: sample skill\n---\n'); }
  return { args: { kind: 'discover' as const, under: [home], home, config, cwd: home }, skill, a: join(home, 'a'), b: join(home, 'b') };
}
it('checkout discover lists every candidate with its count and returns the structure', async () => {
  const { args, skill, a, b } = await discoverFixture(); await skill(a); await skill(b); const io = new ScriptedPrompter();
  const result = await run(args, io); expect(result).toMatchObject({ ok: true, value: { candidates: [{ path: a, skillFolders: 1 }, { path: b, skillFolders: 1 }] } });
  expect(io.lines[0]).toMatch(/^Looked in \d+ folders under /); expect(io.lines.slice(1)).toEqual([`${a} — 1 skill folders`, `${b} — 1 skill folders`]);
});
it('checkout discover prints none found when nothing matches', async () => {
  const { args } = await discoverFixture(); const io = new ScriptedPrompter();
  expect(await run(args, io)).toMatchObject({ ok: true, value: { candidates: [] } }); expect(io.lines.slice(1)).toEqual(['none found']);
});
it('checkout discover --register registers the unregistered candidates and leaves the registered one alone', async () => {
  const { args, skill, a, b } = await discoverFixture(); await skill(a); await skill(b); await args.config.update(c => { c.checkouts = [a]; });
  const io = new ScriptedPrompter(); expect(await run({ ...args, register: true }, io)).toMatchObject({ ok: true, value: { candidates: [{ path: a, registered: true }, { path: b, registered: true }] } });
  expect((await args.config.read()).checkouts).toEqual([a, b]); expect(io.lines.filter(l => l.startsWith('Registered '))).toEqual([`Registered ${b}`]); expect(io.lines.some(l => l.startsWith('Already registered'))).toBe(false);
});
it('checkout discover --budget-ms 0 says it stopped early', async () => {
  const { args } = await discoverFixture(); const io = new ScriptedPrompter(); expect(await run({ ...args, budgetMs: 0 }, io)).toMatchObject({ ok: true, value: { truncated: true, scanned: 0 } });
  expect(io.lines).toContain('(stopped after 0 s; pass --budget-ms to look longer)');
});
it('checkout discover refuses a negative depth and a fractional budget', async () => {
  const { args, skill, a } = await discoverFixture(); await skill(a); const io = new ScriptedPrompter();
  expect(await run({ ...args, depth: -1 }, io)).toEqual({ ok: false, error: '--depth must be a non-negative integer.' });
  expect(await run({ ...args, budgetMs: 1.5 }, io)).toEqual({ ok: false, error: '--budget-ms must be a non-negative integer.' }); expect(io.lines).toEqual([]);
});
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('checkout discover reports an unreadable folder and still succeeds', async () => {
  const { args, a } = await discoverFixture(); await mkdir(a); await chmod(a, 0); const io = new ScriptedPrompter();
  try { expect((await run(args, io)).ok).toBe(true); expect(io.lines.filter(l => l.startsWith('Could not look in '))).toEqual([expect.stringContaining(a)]); }
  finally { await chmod(a, 0o700); }
});
it('checkout discover emits progress frames with step discover', async () => {
  const { args } = await discoverFixture(); const input = new PassThrough(), output = new PassThrough(); const frames: Frame[] = [];
  output.on('data', (data: Buffer) => frames.push(JSON.parse(data.toString()) as Frame)); const channel = frameChannel({ input, output });
  await run(args, channel.io); channel.result({ verb: 'checkout discover', ok: true, exitCode: 0 });
  const progress = frames.filter(f => f.t === 'progress'); expect(progress.length).toBeGreaterThan(0);
  for (const frame of progress) expect(frame).toEqual({ t: 'progress', step: 'discover', current: expect.any(Number) });
});
it('checkout discover keeps its own registration failure out of the result', async () => {
  const { args, skill, a, b } = await discoverFixture(); await skill(a); await skill(b); const io = new ScriptedPrompter();
  const update = vi.spyOn(args.config, 'update').mockRejectedValueOnce(new Error('write denied'));
  try {
    expect(await run({ ...args, register: true }, io)).toMatchObject({ ok: true, value: { candidates: [{ path: a, registered: false }, { path: b, registered: true }] } });
    expect(io.lines).toContain(`Could not register ${a}: write denied`); expect((await args.config.read()).checkouts).toEqual([b]);
  } finally { update.mockRestore(); }
});
