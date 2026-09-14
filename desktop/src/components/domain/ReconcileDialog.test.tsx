import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext, PrintContext, PromptContext } from '../../backend';
import { createMockBackend, resetMockRemovals } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import type { ReconcileResult } from '../../backend/types';
import { ReconcileDialog } from './ReconcileDialog';
import { useAddLibraryProject } from './useAddLibraryProject';

afterEach(() => { cleanup(); resetMockRemovals(); vi.restoreAllMocks(); });

const result: ReconcileResult = {
  identical: [{ path: '~/.claude/skills/deploy-check', name: 'deploy-check', team: 'terum', skillId: 'deploy-check-id', version: 'v5' }],
  differing: [
    { path: '~/.claude/skills/release-notes', name: 'release-notes', team: 'terum', skillId: 'release-notes-id', teamVersion: 'v2', nextVersion: 'v3', sameId: true, teamAuthor: 'teddy' },
    { path: '~/.claude/skills/pr-review', name: 'pr-review', team: 'terum', skillId: null, teamVersion: 'v4', nextVersion: 'v5', sameId: false, teamAuthor: 'ajayw36' },
  ],
  renamed: [{ path: '~/.claude/skills/old-deploy', name: 'old-deploy', team: 'terum', skillId: 'deploy-check-id', version: 'v5', teamName: 'deploy-check' }],
  adopted: [],
  published: [],
};

function renderDialog(value = result) {
  const backend = createMockBackend();
  const install = vi.spyOn(backend, 'install');
  const publish = vi.spyOn(backend, 'publish');
  const close = vi.fn();
  const finished = vi.fn();
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><PromptContext value={async () => true}><PrintContext value={() => undefined}>
    <ReconcileDialog result={value} onClose={close} onFinished={finished}/>
  </PrintContext></PromptContext></QueryClientProvider></BackendContext>);
  return { backend, install, publish, close, finished };
}

it('defaults identical and same-id rows on, leaves name-only rows off with the rename note, and reports renamed rows', async () => {
  renderDialog();
  const boxes = await screen.findAllByRole('checkbox');
  expect(boxes).toHaveLength(3);
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).toBeChecked();
  expect(boxes[2]).not.toBeChecked();
  // Checking every differing row removes the footnote: nothing is left unchecked to rename.
  fireEvent.click(boxes[2]!);
  expect(screen.queryByText(/rename it first/)).toBeNull();
  fireEvent.click(boxes[2]!);
  // UI policy §6: the rename hint is said once under the group, as a copyable command, not under every unchecked row.
  expect(screen.getByText(/Unchecked folders stay as they are\. To keep one separate from the team’s copy, rename it first:/)).toBeInTheDocument();
  expect(screen.getAllByText(/rename it first/)).toHaveLength(1);
  expect(document.querySelector('.reconcile-footnote .cli-box .board-mono')).toHaveTextContent('npx -y terum-skills@latest skill rename <path> --to <new-name>');
  // UI policy §2: a path is a PathText (full path in the title, root label beside the name), never prose.
  expect(screen.getByTitle('~/.claude/skills/old-deploy')).toBeInTheDocument();
  expect(screen.getByText(/holds the bytes of deploy-check Version 5 under a different folder name; nothing is offered for it\./)).toBeInTheDocument();
  expect(screen.getAllByText('· Global')).toHaveLength(3);
});

it('confirms only checked rows through install adopt and publish, then reports each outcome', async () => {
  const { install, publish, finished } = renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(finished).toHaveBeenCalledOnce());
  expect(install).toHaveBeenCalledOnce();
  expect(install).toHaveBeenCalledWith({ team: 'terum', adopt: '~/.claude/skills/deploy-check' });
  expect(publish).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledWith({ team: 'terum', ref: '~/.claude/skills/release-notes' });
  expect(screen.getByText('Recorded deploy-check.')).toBeInTheDocument();
  expect(screen.getByText('Published release-notes.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
});

it('honors changed checkbox choices, including an explicitly selected name-only publish', async () => {
  const { install, publish, finished } = renderDialog();
  const boxes = await screen.findAllByRole('checkbox');
  fireEvent.click(boxes[0]!);
  fireEvent.click(boxes[1]!);
  fireEvent.click(boxes[2]!);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(finished).toHaveBeenCalledOnce());
  expect(install).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledWith({ team: 'terum', ref: '~/.claude/skills/pr-review' });
});

function ProjectAddHarness() {
  const project = useAddLibraryProject();
  return <><button type="button" disabled={project.busy} onClick={() => void project.add()}>Add project fixture</button>{project.dialog}</>;
}

function renderProjectAdd(backend = createMockBackend()) {
  render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><PromptContext value={async () => true}><PrintContext value={() => undefined}>
    <ProjectAddHarness/>
  </PrintContext></PromptContext></QueryClientProvider></BackendContext>);
  return backend;
}

it('opens the reconcile dialog from project add only when its optional result has rows', async () => {
  const backend = renderProjectAdd();
  const add = vi.spyOn(backend.projects, 'add');
  fireEvent.click(screen.getByRole('button', { name: 'Add project fixture' }));
  expect(await screen.findByRole('dialog', { name: 'Your skills' })).toBeInTheDocument();
  expect(add).toHaveBeenCalledWith('/Users/you/code/new-project');
});

it.each(['empty', 'absent'] as const)('does not open the project reconciliation dialog for an %s result', async kind => {
  const backend = createMockBackend();
  const add = vi.spyOn(backend.projects, 'add').mockImplementation(path => createRun(async () => ({ ok: true, value: {
    path,
    label: 'new-project',
    added: true,
    ...(kind === 'empty' ? { reconcile: { identical: [], differing: [], renamed: [], adopted: [], published: [] } } : {}),
  } })));
  renderProjectAdd(backend);
  fireEvent.click(screen.getByRole('button', { name: 'Add project fixture' }));
  await waitFor(() => expect(add).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add project fixture' })).not.toBeDisabled());
  expect(screen.queryByRole('dialog')).toBeNull();
});
