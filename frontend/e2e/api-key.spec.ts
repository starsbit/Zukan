import { expect, test, type Page } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() =>
    localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'),
  );

  if (!token) {
    throw new Error('No access token found after authentication');
  }

  return token;
}

async function openAccountSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Account Settings' }).click();
  await expect(page.locator('zukan-user-settings-dialog')).toBeVisible();
}

async function closeAccountSettings(page: Page): Promise<void> {
  await page.locator('mat-dialog-container').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('mat-dialog-container')).toHaveCount(0);
}

test.describe.serial('API key management', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await ensureAdminAuthenticated(page);
  });

  test('create API key - new key is shown with copy button and one-time warning', async ({ page }) => {
    const token = await getAccessToken(page);

    const existingKey = await page.evaluate(async (authToken) => {
      const response = await fetch('/api/v1/me/api-key', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      return response.json() as Promise<{ has_key: boolean }>;
    }, token);

    await openAccountSettings(page);

    const dialog = page.locator('mat-dialog-container');
    const createButton = dialog.getByRole('button', {
      name: existingKey.has_key ? 'Regenerate Key' : 'Create API Key',
    });
    await expect(createButton).toBeEnabled({ timeout: 10000 });
    await createButton.click();

    const codeEl = dialog.locator('code');
    await expect(codeEl).toBeVisible({ timeout: 10000 });

    const keyValue = await codeEl.textContent();
    expect(keyValue).toMatch(/^zk_[0-9a-f]+$/);

    await expect(dialog.getByText('This key is only shown once')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy API key' })).toBeVisible();
    await expect(dialog.getByText('Active')).toBeVisible();
  });

  test('regenerate API key - a new distinct key is returned', async ({ page }) => {
    await openAccountSettings(page);

    const dialog = page.locator('mat-dialog-container');
    const codeEl = dialog.locator('code');

    await expect(dialog.getByRole('button', { name: /Create API Key|Regenerate Key/ })).toBeEnabled({ timeout: 10000 });
    await dialog.getByRole('button', { name: /Create API Key|Regenerate Key/ }).click();

    await expect(codeEl).toBeVisible({ timeout: 10000 });
    const firstKey = await codeEl.textContent();
    expect(firstKey).toMatch(/^zk_[0-9a-f]+$/);

    await dialog.getByRole('button', { name: 'Regenerate Key' }).click();

    await expect.poll(
      async () => {
        const text = await codeEl.textContent();
        return text !== firstKey && /^zk_[0-9a-f]+$/.test(text ?? '');
      },
      { timeout: 10000 },
    ).toBe(true);

    const secondKey = await codeEl.textContent();
    expect(secondKey).toMatch(/^zk_[0-9a-f]+$/);
    expect(secondKey).not.toBe(firstKey);
  });

  test('API key status persists across dialog open/close', async ({ page }) => {
    const token = await getAccessToken(page);

    const keyStatus = await page.evaluate(async (authToken) => {
      const response = await fetch('/api/v1/me/api-key', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      return response.json() as Promise<{ has_key: boolean; created_at: string | null }>;
    }, token);

    expect(keyStatus.has_key).toBe(true);
    expect(keyStatus.created_at).not.toBeNull();

    await openAccountSettings(page);

    const dialog = page.locator('mat-dialog-container');

    await expect(dialog.getByText('Active')).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator('code')).toHaveCount(0);

    await closeAccountSettings(page);

    await page.goto('/');
    await expect(page).toHaveURL('/');

    await openAccountSettings(page);

    await expect(dialog.getByText('Active')).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole('button', { name: 'Regenerate Key' })).toBeVisible({ timeout: 10000 });
  });
});
