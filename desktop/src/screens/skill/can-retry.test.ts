import { expect, it } from 'vitest';
import { canRetry } from './can-retry';

type Active = Parameters<typeof canRetry>[0];
const stopped = { state: 'stopped' } as NonNullable<Active>;
const failed = { state: 'done', result: { ok: false, value: undefined } } as unknown as NonNullable<Active>;
const succeeded = { state: 'done', result: { ok: true, value: {} } } as unknown as NonNullable<Active>;
const running = { state: 'running' } as NonNullable<Active>;
// `Result<T>` (backend/types.ts:2) permits `ok:false` WITH a value, and `failureWith` produces
// exactly that on the drain path (`src/commands/eval.ts:625`): runs happened, some failed, and the
// partial result survives. Reachable, not hypothetical.
const partial = { state: 'done', result: { ok: false, error: 'some queued evals failed', value: {} } } as unknown as NonNullable<Active>;

it('§11.4: a finished run whose folder is gone offers no retry — the gate covers both branches', () => {
  // The defect: `missing` was consulted only in the pre-run branch, so once a run existed the dialog
  // fell through to a live "Run eval again" for a skill the CLI can no longer evaluate — the exact
  // guaranteed failure the gate was written to stop, in the case its own comment anticipates
  // ("a run can outlive its folder — the copy is uninstalled while the eval streams").
  expect(canRetry(stopped, true)).toBe(false);
  expect(canRetry(failed, true)).toBe(false);
  // With the folder present, both retryable shapes still offer the retry.
  expect(canRetry(stopped, false)).toBe(true);
  expect(canRetry(failed, false)).toBe(true);
  // And the states that were never retryable stay that way.
  expect(canRetry(succeeded, false)).toBe(false);
  expect(canRetry(running, false)).toBe(false);
  expect(canRetry(null, false)).toBe(false);
});

it('a run that produced a value — it ran, and only part of it failed — offers no retry', () => {
  // The guard is `ok === false && value === undefined`, so this shape is already correct; nothing
  // asserted it, which is what makes the second disjunct a regression waiting to happen. Retrying
  // here would spend the user's own Claude account on work that already ran.
  expect(canRetry(partial, false)).toBe(false);
  expect(canRetry(partial, true)).toBe(false);
});
