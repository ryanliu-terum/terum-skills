import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localSkillCandidates } from '../local-skills.js';
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
    ['broken', '---\nname: [\n---\n', 'SKILL.md frontmatter is not valid YAML'],
    ['Bad', '---\nname: Bad\n---\n', 'folder name is not a legal skill name'],
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

  it('counts a SKILL.md read failure and continues', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'broken', 'SKILL.md'), { recursive: true });
    expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: [], omitted: [], unreadable: 1 });
  });

  it.skipIf(process.platform === 'win32')('silently skips symlinked entries', async () => {
    const fixture = await temporaryDirectory();
    const root = join(fixture, 'skills');
    await mkdir(root);
    const path = await candidate(fixture, 'outside');
    await symlink(path, join(root, 'linked'));
    expect(await localSkillCandidates(root, emptyConfig())).toEqual({ names: [], omitted: [], unreadable: 0 });
  });
});
