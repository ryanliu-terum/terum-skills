import { afterEach, assert, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Dialog, DialogContainer, DialogDescription, DialogTitle } from '../ui/Dialog';
import { WorkflowDialog } from './WorkflowControls';
import { WorkflowPopup } from './WorkflowPopup';

afterEach(cleanup);

function workflowDialog(width = 440) {
  return <WorkflowDialog
    title="Leave team?"
    body="Your team skills will be removed from this machine."
    primary="Leave team"
    command="npx -y terum-skills@latest team leave"
    close={vi.fn()}
    submit={vi.fn()}
    width={width}
  />;
}

it('uses an absolute flex overlay and a relative popup while keeping the route main accessible', async () => {
  const shell = document.createElement('div');
  document.body.append(shell);
  render(
    <DialogContainer container={shell}>
      <main aria-label="Team settings">Team settings{workflowDialog()}</main>
    </DialogContainer>,
    { container: shell },
  );

  const popup = await screen.findByRole('dialog', { name: 'Leave team?' });
  const overlay = popup.parentElement;
  assert(overlay, 'The workflow popup must have a centering overlay');
  expect(shell).toContainElement(overlay);
  expect(overlay).toHaveStyle({ position: 'absolute', display: 'flex' });
  expect(popup).toHaveStyle({ position: 'relative', transform: 'none' });
  const backdrop = overlay.querySelector('.dialog-backdrop');
  assert(backdrop, 'The workflow overlay must contain a backdrop');
  for (const element of [overlay, backdrop, popup, ...popup.querySelectorAll('*')]) {
    expect(getComputedStyle(element).position, element.outerHTML).not.toBe('fixed');
  }

  const main = screen.getByRole('main', { name: 'Team settings' });
  expect(main).toBeInTheDocument();
  expect(main.closest('[aria-hidden="true"], [inert]')).toBeNull();
  expect(main).not.toContainElement(popup);
  expect(popup).toHaveAttribute('aria-modal', 'true');
});

it('preserves the caller width inside a DialogContainer', async () => {
  const shell = document.createElement('div');
  document.body.append(shell);
  render(<DialogContainer container={shell}>{workflowDialog(520)}</DialogContainer>, { container: shell });

  const popup = await screen.findByRole('dialog', { name: 'Leave team?' });
  expect(shell).toContainElement(popup);
  expect(popup.style.width).toBe('520px');
});

it('focuses the workflow popup itself on open', async () => {
  const shell = document.createElement('div');
  document.body.append(shell);
  render(<DialogContainer container={shell}>{workflowDialog()}</DialogContainer>, { container: shell });

  const popup = await screen.findByRole('dialog', { name: 'Leave team?' });
  expect(popup).toHaveAttribute('tabindex', '-1');
  await waitFor(() => expect(document.activeElement).toBe(popup));
});

it('preserves caller padding and gap while enforcing popup layout invariants', async () => {
  render(
    <Dialog open>
      <WorkflowPopup style={{ padding: 28, gap: 24, position: 'fixed', top: 10, left: 10, transform: 'translateX(10px)' }}>
        <DialogTitle>Custom spacing</DialogTitle>
        <DialogDescription>A popup with caller-defined spacing.</DialogDescription>
      </WorkflowPopup>
    </Dialog>,
  );

  const popup = await screen.findByRole('dialog', { name: 'Custom spacing' });
  expect(popup.style.padding).toBe('28px');
  expect(popup.style.gap).toBe('24px');
  expect(popup.style.position).toBe('relative');
  expect(popup.style.top).toBe('auto');
  expect(popup.style.left).toBe('auto');
  expect(popup.style.transform).toBe('none');
});

it('keeps the shared body portal fallback when no DialogContainer is provided', async () => {
  const { container } = render(<main aria-label="Team settings">{workflowDialog()}</main>);

  const popup = await screen.findByRole('dialog', { name: 'Leave team?' });
  expect(document.body).toContainElement(popup);
  expect(container).not.toContainElement(popup);
  expect(popup.parentElement).toHaveStyle({ position: 'absolute', display: 'flex' });
  expect(popup).toHaveStyle({ position: 'relative', transform: 'none' });
  expect(screen.getByRole('main', { name: 'Team settings' })).toBeInTheDocument();
});

it('waits for a provided container to commit instead of falling back to body', async () => {
  const shell = document.createElement('div');
  document.body.append(shell);
  const { rerender } = render(
    <DialogContainer container={null}>{workflowDialog()}</DialogContainer>,
    { container: shell },
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.querySelector('.dialog-popup')).toBeNull();

  rerender(<DialogContainer container={shell}>{workflowDialog()}</DialogContainer>);
  expect(shell).toContainElement(await screen.findByRole('dialog', { name: 'Leave team?' }));
});
