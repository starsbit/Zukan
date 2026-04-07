import { test, expect } from '@playwright/test';
import { fillLoginForm, isSetupRequired, resetBrowserState, seedAuthenticatedSession, submitLoginForm, TEST_ADMIN } from './helpers/auth';

test.describe.serial('Route guards', () => {
  test.beforeEach(async ({ page }) => {
    await resetBrowserState(page);
  });

  test('guest can access home and does not see the sidebar', async ({ page }) => {
    const setupRequired = await isSetupRequired();

    await page.goto('/');

    if (setupRequired) {
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Gallery' })).toHaveCount(0);
      return;
    }

    await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
    await expect(page.locator('zukan-login-page')).toBeVisible();
  });

  test('guest is redirected to login when visiting a protected route', async ({ page }) => {
    await page.goto('/browse');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fbrowse$/);
    await expect(page.locator('zukan-login-page')).toBeVisible();
  });

  test('authenticated user can access protected routes and sees the sidebar', async ({ page }) => {
    await page.route('**/api/v1/media/search**', async (route) => {
      await route.fulfill({
        json: {
          items: [],
          total: 0,
          next_cursor: null,
          has_more: false,
          page_size: 20,
        },
      });
    });

    await page.route('**/api/v1/media/timeline**', async (route) => {
      await route.fulfill({
        json: {
          buckets: [],
        },
      });
    });

    await page.route('**/api/v1/albums', async (route) => {
      await route.fulfill({
        json: {
          items: [],
          next_cursor: null,
          has_more: false,
          page_size: 20,
          total: 0,
        },
      });
    });

    await page.route('**/api/v1/albums/example-album', async (route) => {
      await route.fulfill({
        json: {
          id: 'example-album',
          owner_id: 'u1',
          name: 'Example Album',
          description: null,
          access_role: 'owner',
          cover_media_id: null,
          preview_media: [],
          media_count: 0,
          created_at: '2026-03-28T12:00:00Z',
          updated_at: '2026-03-28T12:00:00Z',
          version: 1,
          owner: {
            id: 'u1',
            username: TEST_ADMIN.username,
          },
        },
      });
    });

    await seedAuthenticatedSession(page);
    const sidebar = page.locator('zukan-sidebar');

    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Album' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();

    await page.goto('/album');
    await expect(page).toHaveURL('/album');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('link', { name: 'Album' })).toBeVisible();

    await page.goto('/album/example-album');
    await expect(page).toHaveURL(/\/album(?:\/example-album)?$/);
    await expect(sidebar).toBeVisible();

    await page.goto('/trash');
    await expect(page).toHaveURL('/trash');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();
  });

  test('protected route redirects back after login', async ({ page }) => {
    const setupRequired = await isSetupRequired();
    test.skip(setupRequired, 'Setup not yet completed');

    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        json: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          token_type: 'bearer',
        },
      });
    });

    await page.route(/\/api\/v1\/me(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          id: 'u1',
          username: TEST_ADMIN.username,
          email: TEST_ADMIN.email,
          is_admin: true,
          show_nsfw: false,
          show_sensitive: false,
          tag_confidence_threshold: 0.35,
          version: 1,
          created_at: '2026-03-28T12:00:00Z',
          updated_at: '2026-03-28T12:00:00Z',
        },
      });
    });

    await page.route(/\/api\/v1\/me\/notifications(?:\?.*)?$/, async (route) => {
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

    await page.route(/\/api\/v1\/me\/import-batches(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          items: [],
          total: 0,
          next_cursor: null,
          has_more: false,
          page_size: 20,
        },
      });
    });

    await page.route('**/api/v1/media/search**', async (route) => {
      await route.fulfill({
        json: {
          items: [],
          total: 0,
          next_cursor: null,
          has_more: false,
          page_size: 20,
        },
      });
    });

    await page.route('**/api/v1/media/timeline**', async (route) => {
      await route.fulfill({
        json: {
          buckets: [],
        },
      });
    });

    await page.goto('/trash');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Ftrash$/);

    await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
    await submitLoginForm(page);

    await expect(page).toHaveURL('/trash');
    await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();
  });
});
