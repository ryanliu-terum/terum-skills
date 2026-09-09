import { beforeEach } from 'vitest';
import { resetMockRemovals } from './mock';

// Restore the mock fixture between tests, while preserving removal across reads within a run.
beforeEach(resetMockRemovals);
