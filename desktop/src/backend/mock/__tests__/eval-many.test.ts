import { afterEach, expect, it } from 'vitest';
import { createMockBackend } from '../index';
import { driveRun } from '../../drive';
import type { EvalManyResult, PromptQuestion, Result } from '../../types';

async function drive(backend: ReturnType<typeof createMockBackend>, args: Parameters<typeof backend.evalMany>[0], answer = true) {
  const lines: string[] = [], asks: PromptQuestion[] = [], progress: { done: number; total: number }[] = [];
  const result: Result<EvalManyResult> = await driveRun(backend.evalMany(args), {}, async question => { asks.push(question); return answer; }, line => lines.push(line), frame => progress.push({ done: frame.done, total: frame.total }));
  return { result, lines, asks, progress };
}
afterEach(() => { location.hash = ''; });

it('runs every skill now, four at a time, and reports the counts', async () => {
  const d = await drive(createMockBackend(), { refs: ['deploy-check', 'migration-guard', 'deploy-check'], mode: 'now' });
  expect(d.result).toEqual({ ok: true, value: { mode: 'ran', team: expect.any(String), skills: ['deploy-check', 'migration-guard'], ok: 2, failed: 0, queued: [] } });
  expect(d.lines).toEqual(['Evaluating 2 skills, 2 at a time…', 'Evaluating deploy-check…', 'Evaluating migration-guard…', 'Evaluated 2 of 2; 0 failed.']);
  expect(d.progress).toEqual([{ done: 1, total: 2 }, { done: 2, total: 2 }]); expect(d.asks).toEqual([]);
});

it('asks before each further batch and queues the rest for later when declined', async () => {
  const d = await drive(createMockBackend(), { refs: ['deploy-check', 'migration-guard', 'onboarding-tour'], mode: 'batches', batch: 1 }, false);
  expect(d.asks).toEqual([{ kind: 'confirm', question: 'Continue with the next 1? (1 of 3 done, 2 left)' }]);
  expect(d.result).toMatchObject({ ok: true, value: { mode: 'ran', ok: 1, failed: 0, stoppedAfter: 1, queued: [expect.objectContaining({ skill: 'migration-guard', window: 'later' }), expect.objectContaining({ skill: 'onboarding-tour', window: 'later' })] } });
  expect(d.lines.at(-2)).toBe('Queued 2 evals for later. Run them with `npx -y terum-skills@latest eval --drain`.');
  const accepted = await drive(createMockBackend(), { refs: ['deploy-check', 'migration-guard', 'onboarding-tour'], mode: 'batches', batch: 2 });
  expect(accepted.asks.map(ask => ask.question)).toEqual(['Continue with the next 1? (2 of 3 done, 1 left)']);
  expect(accepted.result).toMatchObject({ ok: true, value: { ok: 3, queued: [] } });
});

it('queues for overnight without evaluating anything', async () => {
  const d = await drive(createMockBackend(), { refs: ['deploy-check', 'migration-guard'], mode: 'overnight' });
  expect(d.result).toMatchObject({ ok: true, value: { mode: 'queued', ok: 0, queued: [expect.objectContaining({ skill: 'deploy-check', window: 'overnight' }), expect.objectContaining({ skill: 'migration-guard', window: 'overnight' })] } });
  expect(d.lines).toEqual(['Queued 2 evals for overnight: the app runs them in parallel between 01:00 and 05:00 while it is open and idle. Run them now with `npx -y terum-skills@latest eval --drain`.']);
  expect(d.progress).toEqual([]);
});

it('adds every shared skill without a receipt under --pending, and needs a team for it', async () => {
  const d = await drive(createMockBackend(), { refs: [], mode: 'now', pending: true });
  expect(d.result.ok).toBe(true); if (!d.result.ok) throw new Error(d.result.error);
  expect(d.result.value.skills.length).toBeGreaterThan(0); expect(d.result.value.ok).toBe(d.result.value.skills.length);
  location.hash = '#/settings/evals?__mock=no-team';
  expect((await drive(createMockBackend(), { refs: [], mode: 'now', pending: true })).result).toEqual({ ok: false, error: '--pending needs a team; this machine has none.' });
});

it('refuses an unknown skill before any paid work, and the two malformed requests before a run exists', async () => {
  const backend = createMockBackend();
  expect((await drive(backend, { refs: ['deploy-check', 'nowhere'], mode: 'now' })).result).toEqual({ ok: false, error: 'No local skill folder named `nowhere` in your library; install it from the marketplace first.' });
  expect(() => backend.evalMany({ refs: [], mode: 'now' })).toThrow('Provide at least one skill, or --pending.');
  expect(() => backend.evalMany({ refs: ['deploy-check'], mode: 'batches', batch: 0 })).toThrow('--batch must be a positive integer.');
});
