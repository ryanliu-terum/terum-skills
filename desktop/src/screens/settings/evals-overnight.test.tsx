import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { isChromePreference } from '../../backend/prefs';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';

afterEach(() => { cleanup(); localStorage.clear(); location.hash = ''; });
it('defaults overnight evals on and persists the Settings Evals toggle as chrome', async () => {
  const backend = createMockBackend(); location.hash = '#/settings/evals';
  render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
  const control = await screen.findByRole('switch', { name: 'Run queued evals overnight' });
  expect(control).toBeChecked(); expect(screen.getByText('between 01:00 and 05:00, while the app is open and idle')).toBeVisible();
  expect(isChromePreference('evals:overnight')).toBe(true);
  fireEvent.click(control); expect(backend.prefs.get('evals:overnight', true)).toBe(false);
  fireEvent.click(control); expect(backend.prefs.get('evals:overnight', false)).toBe(true);
});
