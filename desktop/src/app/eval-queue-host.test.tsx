import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { MemoryRouter } from 'react-router';
import { BackendContext, PromptContext } from '../backend';
import { registerEvalQueue, type EvalQueueResult } from '../backend/eval-queue';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
import type { Run } from '../backend/types';
import { TopBar } from '../components/domain/TopBar';
import { EvalRunDialogHost } from './EvalRunDialogHost';
import { EvalRunProvider } from './EvalRunProvider';
import { useEvalRun } from './eval-run-context';

const runs: Run<EvalQueueResult>[] = [];
afterEach(async () => { for (const run of runs.splice(0)) await run.cancel(); cleanup(); localStorage.clear(); });
it('queued runs are visible, dismissible, reopenable and stoppable without needing a skill read', async () => {
  const backend = createMockBackend(), readSkill = vi.spyOn(backend, 'skill');
  const item = { team: 'team', skill: 'alpha', version: 'a'.repeat(40), requestedAt: '2026-09-10T00:00:00Z', window: 'overnight' as const };
  const run = createRun<EvalQueueResult>(async ctx => { ctx.print('Evaluating alpha'); ctx.progress(1,2,'evals'); await ctx.sleep(60_000); return { ok: true, value: { items: [], completed: 1 } }; });
  runs.push(run); const cancel = vi.spyOn(run, 'cancel');
  registerEvalQueue(backend, { list: async () => ({ ok: true, value: { items: [item] } }), drain: () => run });
  function Start() { const host = useEvalRun(); return <button onClick={() => { void host.startQueued?.(item); }}>Start queued eval</button>; }
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><Tooltip.Provider><PromptContext value={async () => true}><EvalRunProvider><TopBar mode="cosmetic"/><MemoryRouter><Start/><EvalRunDialogHost/></MemoryRouter></EvalRunProvider></PromptContext></Tooltip.Provider></QueryClientProvider></BackendContext>);
  fireEvent.click(screen.getByRole('button', { name: 'Start queued eval' }));
  const dialog = await screen.findByRole('dialog', { name: 'Queued eval · alpha' });
  expect(await within(dialog).findByRole('log')).toHaveTextContent('Evaluating alpha'); expect(readSkill).not.toHaveBeenCalled();expect(await within(dialog).findByText('1 of 2 evaluated')).toBeVisible();
  fireEvent.keyDown(dialog, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Eval running · alpha' }));
  const reopened = await screen.findByRole('dialog', { name: 'Queued eval · alpha' });
  fireEvent.click(within(reopened).getByRole('button', { name: 'Stop' }));
  expect(await within(reopened).findByText('Stopped')).toBeVisible(); expect(cancel).toHaveBeenCalledTimes(1);
});
