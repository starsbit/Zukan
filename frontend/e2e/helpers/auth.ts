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

let rateLimitsDisabledForRun = false;

export async function seedAuthenticatedSession(
  page: Page,
  user: { id?: string; username?: string; email?: string; is_admin?: boolean } = {},
): Promise<void> {
  const profile = {
    id: user.id ?? 'u1',
    username: user.username ?? TEST_ADMIN.username,
    email: user.email ?? TEST_ADMIN.email,
    is_admin: user.is_admin ?? true,
    show_nsfw: false,
    show_sensitive: false,
    tag_confidence_threshold: 0.35,
    version: 1,
    created_at: '2026-03-28T12:00:00Z',
    updated_at: '2026-03-28T12:00:00Z',
  };

  await page.addInitScript(() => {
    localStorage.setItem('zukan_at', 'test-access-token');
    localStorage.setItem('zukan_rt', 'test-refresh-token');
  });

  await page.route('**/api/v1/config/setup-required', async (route) => {
    await route.fulfill({ json: { setup_required: false } });
  });

  await page.route('**/api/v1/me', async (route) => {
    await route.fulfill({ json: profile });
  });

  await page.route('**/api/v1/me/notifications**', async (route) => {
    await route.fulfill({
      json: {
        items: [],
        total: 0,
        next_cursor: null,
        has_more: false,
        page_size: 8,
      },
    });
  });

  await page.route('**/api/v1/config/upload', async (route) => {
    await route.fulfill({
      json: {
        max_batch_size: 300,
        max_upload_size_mb: 50,
      },
    });
  });

  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      json: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
      },
    });
  });

  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('zukan_at', 'test-access-token');
    localStorage.setItem('zukan_rt', 'test-refresh-token');
  });
  await page.goto('/');
}

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
    try {
      await page.waitForURL('/', { timeout: 5000 });
    } catch {
      const setupFinishedElsewhere = !(await isSetupRequired().catch(() => true));
      if (!setupFinishedElsewhere) {
        throw new Error('Setup did not complete and the instance still reports setup_required=true');
      }
    }
    const alreadyAuthenticated = await page.getByRole('button', { name: 'Profile' }).isVisible().catch(() => false);
    if (alreadyAuthenticated) {
      await disableRateLimiting(page);
      return;
    }
    await page.goto('/login');
  }

  await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
  await submitLoginForm(page);
  await page.waitForURL('/');
  await disableRateLimiting(page);
}

async function disableRateLimiting(page: Page): Promise<void> {
  if (rateLimitsDisabledForRun) {
    return;
  }

  const result = await page.evaluate(async () => {
    const accessToken = localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at');
    if (!accessToken) {
      return { ok: false, status: 0, body: 'missing access token' };
    }

    const response = await fetch('/api/v1/admin/app-config', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_register_rate_limit_requests: 0,
        auth_register_rate_limit_window_seconds: 0,
        auth_login_rate_limit_requests: 0,
        auth_login_rate_limit_window_seconds: 0,
        auth_refresh_rate_limit_requests: 0,
        auth_refresh_rate_limit_window_seconds: 0,
        upload_rate_limit_requests: 0,
        upload_rate_limit_window_seconds: 0,
      }),
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  });

  if (!result.ok) {
    throw new Error(`Unable to disable backend rate limiting for e2e: ${result.status} ${result.body}`);
  }

  rateLimitsDisabledForRun = true;
}
