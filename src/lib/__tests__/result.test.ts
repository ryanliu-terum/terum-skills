import { expect, it } from 'vitest';
import { cancelled, CancelledError, failure, fromError } from '../result.js';

it('marks cancellation without changing the message', () => {
  expect(cancelled('Leave was cancelled.')).toEqual({ ok: false, error: 'Leave was cancelled.', cancelled: true });
});
it('never marks ordinary failures, including decline-like messages', () => {
  expect(failure('declined')).toEqual({ ok: false, error: 'declined' });
  expect(failure('cancelled', 4)).toEqual({ ok: false, error: 'cancelled', value: 4 });
});
it('round-trips typed errors and preserves ordinary errors and thrown values', () => {
  expect(fromError(new CancelledError('Publish was cancelled.'))).toEqual(cancelled('Publish was cancelled.'));
  expect(fromError(new Error('declined'))).toEqual(failure('declined'));
  expect(fromError('oops')).toEqual(failure('oops'));
  expect(fromError({ cancelled: true })).toEqual(failure('[object Object]'));
});
