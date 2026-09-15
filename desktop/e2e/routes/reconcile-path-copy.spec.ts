import { test, expect } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

// UI policy §2 (2026-09-14 review): a path in the Library's Sync dialog ("Check against the team" before 0.19.0) is click-to-copy and sits beside a checkbox.
// Blink forwards a click on a role=button span inside a <label> to the label's control — jsdom does not — so only a
// real engine can prove that copying a path never toggles whether that folder is published. The path renders as a
// sibling of the label, and CopyValue cancels the default; both are exercised here.
test('copying a path in the Sync dialog never toggles its row', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await prepare(page, { name: 'Reconcile path copy', route: '#/library/global', klass: 'dialog', width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Sync' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sync' });
  await expect(dialog).toBeVisible();
  const boxes = dialog.getByRole('checkbox');
  const count = await boxes.count();
  expect(count).toBeGreaterThan(0);
  const before: (string | null)[] = [];
  for (let i = 0; i < count; i++) before.push(await boxes.nth(i).getAttribute('aria-checked'));
  const paths = dialog.locator('.reconcile-path .copy-value');
  expect(await paths.count()).toBe(count);
  for (let i = 0; i < count; i++) {
    await paths.nth(i).click();
    await expect(page.locator('.copy-toast')).toHaveText('Copied path');
    for (let j = 0; j < count; j++) expect(await boxes.nth(j).getAttribute('aria-checked')).toBe(before[j]);
  }
});
