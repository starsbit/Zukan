import { expect, test, type Page, type Route } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

function mediaItem(id: string, isFavorited = false) {
  return {
    id,
    uploader_id: 'u1',
    owner_id: 'u1',
    visibility: 'public',
    filename: `${id}.jpg`,
    original_filename: null,
    media_type: 'image',
    metadata: {
      file_size: 100,
      width: 1200,
      height: 800,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: '2026-03-28T12:00:00Z',
    },
    version: 1,
    created_at: '2026-03-28T12:00:00Z',
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: 'done',
    tagging_error: null,
    thumbnail_status: 'done',
    poster_status: 'not_applicable',
    ocr_text: null,
    is_favorited: isFavorited,
  };
}

async function setupHomeMocks(page: Page, options: { initiallyFavorited?: boolean } = {}): Promise<{
  patchRequests: Array<{ id: string; body: Record<string, unknown> }>;
}> {
  const patchRequests: Array<{ id: string; body: Record<string, unknown> }> = [];
  const { initiallyFavorited = false } = options;

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [mediaItem('m1', initiallyFavorited)],
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 20,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route: Route) => {
    await route.fulfill({
      json: { buckets: [{ year: 2026, month: 3, count: 1 }] },
    });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  await page.route('**/api/v1/media/m1', async (route: Route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const body = await route.request().postDataJSON() as Record<string, unknown>;
    patchRequests.push({ id: 'm1', body });
    await route.fulfill({
      json: { ...mediaItem('m1', body['favorited'] as boolean) },
    });
  });

  return { patchRequests };
}

test.describe.serial('Home page favorites', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('favorite button appears on card hover and emits a PATCH to the backend', async ({ page }) => {
    const { patchRequests } = await setupHomeMocks(page);
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();

    // No favorite button before hover
    await expect(page.locator('.media-card__favorite-button')).toHaveCount(0);

    // Hover reveals the favorite button
    await card.hover();
    const favBtn = page.locator('.media-card__favorite-button');
    await expect(favBtn).toBeVisible();
    await expect(favBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(favBtn.locator('mat-icon')).toHaveText('favorite_border');

    // Click the button — should PATCH the backend
    await favBtn.click();

    await expect.poll(() => patchRequests.length, { timeout: 5000 }).toBe(1);
    expect(patchRequests[0]?.body['favorited']).toBe(true);
  });

  test('favorite icon changes to filled heart after clicking', async ({ page }) => {
    await setupHomeMocks(page);
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();
    await card.hover();

    const favBtn = page.locator('.media-card__favorite-button');
    await expect(favBtn).toBeVisible();

    // Optimistic update: icon should flip immediately on click
    await favBtn.click();
    await expect(favBtn.locator('mat-icon')).toHaveText('favorite');
    await expect(favBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking a filled heart unfavorites the item', async ({ page }) => {
    const { patchRequests } = await setupHomeMocks(page, { initiallyFavorited: true });
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();
    await card.hover();

    const favBtn = page.locator('.media-card__favorite-button');
    await expect(favBtn).toBeVisible();
    await expect(favBtn.locator('mat-icon')).toHaveText('favorite');

    await favBtn.click();

    await expect(favBtn.locator('mat-icon')).toHaveText('favorite_border');
    await expect.poll(() => patchRequests.length, { timeout: 5000 }).toBe(1);
    expect(patchRequests[0]?.body['favorited']).toBe(false);
  });

  test('clicking the favorite button does not open the media viewer', async ({ page }) => {
    await setupHomeMocks(page);
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();
    await card.hover();

    await page.locator('.media-card__favorite-button').click();

    // URL should stay at '/' — no navigation to a detail view
    await expect(page).toHaveURL('/');
  });
});
