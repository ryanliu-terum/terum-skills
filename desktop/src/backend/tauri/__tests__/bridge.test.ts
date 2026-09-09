import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tauriBridge } from '../bridge';
import { NO_STATE } from '../run';
import { STATE } from './fake-bridge';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

beforeEach(() => { vi.resetAllMocks(); });

describe('app.json boundary', () => {
  it('wraps truncated JSON with NO_STATE guidance and the parse detail', async () => {
    const text = '{"schema":1,';
    let detail = '';
    try { JSON.parse(text); } catch (error) { detail = (error as Error).message; }
    vi.mocked(invoke).mockResolvedValue(text);
    await expect(tauriBridge().readAppState()).rejects.toThrow(`${NO_STATE} app.json could not be parsed: ${detail}`);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('read_app_state');
  });

  it('wraps invalid schema with guidance and the offending field', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({ ...STATE, writtenAt: undefined }));
    await expect(tauriBridge().readAppState()).rejects.toThrow(`${NO_STATE} app.json could not be parsed: writtenAt`);
  });

  it('accepts older files without PATH or target', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify(STATE));
    expect(await tauriBridge().readAppState()).toEqual(STATE);
  });

  it('exposes the recorded PATH, target and timestamp', async () => {
    const state = { ...STATE, path: '/opt/node/bin:/usr/bin', target: 'acme/team' };
    vi.mocked(invoke).mockResolvedValue(JSON.stringify(state));
    expect(await tauriBridge().readAppState()).toEqual(state);
  });

  it('keeps missing state nullable', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await tauriBridge().readAppState()).toBeNull();
  });
});

it.each(['/opt/node/bin:/usr/bin', 'C:\\node;C:\\git', '', null, undefined])('passes recorded PATH %j to cli_spawn', async (path) => {
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);
  const state = path === undefined ? STATE : { ...STATE, path };
  expect(await tauriBridge().spawn('r1', state, ['sync'], undefined, vi.fn())).toBe(unlisten);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('cli_spawn', {
    id: 'r1', node: STATE.node, entry: STATE.entry, path: path ?? null, args: ['sync'], cwd: null,
  });
});
