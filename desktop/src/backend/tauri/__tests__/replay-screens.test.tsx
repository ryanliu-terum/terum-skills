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
import { inventoryReplay, marketplaceRecorded } from './inventory-replay';

afterEach(() => { cleanup(); location.hash = ''; localStorage.clear(); });
function open(route: string, marketplace = false) {
  useUiStore.setState({ railOpen: true, overviewHidden: false });
  const f = inventoryReplay(marketplace ? marketplaceRecorded : name => readFileSync(resolve('../.planning/codex-runs/m7-S7g/frames', name + '.jsonl'), 'utf8').trim().split('\n'));
  location.hash = route;
  render(<BackendContext value={createTauriBackend(f.bridge)}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return f;
}
it('renders recorded Library cards and the real project registry without favorite controls or sample provenance', async () => {
  open('#/library/global');
  expect(await screen.findByText('1 skill · 1 shared with acme')).toBeVisible();
  expect(within(document.querySelector('.board-view-header') as HTMLElement).getByText('Global')).toBeVisible();
  const card = screen.getByTestId('skill-card-deploy-check');
  expect(within(card).getByText('Use this skill when a deploy needs a pre-flight checklist.')).toBeVisible();
  expect(within(card).queryByRole('button', { name: 'Favorite deploy-check' })).toBeNull();
  expect(screen.getByRole('link', { name: 'seed' })).toHaveAttribute('href', '#/library/checkout?root='+encodeURIComponent('/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'));
  expect(screen.queryByRole('link', { name: 'SSM' })).toBeNull();
  expect(screen.queryByText(/sonnet · agent CLI/)).toBeNull();
});
it('renders recorded markdown and validation, omitting unknown counts and fabricated frontmatter', async () => {
  const f = open('#/skill/deploy-check');
  // The body-derived description now equals the markdown's first paragraph, so the text appears twice.
  expect((await screen.findAllByText('Use this skill when a deploy needs a pre-flight checklist.'))[0]).toBeVisible();
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
it('shows unknown quarantine contents without a fabricated folder count', async () => {
  open('#/settings/sync');
  expect(await screen.findByText('Quarantine contents are not reported by this terum-skills version.')).toBeVisible();
  expect(screen.queryByText(/folders · —/)).toBeNull();
});
it('preserves the project route key when the displayed title is capitalized', async () => {
  const f = open('#/library/checkout?root='+encodeURIComponent('/private/tmp/claude-501/-Users-ryanliu-Documents-Terum-skill-management-software/531442ce-3f4e-40d8-93ca-3e9bdddfd46a/scratchpad/fx/repo/seed'));
  expect(await screen.findByText('0 skills')).toBeVisible();
  expect(within(document.querySelector('.board-view-header') as HTMLElement).getByText('seed')).toBeVisible();
  expect(screen.queryAllByTestId(/^skill-card-/)).toHaveLength(0);
  expect(f.spawns.some(spawn => spawn.args[1] === 'project')).toBe(false);
});

it('renders the real machine placement table from typed provenance, in the board\'s vocabulary',async()=>{
  open('#/settings/machine');
  const row=await screen.findByTestId('placement-row-0');
  expect(row).toHaveTextContent('deploy-check');expect(row).toHaveTextContent('up to date');
  expect(row).toHaveTextContent('tracking');expect(row).not.toHaveTextContent('In sync');
  expect(screen.getByText(/1 placed · — global · 0 pinned/)).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('renders recorded people without dangling separators and with authored publish lines', async () => {
  open('#/marketplace/people', true);
  const mira = await screen.findByTestId('person-card-mira');
  expect(mira).toHaveTextContent('Published deploy-check');
  expect(mira).not.toHaveTextContent('· mira');
  expect(mira.querySelector('.market-person-ident')?.textContent).toBe('Mira Chenmira');
});
it('omits unknown project descriptions, admins and evaluation chips', async () => {
  open('#/marketplace/projects', true);
  const project = await screen.findByTestId('project-card-terum');
  expect(project.querySelector('.market-project-desc')).toBeNull();
  expect(project.querySelector('.market-project-foot')).toBeNull();
  expect(project).not.toHaveTextContent('evaluated');
  expect(project).toHaveTextContent('1 skill');
});
it('renders the real project repo with no Admin or Evaluated rail rows', async () => {
  open('#/marketplace/projects/terum', true);
  expect(await screen.findByRole('link', { name: 'acme/team' })).toBeVisible();
  const rail = document.querySelector('.market-rail');
  expect(rail).not.toHaveTextContent('Evaluated');
  expect(rail).not.toHaveTextContent('Admin');
  expect(document.querySelector('.market-project-heading > span')).toBeNull();
});
it('renders a missing project as Not found with a way back', async () => {
  open('#/marketplace/projects/nope', true);
  expect(await screen.findByText('Not found')).toBeVisible();
  expect(screen.getByText('No project named nope.')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to marketplace' }));
  await waitFor(() => expect(location.hash).toBe('#/marketplace'));
});
it('renders the actual unevaluated card count in filters', async () => {
  open('#/marketplace/skills?filters=open', true);
  expect(await screen.findByTestId('verdict-count-Not evaluated')).toHaveTextContent('Not evaluated3');
});
it('shows no fake tool grants in the real project install preview', async () => {
  open('#/marketplace/projects/terum?dialog=install', true);
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('0 of 1 ask');
  expect(dialog).toHaveTextContent("Adds the project's 1 skill");
  expect(within(dialog).queryByText('none')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Install 1 skill' })).toBeVisible();
});
