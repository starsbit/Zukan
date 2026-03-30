import { test, expect } from '@playwright/test';
import { ensureAdminAuthenticated, fillLoginForm, isSetupRequired, submitLoginForm, TEST_ADMIN } from './helpers/auth';

test.describe.serial('Route guards', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('guest can access home and does not see the sidebar', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL('/');
    await expect(page.getByText('Home')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gallery' })).toHaveCount(0);
  });

  test('guest is redirected to login when visiting a protected route', async ({ page }) => {
    await page.goto('/gallery');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fgallery$/);
    await expect(page.locator('zukan-login-page')).toBeVisible();
  });

  test('authenticated user can access protected routes and sees the sidebar', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    const sidebar = page.locator('zukan-sidebar');

    await page.goto('/gallery');
    await expect(page).toHaveURL('/gallery');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Album' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();

    await page.goto('/album');
    await expect(page).toHaveURL('/album');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('link', { name: 'Album' })).toBeVisible();

    await page.goto('/album/example-album');
    await expect(page).toHaveURL('/album/example-album');
    await expect(sidebar).toBeVisible();

    await page.goto('/trash');
    await expect(page).toHaveURL('/trash');
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();
  });

  test('protected route redirects back after login', async ({ page }) => {
    const setupRequired = await isSetupRequired();
    test.skip(setupRequired, 'Setup not yet completed');

    await page.goto('/trash');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Ftrash$/);

    await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
    await submitLoginForm(page);

    await expect(page).toHaveURL('/trash');
    await expect(page.getByText('Trash')).toBeVisible();
  });
});
