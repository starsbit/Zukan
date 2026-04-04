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
    const menuState = await page.evaluate(async (accessToken) => {
      const [notificationsResponse, batchesResponse] = await Promise.all([
        fetch('/api/v1/me/notifications?page_size=8', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        fetch('/api/v1/me/import-batches?page_size=10', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      ]);
      const notifications = await notificationsResponse.json() as {
        items: Array<{ title: string; body: string }>;
      };
      const batchesPayload = await batchesResponse.json() as
        | { items?: Array<{ id: string; created_at: string; type: string }> }
        | Array<{ id: string; created_at: string; type: string }>;
      const batches = Array.isArray(batchesPayload) ? batchesPayload : (batchesPayload.items ?? []);

      const uploadBatches = batches.filter((batch) => batch.type === 'upload').slice(0, 10);
      const reviewTotals = await Promise.all(uploadBatches.map(async (batch) => {
        const response = await fetch(`/api/v1/me/import-batches/${batch.id}/review-items?page_size=1`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const payload = await response.json() as { total: number };
        return payload.total;
      }));

      const unresolvedCount = reviewTotals.reduce((sum, total) => sum + total, 0);
      return {
        notificationItems: notifications.items,
        hasReviewReminder: unresolvedCount > 0,
      };
    }, token) as {
      notificationItems: Array<{ title: string; body: string }>;
      hasReviewReminder: boolean;
    };

    await page.getByRole('button', { name: 'Notifications' }).click();

    if (menuState.hasReviewReminder) {
      await expect(page.getByText('Some uploaded media still need names')).toBeVisible();
      return;
    }

    if (menuState.notificationItems.length === 0) {
      await expect(page.getByText('No notifications yet.')).toBeVisible();
    } else {
      await expect(page.getByText(menuState.notificationItems[0].title)).toBeVisible();
      await expect(page.getByText(menuState.notificationItems[0].body)).toBeVisible();
    }
  });
});
