import { test, expect } from '@playwright/test';
import { prepare } from '../fidelity/determinism.js';

test('install retains its busy confirmation while waiting for CLI consent', async ({ page }) => {
  await prepare(page, { name: 'Install busy', route: '#/skill/deploy-check?dialog=install&__mock=not-installed', klass: 'dialog', width: 1440, height: 900 });
  const dialog = page.getByRole('dialog', { name: 'Install deploy-check', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  // The CLI consent prompt is nested above the still-mounted busy confirmation.
  const consent = page.getByRole('dialog', { name: 'Approve these tools for deploy-check?' });
  await expect(consent).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Install', exact: true })).toBeDisabled();
  await consent.getByRole('button', { name: 'No', exact: true }).click();
  await expect(consent).not.toBeVisible();
  await expect(dialog).not.toBeVisible();
});
