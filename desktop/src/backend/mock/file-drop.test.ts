import { afterEach, expect, it, vi } from 'vitest';
import { createMockBackend, dropPathsFrom } from './index';
import type { FileDropEvent } from '../types';

afterEach(() => vi.restoreAllMocks());

it('reads one path per non-empty text line and nothing from a protected store', () => {
  expect(dropPathsFrom({ getData: () => '~/a\r\n\n  ~/b  \n' })).toEqual(['~/a', '~/b']);
  expect(dropPathsFrom({ getData: () => '' })).toEqual([]);
  expect(dropPathsFrom({ getData: () => { throw new Error('protected'); } })).toEqual([]);
  expect(dropPathsFrom(null)).toEqual([]);
});

function drag(type: string, extra: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
  window.dispatchEvent(event);
  return event;
}

it('folds HTML5 drag events into enter, leave and drop, and cancels dragover so the drop lands', () => {
  const backend = createMockBackend(), seen: FileDropEvent[] = [];
  const stop = backend.onFileDrop(event => seen.push(event));
  drag('dragenter'); drag('dragenter');
  expect(seen).toEqual([{ kind: 'enter', paths: [] }]);
  expect(drag('dragover').defaultPrevented).toBe(true);
  drag('dragleave', { relatedTarget: document.body });
  expect(seen).toHaveLength(1);
  drag('dragleave', { relatedTarget: null });
  expect(seen.at(-1)).toEqual({ kind: 'leave' });
  drag('dragenter');
  const drop = drag('drop', { dataTransfer: { getData: () => '~/Projects/x' } });
  expect(drop.defaultPrevented).toBe(true);
  expect(seen.at(-1)).toEqual({ kind: 'drop', paths: ['~/Projects/x'] });
  stop();
  drag('dragenter');
  expect(seen).toHaveLength(4);
});
