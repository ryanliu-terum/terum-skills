import { describe, expect, it } from 'vitest';
import { describeLaunch, Launch, packageRemovalLines } from '../launch.js';

describe('launch classification', () => {
  it.each([
    { argv1: '/Users/me/.npm/_npx/57bf464bcb1eb840/node_modules/terum-skills/dist/index.js', cwd: '/tmp', kind: 'npx' },
    { argv1: '/repo/src/index.ts', cwd: '/repo', env: { npm_lifecycle_event: 'npx' }, kind: 'npx' },
    { argv1: '/opt/homebrew/lib/node_modules/terum-skills/dist/index.js', cwd: '/tmp', kind: 'global' },
    { argv1: 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\terum-skills\\dist\\index.js', cwd: 'C:\\work', sep: '\\', kind: 'global' },
    { argv1: '/work/app/node_modules/terum-skills/dist/index.js', cwd: '/work/app/src', kind: 'local', projectDir: '/work/app' },
    { argv1: '/work/app/node_modules/terum-skills/dist/index.js', cwd: '/work/app/', kind: 'local', projectDir: '/work/app' },
    { argv1: '/work/app/node_modules/terum-skills/dist/index.js', cwd: '/tmp', kind: 'unknown' },
    { argv1: '/repo/src/index.ts', cwd: '/repo', kind: 'unknown' },
    { argv1: undefined, cwd: '/repo', kind: 'unknown' },
    { argv1: '', cwd: '/repo', env: { npm_lifecycle_event: 'npx' }, kind: 'unknown' },
  ])('classifies $argv1 from $cwd as $kind', ({ argv1, cwd, env, sep, kind, projectDir }) => {
    expect(describeLaunch({ argv1, cwd, env: env ?? {}, sep })).toEqual({ kind, path: argv1 ?? '', ...(projectDir ? { projectDir } : {}) });
  });

  it('prints exact conditional package advice and the executing path for every kind', () => {
    const cases: Array<[Launch | undefined, string]> = [
      [{ kind: 'global', path: '/global/index.js' }, 'If you installed it with npm: npm uninstall -g terum-skills   (pnpm: pnpm remove -g terum-skills · yarn: yarn global remove terum-skills · bun: bun remove -g terum-skills · Volta: volta uninstall terum-skills)'],
      [{ kind: 'local', path: '/app/node_modules/terum-skills/dist/index.js', projectDir: '/app' }, 'It is a dependency of /app: run npm uninstall terum-skills there, or remove it from that package.json.'],
      [{ kind: 'npx', path: '/cache/_npx/x/index.js' }, 'It is an npx cache copy, so there is nothing to uninstall for it. If you also installed the package globally or in a project, remove that with the tool you used, e.g. npm uninstall -g terum-skills.'],
      [{ kind: 'unknown', path: '/src/index.ts' }, 'Remove it with whatever put it there.'],
      [{ kind: 'unknown', path: '' }, 'Remove it with whatever put it there.'],
      [undefined, 'Remove it with whatever put it there.'],
    ];
    for (const [launch, advice] of cases) expect(packageRemovalLines(launch)).toEqual([
      `This copy of terum-skills runs from ${launch?.path || 'an unknown location'}.`, advice,
    ]);
  });
});
