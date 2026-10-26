import { expect, test } from '@playwright/test';
import {
  API_BASE,
  TEST_ADMIN,
  ensureAdminAuthenticated,
  fillLoginForm,
  fillPasswordFields,
  isSetupRequired,
  submitLoginForm,
} from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

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
  // await page.locator('zukan-register-form input[formcontrolname="email"]').fill(user.email);
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
  test('serves installability assets for the production PWA shell', async ({ page, request }) => {
    const manifestResponse = await request.get('/manifest.webmanifest');
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({
      name: 'Zukan',
      display: 'standalone',
      start_url: '/',
    });

    const serviceWorkerResponse = await request.get('/ngsw-worker.js');
    expect(serviceWorkerResponse.ok()).toBeTruthy();
    expect(serviceWorkerResponse.headers()['content-type'] ?? '').toContain('javascript');

    const shellResponse = await page.goto('/');
    expect(shellResponse?.ok()).toBeTruthy();

    await expect.poll(async () =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.scriptURL ?? registration?.installing?.scriptURL ?? null;
      }),
    ).toContain('/ngsw-worker.js');
  });
});
