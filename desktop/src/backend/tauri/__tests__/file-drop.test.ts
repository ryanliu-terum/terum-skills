import { afterEach, expect, it, vi } from 'vitest';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';
import type { FileDropEvent } from '../../types';
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: vi.fn() }));
afterEach(() => vi.resetAllMocks());

type Handler = (event: { payload: unknown }) => void;
function webview() {
  let handler: Handler | undefined; const stop = vi.fn();
  vi.mocked(getCurrentWebview).mockReturnValue({ onDragDropEvent: async (next: Handler) => { handler = next; return stop; } } as unknown as ReturnType<typeof getCurrentWebview>);
  return { fire: (payload: unknown) => handler?.({ payload }), stop, ready: () => Promise.resolve() };
}

it('forwards the webview drag-drop stream as enter, leave and drop', async () => {
  const view = webview(), seen: FileDropEvent[] = [];
  const backend = createTauriBackend(fakeBridge(() => {}).bridge);
  const unsubscribe = backend.onFileDrop(event => seen.push(event));
  await view.ready();
  view.fire({ type: 'enter', paths: ['/Users/t/Projects/x'], position: { x: 1, y: 1 } });
  view.fire({ type: 'over', position: { x: 2, y: 2 } });
  view.fire({ type: 'leave' });
  view.fire({ type: 'drop', paths: ['/Users/t/Projects/x'], position: { x: 3, y: 3 } });
  expect(seen).toEqual([{ kind: 'enter', paths: ['/Users/t/Projects/x'] }, { kind: 'leave' }, { kind: 'drop', paths: ['/Users/t/Projects/x'] }]);
  unsubscribe();
  expect(view.stop).toHaveBeenCalledOnce();
  view.fire({ type: 'drop', paths: ['/late'], position: { x: 0, y: 0 } });
  expect(seen).toHaveLength(3);
});

it('stops a subscription that resolves after it was disposed, and survives a missing webview', async () => {
  let resolve!: (stop: () => void) => void; const stop = vi.fn();
  vi.mocked(getCurrentWebview).mockReturnValue({ onDragDropEvent: () => new Promise<() => void>(r => { resolve = r; }) } as unknown as ReturnType<typeof getCurrentWebview>);
  const backend = createTauriBackend(fakeBridge(() => {}).bridge);
  backend.onFileDrop(() => {})();
  resolve(stop); await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce();
  vi.mocked(getCurrentWebview).mockImplementation(() => { throw new Error('no IPC'); });
  expect(() => createTauriBackend(fakeBridge(() => {}).bridge).onFileDrop(() => {})()).not.toThrow();
});
