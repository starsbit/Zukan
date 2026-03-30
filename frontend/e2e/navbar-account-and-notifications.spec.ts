import { expect, test } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() =>
    localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'),
  );

  if (!token) {
    throw new Error('No access token found after authentication');
  }

  return token;
}

test.describe.serial('Navbar account settings and notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('account settings opens a Material dialog and saves user settings to the backend', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('button', { name: 'Account Settings' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();

    const nsfwCheckbox = page.getByRole('checkbox', { name: 'Show NSFW content' });
    const thresholdInput = page.getByLabel('Tag Confidence Threshold');
    await nsfwCheckbox.check();
    await thresholdInput.fill('0.61');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);

    const token = await getAccessToken(page);
    const me = await page.evaluate(async (accessToken) => {
      const response = await fetch('/api/v1/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return response.json();
    }, token) as { show_nsfw: boolean; tag_confidence_threshold: number };

    expect(me.show_nsfw).toBe(true);
    expect(me.tag_confidence_threshold).toBe(0.61);
  });

  test('notifications menu reflects the backend response', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const token = await getAccessToken(page);
    const notifications = await page.evaluate(async (accessToken) => {
      const response = await fetch('/api/v1/me/notifications?page_size=8', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return response.json();
    }, token) as {
      items: Array<{ title: string; body: string }>;
      total: number;
    };

    await page.getByRole('button', { name: 'Notifications' }).click();

    if (notifications.items.length === 0) {
      await expect(page.getByText('No notifications yet.')).toBeVisible();
    } else {
      await expect(page.getByText(notifications.items[0].title)).toBeVisible();
      await expect(page.getByText(notifications.items[0].body)).toBeVisible();
    }
  });
});
