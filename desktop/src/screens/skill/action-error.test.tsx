import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { pickBackend } from '../../backend';

function open(route: string) { location.hash = route; return render(<Providers><App/></Providers>); }
afterEach(() => { cleanup(); location.hash = ''; localStorage.clear(); vi.restoreAllMocks(); });

it('reports a failed action inline and leaves the skill on the page', async () => {
  // Before this, any failed action was merged ahead of the read error and drawn as
  // "Couldn't read <ref>" — the page blanked and blamed the skill for a button that failed.
  vi.spyOn(pickBackend(), 'openInEditor').mockResolvedValue({ ok: false, error: 'No editor is configured for this machine.' });
  open('#/skill/onboarding-tour');
  fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No editor is configured for this machine.');
  expect(screen.getByRole('heading', { name: 'onboarding-tour' })).toBeInTheDocument();
  expect(screen.queryByText(/Couldn't read/)).toBeNull();
});
