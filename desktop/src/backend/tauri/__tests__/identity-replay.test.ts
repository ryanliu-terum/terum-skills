import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

const directory = resolve('../.planning/codex-runs/m7-S7c');
function recorded(name: string) {
  return readFileSync(resolve(directory, 'frames', name + '.jsonl'), 'utf8').trim().split('\n');
}
// status() reads `status` and `ls --local` together (S7k); the local inventory is this batch's own recording.
function replay(name: string) {
  return fakeBridge((args, emit) => { for (const line of recorded(args[0] === 'ls' ? 'ls-local' : name)) emit({ kind: 'stdout', line }); });
}

it('replays the real login write and proves that only display_name bytes changed', async () => {
  const before = readFileSync(resolve(directory, 'config-before.json'), 'utf8');
  const after = readFileSync(resolve(directory, 'config-after.json'), 'utf8');
  expect(after).toBe(before.replace('"display_name":"Seed"', '"display_name":"Seed2"'));
  const f = replay('login-set-name');
  expect(await createTauriBackend(f.bridge).setIdentity({ name: 'Seed2' }).done).toEqual({
    ok: true,
    value: {
      updated: [{ key: 'name', value: 'Seed2' }],
      notice: 'This changes the author line (Seed2 <seed@example.com>) that the next sync writes into the skills you have connected on this machine; skills you authored elsewhere keep their recorded author.',
    },
  });
  expect(f.spawns.map(spawn => spawn.args)).toEqual([['login', '--set', 'name=Seed2']]);
});

it.each([['status-before', 'Seed'], ['status-after', 'Seed2']])('replays %s through the served status (S7k) and shows the identity the CLI recorded', async (name, displayName) => {
  const f = replay(name);
  const served = await createTauriBackend(f.bridge).status();
  expect(served.ok).toBe(true);
  expect(served.value?.me).toMatchObject({ name: displayName, email: 'seed@example.com', handle: 'seed' });
  expect(served.value?.teams.map(team => team.key)).toEqual(['acme']);
  expect((await createTauriBackend(f.bridge).surfaces())).toMatchObject({ status: true, settings: true });
});
