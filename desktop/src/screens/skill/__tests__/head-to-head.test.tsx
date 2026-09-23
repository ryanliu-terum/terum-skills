import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../../backend';
import { createMockBackend } from '../../../backend/mock';
import type { Backend } from '../../../backend/Backend';
import { skillByRef } from '../../../backend/mock/data';
import { EvalRunContext, type EvalRunApi } from '../../../app/eval-run-context';
import { HeadToHeadDialog } from '../HeadToHeadDialog';

afterEach(cleanup);

const skill = (() => { const found = skillByRef('deploy-check'); if (!found.ok) throw new Error(found.error); return found.value; })();

function mount(overrides: Partial<ReturnType<typeof createMockBackend>> = {}, evalRun: Partial<EvalRunApi> = {}) {
  const backend = { ...createMockBackend(), ...overrides };
  const api: EvalRunApi = { current: null, dialogOpen: false, start: () => {}, stop: async () => {}, dismiss: () => {}, clear: () => {}, show: () => {}, ...evalRun };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BackendContext value={backend}>
          <EvalRunContext value={api}>
            <HeadToHeadDialog skill={skill} onClose={() => {}} />
          </EvalRunContext>
        </BackendContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return backend;
}

it('will not run anything until the derived brief has been shown and approved', async () => {
  const start = vi.fn();
  mount({}, { start });

  // Nothing is runnable before a rival is chosen.
  expect(screen.getByRole('button', { name: /derive the brief/i })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /approve and run/i })).toBeNull();

  // The picker renders before the library query settles; the option must exist to be chosen.
  await screen.findByRole('option', { name: 'migration-guard' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'migration-guard' } });
  fireEvent.click(screen.getByRole('button', { name: /derive the brief/i }));

  // The brief is put in front of the person; only then does a run become possible.
  const approve = await screen.findByRole('button', { name: /approve and run/i });
  expect(start).not.toHaveBeenCalled();
  expect(screen.getByText(/get it live without surprising anyone/i)).toBeVisible();

  fireEvent.click(approve);
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  // The reviewed brief's PATH is what the run receives — the CLI re-reads and re-checks it.
  expect(start.mock.calls[0]![0]).toMatchObject({ vs: 'migration-guard', brief: expect.stringContaining('brief.md') });
});

it('never offers the skill itself as its own rival', async () => {
  mount();
  const others = await screen.findByRole('combobox');
  const values = [...others.querySelectorAll('option')].map((option) => option.getAttribute('value'));
  expect(values).not.toContain(skill.name);
});

it('surfaces a derivation failure instead of running anyway', async () => {
  const start = vi.fn();
  const failing: NonNullable<Backend['deriveBrief']> = () => ({ frames: (async function*(){})(), answer: () => {}, cancel: async () => {}, done: Promise.resolve({ ok: false, error: 'the brief names migration-guard' }) });
  mount({ deriveBrief: failing }, { start });
  await screen.findByRole('option', { name: 'migration-guard' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'migration-guard' } });
  fireEvent.click(screen.getByRole('button', { name: /derive the brief/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/names migration-guard/);
  expect(start).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /approve and run/i })).toBeNull();
});

it('hides the feature when the CLI on this machine cannot derive a brief', () => {
  mount({ deriveBrief: undefined as never });
  expect(screen.queryByRole('button', { name: /derive the brief/i })).toBeNull();
  expect(screen.getByText(/update terum-skills/i)).toBeVisible();
});
