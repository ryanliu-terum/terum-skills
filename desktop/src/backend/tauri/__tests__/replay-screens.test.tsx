import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

afterEach(() => { cleanup(); location.hash = ''; localStorage.clear(); });
function open(route: string) {
  useUiStore.setState({ railOpen: true, overviewHidden: false });
  const f = fakeBridge((args, emit) => {
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'project' ? 'ls-project-terum' : 'ls' : args[0] === 'validate' ? 'validate-deploy-check' : args[0]!;
    const lines = readFileSync(resolve('../.planning/codex-runs/m7-S7g/frames', name + '.jsonl'), 'utf8').trim().split('\n');
    for (const line of lines) emit({ kind: 'stdout', line });
  });
  location.hash = route;
  render(<BackendContext value={createTauriBackend(f.bridge)}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return f;
}
it('renders recorded Library cards and the real project registry without favorite controls or sample provenance', async () => {
  open('#/library/global');
  expect(await screen.findByText('1 skill folder in Global · 1 shared with acme')).toBeVisible();
  const card = screen.getByTestId('skill-card-deploy-check');
  expect(within(card).getByText('a deploy needs a pre-flight checklist.')).toBeVisible();
  expect(within(card).queryByRole('button', { name: 'Favorite deploy-check' })).toBeNull();
  expect(screen.getByRole('link', { name: 'seed' })).toHaveAttribute('href', '#/library/checkout?root='+encodeURIComponent('/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'));
  expect(screen.queryByRole('link', { name: 'SSM' })).toBeNull();
  expect(screen.queryByText(/sonnet · agent CLI/)).toBeNull();
});
it('renders recorded markdown and validation, omitting unknown counts and fabricated frontmatter', async () => {
  const f = open('#/skill/deploy-check');
  expect(await screen.findByText('Use this skill when a deploy needs a pre-flight checklist.')).toBeVisible();
  expect(screen.queryByTestId('frontmatter')).toBeNull();
  expect(screen.queryByText(/184 lines/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Favorite skill' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Quality' }));
  expect(await screen.findByText('Hygiene checks · passed on connect · free, no model calls')).toBeVisible();
  expect(screen.queryByText(/12 days ago/)).toBeNull();
  expect(screen.queryByText('none')).toBeNull();
  expect(screen.getByText('No tool grants requested')).toBeVisible();
  expect(f.spawns.find(spawn => spawn.args[0] === 'validate')?.args).toEqual(['validate', '--team', 'acme', '--', 'deploy-check']);
});
it('omits the missing-project crumb instead of drawing a dash segment', async () => {
  open('#/skill/diagnose');
  await waitFor(() => expect(document.querySelector('.detail-crumbs')).toHaveTextContent('diagnose'));
  expect(document.querySelector('.detail-crumbs')?.textContent).toBe('Global/acme/debugging/diagnose');
});
it('omits the unknown quarantine size instead of a dangling dash clause', async () => {
  open('#/settings/sync');
  expect(await screen.findByText(/0 folders\. Only prune deletes here/)).toBeVisible();
  expect(screen.queryByText(/folders · —/)).toBeNull();
});
it('preserves the project route key when the displayed title is capitalized', async () => {
  const f = open('#/library/checkout?root='+encodeURIComponent('/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'));
  expect(await screen.findByText('0 skill folders in seed')).toBeVisible();
  expect(screen.queryAllByTestId(/^skill-card-/)).toHaveLength(0);
  expect(f.spawns.some(spawn => spawn.args[1] === 'project')).toBe(false);
});

it('renders the real machine placement table from typed provenance, in the board\'s vocabulary',async()=>{
  open('#/settings/machine');
  const row=await screen.findByTestId('placement-row-0');
  expect(row).toHaveTextContent('deploy-check');expect(row).toHaveTextContent('up to date');
  expect(row).not.toHaveTextContent('tracking');expect(row).not.toHaveTextContent('In sync');
  expect(screen.getByText(/1 placed · — global · 1 pinned/)).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});
