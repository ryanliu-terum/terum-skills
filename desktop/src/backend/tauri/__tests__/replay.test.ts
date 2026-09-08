import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTauriBackend, read } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

const directory = resolve('../.planning/codex-runs/m7-S7af/frames');
function recorded(name: string) {
  return readFileSync(resolve(directory, name + '.jsonl'), 'utf8').trim().split('\n');
}
function replay(lines: string[]) {
  return fakeBridge((_args, emit) => {
    for (const line of lines) emit({ kind: 'stdout', line });
  });
}
const status = z.object({ version: z.string(), teams: z.array(z.object({ team: z.string() }).passthrough()) }).passthrough();

it('replays recorded status through the read driver while the served status remains a typed gap', async () => {
  const f = replay(recorded('status'));
  const result = await read(cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map: value => status.parse(value) }));
  expect(result.ok).toBe(true);
  expect(result.value?.teams.map(team => team.team)).toEqual(['acme']);
  expect(await createTauriBackend(f.bridge).status()).toEqual({ ok: false, error: 'Team status in the design’s shape (machine, me, teams, counts) is not available from terum-skills yet: the CLI has no verb that returns it (desktop/GAPS.md). The terminal has everything the app shows here.' });
  expect(f.spawns).toHaveLength(1);
});

it('retains the recorded status payload when its result frame fails', async () => {
  // The recording is healthy. Change only its result envelope to exercise failure-with-value.
  const lines = recorded('status').map(line => {
    const frame = z.object({ t: z.string() }).passthrough().parse(JSON.parse(line));
    return frame.t === 'result' ? JSON.stringify({ ...frame, ok: false, exitCode: 1, error: 'Unreadable team clone.' }) : line;
  });
  const f = replay(lines);
  const result = await read(cliRun(f.bridge, Promise.resolve(STATE), ['status'], { map: value => status.parse(value) }));
  expect(result.ok).toBe(false);
  expect(result.value?.teams).toHaveLength(1);
  expect(result.value?.teams[0]?.team).toBe('acme');
  if (result.ok) throw new Error('Expected failed status');
  expect(result.error).toMatch(/^Unreadable team clone\.\nterum-skills/);
});

it('serves all three recorded search hits with real metadata and no fabricated descriptions', async () => {
  const lines = recorded('search');
  const resultFrame = lines.map(line => z.object({ t: z.string(), value: z.unknown().optional() }).parse(JSON.parse(line))).find(frame => frame.t === 'result');
  const hits = z.array(z.object({ team: z.string(), name: z.string(), author: z.string(), category: z.string(), installs: z.number(), latest: z.string(), endorsed: z.string(), unresolved: z.boolean() })).parse(resultFrame?.value);
  expect(hits).toHaveLength(3);
  expect(hits.map(hit => hit.team)).toEqual(['acme', 'acme', 'acme']);
  const result = await createTauriBackend(replay(lines).bridge).search({ q: '' });
  expect(result).toEqual({ ok: true, value: hits.map(hit => ({ ...hit, kind: 'skill', ref: `${hit.team}/${hit.name}`, description: '' })) });
});
