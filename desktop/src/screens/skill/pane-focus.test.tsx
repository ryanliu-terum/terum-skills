import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';

// Batch F (2026-09-13): every scrolling pane on the skill detail is a focusable landmark with a name, so a
// keyboard user on a WebView without Chromium's keyboard-focusable-scroller heuristic (WKWebView) can still
// Tab to the pane and scroll it. The CSS side (the inset ring, no ring on mouse focus) is pinned in
// scroll-panes.test.ts and exercised for real in e2e/routes/scroll.spec.ts; this file pins the markup.
function open(route: string) { location.hash = route; return render(<Providers><App /></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; });

const PANES = [
  { route: '#/skill/deploy-check', name: 'SKILL.md', klass: 'skill-md-blocks' },
  { route: '#/skill/deploy-check?tab=evals', name: 'Evaluation report', klass: 'evals-main' },
  { route: '#/skill/deploy-check?tab=quality', name: 'Quality', klass: 'quality-tab' },
  { route: '#/skill/deploy-check?tab=activity', name: 'Activity', klass: 'activity-tab' },
] as const;

it.each(PANES)('$route renders its scrolling pane as the focusable region "$name"', async ({ route, name, klass }) => {
  open(route);
  const pane = await screen.findByRole('region', { name });
  expect(pane).toHaveClass(klass);
  expect(pane).toHaveAttribute('tabindex', '0');
  pane.focus();
  expect(document.activeElement).toBe(pane);
});

it('names every region on a tab uniquely, so screen readers can tell the panes apart', async () => {
  for (const { route, name } of PANES) {
    open(route);
    await screen.findByRole('region', { name });
    const names = screen.getAllByRole('region').map(region => region.getAttribute('aria-label'));
    expect(names.every(label => typeof label === 'string' && label.length > 0), route).toBe(true);
    expect(new Set(names).size, `${route}: ${names.join(', ')}`).toBe(names.length);
    cleanup();
  }
});

it('renders the History rail as a focusable landmark beside the report', async () => {
  open('#/skill/deploy-check?tab=evals');
  await screen.findByRole('region', { name: 'Evaluation report' });
  const rail = screen.getByRole('complementary', { name: 'Run history' });
  expect(rail).toHaveClass('history-rail');
  expect(rail).toHaveAttribute('tabindex', '0');
  rail.focus();
  expect(document.activeElement).toBe(rail);
});

it('keeps the pane out of the way when a state renders no report pane', async () => {
  // The invalid-newest state renders `.evals-body` with a CenteredState and no `.evals-main`: its buttons are
  // the focusable content, so the body needs no tabIndex of its own and must not claim the report's name.
  open('#/skill/deploy-check?tab=evals&__mock=invalid-newest');
  expect(await screen.findByText('The newest receipt for this version is invalid', { selector: '.state-title' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Evaluation report' })).toBeNull();
  expect(screen.getByRole('complementary', { name: 'Run history' })).toHaveAttribute('tabindex', '0');
});
