import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { PropsWithChildren } from 'react';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import { useWorkflow } from './useWorkflow';

afterEach(cleanup);
function wrapper({ children }: PropsWithChildren) {
  return <MemoryRouter initialEntries={['/settings?dialog=leave&tab=teams']}><BackendContext value={createMockBackend()}>{children}</BackendContext></MemoryRouter>;
}
it('closes a cancelled workflow quietly, retains the CLI line and never invokes success', async () => {
  const success = vi.fn();
  const { result } = renderHook(() => ({ action: useWorkflow(), location: useLocation() }), { wrapper });
  await act(() => result.current.action.run(() => createRun(async () => ({ ok: false, error: 'Leave was cancelled.', cancelled: true })), {}, success));
  await waitFor(() => expect(result.current.location.search).toBe('?tab=teams'));
  expect(result.current.action.notice).toBe('Leave was cancelled.');
  expect(result.current.action.error).toBeNull();
  expect(result.current.action.busy).toBe(false);
  expect(success).not.toHaveBeenCalled();
});
it('keeps an actual failure in the popup error state even when its message says declined', async () => {
  const { result } = renderHook(() => ({ action: useWorkflow(), location: useLocation() }), { wrapper });
  await act(() => result.current.action.run(() => createRun(async () => ({ ok: false, error: "Unknown option --declined" }))));
  expect(result.current.location.search).toBe('?dialog=leave&tab=teams');
  expect(result.current.action.error).toBe('Unknown option --declined');
  expect(result.current.action.notice).toBeNull();
});

it('clear dismisses a shown failure without starting a new action',async()=>{
 const {result}=renderHook(()=>({action:useWorkflow()}),{wrapper});
 await act(()=>result.current.action.run(()=>createRun(async()=>({ok:false,error:'Team removal requires GitHub repository admin permission.'}))));
 expect(result.current.action.error).toBe('Team removal requires GitHub repository admin permission.');
 act(()=>result.current.action.clear());
 expect(result.current.action.error).toBeNull();
 expect(result.current.action.notice).toBeNull();
 expect(result.current.action.busy).toBe(false);
});
it('closes a refused workflow quietly and retains the CLI notice',async()=>{
 const success=vi.fn();
 const {result}=renderHook(()=>({action:useWorkflow(),location:useLocation()}),{wrapper});
 await act(()=>result.current.action.run(()=>createRun(async()=>({ok:false,error:'Leave first.',refused:true})),{},success));
 await waitFor(()=>expect(result.current.location.search).toBe('?tab=teams'));
 expect(result.current.action.notice).toBe('Leave first.');expect(result.current.action.error).toBeNull();
 expect(result.current.action.busy).toBe(false);expect(success).not.toHaveBeenCalled();
});
