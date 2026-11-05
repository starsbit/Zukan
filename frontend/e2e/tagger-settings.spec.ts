import { expect, test } from '@playwright/test';
import { resetBrowserState, seedAuthenticatedSession } from './helpers/auth';

const options = [
  { id: 'wd_v3', label: 'WD ViT Tagger v3', description: 'The default tagger.', download_size_bytes: 380000000 },
  {
    id: 'pixai_v1_336_int8',
    label: 'PixAI v1.0 336px INT8',
    description: 'Community fine-tune of PixAI Tagger v1.0.',
    download_size_bytes: 494000000,
  },
];
const status = (overrides: Record<string, unknown> = {}) => ({
  active: 'wd_v3',
  status: 'ready',
  target: null,
  error: null,
  execution_provider: 'CPUExecutionProvider',
  options,
  ...overrides,
});

test('owner can switch tagger without starting a retag', async ({ page }) => {
  let current = status();
  let retagRequests = 0;
  let putBody: unknown = null;

  await page.route('**/api/v1/admin/tagging-jobs', async (route) => {
    retagRequests += 1;
    await route.fulfill({ status: 202, json: { queued: 0 } });
  });
  await page.route('**/api/v1/admin/tagger', async (route) => {
    if (route.request().method() === 'PUT') {
      putBody = route.request().postDataJSON();
      current = status({ status: 'loading', target: 'pixai_v1_336_int8' });
      await route.fulfill({ status: 202, json: current });
      current = status({ active: 'pixai_v1_336_int8' });
      return;
    }
    await route.fulfill({ json: current });
  });

  await resetBrowserState(page);
  await seedAuthenticatedSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Owner preferences' }).click();

  const dialog = page.locator('mat-dialog-container');
  await expect(dialog.getByText('Active: WD ViT Tagger v3 (CPU)')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Switch tagger' })).toBeDisabled();

  await dialog.getByRole('combobox', { name: 'Tagger model' }).click();
  await page.getByRole('option', { name: 'PixAI v1.0 336px INT8' }).click();
  await dialog.getByRole('button', { name: 'Switch tagger' }).click();

  await expect(dialog.getByText('Active: PixAI v1.0 336px INT8 (CPU)')).toBeVisible();
  expect(putBody).toEqual({ backend: 'pixai_v1_336_int8' });
  expect(retagRequests).toBe(0);
});
