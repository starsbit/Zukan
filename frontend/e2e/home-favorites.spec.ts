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
  patchRequests: Array<Record<string, unknown>>;
}> {
  const patchRequests: Array<Record<string, unknown>> = [];
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

  await page.route('**/api/v1/media', async (route: Route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const body = await route.request().postDataJSON() as Record<string, unknown>;
    patchRequests.push(body);
    await route.fulfill({
      json: { processed: 1, skipped: 0 },
    });
  });

  return { patchRequests };
}
async function revealFavoriteButton(page: Page): Promise<{
  ariaPressed: string | null;
  iconText: string | null;
}> {
  return page.evaluate(() => {
    const card = document.querySelector('.media-card') as HTMLElement | null;
    card?.dispatchEvent(new Event('mouseenter'));
    card?.dispatchEvent(new FocusEvent('focusin'));
    const button = document.querySelector('.media-card__favorite-button') as HTMLButtonElement | null;
    return {
      ariaPressed: button?.getAttribute('aria-pressed') ?? null,
      iconText: button?.querySelector('mat-icon')?.textContent?.trim() ?? null,
    };
  });
}

async function clickFavoriteButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.querySelector('.media-card__favorite-button') as HTMLButtonElement | null)?.click();
  });
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

    await expect.poll(async () => (await revealFavoriteButton(page)).ariaPressed).toBe('false');
    await expect.poll(async () => (await revealFavoriteButton(page)).iconText).toBe('favorite_border');

    // Click the button — should PATCH the backend
    await clickFavoriteButton(page);

    await expect.poll(() => patchRequests.length, { timeout: 5000 }).toBe(1);
    expect(patchRequests[0]).toEqual({ media_ids: ['m1'], favorited: true });
  });

  test('favorite icon changes to filled heart after clicking', async ({ page }) => {
    await setupHomeMocks(page);
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();
    await expect.poll(async () => (await revealFavoriteButton(page)).ariaPressed).toBe('false');

    // Optimistic update: icon should flip immediately on click
    await clickFavoriteButton(page);
    await expect.poll(() =>
      page.evaluate(() => document.querySelector('.media-card__favorite-button')?.getAttribute('aria-pressed') ?? null),
    ).toBe('true');
    await expect.poll(() =>
      page.evaluate(() => document.querySelector('.media-card__favorite-button mat-icon')?.textContent?.trim() ?? null),
    ).toBe('favorite');
  });

  test('clicking a filled heart unfavorites the item', async ({ page }) => {
    const { patchRequests } = await setupHomeMocks(page, { initiallyFavorited: true });
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();
    await expect.poll(async () => (await revealFavoriteButton(page)).iconText).toBe('favorite');

    await clickFavoriteButton(page);

    await expect.poll(() =>
      page.evaluate(() => document.querySelector('.media-card__favorite-button mat-icon')?.textContent?.trim() ?? null),
    ).toBe('favorite_border');
    await expect.poll(() => patchRequests.length, { timeout: 5000 }).toBe(1);
    expect(patchRequests[0]).toEqual({ media_ids: ['m1'], favorited: false });
  });

  test('clicking the favorite button does not open the media viewer', async ({ page }) => {
    await setupHomeMocks(page);
    await ensureAdminAuthenticated(page);
    await page.goto('/');

    const card = page.locator('.media-card').first();
    await expect(card).toBeVisible();
    await expect.poll(async () => (await revealFavoriteButton(page)).ariaPressed).toBe('false');

    await clickFavoriteButton(page);

    // URL should stay at '/' — no navigation to a detail view
    await expect(page).toHaveURL('/');
  });
});
