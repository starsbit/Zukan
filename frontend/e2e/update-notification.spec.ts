import { expect, test } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

const FAKE_UPDATE_NOTIFICATION = {
  id: 'notif-update-1',
  user_id: 'u1',
  type: 'app_update',
  title: 'Zukan 9.9.9 is available',
  body: 'Zukan 9.9.9 is available. You are running 1.0.0.',
  is_read: false,
  link_url: 'https://github.com/starsbit/zukan/releases/tag/v9.9.9',
  data: {
    announcement_id: 'ann-1',
    severity: 'info',
    version: '9.9.9',
    starts_at: null,
    ends_at: null,
  },
  created_at: new Date().toISOString(),
};

test.describe('Update notification - admin flow', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page, { is_admin: true });
  });

  test('shows Update Now and Dismiss buttons for admin on app_update notification', async ({ page }) => {
    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [FAKE_UPDATE_NOTIFICATION],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 8,
        },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();

    await expect(page.getByText('Zukan 9.9.9 is available')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update Now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });

  test('Update Now opens a confirmation dialog', async ({ page }) => {
    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [FAKE_UPDATE_NOTIFICATION],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 8,
        },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('button', { name: 'Update Now' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/pull the latest images/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update Now' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('cancelling the confirmation dialog closes it without calling the API', async ({ page }) => {
    let updateCalled = false;
    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [FAKE_UPDATE_NOTIFICATION],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 8,
        },
      });
    });
    await page.route('**/api/v1/admin/update', async (route) => {
      updateCalled = true;
      await route.fulfill({ status: 202, json: { message: 'Update initiated' } });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('button', { name: 'Update Now' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(updateCalled).toBe(false);
  });

  test('confirming the update calls POST /admin/update and shows a snackbar', async ({ page }) => {
    let updateCallCount = 0;
    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [FAKE_UPDATE_NOTIFICATION],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 8,
        },
      });
    });
    await page.route(`**/api/v1/me/notifications/${FAKE_UPDATE_NOTIFICATION.id}/read`, async (route) => {
      await route.fulfill({
        json: { ...FAKE_UPDATE_NOTIFICATION, is_read: true },
      });
    });
    await page.route('**/api/v1/admin/update', async (route) => {
      updateCallCount++;
      await route.fulfill({ status: 202, json: { message: 'Update initiated' } });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('button', { name: 'Update Now' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    // Click the confirm button inside the dialog (last "Update Now" in the DOM)
    await page.getByRole('dialog').getByRole('button', { name: 'Update Now' }).click();

    await expect(page.getByText(/update in progress/i)).toBeVisible();
    expect(updateCallCount).toBe(1);
  });

  test('Dismiss marks notification as read and removes it from the list', async ({ page }) => {
    let markReadCalled = false;
    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [FAKE_UPDATE_NOTIFICATION],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 8,
        },
      });
    });
    await page.route(`**/api/v1/me/notifications/${FAKE_UPDATE_NOTIFICATION.id}/read`, async (route) => {
      markReadCalled = true;
      await route.fulfill({
        json: { ...FAKE_UPDATE_NOTIFICATION, is_read: true },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('button', { name: 'Dismiss' }).click();

    await expect(page.getByText('Zukan 9.9.9 is available')).toHaveCount(0);
    expect(markReadCalled).toBe(true);
  });

  test('non-admin user does not see Update Now button on app_update notification', async ({ page }) => {
    await seedAuthenticatedSession(page, { is_admin: false });

    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [FAKE_UPDATE_NOTIFICATION],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 8,
        },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();

    await expect(page.getByText('Zukan 9.9.9 is available')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update Now' })).toHaveCount(0);
    // Non-admin sees the generic "Mark as read" button instead
    await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible();
  });
});
