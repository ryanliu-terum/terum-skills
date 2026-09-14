import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { Providers } from './providers';
import { useUiStore } from './store';
import { BackendContext } from '../backend';
import { createMockBackend } from '../backend/mock';
import type { Backend } from '../backend/Backend';
import type { Capabilities } from '../backend/types';

/**
 * The shell's shortcuts read their modifier from `capabilities().windowChrome`, never from a platform
 * probe: ⌘ alone on macOS, Ctrl as well on Linux/Windows and in the browser mock. Before this, the
 * handler tested `event.metaKey` alone, so nothing on Windows had a shortcut at all.
 */
async function boot(chrome: Capabilities['windowChrome'] | 'pending'): Promise<Backend> {
  const backend = createMockBackend();
  const base = await backend.capabilities();
  vi.spyOn(backend, 'capabilities').mockImplementation(chrome === 'pending'
    // A seam that has not answered yet: the app keeps the ⌘-only binding it always had.
    ? () => new Promise<Capabilities>(() => { /* Deliberately pending. */ })
    : () => Promise.resolve({ ...base, windowChrome: chrome }));
  location.hash = '#/library/global';
  render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
  await screen.findByTestId('skill-card-deploy-check');
  if (chrome !== 'pending') await waitFor(() => expect(document.documentElement.dataset.appReady).toBe('true'));
  return backend;
}
beforeEach(() => { localStorage.clear(); useUiStore.setState({ railOpen: true, overviewHidden: false, theme: 'dark' }); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

it.each([
  ['native', { key: 'k', ctrlKey: true }, '#/search'],
  ['native', { key: 'k', metaKey: true }, '#/search'],
  ['cosmetic', { key: 'k', ctrlKey: true }, '#/search'],
  ['cosmetic', { key: 'k', metaKey: true }, '#/search'],
  ['mac-overlay', { key: 'k', metaKey: true }, '#/search'],
  // macOS binds ⌘K; Ctrl+K there belongs to the text field, so the app never takes it.
  ['mac-overlay', { key: 'k', ctrlKey: true }, '#/library/global'],
  // Both modifiers at once is a chord this app does not bind.
  ['native', { key: 'k', ctrlKey: true, metaKey: true }, '#/library/global'],
  ['native', { key: 'k', ctrlKey: true, shiftKey: true }, '#/library/global'],
  ['native', { key: 'k', ctrlKey: true, altKey: true }, '#/library/global'],
] as const)('%s: %j lands on %s', async (chrome, init, hash) => {
  await boot(chrome);
  fireEvent.keyDown(document, init);
  await waitFor(() => expect(location.hash).toBe(hash));
});

it('native binds the rest of the set to Ctrl too', async () => {
  await boot('native');
  fireEvent.keyDown(document, { key: ',', ctrlKey: true });
  await waitFor(() => expect(location.hash).toBe('#/settings/account'));
});

/**
 * Back and forward need a second entry to be provable: `#/library/global` is where `boot()` starts AND
 * where `#/` redirects, so asserting it after Ctrl+[ from the first entry passes whether the shortcut
 * fired or not. Walking to another route first makes "went back" distinguishable from "nothing happened".
 */
async function twoEntries() {
  await boot('native');
  location.hash = '#/marketplace';
  await waitFor(() => expect(location.hash).toBe('#/marketplace'));
}
it('walks back with the modifier on native', async () => {
  await twoEntries();
  fireEvent.keyDown(document, { key: '[', ctrlKey: true });
  await waitFor(() => expect(location.hash).toBe('#/library/global'));
});
it('walks forward again with the modifier on native', async () => {
  await twoEntries();
  fireEvent.keyDown(document, { key: '[', ctrlKey: true });
  await waitFor(() => expect(location.hash).toBe('#/library/global'));
  fireEvent.keyDown(document, { key: ']', ctrlKey: true });
  await waitFor(() => expect(location.hash).toBe('#/marketplace'));
});
it('leaves back and forward alone on mac-overlay', async () => {
  await boot('mac-overlay');
  location.hash = '#/marketplace';
  await waitFor(() => expect(location.hash).toBe('#/marketplace'));
  fireEvent.keyDown(document, { key: '[', ctrlKey: true });
  // Nothing to await: the assertion is that no navigation happens at all.
  await Promise.resolve();
  expect(location.hash).toBe('#/marketplace');
});

it('keeps ⌘ alone until the seam has answered', async () => {
  await boot('pending');
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  // Nothing to await: the assertion is that no navigation happens at all.
  await Promise.resolve();
  expect(location.hash).toBe('#/library/global');
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  await waitFor(() => expect(location.hash).toBe('#/search'));
});

it('never steals a shortcut key typed into a field', async () => {
  await boot('native');
  const search = screen.getByRole('textbox', { name: /Search/ });
  fireEvent.keyDown(search, { key: 'k', ctrlKey: true });
  await Promise.resolve();
  expect(location.hash).toBe('#/library/global');
});
