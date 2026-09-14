import { describe, expect, it } from 'vitest';
import { FRAME_FEATURES, FRAME_PROTOCOL, FRAME_VERBS } from '../frames.js';
import { SERVE_READ_VERBS } from '../serve-verbs.js';

describe('M2 reconcile frame surface', () => {
  it('advertises the verb and feature without changing the protocol or making the write-capable verb serve-readable', () => {
    expect(FRAME_PROTOCOL).toBe(1);
    expect(FRAME_VERBS).toContain('reconcile');
    expect(FRAME_FEATURES.reconcile).toBe(true);
    expect(SERVE_READ_VERBS).not.toContain('reconcile');
  });
});
