import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSkillRoots, PROGRESS_INTERVAL_MS, type DiscoverOptions } from '../discover.js';
import { temporaryDirectory } from './fixtures.js';

async function skillAt(root: string, name = 'sample') {
  const dir = join(root, '.claude', 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
}
async function fixture() {
  const home = await temporaryDirectory();
  const options: DiscoverOptions = { under: [home], home, checkouts: [], stateRoot: join(home, '.terum', 'skills'), config: { placements: {} } };
  return { home, options, scan: (extra: Partial<DiscoverOptions> = {}) => discoverSkillRoots({ ...options, ...extra }) };
}
const cannotChmod = process.platform === 'win32' || process.getuid?.() === 0;
describe('discovery traversal', () => {
  it('finds a folder that holds .claude/skills and counts its skill folders', async () => {
    const { home, scan } = await fixture(); const a = join(home, 'projects', 'alpha'), b = join(home, 'projects', 'beta');
    await skillAt(a, 'one'); await skillAt(a, 'two'); await skillAt(b);
    const result = await scan();
    expect(result.candidates).toEqual([{ path: a, skillFolders: 2, registered: false, repoRoot: false }, { path: b, skillFolders: 1, registered: false, repoRoot: false }]);
    expect(result).toMatchObject({ truncated: false, problems: [] }); expect(result.scanned).toBeGreaterThanOrEqual(3);
  });
  it('never offers the home folder itself, even when it holds .claude/skills', async () => {
    const { home, scan } = await fixture(); const child = join(home, 'child'); await skillAt(home); await skillAt(child);
    expect((await scan()).candidates.map(c => c.path)).toEqual([child]);
  });
  it('stops at maxDepth and reports nothing deeper', async () => {
    const { home, scan } = await fixture(); const root = join(home, 'a', 'b', 'c', 'd', 'e'); await skillAt(root);
    expect((await scan({ maxDepth: 4 })).candidates).toEqual([]); expect((await scan({ maxDepth: 5 })).candidates.map(c => c.path)).toEqual([root]);
  });
  it('skips node_modules, dist, AppData and every dot-directory except .claude', async () => {
    const { home, scan } = await fixture();
    for (const path of ['node_modules/x', 'NODE_MODULES/y', 'dist/z', 'AppData/w', '.hidden/v', 'keep/ok']) await skillAt(join(home, path));
    expect((await scan()).candidates.map(c => c.path)).toEqual([join(home, 'keep', 'ok')]);
  });
  it.skipIf(process.platform === 'win32')('does not follow a symlinked directory, so a symlink loop terminates', async () => {
    const { home, scan } = await fixture(); const a = join(home, 'real', 'alpha'); await skillAt(a);
    await symlink(home, join(home, 'real', 'loop')); await symlink(a, join(home, 'link'));
    const result = await scan(); expect(result.truncated).toBe(false); expect(result.candidates.map(c => c.path)).toEqual([a]);
  });
  it.skipIf(cannotChmod)('records an unreadable folder in problems and keeps scanning', async () => {
    const { home, scan } = await fixture(); const locked = join(home, 'locked'), a = join(home, 'open', 'alpha');
    await mkdir(locked); await skillAt(a); await chmod(locked, 0);
    try { const result = await scan(); expect(result.candidates.map(c => c.path)).toEqual([a]); expect(result.problems).toEqual([{ path: locked, reason: expect.stringContaining('EACCES') }]); }
    finally { await chmod(locked, 0o700); }
  });
  it('marks a candidate already in config.checkouts as registered', async () => {
    const { home, scan } = await fixture(); const a = join(home, 'a'), b = join(home, 'b'); await skillAt(a); await skillAt(b);
    expect((await scan({ checkouts: [a] })).candidates.map(c => c.registered)).toEqual([true, false]);
  });
  it('reports repoRoot for a .git directory and for a .git file', async () => {
    const { home, scan } = await fixture(); for (const n of ['alpha', 'beta', 'gamma']) await skillAt(join(home, n));
    await mkdir(join(home, 'alpha', '.git')); await writeFile(join(home, 'beta', '.git'), 'gitdir: elsewhere');
    expect((await scan()).candidates.map(c => c.repoRoot)).toEqual([true, true, false]);
  });
  it('a zero budget returns truncated with nothing scanned', async () => {
    const { scan } = await fixture(); expect(await scan({ budgetMs: 0 })).toEqual({ candidates: [], scanned: 0, truncated: true, problems: [] });
  });
  it('never descends into the state root', async () => {
    const { options, scan } = await fixture(); await skillAt(join(options.stateRoot, 'teams', 't', 'checkout'));
    const result = await scan(); expect(result.candidates).toEqual([]); expect(result.problems).toEqual([]);
    // An explicit root that is refused says so; a child under one is dropped silently (the line above).
    expect(await scan({ under: [options.stateRoot] })).toEqual({
      candidates: [], scanned: 0, truncated: false,
      problems: [{ path: options.stateRoot, reason: 'inside the terum state directory; not searched' }],
    });
  });
  it('an aborted signal stops the walk and reports truncated', async () => {
    const { scan } = await fixture(); const controller = new AbortController(); controller.abort();
    await expect(scan({ signal: controller.signal })).resolves.toEqual({ candidates: [], scanned: 0, truncated: true, problems: [] });
  });
  it('records a missing root as a problem instead of throwing', async () => {
    const { home, scan } = await fixture(); const root = join(home, 'no-such-folder');
    expect(await scan({ under: [root] })).toMatchObject({ candidates: [], problems: [{ path: root, reason: expect.stringContaining('ENOENT') }] });
  });
  it('reports progress at most once per interval and always once at the end', async () => {
    const { home, scan } = await fixture(); for (let i = 0; i < 80; i++) await mkdir(join(home, String(i)));
    let clock = 0; const reports: { at: number; scanned: number; current: string }[] = [];
    const result = await scan({ now: () => (clock += 10), onProgress: p => reports.push({ at: clock, ...p }) });
    const periodic = reports.filter(p => p.current !== ''); expect(periodic.length).toBeGreaterThan(1);
    for (let i = 1; i < periodic.length; i++) expect(periodic[i]!.at - periodic[i - 1]!.at).toBeGreaterThanOrEqual(PROGRESS_INTERVAL_MS);
    expect(reports.at(-1)).toMatchObject({ current: '', scanned: result.scanned });
    expect(reports.filter(p => p.current === '')).toHaveLength(1);
  });
  // Candidate ordering needs no chmod, so it is proved on every platform and as root; only the problems
  // half of spec A14 depends on making a folder unreadable.
  it('returns candidates sorted by path', async () => {
    const { home, scan } = await fixture(); for (const n of ['z', 'a', 'm']) await skillAt(join(home, n));
    expect((await scan()).candidates.map(c => c.path)).toEqual(['a', 'm', 'z'].map(n => join(home, n)));
  });
  it.skipIf(cannotChmod)('returns problems sorted by path', async () => {
    const { home, scan } = await fixture(); for (const n of ['z', 'a', 'm']) await skillAt(join(home, n));
    const locked = [join(home, 'locked-z'), join(home, 'locked-a')]; for (const dir of locked) { await mkdir(dir); await chmod(dir, 0); }
    try { const result = await scan(); expect(result.candidates.map(c => c.path)).toEqual(['a', 'm', 'z'].map(n => join(home, n))); expect(result.problems.map(p => p.path)).toEqual([...locked].sort()); }
    finally { for (const dir of locked) await chmod(dir, 0o700); }
  });
  it('does not treat a sibling of the state root as inside it', async () => {
    const { home, scan } = await fixture(); const candidate = join(home, 'stateX', 'alpha'); await skillAt(candidate); await skillAt(join(home, 'state', 'hidden'));
    expect((await scan({ stateRoot: join(home, 'state') })).candidates.map(c => c.path)).toEqual([candidate]);
  });
  it('a .claude with no skills folder is neither a candidate nor a problem', async () => {
    const { home, scan } = await fixture();
    const claude = join(home, 'a', '.claude'); await mkdir(claude, { recursive: true }); await writeFile(join(claude, 'settings.local.json'), '{}');
    // ENOTDIR too: a `skills` file where the folder would be is still the ordinary shape, not a problem.
    const other = join(home, 'b', '.claude'); await mkdir(other, { recursive: true }); await writeFile(join(other, 'skills'), 'not a directory');
    expect(await scan()).toMatchObject({ candidates: [], problems: [] });
  });
  it('a .claude/skills that holds only files is not a candidate', async () => {
    const { home, scan } = await fixture(); const root = join(home, 'a', '.claude', 'skills'); await mkdir(root, { recursive: true }); await writeFile(join(root, 'README.md'), 'hello');
    expect(await scan()).toMatchObject({ candidates: [], problems: [] });
  });
  it('a folder inside a candidate can itself be a candidate', async () => {
    const { home, scan } = await fixture(); const parent = join(home, 'mono'), child = join(parent, 'packages', 'web'); await skillAt(parent); await skillAt(child);
    expect((await scan()).candidates.map(c => c.path)).toEqual([parent, child]);
  });
  it('a .claude/skills whose only entry has no SKILL.md is not a candidate', async () => {
    const { home, scan } = await fixture(); await mkdir(join(home, 'a', '.claude', 'skills', 'empty'), { recursive: true });
    expect(await scan()).toMatchObject({ candidates: [], problems: [] });
  });
  it('deduplicates overlapping roots and retains partial results when aborted during progress', async () => {
    const { home, scan } = await fixture(); const a = join(home, 'a'); await skillAt(a); await mkdir(join(home, 'later')); const controller = new AbortController(); let clock = 0;
    const result = await scan({ under: [home, home, a], signal: controller.signal, now: () => (clock += 250), onProgress: p => { if (p.current) controller.abort(); } });
    expect(result.truncated).toBe(true); expect(new Set(result.candidates.map(c => c.path)).size).toBe(result.candidates.length);
  });
});
