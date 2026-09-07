import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { APPROVED_UPSTREAM, PACKAGE_NAME } from '../../lib/package.js';
import { createReleaseState } from '../../lib/update.js';
import { denyingRunner, fakeLaunch, ScriptedPrompter, stateFileAt, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { run } from '../update.js';

const at = '2026-09-06T21:10:00.000Z';
const now = () => Date.parse(at);
const advertisement = { version: '0.1.1', at, source: 'git-tags' };
async function setup() {
  const root = await temporaryDirectory(); const config = createConfigStore(root); const state = createReleaseState(root);
  const runner = denyingRunner([{ command: 'git', argsPrefix: ['-c', `url.${APPROVED_UPSTREAM}.insteadOf=${APPROVED_UPSTREAM}`, 'ls-remote', '--tags', '--', APPROVED_UPSTREAM], respond: () => ({ code: 0, stdout: `${'a'.repeat(40)}\trefs/tags/v0.1.1\n`, stderr: '' }) }]);
  return { config, state, runner, now, running: '0.1.0', probe: 'everyone' as const };
}

describe('print-only update', () => {
  it.each(['global', 'local', 'npx', 'source', 'unknown'] as const)('prints the exact %s template', async (kind) => {
    const args = await setup(); const launch = fakeLaunch(kind); const io = new ScriptedPrompter();
    expect((await run({ ...args, launch }, io)).ok).toBe(true);
    const expected = {
      global: ['terum-skills 0.1.0', 'This copy: /opt/homebrew/lib/node_modules/terum-skills', `Latest advertised release: 0.1.1 (observed ${at})`, 'If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'],
      local: ['terum-skills 0.1.0', 'This copy: /work/app/node_modules/terum-skills', 'Declared dependency of: /work/app', `Latest advertised release: 0.1.1 (observed ${at})`, 'If managed with npm, run in /work/app:', '  npm install terum-skills@latest'],
      npx: ['terum-skills 0.1.0', 'This copy: /cache/_npx/hash/node_modules/terum-skills', 'Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'],
      source: ['terum-skills 0.1.0', 'This copy: /work/terum-skills/dist/index.js', 'Running from a source checkout.', 'Update the checkout through its normal git workflow, then run:', '  npm run build', "The checkout's version does not establish npm publication."],
      unknown: ['terum-skills 0.1.0', 'This copy: /unknown/index.js', 'Installation method could not be established.', 'Update this copy with the tool that installed it.', "To run the registry's latest release:", '  npx -y terum-skills@latest <command>'],
    };
    expect(io.lines).toEqual(expected[kind]);
  });
  it('keeps the dev dependency flag', async () => {
    const args = await setup(); const io = new ScriptedPrompter();
    await run({ ...args, launch: { kind: 'local', path: '/work/app/node_modules/terum-skills/dist/index.js', root: '/work/app', dependencyKind: 'devDependencies' } }, io);
    expect(io.lines).toEqual(['terum-skills 0.1.0', 'This copy: /work/app/node_modules/terum-skills', 'Declared dependency of: /work/app', `Latest advertised release: 0.1.1 (observed ${at})`, 'If managed with npm, run in /work/app:', '  npm install --save-dev terum-skills@latest']);
  });
  it.each(['terum-skills@0.1.0', 'terum-skills', null])('preserves the npx request without calling it pinned: %s', async (request) => {
    const args = await setup(); const io = new ScriptedPrompter();
    await run({ ...args, launch: { kind: 'npx', path: '/cache/_npx/hash/node_modules/terum-skills/dist/index.js', cacheDir: '/cache/_npx/hash', request } }, io);
    expect(io.lines[2]).toBe(`Cache request recorded as: ${request ?? 'unknown'}`);
    expect(io.lines.join('\n')).not.toContain('pinned');
  });
  it('prints the exact matching advertisement template', async () => {
    const args = await setup(); const io = new ScriptedPrompter();
    await run({ ...args, launch: fakeLaunch('global'), running: '0.1.1' }, io);
    expect(io.lines).toEqual(['terum-skills 0.1.1', 'This copy: /opt/homebrew/lib/node_modules/terum-skills', `Latest advertised release: 0.1.1 (observed ${at})`, 'This copy matches the release advertisement. npm availability was not checked.']);
  });
  it('reports a failed probe, prior observation, and advice with exit 0', async () => {
    const args = await setup(); await stateFileAt(args.config.root, { schema: 1, package: PACKAGE_NAME, upstream: APPROVED_UPSTREAM, running: null, registry: null, advertisement, attempt: null, ack: null });
    args.runner = denyingRunner([{ command: 'git', argsPrefix: ['-c', `url.${APPROVED_UPSTREAM}.insteadOf=${APPROVED_UPSTREAM}`, 'ls-remote', '--tags', '--', APPROVED_UPSTREAM], respond: () => ({ code: 1, stdout: '', stderr: '\u001b[31moffline\u001b[0m\nsecret' }) }]);
    const io = new ScriptedPrompter(); expect((await run({ ...args, launch: fakeLaunch('global') }, io)).ok).toBe(true);
    expect(io.lines).toEqual(['terum-skills 0.1.0', 'This copy: /opt/homebrew/lib/node_modules/terum-skills', 'Could not check release advertisements: offline', `Last successful observation: 0.1.1 (observed ${at})`, 'npm availability was not checked.', 'If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.']);
  });
  it('uses nobody wording and version unknown without executing anything', async () => {
    const args = await setup(); const io = new ScriptedPrompter();
    expect((await run({ ...args, launch: fakeLaunch('global'), running: null, probe: 'nobody', runner: denyingRunner([]) }, io)).ok).toBe(true);
    expect(io.lines).toEqual(['terum-skills version unknown', 'This copy: /opt/homebrew/lib/node_modules/terum-skills', 'Release advertisements are not checked on this machine.', 'If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.']);
  });
  it('prints unknown and the stable-channel limitation when only prerelease tags exist', async () => {
    const args = await setup(); const io = new ScriptedPrompter();
    args.runner = denyingRunner([{ command: 'git', argsPrefix: ['-c', `url.${APPROVED_UPSTREAM}.insteadOf=${APPROVED_UPSTREAM}`, 'ls-remote', '--tags', '--', APPROVED_UPSTREAM], respond: () => ({ code: 0, stdout: `${'a'.repeat(40)}\trefs/tags/v0.2.0-rc.1\n`, stderr: '' }) }]);
    await run({ ...args, launch: fakeLaunch('global') }, io);
    expect(io.lines).toContain('Latest advertised release: unknown'); expect(io.lines).toContain('pre-release tags are not compared');
  });
  it('adds a newer registry observation with its source and timestamp', async () => {
    const args = await setup(); await stateFileAt(args.config.root, { schema: 1, package: PACKAGE_NAME, upstream: APPROVED_UPSTREAM, running: null, registry: { version: '0.2.0', at, source: 'npx-latest-cache', entry: '/cache' }, advertisement, attempt: null, ack: null });
    const io = new ScriptedPrompter(); await run({ ...args, launch: fakeLaunch('global') }, io);
    expect(io.lines).toContain(`Latest observed registry release: 0.2.0 (npx cache, ${at})`);
  });
});

it('labels a registry observation newer than the advertisement even when this running copy is newer still', async () => {
  const args = await setup(); await stateFileAt(args.config.root, { schema: 1, package: PACKAGE_NAME, upstream: APPROVED_UPSTREAM, running: null, registry: { version: '0.2.0', at, source: 'npx-latest-cache', entry: '/cache' }, advertisement, attempt: null, ack: null });
  const io = new ScriptedPrompter(); await run({ ...args, running: '0.3.0', launch: fakeLaunch('global') }, io);
  expect(io.lines).toContain(`Latest observed registry release: 0.2.0 (npx cache, ${at})`);
});
