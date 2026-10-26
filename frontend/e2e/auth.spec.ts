import { expect, test } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

test.describe.serial('Single owner workflows', () => {
  test('sets up or signs in the owner and exposes one library', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gacha', exact: true })).toHaveCount(0);
    await expect(page.locator('zukan-register-form')).toHaveCount(0);
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Owner preferences', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Owner preferences' })).toBeVisible();
    await expect(page.getByText('Collection Sharing', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
  test('browses albums, favorites, metadata and maintenance as owner', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await page.goto('/album');
    await expect(page.locator('zukan-album')).toBeVisible();
    await page.goto('/favorites');
    await expect(page.locator('zukan-media-browser')).toBeVisible();
    await page.goto('/tags');
    await expect(page.locator('zukan-metadata-manager-page')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Library maintenance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Backfill embeddings' })).toBeVisible();
    await expect(page.getByText('Discovery owner', { exact: true })).toHaveCount(0);
  });
  test('uploads into the global library and displays albums and favorites', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 20;
      canvas.height = 20;
      const context = canvas.getContext('2d')!;
      context.fillStyle = `rgb(${Date.now() % 255},45,96)`;
      context.fillRect(0, 0, 20, 20);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/media') && r.request().method() === 'POST',
    );
    await page
      .locator('input[data-upload-kind="files"]')
      .setInputFiles({
        name: 'single-owner.png',
        mimeType: 'image/png',
        buffer: Buffer.from(image, 'base64'),
      });
    await page.getByRole('dialog').getByRole('button', { name: 'Upload', exact: true }).click();
    const response = await uploaded;
    expect(response.status()).toBe(202);
    const mid = (await response.json()).results[0].id as string;
    expect(mid).toBeTruthy();
    const album = await page.evaluate(async (mid) => {
      const token = localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at');
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const created = await fetch('/api/v1/albums', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Owner journey album' }),
      });
      const album = await created.json();
      await fetch(`/api/v1/albums/${album.id}/media`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ media_ids: [mid] }),
      });
      const favorite = await fetch(`/api/v1/media/${mid}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ favorited: true }),
      });
      return { id: album.id, favoriteStatus: favorite.status };
    }, mid);
    expect(album.favoriteStatus).toBe(200);
    await page.goto(`/album/${album.id}`);
    await expect(page.getByRole('heading', { name: 'Owner journey album' })).toBeVisible();
    await expect(page.locator('zukan-media-card').first()).toBeVisible();
    await page.goto('/favorites');
    await expect(page.locator('zukan-media-card').first()).toBeVisible();
  });
  test('shows SSO only when installation uses OIDC', async ({ page }) => {
    await page.route('**/api/v1/auth/config', (r) =>
      r.fulfill({ json: { mode: 'oidc', setup_required: false } }),
    );
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();
    await expect(page.locator('zukan-login-form')).toHaveCount(0);
  });
});
