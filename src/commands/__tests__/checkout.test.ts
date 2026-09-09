import { mkdir, realpath, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
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
