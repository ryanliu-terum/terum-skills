import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext, PrintContext, PromptContext } from '../../../backend/index.js';
import { createMockBackend } from '../../../backend/mock/index.js';
import { createRun } from '../../../backend/mock/run.js';
import type { Result, Run } from '../../../backend/types.js';
import { App } from '../../../app/App.js';
import * as backendModule from '../../../backend/index.js';
import { Providers } from '../../../app/providers.js';

const runs: Run<unknown>[] = [];
afterEach(async () => {
  cleanup();
  for (const run of runs.splice(0)) await run.cancel();
  location.hash = ''; localStorage.clear(); vi.restoreAllMocks();
});

type Kind = 'install' | 'remove' | 'manage';
const confirm = { install: 'Install', remove: 'Remove', manage: 'Continue' };
async function open(kind: Kind = 'install', prompts = false) {
  const backend = createMockBackend();
  const detail = await backend.skill({ ref: 'deploy-check' });
  if (!detail.ok) throw new Error(detail.error);
  vi.spyOn(backend, 'skill').mockResolvedValue({ ok: true, value: {
    ...detail.value,
    installed: kind === 'install' ? 'absent' : 'placed',
    placed: kind === 'remove',
    onDiskOnly: kind === 'manage',
    path: kind === 'install' ? null : '/skills/deploy-check',
    unidentifiedLocal: null,
  } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  location.hash = `#/skill/deploy-check?dialog=${kind}`;
  if (prompts) vi.spyOn(backendModule, 'pickBackend').mockReturnValue(backend);
  const view = render(prompts ? <Providers><App/></Providers> : <BackendContext value={backend}><QueryClientProvider client={client}><Tooltip.Provider><PromptContext value={async () => true}><PrintContext value={() => undefined}><App/></PrintContext></PromptContext></Tooltip.Provider></QueryClientProvider></BackendContext>);
  await screen.findByRole('dialog');
  return { backend, client, ...view };
}
function controlledRun() {
  let step!: (label: string) => void;
  let finish!: (result: Result<never[]>) => void;
  const settled = new Promise<Result<never[]>>(resolve => { finish = resolve; });
  const run = createRun(async ctx => {
    step = label => ctx.progress(1, 4, label);
    return await settled;
  });
  runs.push(run);
  return { run, step: (label: string) => step(label), finish, cancel: vi.spyOn(run, 'cancel') };
}
function start(kind: Kind = 'install') {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: confirm[kind] }));
}

it.each(['install', 'remove', 'manage'] as const)('%s keeps the CLI step visible until the run settles', async kind => {
  const { backend } = await open(kind); const pending = controlledRun();
  // Connect may succeed without a value; install/remove return result arrays.
  if (kind === 'install') vi.spyOn(backend, 'install').mockReturnValue(pending.run);
  else if (kind === 'remove') vi.spyOn(backend, 'uninstallSkill').mockReturnValue(pending.run);
  else vi.spyOn(backend, 'connect').mockImplementation(() => {
    const run: Run<undefined> = { ...pending.run, done: pending.run.done.then(result => result.ok ? { ok: true, value: undefined } : { ok: false, error: result.error }) };
    return run;
  });
  start(kind);
  for (const label of ['Reading the team clone', 'Placing deploy-check', 'Publishing to the team repository', 'Recording your install']) {
    await act(async () => { await Promise.resolve(); pending.step(label); });
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(label);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: confirm[kind] })).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  }
  await act(async () => { pending.finish({ ok: true, value: [] }); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText('Recording your install')).toBeNull();
});

it('Cancel stops an install and a reopened dialog has no orphaned busy state', async () => {
  const { backend } = await open(); const pending = controlledRun();
  vi.spyOn(backend, 'install').mockReturnValue(pending.run); start();
  await act(async () => { await Promise.resolve(); pending.step('Placing deploy-check'); });
  expect(await screen.findByText('Placing deploy-check')).toBeVisible();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(pending.cancel).toHaveBeenCalledTimes(1);
  expect(await pending.run.done).toMatchObject({ ok: false, error: 'Cancelled.' });
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Install' })).toBeEnabled();
  expect(within(dialog).queryByRole('status')).toBeNull();
  pending.finish({ ok: true, value: [] });
});

it.each(['install', 'remove', 'manage'] as const)('%s failure closes progress and exposes the existing error board', async kind => {
  const { backend } = await open(kind);
  let fail!: () => void;
  const failure = new Promise<void>(resolve => { fail = resolve; });
  const run = createRun<never>(async ctx => {
    ctx.progress(1, 4, 'Waiting for the team');
    await failure;
    return { ok: false, error: 'The team repository is unavailable.' };
  });
  runs.push(run);
  vi.spyOn(backend, kind === 'install' ? 'install' : kind === 'remove' ? 'uninstallSkill' : 'connect').mockReturnValue(run);
  start(kind);
  expect(await screen.findByText('Waiting for the team')).toBeVisible();
  await act(async () => { fail(); });
  expect(await screen.findByText('The team repository is unavailable.')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Waiting for the team')).toBeNull();
});

it('unmounting the busy dialog cancels the install', async () => {
  const { backend, unmount } = await open(); const pending = controlledRun();
  vi.spyOn(backend, 'install').mockReturnValue(pending.run); start();
  await act(async () => { await Promise.resolve(); pending.step('Publishing to the team repository'); });
  expect(await screen.findByText('Publishing to the team repository')).toBeVisible();
  unmount(); expect(pending.cancel).toHaveBeenCalledTimes(1);
  pending.finish({ ok: true, value: [] });
});


it('answering a CLI consent prompt leaves the install dialog and subsequent progress alive', async () => {
  const { backend } = await open('install', true);
  let finish!: () => void;
  const completion = new Promise<void>(resolve => { finish = resolve; });
  const run = createRun<never[]>(async ctx => {
    ctx.progress(1, 4, 'Reading the team clone');
    await ctx.ask('confirm', 'Approve these tools for deploy-check?');
    ctx.progress(2, 4, 'Placing deploy-check');
    await completion;
    return { ok: true, value: [] };
  });
  runs.push(run); const cancel = vi.spyOn(run, 'cancel');
  vi.spyOn(backend, 'install').mockReturnValue(run); start();
  const consent = await screen.findByRole('dialog', { name: 'Approve these tools for deploy-check?' });
  fireEvent.click(within(consent).getByRole('button', { name: 'Yes' }));
  const install = await screen.findByRole('dialog', { name: 'Install deploy-check' });
  expect(await within(install).findByText('Placing deploy-check')).toBeVisible();
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
