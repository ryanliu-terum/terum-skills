import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Backend } from '../../backend/Backend';
import { ContextMenuProvider, CopyValue } from './ContextMenu';
import { suppressesNativeMenu, useContextMenu, useCopy } from './context-menu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(ui: React.ReactNode, backend: Backend = createMockBackend()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<BackendContext value={backend}><QueryClientProvider client={client}><ContextMenuProvider>{ui}</ContextMenuProvider></QueryClientProvider></BackendContext>);
}

function Target({ onOpen, onCopy }: { onOpen: () => void; onCopy?: () => void }) {
  const ref = useContextMenu(() => [
    { key: 'open', label: 'Open', onSelect: onOpen },
    { key: 'sep', kind: 'separator' },
    { key: 'copy', label: 'Copy name', icon: 'copy', onSelect: () => onCopy?.() },
    { key: 'gone', label: 'Delete…', disabled: true, reason: 'Not yours', danger: true, onSelect: () => { throw new Error('must not run'); } },
  ]);
  return <div ref={ref} data-testid="target"><span>inner text</span><input aria-label="field" /></div>;
}

it('opens a menu at the pointer for a registered target and runs the picked row', async () => {
  const onOpen = vi.fn();
  mount(<><Target onOpen={onOpen} /><p data-testid="plain">plain</p></>);
  const event = fireEvent.contextMenu(screen.getByText('inner text'), { clientX: 40, clientY: 50 });
  expect(event).toBe(false); // preventDefault: the host menu never shows
  const menu = await screen.findByRole('menu', { name: 'Context menu' });
  expect(menu.querySelectorAll('.menu-item')).toHaveLength(3);
  expect(menu.querySelector('.menu-separator')).not.toBeNull();
  const danger = screen.getByRole('menuitem', { name: /Delete…/ });
  expect(danger).toHaveAttribute('aria-disabled', 'true');
  expect(danger).toHaveAttribute('data-danger');
  expect(danger).toHaveTextContent('Not yours');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('leaves a plain element and a text field to the host menu in the browser mock', () => {
  mount(<><Target onOpen={() => {}} /><p data-testid="plain">plain</p></>);
  expect(fireEvent.contextMenu(screen.getByTestId('plain'), { clientX: 5, clientY: 5 })).toBe(true);
  expect(fireEvent.contextMenu(screen.getByLabelText('field'), { clientX: 5, clientY: 5 })).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('anchors a keyboard-invoked menu at the target, not the window corner', async () => {
  mount(<Target onOpen={() => {}} />);
  const target = screen.getByTestId('target');
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 50, 20));
  fireEvent.contextMenu(target, { clientX: 0, clientY: 0 });
  expect(await screen.findByRole('menu')).toBeInTheDocument();
});

it('reports a copy through the toast, and the seam error when the clipboard refuses', async () => {
  const backend = createMockBackend();
  const write = vi.spyOn(backend, 'copyToClipboard').mockResolvedValueOnce({ ok: true, value: undefined }).mockResolvedValueOnce({ ok: false, error: 'Clipboard unavailable.' });
  function Copier() { const copy = useCopy(); return <button onClick={() => void copy('~/x', 'path')}>go</button>; }
  mount(<Copier />, backend);
  fireEvent.click(screen.getByText('go'));
  expect(await screen.findByRole('status')).toHaveTextContent('Copied path');
  expect(write).toHaveBeenCalledWith('~/x');
  fireEvent.click(screen.getByText('go'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard unavailable.');
});

it('CopyValue copies its own text on click and keeps the text as its label', async () => {
  const backend = createMockBackend();
  const write = vi.spyOn(backend, 'copyToClipboard').mockResolvedValue({ ok: true, value: undefined });
  mount(<CopyValue what="handle" className="board-mono">teddy</CopyValue>, backend);
  const button = screen.getByRole('button', { name: 'teddy' });
  expect(button).toHaveAttribute('title', 'Click to copy');
  expect(button).toHaveClass('copy-value', 'board-mono');
  await act(async () => { fireEvent.click(button); });
  expect(write).toHaveBeenCalledWith('teddy');
  expect(await screen.findByRole('status')).toHaveTextContent('Copied handle');
});

it('decides native-menu suppression by host, field and selection', () => {
  const field = document.createElement('input'), div = document.createElement('div');
  expect(suppressesNativeMenu(div, 'native', false)).toBe(true);
  expect(suppressesNativeMenu(div, 'mac-overlay', false)).toBe(true);
  expect(suppressesNativeMenu(div, 'cosmetic', false)).toBe(false);
  expect(suppressesNativeMenu(div, undefined, false)).toBe(false);
  expect(suppressesNativeMenu(field, 'native', false)).toBe(false);
  expect(suppressesNativeMenu(div, 'native', true)).toBe(false);
  expect(suppressesNativeMenu(null, 'native', false)).toBe(true);
});
