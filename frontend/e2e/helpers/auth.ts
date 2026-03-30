import { Page } from '@playwright/test';

/**
 * In Docker e2e mode, API_BASE_URL equals the frontend URL because nginx
 * proxies /api/ -> backend. In local dev mode, set API_BASE_URL=http://localhost:8000.
 */
export const API_BASE =
  process.env['API_BASE_URL'] ??
  process.env['PLAYWRIGHT_TEST_BASE_URL'] ??
  'http://localhost:8000';

export const TEST_ADMIN = {
  username: 'e2e_admin',
  email: 'e2e_admin@example.com',
  password: 'E2ePassword1!',
};

export async function isSetupRequired(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/v1/config/setup-required`);
  const data = await res.json() as { setup_required: boolean };
  return data.setup_required;
}

export async function fillLoginForm(page: Page, username: string, password: string): Promise<void> {
  const loginForm = page.locator('zukan-login-form');
  await loginForm.getByLabel('Username').fill(username);
  // Use getByRole to avoid matching the "Show password" aria-label on the toggle button.
  await loginForm.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
}

export async function setRememberMe(page: Page, rememberMe: boolean): Promise<void> {
  const checkbox = page.locator('zukan-login-form').getByRole('checkbox', { name: 'Remember me' });
  if ((await checkbox.isChecked()) !== rememberMe) {
    await checkbox.click();
  }
}

export async function submitLoginForm(page: Page): Promise<void> {
  await page.locator('zukan-login-form').getByRole('button', { name: 'Sign In' }).click();
}

export async function fillPasswordFields(
  page: Page,
  host: string,
  password: string,
  confirm: string,
): Promise<void> {
  await page.locator(`${host} input[formcontrolname="password"]`).fill(password);
  await page.locator(`${host} input[formcontrolname="confirmPassword"]`).fill(confirm);
}

export async function ensureAdminAuthenticated(page: Page): Promise<void> {
  const setupRequired = await isSetupRequired();

  await page.goto('/login');

  if (setupRequired) {
    await page.locator('zukan-setup-wizard input[formcontrolname="username"]').fill(TEST_ADMIN.username);
    await page.locator('zukan-setup-wizard input[formcontrolname="email"]').fill(TEST_ADMIN.email);
    await fillPasswordFields(page, 'zukan-setup-wizard', TEST_ADMIN.password, TEST_ADMIN.password);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Complete Setup' }).click();
    await page.waitForURL('/');
    const alreadyAuthenticated = await page.getByRole('button', { name: 'Profile' }).isVisible().catch(() => false);
    if (alreadyAuthenticated) {
      return;
    }

    await page.goto('/login');
  }

  await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
  await submitLoginForm(page);
  await page.waitForURL('/');
}
