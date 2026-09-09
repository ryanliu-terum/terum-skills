import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTauriBackend, read } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

const directory = resolve('../.planning/codex-runs/m7-S7c');
function replay(name: string) {
  const lines = readFileSync(resolve(directory, 'frames', name + '.jsonl'), 'utf8').trim().split('\n');
  return fakeBridge((_args, emit) => { for (const line of lines) emit({ kind: 'stdout', line }); });
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

it.each(['status-before', 'status-after'])('replays %s while the S7k read surfaces remain gaps', async name => {
  const f = replay(name);
  const schema = z.object({ version: z.string(), teams: z.array(z.object({ team: z.string() })) });
  const result = await read(cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map: value => schema.parse(value) }));
  expect(result).toEqual({ ok: true, value: { version: '0.1.6', teams: [{ team: 'acme' }] } });
  const surfaces = await createTauriBackend(f.bridge).surfaces();
  expect(surfaces.status).toBe(false); expect(surfaces.settings).toBe(false);
});
