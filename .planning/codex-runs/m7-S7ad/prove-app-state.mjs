// Run after fixture.sh <this directory>/fx and the root build, with HOME=<fx>/home.
// Uses the built commands' existing no-open knob; no native app, download or network is needed.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as app } from '../../../dist/commands/app.js';
import { run as setup } from '../../../dist/commands/setup.js';
import { createConfigStore } from '../../../dist/lib/config.js';
import { packageVersion } from '../../../dist/lib/package.js';

const record = fileURLToPath(new URL('.', import.meta.url));
assert.equal(homedir(), join(record, 'fx', 'home'));
const config = createConfigStore();
const version = packageVersion();
const entry = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
const installed = join(config.root, 'app', version);
await mkdir(join(installed, 'Terum Skills.app'), { recursive: true });
const marker = JSON.stringify({ schema: 1, version, platform: 'darwin-arm64', bundle: 'Terum Skills.app' });
await writeFile(join(installed, 'installed.json'), marker);
assert.equal(await readFile(join(installed, 'installed.json'), 'utf8'), marker);
const lines = [];
const unexpected = async () => { throw new Error('Unexpected prompt or external command'); };
const io = { interactive: true, confirm: unexpected, text: unexpected, select: unexpected, print: line => lines.push(line) };
const runner = { run: unexpected };
const args = { config, runner, exec: unexpected, open: false, entry, evidence: { platform: 'darwin', arch: 'arm64' } };
async function capture(name, target) {
  const text = await readFile(join(config.root, 'run', 'app.json'), 'utf8');
  const state = JSON.parse(text);
  assert.equal(state.path, process.env.PATH ?? null);
  assert.equal(state.node, process.execPath);
  assert.equal(state.entry, entry);
  assert.equal(typeof state.writtenAt, 'string');
  if (target === undefined) assert.equal(Object.hasOwn(state, 'target'), false);
  else assert.equal(state.target, target);
  await writeFile(join(record, name), text);
  assert.equal(await readFile(join(record, name), 'utf8'), text);
}
assert.equal((await app(args, io)).ok, true);
await capture('app.json');
const joined = await setup({ config, runner, app: true, evidence: args.evidence, target: 'acme/team', verbs: {
  app: (handoff, prompter) => app({ ...handoff, open: false, exec: unexpected, entry }, prompter),
} }, io);
assert.equal(joined.ok, true);
assert.equal(joined.value.steps.app, 'done');
assert.equal(lines.at(-1), 'Continuing in the app. Join acme/team there.');
await capture('setup-app.json', 'acme/team');
assert.equal((await app(args, io)).ok, true);
await capture('plain-after-setup-app.json');
console.log('3 app.json captures verified: launch PATH, setup target hand-off, later target clearing.');
