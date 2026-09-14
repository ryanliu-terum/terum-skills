import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MachineRemovalProvider } from '../../app/MachineRemovalProvider';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { design } from '../../backend/mock/data';

// Right-click targets across the app (2026-09-14): a skill card, a sidebar folder row, an inbox item and a member row.
const backend = createMockBackend();
function open(route: string) { location.hash = route; return render(<Providers><BackendContext value={backend}><MachineRemovalProvider><App/></MachineRemovalProvider></BackendContext></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.getState().setTheme('dark'); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });
const menu = () => screen.findByRole('menu', { name: 'Context menu' });
const item = async (name: string | RegExp) => within(await menu()).getByRole('menuitem', { name });
const names = async () => within(await menu()).getAllByRole('menuitem').map(row => row.textContent);

it('a skill card offers its ⋯ actions, then copy, reveal and editor rows', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  const library = await backend.library({ scope: { kind: 'global' } }); if (!library.ok) throw new Error(library.error);
  const card = library.value.skills.find(skill => skill.path)!;
  open('#/library/global');
  fireEvent.contextMenu(await screen.findByTestId('skill-card-' + card.name), { clientX: 10, clientY: 10 });
  const rows = await names();
  expect(rows[0]).toBe('Open');
  expect(rows).toContain('Copy name'); expect(rows).toContain('Copy path'); expect(rows).toContain('Show in Finder'); expect(rows).toContain('Open in editor');
  const remove = within(await menu()).queryByRole('menuitem', { name: /^Delete…/ });
  if (remove) expect(remove).toHaveAttribute('data-danger');
  await act(async () => { fireEvent.click(await item('Copy path')); });
  expect(copy).toHaveBeenCalledWith(card.path);
  fireEvent.contextMenu(await screen.findByTestId('skill-card-' + card.name), { clientX: 10, clientY: 10 });
  fireEvent.click(await item('Open'));
  expect(location.hash).toMatch(/^#\/skill\//);
});

it('a sidebar project row reveals, copies, and jumps to the Projects list', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  const status = await backend.status(); if (!status.ok) throw new Error(status.error);
  const root = status.value.roots.find(r => r.kind === 'checkout')!;
  open('#/library/global');
  const row = await screen.findByRole('link', { name: new RegExp('^' + root.label) });
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  expect(await names()).toEqual(['Show in Finder', 'Copy path', 'Manage projects…']);
  await act(async () => { fireEvent.click(await item('Copy path')); });
  expect(copy).toHaveBeenCalledWith(root.root);
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  fireEvent.click(await item('Manage projects…'));
  expect(location.hash).toBe('#/settings/machine');
});

it('the Global row reveals the global skills folder and has no Manage row', async () => {
  open('#/library/global');
  await screen.findByRole('link', { name: /^Terum/ }); // status has landed, so the row knows its folder
  fireEvent.contextMenu(screen.getByRole('link', { name: /^Global/ }), { clientX: 10, clientY: 10 });
  expect(await names()).toEqual(['Show in Finder', 'Copy path']);
});

it('an inbox item opens its skill and copies the skill name', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  open('#/inbox');
  const rows = await screen.findAllByTestId(/^inbox-row-/);
  fireEvent.contextMenu(rows[0]!, { clientX: 10, clientY: 10 });
  const open_ = within(await menu()).getByRole('menuitem', { name: /^Open / });
  const name = open_.textContent!.replace(/^Open /, '');
  await act(async () => { fireEvent.click(await item('Copy skill name')); });
  expect(copy).toHaveBeenCalledWith(name);
  fireEvent.contextMenu(rows[0]!, { clientX: 10, clientY: 10 });
  fireEvent.click(within(await menu()).getByRole('menuitem', { name: /^Open / }));
  expect(location.hash).toBe('#/skill/' + encodeURIComponent(name));
});

it('a member row copies the handle and opens the profile', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  open('#/share');
  const row = await screen.findByTestId('member-row-0');
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  expect(await names()).toEqual(['Open profile', 'Copy handle', 'Copy name']);
  await act(async () => { fireEvent.click(await item('Copy handle')); });
  const handle = copy.mock.calls.at(-1)![0];
  expect(design.ROSTER.some(member => member.handle === handle)).toBe(true);
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  fireEvent.click(await item('Open profile'));
  expect(location.hash).toBe('#/marketplace/people/' + encodeURIComponent(handle));
});

it('the detail title copies the name and install command, and the rail version copies on click', async () => {
  const copy = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  const name = design.DETAIL.name;
  open('#/skill/' + name);
  const title = (await screen.findByRole('heading', { level: 1, name })).closest('.detail-title')!;
  fireEvent.contextMenu(title, { clientX: 10, clientY: 10 });
  const rows = await names();
  expect(rows.slice(0, 2)).toEqual(['Copy name', 'Copy install command']);
  await act(async () => { fireEvent.click(await item('Copy install command')); });
  expect(copy.mock.calls.at(-1)![0]).toMatch(/^npx -y terum-skills@latest install /);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: design.DETAIL.version })); });
  expect(copy).toHaveBeenLastCalledWith(design.DETAIL.version);
});
