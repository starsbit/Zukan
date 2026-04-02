import { expect, test } from '@playwright/test';
import {
  API_BASE,
  TEST_ADMIN,
  fillLoginForm,
  fillPasswordFields,
  isSetupRequired,
  submitLoginForm,
} from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

async function completeSetup(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await expect(page.locator('zukan-setup-wizard')).toBeVisible();
  await page.locator('zukan-setup-wizard input[formcontrolname="username"]').fill(TEST_ADMIN.username);
  await page.locator('zukan-setup-wizard input[formcontrolname="email"]').fill(TEST_ADMIN.email);
  await fillPasswordFields(page, 'zukan-setup-wizard', TEST_ADMIN.password, TEST_ADMIN.password);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Complete Setup' }).click();
  await expect(page).toHaveURL('/');
}

async function signOut(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function registerUser(
  page: import('@playwright/test').Page,
  user: { username: string; email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Register' }).click();
  await page.locator('zukan-register-form input[formcontrolname="username"]').fill(user.username);
  await page.locator('zukan-register-form input[formcontrolname="email"]').fill(user.email);
  await fillPasswordFields(page, 'zukan-register-form', user.password, user.password);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.locator('.form-success')).toBeVisible();
}

async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'));
  if (!token) {
    throw new Error('No access token found after login');
  }
  return token;
}

async function getMediaTotal(page: import('@playwright/test').Page, accessToken: string): Promise<number> {
  return page.evaluate(async (token) => {
    const response = await fetch('/api/v1/media/search?page_size=1&include_total=true', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json() as { total: number };
    return payload.total;
  }, accessToken);
}

test.describe.serial('Deployed smoke workflow', () => {
  test('containerized app supports setup, auth, registration, and batch upload', async ({ page }) => {
    const setupRequiredInitially = await isSetupRequired();
    if (setupRequiredInitially) {
      await completeSetup(page);

      await expect.poll(async () => isSetupRequired(), {
        message: `${API_BASE}/api/v1/config/setup-required should turn false after setup`,
      }).toBe(false);

      await signOut(page);
    } else {
      await page.goto('/login');
      await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
      await submitLoginForm(page);
      await expect(page).toHaveURL('/');
      await signOut(page);
    }

    await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
    await submitLoginForm(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();

    await signOut(page);

    const timestamp = Date.now();
    const user = {
      username: `smoke_user_${timestamp}`,
      email: `smoke_${timestamp}@example.com`,
      password: 'SmokePass1!',
    };

    await registerUser(page, user);
    await fillLoginForm(page, user.username, user.password);
    await submitLoginForm(page);
    await expect(page).toHaveURL('/');

    const accessToken = await getAccessToken(page);
    const beforeTotal = await getMediaTotal(page, accessToken);
    const uploadResponses: Array<{ accepted: number }> = [];

    page.on('response', async (response) => {
      if (response.url().endsWith('/api/v1/media') && response.request().method() === 'POST') {
        uploadResponses.push(await response.json() as { accepted: number });
      }
    });

    await page.locator('input[data-upload-kind="files"]').setInputFiles([
      { name: `smoke-${timestamp}-one.png`, mimeType: 'image/png', buffer: PNG_1X1 },
      { name: `smoke-${timestamp}-two.png`, mimeType: 'image/png', buffer: PNG_1X1 },
    ]);
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => uploadResponses.length).toBe(1);
    await expect(page.locator('.status-island')).toContainText('accepted');
    await expect(page.locator('.status-island')).toContainText('request finished');
  });
});
