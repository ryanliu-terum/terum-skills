import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { temporaryDirectory } from './fixtures.js';
import { describe, expect, it } from 'vitest';
import { describeLaunch, Launch, packageRemovalLines } from '../launch.js';

describe('launch classification', () => {
  it.each([
    ['/opt/homebrew/lib/node_modules/terum-skills/dist/index.js', null, { kind: 'global' }],
    ['/work/app/node_modules/terum-skills/dist/index.js', { dependencies: { 'terum-skills': '*' } }, { kind: 'local', root: '/work/app', dependencyKind: 'dependencies' }],
    ['/work/app/node_modules/terum-skills/dist/index.js', { devDependencies: { 'terum-skills': '*' } }, { kind: 'local', root: '/work/app', dependencyKind: 'devDependencies' }],
    ['/work/app/node_modules/terum-skills/dist/index.js', {}, { kind: 'global' }],
    ['/ws/node_modules/other/packages/a/dist/index.js', {}, { kind: 'unknown' }],
    ['/ws/packages/a/node_modules/other/dist/index.js', {}, { kind: 'unknown' }],
    ['/repo/dist/index.js', { name: 'terum-skills' }, { kind: 'source', root: '/repo' }],
    ['/repo/dist/index.js', {}, { kind: 'unknown' }],
    ['/repo/src/index.ts', { name: 'terum-skills' }, { kind: 'unknown' }],
    ['', null, { kind: 'unknown' }],
  ])('classifies canonical entry %s from manifest evidence', async (entry, manifest, expected) => {
    expect(await describeLaunch({ entry, realpath: async (p) => p, readJson: async () => manifest })).toEqual({ ...expected, path: entry });
  });

  it.each(['terum-skills@latest', 'terum-skills@0.1.0', 'terum-skills', null])('npx evidence wins and preserves request %s', async (request) => {
    const entry = '/Users/me/.npm/_npx/hash/node_modules/terum-skills/dist/index.js';
    const seen: string[] = [];
    expect(await describeLaunch({ entry, realpath: async (p) => p, readJson: async (p) => { seen.push(p); return request ? { _npx: { packages: [request] }, dependencies: { 'terum-skills': '*' } } : null; } })).toEqual({ kind: 'npx', path: entry, cacheDir: '/Users/me/.npm/_npx/hash', request });
    expect(seen).toEqual(['/Users/me/.npm/_npx/hash/package.json']);
  });

  it('realpaths a symlinked .bin entry before inspecting its manifest', async () => {
    const root = await temporaryDirectory();
    const entry = join(root, 'node_modules/terum-skills/dist/index.js');
    await mkdir(join(entry, '..'), { recursive: true }); await writeFile(entry, '');
    await mkdir(join(root, 'node_modules/.bin')); await symlink(entry, join(root, 'node_modules/.bin/terum-skills'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { 'terum-skills': '*' } }));
    expect(await describeLaunch({ entry: join(root, 'node_modules/.bin/terum-skills'), realpath, readJson: async (p) => JSON.parse(await readFile(p, 'utf8')) })).toEqual({ kind: 'local', path: await realpath(entry), root: await realpath(root), dependencyKind: 'devDependencies' });
  });

  it('supports Windows separators', async () => {
    const entry = 'C:/Users/x/AppData/Roaming/npm/node_modules/terum-skills/dist/index.js'.replaceAll('/', String.fromCharCode(92));
    expect(await describeLaunch({ entry, sep: String.fromCharCode(92), realpath: async (p) => p, readJson: async () => null })).toEqual({ kind: 'global', path: entry });
  });

  it('contains failed realpath and manifest evidence without rejecting', async () => {
    const entry = '/repo/dist/index.js';
    expect(await describeLaunch({ entry, realpath: async (p) => p, readJson: async () => { throw new Error('unreadable'); } })).toEqual({ kind: 'unknown', path: entry });
    expect(await describeLaunch({ entry, realpath: async () => { throw new Error('missing'); }, readJson: async () => null })).toEqual({ kind: 'unknown', path: entry });
  });

  it('prints exact conditional package advice and the executing path for every kind', () => {
    const cases: Array<[Launch | undefined, string]> = [
      [{ kind: 'global', path: '/global/index.js' }, 'If you installed it with npm: npm uninstall -g terum-skills   (pnpm: pnpm remove -g terum-skills · yarn: yarn global remove terum-skills · bun: bun remove -g terum-skills · Volta: volta uninstall terum-skills)'],
      [{ kind: 'local', path: '/app/node_modules/terum-skills/dist/index.js', root: '/app', dependencyKind: 'dependencies' }, 'It is a dependency of /app: run npm uninstall terum-skills there, or remove it from that package.json.'],
      [{ kind: 'npx', path: '/cache/_npx/x/index.js', cacheDir: '/cache/_npx/x', request: null }, 'It is an npx cache copy, so there is nothing to uninstall for it. If you also installed the package globally or in a project, remove that with the tool you used, e.g. npm uninstall -g terum-skills.'],
      [{ kind: 'unknown', path: '/src/index.ts' }, 'Remove it with whatever put it there.'],
      [{ kind: 'unknown', path: '' }, 'Remove it with whatever put it there.'],
      [{ kind: 'source', path: '/repo/dist/index.js', root: '/repo' }, 'Remove it with whatever put it there.'],
      [undefined, 'Remove it with whatever put it there.'],
    ];
    for (const [launch, advice] of cases) expect(packageRemovalLines(launch)).toEqual([
      `This copy of terum-skills runs from ${launch?.path || 'an unknown location'}.`, advice,
    ]);
  });
});

it('preserves the one npx request naming this package even in a mixed cache entry', async () => {
  const entry = '/cache/_npx/hash/node_modules/terum-skills/dist/index.js';
  expect(await describeLaunch({ entry, realpath: async (p) => p, readJson: async () => ({ _npx: { packages: ['other-package', 'terum-skills@latest'] } }) })).toEqual({ kind: 'npx', path: entry, cacheDir: '/cache/_npx/hash', request: 'terum-skills@latest' });
});
