import { describe, expect, it } from 'vitest';
import { onShutdown, runShutdownHooks } from '../shutdown.js';

describe('shutdown hooks', () => {
  it('runs hooks in registration order and only once', () => {
    const seen: string[] = [];
    onShutdown(() => { seen.push('a'); });
    onShutdown(() => { seen.push('b'); });
    onShutdown(() => { seen.push('c'); });
    runShutdownHooks(); expect(seen).toEqual(['a', 'b', 'c']);
    runShutdownHooks(); expect(seen).toEqual(['a', 'b', 'c']);
  });
  it('keeps running the remaining hooks when one throws', () => {
    const seen: string[] = [];
    onShutdown(() => { seen.push('a'); });
    onShutdown(() => { throw new Error('hook failed'); });
    onShutdown(() => { seen.push('c'); });
    expect(runShutdownHooks).not.toThrow();
    expect(seen).toEqual(['a', 'c']);
  });
  it('is a no-op with no hooks registered', () => {
    runShutdownHooks();
    expect(runShutdownHooks).not.toThrow();
  });
});
