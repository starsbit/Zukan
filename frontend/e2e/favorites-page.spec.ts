import { expect, test, type Page, type Route } from '@playwright/test';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

function mediaItem(id: string) {
  return {
    id,
    uploader_id: 'u1',
    owner_id: 'u1',
    visibility: 'private',
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
    is_favorited: true,
    favorite_count: 1,
  };
}

async function setupFavoritesMocks(
  page: Page,
  searchRequests: URL[],
  searchResponses: Array<{ items: ReturnType<typeof mediaItem>[]; total: number }>,
): Promise<void> {
  await page.route('**/api/v1/config/setup-required', async (route: Route) => {
    await route.fulfill({
      json: {
        setup_required: false,
      },
    });
  });

  await page.route('**/api/v1/auth/login', async (route: Route) => {
    await route.fulfill({
      json: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
      },
    });
  });

  await page.route('**/api/v1/me', async (route: Route) => {
    await route.fulfill({
      json: {
        id: 'u1',
        username: 'owner',
        email: 'owner@example.com',
        is_admin: false,
        show_nsfw: false,
        tag_confidence_threshold: 0.35,
        version: 1,
        created_at: '2026-03-28T12:00:00Z',
        updated_at: '2026-03-28T12:00:00Z',
      },
    });
  });

  await page.route('**/api/v1/me/notifications**', async (route: Route) => {
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

  await page.route('**/api/v1/config/upload', async (route: Route) => {
    await route.fulfill({
      json: {
        max_batch_size: 300,
        max_upload_size_mb: 50,
      },
    });
  });

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    searchRequests.push(new URL(route.request().url()));
    const response = searchResponses.shift() ?? { items: [], total: 0 };
    await route.fulfill({
      json: {
        items: response.items,
        total: response.total,
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

  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({
      json: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
      },
    });
  });
}

test.describe.serial('Favorites page', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('shows a user-owned favorited item instead of the empty state', async ({ page }) => {
    const searchRequests: URL[] = [];
    await setupFavoritesMocks(page, searchRequests, [{ items: [mediaItem('own-favorite-1')], total: 1 }]);

    await page.goto('/favorites');
    await page.getByLabel('Username').fill('owner');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect.poll(() => searchRequests.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(searchRequests.at(-1)?.searchParams.get('favorited')).toBe('true');

    await expect(page.locator('.media-card').first()).toBeVisible();
    await expect(page.getByText('No favorites yet')).toHaveCount(0);
    await expect(page.getByText('Media you favorite will appear here.')).toHaveCount(0);
  });

  test('shows public and shared-album favorites returned by the backend', async ({ page }) => {
    const searchRequests: URL[] = [];
    const publicFavorite = {
      ...mediaItem('public-favorite-1'),
      uploader_id: 'u2',
      owner_id: 'u2',
      visibility: 'public',
      filename: 'public-favorite-1.jpg',
    };
    const sharedAlbumFavorite = {
      ...mediaItem('shared-album-favorite-1'),
      uploader_id: 'u2',
      owner_id: 'u2',
      visibility: 'private',
      filename: 'shared-album-favorite-1.jpg',
    };
    await setupFavoritesMocks(page, searchRequests, [
      { items: [publicFavorite, sharedAlbumFavorite], total: 2 },
    ]);

    await page.goto('/favorites');
    await page.getByLabel('Username').fill('owner');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect.poll(() => searchRequests.length, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(page.locator('.media-card')).toHaveCount(2);
    await expect(page.getByText('No favorites yet')).toHaveCount(0);
  });

  test('shows the empty state after previously visible favorites lose access', async ({ page }) => {
    const searchRequests: URL[] = [];
    await setupFavoritesMocks(page, searchRequests, [
      { items: [{ ...mediaItem('shared-album-favorite-1'), filename: 'shared-album-favorite-1.jpg' }], total: 1 },
      { items: [], total: 0 },
    ]);

    await page.goto('/favorites');
    await page.getByLabel('Username').fill('owner');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.locator('.media-card')).toHaveCount(1);

    await page.reload();

    await expect.poll(() => searchRequests.length, { timeout: 5000 }).toBeGreaterThan(1);
    await expect(page.locator('.media-card')).toHaveCount(0);
  });
});
