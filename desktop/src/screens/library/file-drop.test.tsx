import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MachineRemovalProvider } from '../../app/MachineRemovalProvider';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { FileDropEvent } from '../../backend/types';

// A folder dragged from the OS onto the Library adds a project (2026-09-14): the seam's drop stream drives the same
// `projects.add` the chooser does; an overlay names the gesture while a drag hovers and never otherwise.
const backend = createMockBackend();
function open(route: string) { location.hash = route; return render(<Providers><BackendContext value={backend}><MachineRemovalProvider><App/></MachineRemovalProvider></BackendContext></Providers>); }
beforeEach(() => { localStorage.clear(); useUiStore.getState().setTheme('dark'); });
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

function capture() {
  const listeners = new Set<(event: FileDropEvent) => void>();
  vi.spyOn(backend, 'onFileDrop').mockImplementation(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  return { emit: (event: FileDropEvent) => act(() => { for (const listener of listeners) listener(event); }), listeners };
}

it('shows the overlay while a drag hovers and adds each dropped folder', async () => {
  const { emit } = capture();
  const add = vi.spyOn(backend.projects, 'add');
  open('#/library/global');
  await screen.findByText('15 skills');
  expect(screen.queryByText('Drop a folder to add it as a project')).toBeNull();
  await emit({ kind: 'enter', paths: ['~/Projects/new-tool'] });
  expect(screen.getByRole('status')).toHaveTextContent('Drop a folder to add it as a project');
  await emit({ kind: 'leave' });
  expect(screen.queryByText('Drop a folder to add it as a project')).toBeNull();
  await emit({ kind: 'drop', paths: ['~/Projects/new-tool', '~/Projects/other'] });
  await screen.findByText('Added 2 projects');
  expect(add.mock.calls.map(call => call[0])).toEqual(['~/Projects/new-tool', '~/Projects/other']);
  expect(screen.queryByText('Drop a folder to add it as a project')).toBeNull();
});

it('says so when a drop carried no path', async () => {
  const { emit } = capture();
  const add = vi.spyOn(backend.projects, 'add');
  open('#/library/global');
  await screen.findByText('15 skills');
  await emit({ kind: 'drop', paths: [] });
  expect(await screen.findByText('Nothing to add: the drop carried no folder path.')).toBeInTheDocument();
  expect(add).not.toHaveBeenCalled();
});

it('subscribes only while the CLI can add projects, and unsubscribes on unmount', async () => {
  const features = await backend.features();
  vi.spyOn(backend, 'features').mockResolvedValue({ ...features, libraryProjects: false });
  const { listeners } = capture();
  const view = open('#/library/global');
  await screen.findByText('15 skills');
  expect(listeners.size).toBe(0);
  view.unmount(); cleanup(); vi.restoreAllMocks();
  const again = capture();
  const view2 = open('#/library/global');
  await screen.findByText('15 skills');
  expect(again.listeners.size).toBe(1);
  view2.unmount();
  expect(again.listeners.size).toBe(0);
});
