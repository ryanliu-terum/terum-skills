import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createTauriBackend, read } from '../index';
import { cliRun } from '../run';
import { fakeBridge, STATE } from './fake-bridge';

const directory = resolve('../.planning/codex-runs/m7-S7e/frames');
function recording(verb: string) {
  const lines = readFileSync(resolve(directory, verb + '.jsonl'), 'utf8').trim().split('\n');
  const bridge = fakeBridge((_args, emit) => { for (const line of lines) emit({ kind: 'stdout', line }); });
  return { lines, bridge };
}
it('replays the rebuilt offline update report with exact printed lines and nonempty advice', async () => {
  const { lines, bridge } = recording('update');
  const frames = lines.map(line => z.object({ t: z.string(), line: z.string().optional(), value: z.unknown().optional() }).parse(JSON.parse(line)));
  const report = frames.find(frame => frame.t === 'result')?.value;
  const result = await createTauriBackend(bridge.bridge).update();
  expect(result).toEqual({ ok: true, value: report });
  if (!result.ok) throw new Error(result.error);
  expect(result.value.advice.length).toBeGreaterThan(0);
  expect(result.value.lines).toEqual(frames.filter(frame => frame.t === 'print').map(frame => frame.line));
  expect(result.value.latest).toBeNull();
  expect(result.value.observation).toBe('unknown');
  expect(bridge.spawns[0]?.args).toEqual(['update']);
});
it('replays status from the same rebuilt offline fixture; the status surface is served (S7k) and update beside it', async () => {
  const { bridge } = recording('status');
  const schema = z.object({ version: z.string(), teams: z.array(z.object({ team: z.string() }).passthrough()) }).passthrough();
  const result = await read(cliRun(bridge.bridge, Promise.resolve(STATE), ['status'], { map: value => schema.parse(value) }));
  expect(result.ok).toBe(true);
  expect(result.value?.teams.map(team => team.team)).toEqual(['acme']);
  expect(await createTauriBackend(bridge.bridge).surfaces()).toMatchObject({ status: true, settings: true, update: true });
});
