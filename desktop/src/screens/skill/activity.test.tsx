import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';

/**
 * The Activity tab (build spec §6, decision D6 2026-09-15) draws live firing counts and only those.
 *
 * The three outcomes below are genuinely different statements and the panel must not collapse them.
 * The middle one — placed here, never fired — is the case the whole feature exists to surface, and
 * it is the one a naive "no data" empty state would erase.
 *
 * Mock fixtures (backend/mock/index.ts): deploy-check 0/4, release-notes 3/1, pr-review 0/0; incident-triage is absent (not placed).
 */
function open(route: string) { location.hash = route; return render(<Providers><App /></Providers>); }
/** Await the region itself: the page loads asynchronously, so a synchronous role query races it. */
const activity = async () => within(await screen.findByRole('region', { name: 'Activity' }));

beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; });

it('names a skill people reach for that the model never chooses — the reason this tab exists', async () => {
  open('#/skill/deploy-check?tab=activity');
  const tab = await activity();
  expect(await tab.findByText('0 autonomous')).toBeVisible();
  expect(tab.getByText('4 explicit')).toBeVisible();
  expect(tab.getByText(/Never chosen from its description/)).toBeVisible();
});

it('does not brand a skill the model does choose', async () => {
  open('#/skill/release-notes?tab=activity');
  const tab = await activity();
  expect(await tab.findByText('3 autonomous')).toBeVisible();
  expect(tab.queryByText(/Never chosen from its description/)).toBeNull();
});

it('says placed-and-never-fired rather than reporting nothing', async () => {
  open('#/skill/pr-review?tab=activity');
  const tab = await activity();
  expect(await tab.findByText(/Placed here and never fired/)).toBeVisible();
  // Never-fired is a real finding, not an absence: the zero counts still render.
  expect(tab.getByText('0 autonomous')).toBeVisible();
});

it('distinguishes not-installed-here from never-fired', async () => {
  open('#/skill/incident-triage?tab=activity');
  const tab = await activity();
  expect(await tab.findByText(/Not installed on this machine/)).toBeVisible();
  expect(tab.queryByText(/never fired/)).toBeNull();
});

it('always carries the invocations-not-outcomes caveat', async () => {
  open('#/skill/deploy-check?tab=activity');
  expect(await (await activity()).findByText(/invocations, not outcome-changing uses/)).toBeVisible();
});

it('says what the tab does not show yet, so two numbers do not read as broken', async () => {
  open('#/skill/deploy-check?tab=activity');
  expect(await (await activity()).findByText(/Install, publish and eval-run history will land on this tab too/)).toBeVisible();
});
