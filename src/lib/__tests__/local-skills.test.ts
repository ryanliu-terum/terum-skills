import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidatesOf, localSkills, localSkillCandidates } from '../local-skills.js';
import { emptyConfig } from '../schema.js';
import { temporaryDirectory } from './fixtures.js';

async function candidate(root: string, name: string, source = `---\nname: ${name}\ndescription: skill\n---\n`): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), source);
  return path;
}

describe('localSkillCandidates', () => {
  it('returns sorted candidates without requiring managed fields and silently skips absent roots or SKILL.md', async () => {
    const root = await temporaryDirectory();
    expect(await localSkillCandidates(join(root, 'absent'), emptyConfig())).toEqual({ names: [], omitted: [], unreadable: 0 });
    await candidate(root, 'zebra');
    await candidate(root, 'alpha');
    await mkdir(join(root, 'empty'));
    expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: ['alpha', 'zebra'], omitted: [], unreadable: 0 });
  });

  it('excludes a shared source even when it belongs to another team', async () => {
    const root = await temporaryDirectory();
    const path = await candidate(root, 'mine');
    const config = emptyConfig();
    config.shared['22222222-2222-4222-8222-222222222222'] = { source: join(path, '..', 'mine'), team: 'other', baseline: 'sha256:0' };
    expect(await localSkillCandidates(root, config)).toEqual({ names: [], omitted: [], unreadable: 0 });
  });

  it('excludes a placement', async () => {
    const root = await temporaryDirectory();
    const path = await candidate(root, 'placed');
    const config = emptyConfig();
    config.placements[path] = { id: '22222222-2222-4222-8222-222222222222', team: 'other', version: null, scope: { kind: 'global' }, placed_at: new Date().toISOString(), fingerprint: 'sha256:0' };
    expect(await localSkillCandidates(root, config)).toEqual({ names: [], omitted: [], unreadable: 0 });
  });

  it.each([
    ['gsd-x', '---\nname: gsd:x\n---\n', 'SKILL.md name gsd:x does not equal folder gsd-x'],
    ['plain', 'No frontmatter', 'SKILL.md has no YAML frontmatter'],
    ['broken', '---\nname: [\n---\n', `SKILL.md frontmatter is not valid YAML: ${YAML.parseDocument('name: [').errors[0]!.message}`],
    ['Bad', '---\nname: Bad\n---\n', 'folder name is not a legal skill name (1–64 lowercase alphanumerics or single hyphens)'],
  ])('omits %s with its validation reason', async (name, source, reason) => {
    const root = await temporaryDirectory();
    await candidate(root, name, source);
    const result = await localSkillCandidates(root, emptyConfig());
    expect(result).toEqual({ names: [], omitted: [{ name, reason }], unreadable: 0 });
    expect(result.omitted[0]?.reason).toBe(reason);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('counts an unreadable candidate folder and continues', async () => {
    const root = await temporaryDirectory();
    const path = await candidate(root, 'blocked');
    await candidate(root, 'readable');
    await chmod(path, 0o000);
    try {
      expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: ['readable'], omitted: [], unreadable: 1 });
    } finally { await chmod(path, 0o700); }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('counts an unreadable root once', async () => {
    const root = await temporaryDirectory();
    await chmod(root, 0o000);
    try {
      expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: [], omitted: [], unreadable: 1 });
    } finally { await chmod(root, 0o700); }
  });

  it('omits a directory-shaped SKILL.md with its reason instead of counting it unreadable (R.3: rejected, never an omission)', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'broken', 'SKILL.md'), { recursive: true });
    expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: [], omitted: [{ name: 'broken', reason: 'SKILL.md is not a regular file' }], unreadable: 0 });
  });

  it.skipIf(process.platform === 'win32')('omits a symlinked entry with its reason rather than silently skipping it (R.3: discovery does not follow links)', async () => {
    const fixture = await temporaryDirectory();
    const root = join(fixture, 'skills');
    await mkdir(root);
    const path = await candidate(fixture, 'outside');
    await symlink(path, join(root, 'linked'));
    expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: [], omitted: [{ name: 'linked', reason: 'symbolic link' }], unreadable: 0 });
  });
});


describe('issue 9 local inventory', () => {
  it('does not offer a description-less source through the existing candidate API', async () => {
    const root = await temporaryDirectory();
    await candidate(root, 'missing', '---\nname: missing\n---\n');
    expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: [], omitted: [{ name: 'missing', reason: 'description is missing' }], unreadable: 0 });
  });

  it('retains each inspection outcome and offers stock sources, with privileged sources only by opt-in', async () => {
    const root = await temporaryDirectory();
    await candidate(root, 'stock');
    await candidate(root, 'gsd-x', '---\nname: gsd:x\ndescription: x\n---\n');
    await candidate(root, 'missing', '---\nname: missing\n---\n');
    await candidate(root, 'yaml', '---\nname: [\n---\n');
    await candidate(root, 'unsupported', '---\nname: unsupported\ndescription: x\nargument-hint: x\n---\n');
    await candidate(root, 'grants', '---\nname: grants\ndescription: x\nallowed-tools: {bash: true}\n---\n');
    const hooks = await candidate(root, 'privileged'); await mkdir(join(hooks, 'hooks'));
    const nested = await candidate(root, 'nested'); await symlink(join(root, 'stock'), join(nested, 'link'));
    await symlink(join(root, 'stock'), join(root, 'linked'));
    await mkdir(join(root, 'empty'));
    const inventory = await localSkills(root, emptyConfig());
    expect(inventory).toMatchObject({ root, scope: 'global', rootState: 'scanned', problems: [] });
    expect(inventory.entries.map((entry) => [entry.name, entry.inspection.kind === 'rejected' ? entry.inspection.reason : entry.inspection.kind])).toEqual([
      ['grants', 'malformed-allowed-tools'], ['gsd-x', 'name-mismatch'], ['linked', 'symlink'], ['missing', 'description-missing'],
      ['nested', 'nested-symlink'], ['privileged', 'candidate'], ['stock', 'candidate'], ['unsupported', 'unsupported-field'], ['yaml', 'invalid-yaml'],
    ]);
    expect(inventory.entries.find((entry) => entry.name === 'stock')?.inspection).toEqual({ kind: 'candidate', description: 'skill', privileged: false });
    expect(inventory.entries.find((entry) => entry.name === 'privileged')?.inspection).toEqual({ kind: 'candidate', description: 'skill', privileged: true });
    expect(candidatesOf(inventory).map((entry) => entry.name)).toEqual(['stock']);
    expect(candidatesOf(inventory, true).map((entry) => entry.name)).toEqual(['privileged', 'stock']);
  });

  it('keeps overlapping ledger references and a tracked source whose SKILL.md vanished', async () => {
    const root = await temporaryDirectory(); const path = join(root, 'missing'); await mkdir(path);
    const config = emptyConfig();
    config.shared.first = { team: 'one', source: path };
    config.shared.second = { team: 'two', source: join(path, '..', 'missing') };
    config.placements[path] = { id: '33333333-3333-4333-8333-333333333333', team: 'three', version: null, scope: { kind: 'global' }, placed_at: '', fingerprint: '' };
    expect((await localSkills(root, config)).entries).toEqual([{ name: 'missing', path, shared: [{ id: 'first', team: 'one' }, { id: 'second', team: 'two' }], placement: { id: config.placements[path]!.id, team: 'three', version: null }, inspection: { kind: 'rejected', reason: 'skill-md-missing', detail: 'SKILL.md missing' } }]);
  });

  it('distinguishes an absent root from a scanned empty root', async () => {
    const root = await temporaryDirectory();
    expect(await localSkills(join(root, 'absent'), emptyConfig())).toEqual({ root: join(root, 'absent'), scope: 'global', rootState: 'absent', entries: [], problems: [] });
    expect(await localSkills(root, emptyConfig())).toEqual({ root, scope: 'global', rootState: 'scanned', entries: [], problems: [] });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('retains an unreadable file and root as failures', async () => {
    const root = await temporaryDirectory(); const path = await candidate(root, 'blocked');
    await chmod(join(path, 'SKILL.md'), 0o000);
    try {
      expect((await localSkills(root, emptyConfig())).entries[0]?.inspection).toEqual({ kind: 'failed', reason: expect.stringContaining('EACCES') });
    } finally { await chmod(join(path, 'SKILL.md'), 0o600); }
    await chmod(root, 0o000);
    try {
      expect(await localSkills(root, emptyConfig())).toMatchObject({ rootState: 'unreadable', entries: [], problems: [{ path: root, reason: expect.stringContaining('EACCES') }] });
    } finally { await chmod(root, 0o700); }
  });
});
