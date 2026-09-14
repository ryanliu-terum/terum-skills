import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext, PromptContext } from '../backend';
import { createMockBackend } from '../backend/mock';
import { cardOf, design } from '../backend/mock/data';
import { createRun } from '../backend/mock/run';
import type { EvalResult, Run, SkillCard as Card } from '../backend/types';
import { EvalRunProvider } from './EvalRunProvider';
import { useEvalRun } from './eval-run-context';
import { TopBar } from '../components/domain/TopBar';
import { SkillCard } from '../components/domain/SkillCard';

// UI policy §5 (2026-09-14): work in flight is visible from the top bar (starting → counting → finished) and on the card it lands on (a pulsing dot).
const runs: Run<EvalResult>[] = [];
afterEach(async () => { for (const run of runs.splice(0)) await run.cancel(); cleanup(); localStorage.clear(); });
const card = (over: Partial<Card> = {}): Card => ({ ...cardOf(design.CATALOG[0]!), ...over });

function Start({ name, team }: { name: string; team?: string }) { const host = useEvalRun(); return <button onClick={() => host.start({ ref: name, name, ...(team === undefined ? {} : { team }) })}>Start</button>; }
function mount(run: Run<EvalResult>, skill: Card, team?: string) {
  const backend = createMockBackend();
  backend.eval = () => run;
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><Tooltip.Provider><PromptContext value={async () => true}><EvalRunProvider><TopBar mode="cosmetic"/><MemoryRouter initialEntries={['/marketplace']}><Start name={skill.name} {...(team === undefined ? {} : { team })}/><SkillCard skill={skill}/></MemoryRouter></EvalRunProvider></PromptContext></Tooltip.Provider></QueryClientProvider></BackendContext>);
}

it('the chip says starting, then counts, then finished with a dismiss; the covered card pulses only while the run is on', async () => {
  let release!: () => void, finish!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), end = new Promise<void>(resolve => { finish = resolve; });
  const run = createRun<EvalResult>(async ctx => { await gate; ctx.print('Evaluating deploy-check'); ctx.progress(1, 3, 'evals'); await end; return { ok: true, value: { name: 'deploy-check' } as unknown as EvalResult }; });
  runs.push(run);
  const skill = card({ name: 'deploy-check', teamed: true });
  mount(run, skill, 'terum');
  expect(screen.queryByRole('status', { name: 'Evaluating deploy-check' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(await screen.findByRole('button', { name: 'Starting eval · deploy-check' })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Evaluating deploy-check' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  release();
  await screen.findByRole('button', { name: 'Evaluating · 1 of 3 · deploy-check' });
  expect(screen.getByRole('status', { name: 'Evaluating deploy-check' })).toBeInTheDocument();
  finish();
  await screen.findByRole('button', { name: 'Eval finished · deploy-check' });
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Evaluating deploy-check' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss eval status' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Eval finished/ })).toBeNull());
});

it('a card outside the run shows no dot', async () => {
  const run = createRun<EvalResult>(async ctx => { await ctx.sleep(60_000); return { ok: true, value: {} as EvalResult }; });
  runs.push(run);
  mount(run, card({ name: 'other-skill', teamed: true }), 'terum');
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByRole('button', { name: 'Starting eval · other-skill' });
  // Same run, but the card on screen is a LOCAL folder of that name: a team run does not light it.
  cleanup();
  const run2 = createRun<EvalResult>(async ctx => { await ctx.sleep(60_000); return { ok: true, value: {} as EvalResult }; });
  runs.push(run2);
  mount(run2, card({ name: 'other-skill', teamed: false }), 'terum');
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByRole('button', { name: 'Starting eval · other-skill' });
  expect(screen.queryByRole('status', { name: 'Evaluating other-skill' })).toBeNull();
});
