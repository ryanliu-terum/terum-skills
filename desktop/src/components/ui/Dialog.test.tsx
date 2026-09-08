import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';

afterEach(() => {
  cleanup();
  location.hash = '';
});

it('keeps main accessible while the Shell-local remove dialog traps focus and dismisses', async () => {
  const user = userEvent.setup();
  location.hash = '#/skill/deploy-check?dialog=remove';
  render(<Providers><App /></Providers>);

  const dialog = await screen.findByRole('dialog');
  const main = screen.getByRole('main');
  expect(main).toBeInTheDocument();
  expect(main).not.toHaveAttribute('aria-hidden');
  expect(main.closest('[aria-hidden="true"], [inert]')).toBeNull();
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog.closest('.shell')).toBe(main.closest('.shell'));
  expect(main).not.toContainElement(dialog);

  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  const remove = within(dialog).getByRole('button', { name: 'Remove' });
  await waitFor(() => expect(dialog).toHaveFocus());
  await user.tab();
  expect(cancel).toHaveFocus();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await user.tab({ shift: true });
  expect(remove).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.tab();
  expect(remove).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(location.hash).toBe('#/skill/deploy-check');

  await user.click(screen.getByRole('button', { name: 'Remove from Global' }));
  const reopened = await screen.findByRole('dialog');
  await waitFor(() => expect(reopened).toHaveFocus());
  await user.tab({ shift: true });
  expect(within(reopened).getByRole('button', { name: 'Remove' })).toHaveFocus();
  const backdrop = reopened.parentElement?.querySelector('.dialog-backdrop');
  expect(backdrop).toBeInstanceOf(HTMLElement);
  await user.click(backdrop as HTMLElement);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(location.hash).toBe('#/skill/deploy-check');
  expect(screen.getByRole('main')).toBe(main);
});
