import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MachineRemovalProvider } from '../../app/MachineRemovalProvider';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { design } from '../../backend/mock/data';

// Quality-of-life affordances on the Settings sections (2026-09-14): rows and values that copy, reveal or open on a
// click or a right-click, and host-spelled labels. None of them change a board's pixels; these tests pin behaviour.
const backend = createMockBackend();
function open(route: string) { location.hash = route; return render(<Providers><BackendContext value={backend}><MachineRemovalProvider><App/></MachineRemovalProvider></BackendContext></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.getState().setTheme('dark'); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });
const menu = () => screen.findByRole('menu', { name: 'Context menu' });
const item = async (name: string | RegExp) => within(await menu()).getByRole('menuitem', { name });

it('a placement row opens its skill on click and offers the folder on right-click', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  open('#/settings/machine');
  const row = await screen.findByTestId('placement-row-0');
  const [path, skill] = design.PLACEMENTS[0] as [string, string];
  expect(row).toHaveAttribute('aria-label', `${skill} at ${path}`);
  expect(within(row).getAllByRole('cell')[0]).toHaveAttribute('title', `${skill} · ${path}`);
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  expect(await item('Open ' + skill)).toBeInTheDocument();
  expect(await item('Show in Finder')).toBeInTheDocument();
  fireEvent.click(await item('Copy path'));
  expect(copy).toHaveBeenCalledWith(path);
  expect(await screen.findByRole('status')).toHaveTextContent('Copied path');
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(location.hash).toBe('#/skill/' + encodeURIComponent(skill));
});

it('a tool-approval row opens its skill from the right-click menu', async () => {
  open('#/settings/machine');
  const [skill] = design.APPROVALS[0] as [string, string[], string];
  const row = (await screen.findAllByText(skill))[0]!.closest('.setting-row')!;
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  fireEvent.click(await item('Open ' + skill));
  expect(location.hash).toBe('#/skill/' + encodeURIComponent(skill));
});

it('the team clone path and handle copy on click, and the clone row reveals on right-click', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  const reveal = vi.spyOn(backend, 'revealPath').mockResolvedValue({ ok: true, value: undefined });
  open('#/settings/teams');
  const clone = design.TEAMS[0]!.clone;
  const value = await screen.findByRole('button', { name: clone });
  expect(value).toHaveAttribute('title', 'Click to copy');
  await act(async () => { fireEvent.click(value); });
  expect(copy).toHaveBeenLastCalledWith(clone);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'handle ' + design.TEAMS[0]!.handle })); });
  expect(copy).toHaveBeenLastCalledWith(design.TEAMS[0]!.handle);
  fireEvent.contextMenu(value.closest('.setting-row')!, { clientX: 10, clientY: 10 });
  await act(async () => { fireEvent.click(await item('Show in Finder')); });
  expect(reveal).toHaveBeenCalledWith(clone);
});

it('Keyboard chords and the reveal verb follow the host', async () => {
  const capabilities = await backend.capabilities(); vi.spyOn(backend, 'capabilities').mockResolvedValue({ ...capabilities, windowChrome: 'native' });
  const status = await backend.status(); if (!status.ok) throw new Error(status.error);
  vi.spyOn(backend, 'status').mockResolvedValue({ ...status, value: { ...status.value, machine: { ...status.value.machine, os: 'windows' } } });
  open('#/settings/appearance');
  await screen.findByRole('heading', { name: 'Appearance' });
  const keyboard = screen.getByText('Sync now').closest<HTMLElement>('.setting-card')!;
  expect(within(keyboard).getByText('Ctrl+K')).toBeInTheDocument();
  expect(within(keyboard).getByText('Ctrl+[ · Ctrl+]')).toBeInTheDocument();
  expect(screen.queryByText('⌘K')).toBeNull();
  cleanup();
  open('#/settings/advanced');
  expect(await screen.findByRole('button', { name: 'Show in Explorer' })).toBeInTheDocument();
  expect(screen.queryByText('Show in Finder')).toBeNull();
});

it('About copies one version on click and every version from the right-click menu', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  open('#/settings/about');
  const app = await screen.findByRole('button', { name: design.APP_VERSION });
  await act(async () => { fireEvent.click(app); });
  expect(copy).toHaveBeenLastCalledWith(design.APP_VERSION);
  fireEvent.contextMenu(app.closest('.setting-row')!, { clientX: 10, clientY: 10 });
  await act(async () => { fireEvent.click(await item('Copy all versions')); });
  const block = copy.mock.calls.at(-1)![0];
  expect(block).toContain('Terum Skills app ' + design.APP_VERSION);
  expect(block).toContain('terum-skills CLI ' + design.CLI_VERSION);
  expect(block).toContain('Platform ' + design.MACHINE.os);
});

it('a terminal hint copies its command from the right-click menu', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  open('#/settings/teams');
  await screen.findByRole('heading', { name: 'Team' });
  const hint = document.querySelector('.terminal-hint')!;
  fireEvent.contextMenu(hint, { clientX: 10, clientY: 10 });
  await act(async () => { fireEvent.click(await item('Copy command')); });
  expect(copy).toHaveBeenCalledWith('npx -y terum-skills@latest team leave ' + design.TEAMS[0]!.key);
});
