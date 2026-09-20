import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_WRAPPER, defaultWrapperOptions, inspectWrapper, installWrapper, isManagedWrapper, removeWrapper, renderWrapper, wrapperDestination, wrapperState } from '../wrapper.js';
import { NPX_PREFIX, pinnedPrefix } from '../invocation.js';
import { packageVersion } from '../package.js';
import { BUNDLED_SKILL_SOURCE, SYMLINKS_SUPPORTED, temporaryDirectory, wrapperFor } from './fixtures.js';

const OLD_COPY = '---\nname: terum-skills\ndescription: an older bundled copy\nmetadata:\n  managed-by: terum-skills\n---\nold body\n';
const SOMEONE_ELSES = '---\nname: terum-skills\ndescription: someone else\'s skill under the same name\n---\n';

async function fresh() {
  const root = await temporaryDirectory('terum-wrapper-');
  const home = join(root, 'home');
  const options = wrapperFor(home);
  return { root, home, options, destination: wrapperDestination(options.skillsRoot) };
}

describe('the bundled /terum-skills Claude Code skill', () => {
  it('the canonical skill carries the marker; the default source is the built bundle beside dist/lib; unmarked or broken frontmatter is not ours', async () => {
    expect(isManagedWrapper(await readFile(BUNDLED_SKILL_SOURCE, 'utf8'))).toBe(true);
    expect(BUNDLED_WRAPPER).toMatch(/[\\/]claude[\\/]skills[\\/]terum-skills[\\/]SKILL\.md$/);
    expect(defaultWrapperOptions('/h')).toEqual({ skillsRoot: join('/h', '.claude', 'skills'), source: BUNDLED_WRAPPER, prefix: `npx -y terum-skills@${packageVersion()}` });
    expect(defaultWrapperOptions('/h', 'bare').prefix).toBe('terum-skills');
    expect(pinnedPrefix(undefined)).not.toContain('@latest');
    for (const raw of ['no frontmatter', '---\nname: terum-skills\n---\n', SOMEONE_ELSES, '---\nname: other\nmetadata:\n  managed-by: terum-skills\n---\n', '---\nname: terum-skills\nmetadata: [x]\n---\n', '---\nname: [\n---\n']) expect(isManagedWrapper(raw), raw).toBe(false);
  });

  it('installs the bundle byte for byte, reports current, refreshes an outdated copy of its own, and removes only what it placed', async () => {
    const { options, destination } = await fresh();
    expect(await wrapperState(options)).toBe('absent');
    expect(await installWrapper(options)).toBe('installed');
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe(await readFile(options.source, 'utf8'));
    expect(await wrapperState(options)).toBe('current');
    await writeFile(join(destination, 'SKILL.md'), OLD_COPY);
    expect(await wrapperState(options)).toBe('outdated');
    expect(await installWrapper(options)).toBe('replaced');
    expect(await wrapperState(options)).toBe('current');
    // Removal takes the marked SKILL.md and the folder; a file the user added keeps the folder, and is theirs.
    expect(await removeWrapper(options)).toBe('removed');
    expect(await inspectWrapper(options.skillsRoot)).toEqual({ kind: 'absent' });
    expect(await removeWrapper(options)).toBe('absent');
    await installWrapper(options);
    await writeFile(join(destination, 'notes.md'), 'mine');
    expect(await removeWrapper(options)).toBe('removed');
    expect(await inspectWrapper(options.skillsRoot)).toEqual({ kind: 'foreign', why: 'it has no SKILL.md' });
    expect(await readFile(join(destination, 'notes.md'), 'utf8')).toBe('mine');
    expect(await removeWrapper(options)).toBe('foreign');
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('never writes to or removes anything that is not its own copy: another skill, a symlink, a plain file', async () => {
    const other = await fresh();
    await mkdir(other.destination, { recursive: true }); await writeFile(join(other.destination, 'SKILL.md'), SOMEONE_ELSES);
    expect(await wrapperState(other.options)).toBe('foreign');
    await expect(installWrapper(other.options)).rejects.toThrow(`${other.destination} exists and is not the bundled /terum-skills skill (it is a different skill); move it aside and re-run.`);
    expect(await removeWrapper(other.options)).toBe('foreign');
    expect(await readFile(join(other.destination, 'SKILL.md'), 'utf8')).toBe(SOMEONE_ELSES);

    const linked = await fresh();
    const real = join(linked.root, 'real'); await mkdir(real, { recursive: true }); await writeFile(join(real, 'SKILL.md'), await readFile(linked.options.source));
    await mkdir(linked.options.skillsRoot, { recursive: true }); await symlink(real, linked.destination);
    expect(await inspectWrapper(linked.options.skillsRoot)).toEqual({ kind: 'foreign', why: 'it is a symbolic link' });
    expect(await wrapperState(linked.options)).toBe('foreign');
    expect(await removeWrapper(linked.options)).toBe('foreign');
    expect(await readFile(join(real, 'SKILL.md'), 'utf8')).toBe(await readFile(linked.options.source, 'utf8'));

    const file = await fresh();
    await mkdir(file.options.skillsRoot, { recursive: true }); await writeFile(file.destination, 'x');
    expect(await inspectWrapper(file.options.skillsRoot)).toEqual({ kind: 'foreign', why: 'it is not a directory' });
    expect(await removeWrapper(file.options)).toBe('foreign');
    expect(await readFile(file.destination, 'utf8')).toBe('x');
  });

  it('places the manual in this machine\'s spelling: the bundle says @latest, the placed copy names the bare binary or the pinned version, and a copy in another spelling is outdated', async () => {
    const bundled = await readFile(BUNDLED_SKILL_SOURCE, 'utf8');
    expect(bundled).toContain(NPX_PREFIX);
    expect(renderWrapper(bundled, 'terum-skills')).not.toContain('@latest');
    expect(renderWrapper(bundled, 'terum-skills')).toContain('Always `terum-skills <verb> …`');
    expect(renderWrapper(bundled, NPX_PREFIX)).toBe(bundled);
    const bare = await fresh(); const options = { ...bare.options, prefix: 'terum-skills' };
    expect(await installWrapper(options)).toBe('installed');
    const placed = await readFile(join(bare.destination, 'SKILL.md'), 'utf8');
    expect(placed).toBe(renderWrapper(bundled, 'terum-skills'));
    expect(isManagedWrapper(placed)).toBe(true);
    expect(await wrapperState(options)).toBe('current');
    // The same file judged by a copy pinned to a version: outdated, and a refresh rewrites it in that spelling.
    const pinned = { ...bare.options, prefix: 'npx -y terum-skills@9.9.9' };
    expect(await wrapperState(pinned)).toBe('outdated');
    expect(await installWrapper(pinned)).toBe('replaced');
    expect(await readFile(join(bare.destination, 'SKILL.md'), 'utf8')).toContain('npx -y terum-skills@9.9.9 <verb>');
    expect(await wrapperState(pinned)).toBe('current');
    expect(await wrapperState(options)).toBe('outdated');
  });

  it('a copy of the package built without the bundle is unavailable: it says so, asks nothing, writes nothing', async () => {
    const { root, options } = await fresh();
    const missing = { ...options, source: join(root, 'nowhere', 'SKILL.md') };
    expect(await wrapperState(missing)).toBe('unavailable');
    await expect(installWrapper(missing)).rejects.toThrow(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${missing.source}).`);
    expect(await inspectWrapper(options.skillsRoot)).toEqual({ kind: 'absent' });
    // A source without the marker is not a bundle either: setup could never recognise the copy it placed.
    const unmarked = join(root, 'unmarked.md'); await writeFile(unmarked, SOMEONE_ELSES);
    expect(await wrapperState({ ...options, source: unmarked })).toBe('unavailable');
  });
});
