import * as fs from 'node:fs/promises';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { candidatesOf, localSkills, localSkillRoots } from '../local-skills.js';
import { emptyConfig } from '../schema.js';
import { assertSkillSource } from '../skill-source.js';
import { BUNDLED_SKILL_SOURCE, temporaryDirectory } from './fixtures.js';

// Clone the ESM namespace so individual permission failures can be injected and restored.
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

async function candidate(root: string, name: string, source = `---\nname: ${name}\ndescription: skill\n---\n`): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), source);
  return path;
}

// Preserve the old projection assertions while exercising the replacement inventory API.
// This adapter is test-only; production has one inventory and candidatesOf path.
async function candidateSummary(root: string, config: ReturnType<typeof emptyConfig>) {
  const inventory = await localSkills(root, config, { scope: 'global', stateRoot: join(root, '.state') });
  return {
    names: candidatesOf(inventory).map((entry) => entry.name),
    omitted: inventory.entries.flatMap((entry) => !entry.shared.length && !entry.placement && entry.inspection.kind === 'rejected' ? [{ name: entry.name, reason: entry.inspection.detail }] : []),
    unreadable: inventory.problems.length + inventory.entries.filter((entry) => entry.inspection.kind === 'failed').length,
  };
}

describe('candidateSummary', () => {
  it('returns sorted candidates without requiring managed fields and silently skips absent roots or SKILL.md', async () => {
    const root = await temporaryDirectory();
    expect(await candidateSummary(join(root, 'absent'), emptyConfig())).toEqual({ names: [], omitted: [], unreadable: 0 });
    await candidate(root, 'zebra');
    await candidate(root, 'alpha');
    await mkdir(join(root, 'empty'));
    expect(await candidateSummary(root, emptyConfig())).toEqual({ names: ['alpha', 'zebra'], omitted: [], unreadable: 0 });
  });

  // legacy: two teams bound before the one-team rule (2026-09-08); reads/syncs keep working
  it('excludes a shared source even when it belongs to another team', async () => {
    const root = await temporaryDirectory();
    const path = await candidate(root, 'mine');
    const config = emptyConfig();
    config.shared['22222222-2222-4222-8222-222222222222'] = { source: join(path, '..', 'mine'), team: 'other', baseline: 'sha256:0' };
    expect(await candidateSummary(root, config)).toEqual({ names: [], omitted: [], unreadable: 0 });
  });

  it('excludes a placement', async () => {
    const root = await temporaryDirectory();
    const path = await candidate(root, 'placed');
    const config = emptyConfig();
    config.placements[path] = { id: '22222222-2222-4222-8222-222222222222', team: 'other', version: null, scope: { kind: 'global' }, placed_at: new Date().toISOString(), fingerprint: 'sha256:0' };
    expect(await candidateSummary(root, config)).toEqual({ names: [], omitted: [], unreadable: 0 });
  });

  it.each([
    ['gsd-x', '---\nname: gsd:x\n---\n', 'SKILL.md name gsd:x does not equal folder gsd-x'],
    ['plain', 'No frontmatter', 'SKILL.md has no YAML frontmatter'],
    ['broken', '---\nname: [\n---\n', `SKILL.md frontmatter is not valid YAML: ${YAML.parseDocument('name: [').errors[0]!.message}`],
    ['Bad', '---\nname: Bad\n---\n', 'folder name is not a legal skill name (1–64 lowercase alphanumerics or single hyphens)'],
  ])('omits %s with its validation reason', async (name, source, reason) => {
    const root = await temporaryDirectory();
    await candidate(root, name, source);
    const result = await candidateSummary(root, emptyConfig());
    expect(result).toEqual({ names: [], omitted: [{ name, reason }], unreadable: 0 });
    expect(result.omitted[0]?.reason).toBe(reason);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('counts an unreadable candidate folder and continues', async () => {
    const root = await temporaryDirectory();
    const path = await candidate(root, 'blocked');
    await candidate(root, 'readable');
    await chmod(path, 0o000);
    try {
      expect(await candidateSummary(root, emptyConfig())).toEqual({ names: ['readable'], omitted: [], unreadable: 1 });
    } finally { await chmod(path, 0o700); }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('counts an unreadable root once', async () => {
    const root = await temporaryDirectory();
    await chmod(root, 0o000);
    try {
      expect(await candidateSummary(root, emptyConfig())).toEqual({ names: [], omitted: [], unreadable: 1 });
    } finally { await chmod(root, 0o700); }
  });

  it('omits a directory-shaped SKILL.md with its reason instead of counting it unreadable (R.3: rejected, never an omission)', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'broken', 'SKILL.md'), { recursive: true });
    expect(await candidateSummary(root, emptyConfig())).toEqual({ names: [], omitted: [{ name: 'broken', reason: 'SKILL.md is not a regular file' }], unreadable: 0 });
  });

  it.skipIf(process.platform === 'win32')('omits a symlinked entry with its reason rather than silently skipping it (R.3: discovery does not follow links)', async () => {
    const fixture = await temporaryDirectory();
    const root = join(fixture, 'skills');
    await mkdir(root);
    const path = await candidate(fixture, 'outside');
    await symlink(path, join(root, 'linked'));
    expect(await candidateSummary(root, emptyConfig())).toEqual({ names: [], omitted: [{ name: 'linked', reason: 'symbolic link' }], unreadable: 0 });
  });
});


describe('issue 9 local inventory', () => {
  it('does not offer a description-less source through the existing candidate API', async () => {
    const root = await temporaryDirectory();
    await candidate(root, 'missing', '---\nname: missing\n---\n');
    expect(await candidateSummary(root, emptyConfig())).toEqual({ names: [], omitted: [{ name: 'missing', reason: 'description is missing' }], unreadable: 0 });
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
    const inventory = await localSkills(root, emptyConfig(), { scope: 'global', stateRoot: join(root, '.state') });
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
    expect((await localSkills(root, config, { scope: 'global', stateRoot: join(root, '.state') })).entries).toEqual([{ skillId: null, name: 'missing', path, shared: [{ id: 'first', team: 'one' }, { id: 'second', team: 'two' }], placement: { id: config.placements[path]!.id, team: 'three', version: null }, placementFingerprint: '', inspection: { kind: 'rejected', reason: 'skill-md-missing', detail: 'SKILL.md missing' } }]);
  });

  it('distinguishes an absent root from a scanned empty root', async () => {
    const root = await temporaryDirectory();
    expect(await localSkills(join(root, 'absent'), emptyConfig(), { scope: 'global', stateRoot: join(root, '.state') })).toEqual({ root: join(root, 'absent'), scope: 'global', rootState: 'absent', entries: [], problems: [] });
    expect(await localSkills(root, emptyConfig(), { scope: 'global', stateRoot: join(root, '.state') })).toEqual({ root, scope: 'global', rootState: 'scanned', entries: [], problems: [] });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('retains an unreadable file and root as failures', async () => {
    const root = await temporaryDirectory(); const path = await candidate(root, 'blocked');
    await chmod(join(path, 'SKILL.md'), 0o000);
    try {
      expect((await localSkills(root, emptyConfig(), { scope: 'global', stateRoot: join(root, '.state') })).entries[0]?.inspection).toEqual({ kind: 'failed', reason: expect.stringContaining('EACCES') });
    } finally { await chmod(join(path, 'SKILL.md'), 0o600); }
    await chmod(root, 0o000);
    try {
      expect(await localSkills(root, emptyConfig(), { scope: 'global', stateRoot: join(root, '.state') })).toMatchObject({ rootState: 'unreadable', entries: [], problems: [{ path: root, reason: expect.stringContaining('EACCES') }] });
    } finally { await chmod(root, 0o700); }
  });
});


describe('project local discovery (Ryan 2026-09-06)', () => {
  it.each(['directory', 'file'])('walks up from a subdirectory to a .git %s without reading the marker', async (kind) => {
    const home = await temporaryDirectory(); const repo = join(home, 'repo'); const cwd = join(repo, 'src', 'deep');
    await mkdir(cwd, { recursive: true });
    if (kind === 'file') await writeFile(join(repo, '.git'), 'not a readable gitdir reference');
    else await mkdir(join(repo, '.git'));
    expect(await localSkillRoots(home, cwd)).toEqual({ roots: [
      { root: join(home, '.claude', 'skills'), scope: 'global' },
      { root: join(repo, '.claude', 'skills'), scope: 'project', repoRoot: repo },
    ], problems: [] });
  });

  it('stops at the inner repository instead of scanning intermediate ancestor skills', async () => {
    const home = await temporaryDirectory(); const outer = join(home, 'outer'); const inner = join(outer, 'inner'); const cwd = join(inner, 'src');
    await mkdir(cwd, { recursive: true }); await mkdir(join(outer, '.git')); await writeFile(join(inner, '.git'), 'gitdir: ignored');
    await candidate(join(cwd, '.claude', 'skills'), 'intermediate');
    expect((await localSkillRoots(home, cwd)).roots).toEqual([
      { root: join(home, '.claude', 'skills'), scope: 'global' }, { root: join(inner, '.claude', 'skills'), scope: 'project', repoRoot: inner },
    ]);
  });

  it('reports the explicitly supplied cwd when no ancestor is a repository', async () => {
    const home = await temporaryDirectory(); const cwd = join(home, 'outside'); await mkdir(cwd);
    expect(await localSkillRoots(home, cwd)).toEqual({ roots: [{ root: join(home, '.claude', 'skills'), scope: 'global' }], noRepository: cwd, problems: [] });
  });

  it('keeps undefined cwd global-only (regression: never uses the process cwd)', async () => {
    const home = await temporaryDirectory(); await mkdir(join(home, '.git'));
    expect(await localSkillRoots(home)).toEqual({ roots: [{ root: join(home, '.claude', 'skills'), scope: 'global' }], problems: [] });
  });

  it('reports EACCES in the upward walk without a project or no-repository claim', async () => {
    const home = await temporaryDirectory(); const cwd = join(home, 'private'); await mkdir(cwd);
    const original = fs.lstat; const marker = join(cwd, '.git');
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (args[0] === marker) throw Object.assign(new Error('EACCES: blocked marker'), { code: 'EACCES' });
      return original(...args);
    });
    try { expect(await localSkillRoots(home, cwd)).toEqual({ roots: [{ root: join(home, '.claude', 'skills'), scope: 'global' }], problems: [{ path: marker, reason: 'EACCES: blocked marker' }] }); }
    finally { spy.mockRestore(); }
  });

  it('deduplicates a home repository with global precedence', async () => {
    const home = await temporaryDirectory(); await mkdir(join(home, '.git'));
    await candidate(join(home, '.claude', 'skills'), 'local');
    expect(await localSkillRoots(home, home)).toEqual({ roots: [{ root: join(home, '.claude', 'skills'), scope: 'global' }], problems: [] });
  });

  it.each(['alias-to-real', 'real-to-alias', 'deduplicated-alias'])('joins both ledgers through canonical parents: %s', async (direction) => {
    const base = await temporaryDirectory(); const home = join(base, 'real'); const alias = join(base, 'alias');
    const root = join(home, '.claude', 'skills'); const path = await candidate(root, 'tracked');
    await symlink(home, alias); await mkdir(join(home, '.git'));
    const aliasRoot = join(alias, '.claude', 'skills');
    const reference = direction === 'real-to-alias' ? path : join(aliasRoot, 'tracked');
    const scannedRoot = direction === 'real-to-alias' ? aliasRoot : root;
    const config = emptyConfig(); config.shared.id = { source: reference, team: 'one' };
    config.placements[reference] = { id: 'placed', team: 'two', version: null, scope: { kind: 'global' }, fingerprint: '', placed_at: '' };
    if (direction === 'deduplicated-alias') expect((await localSkillRoots(home, alias)).roots).toEqual([{ root, scope: 'global' }]);
    await symlink(path, join(root, 'child-link'));
    const inventory = await localSkills(scannedRoot, config, { scope: 'global', stateRoot: join(base, 'state') });
    expect(inventory.entries.find((entry) => entry.name === 'tracked')).toMatchObject({ shared: [{ id: 'id', team: 'one' }], placement: { id: 'placed', team: 'two' } });
    expect(inventory.entries.find((entry) => entry.name === 'child-link')).toMatchObject({ shared: [], inspection: { kind: 'rejected', reason: 'symlink' } });
    expect(candidatesOf(inventory)).toEqual([]);
  });

  it('excludes canonical state-root entries but retains tracked provenance and project scope', async () => {
    const home = await temporaryDirectory(); const stateRoot = join(home, 'state'); const root = join(stateRoot, 'sources');
    await candidate(root, 'untracked'); const path = await candidate(root, 'tracked');
    const alias = join(home, 'alias'); await symlink(root, alias);
    const config = emptyConfig(); config.shared.id = { source: path, team: 'team' };
    const inventory = await localSkills(alias, config, { scope: 'project', stateRoot });
    expect(inventory.scope).toBe('project');
    expect(inventory.entries.map((entry) => entry.inspection)).toEqual([0, 1].map(() => ({ kind: 'rejected', reason: 'inside-state-root', detail: `inside the terum-skills state directory ${stateRoot}` })));
    expect(inventory.entries[0]?.shared).toEqual([{ id: 'id', team: 'team' }]);
    expect(candidatesOf(inventory, true)).toEqual([]);
  });
});

describe('the bundled /terum-skills Claude Code skill is not a team skill', () => {
  it('discovery rejects it with its own reason under any folder name, and connect refuses it', async () => {
    const root = await temporaryDirectory();
    const bundled = await readFile(BUNDLED_SKILL_SOURCE, 'utf8');
    await candidate(root, 'terum-skills', bundled);
    await candidate(root, 'renamed-copy', bundled);
    await candidate(root, 'plain');
    const inventory = await localSkills(root, emptyConfig(), { scope: 'global', stateRoot: join(root, '.state') });
    const rejected = { kind: 'rejected', reason: 'managed-wrapper', detail: 'the /terum-skills Claude Code skill that ships with terum-skills; not a team skill' };
    expect(inventory.entries.find((entry) => entry.name === 'terum-skills')?.inspection).toEqual(rejected);
    expect(inventory.entries.find((entry) => entry.name === 'renamed-copy')?.inspection).toEqual(rejected);
    expect(candidatesOf(inventory, true).map((entry) => entry.name)).toEqual(['plain']);
    expect(() => assertSkillSource(bundled, 'terum-skills')).toThrow('This folder is the /terum-skills Claude Code skill that ships with terum-skills and is placed by setup; it cannot be connected to a team.');
  });
});
