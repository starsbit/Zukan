import { expect, test, type Page, type Route } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

function mediaItem(id: string, capturedAt: string, width = 1200, height = 800) {
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
      width,
      height,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: capturedAt,
    },
    version: 1,
    created_at: capturedAt,
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: 'done',
    tagging_error: null,
    thumbnail_status: 'done',
    poster_status: 'not_applicable',
    ocr_text: null,
    is_favorited: false,
  };
}

/** Register route mocks and expose a call-count helper on the page. */
async function registerGalleryRoutes(page: Page): Promise<void> {
  let searchRequests = 0;

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    searchRequests += 1;
    const url = new URL(route.request().url());
    const after = url.searchParams.get('after');

    await route.fulfill({
      json: {
        items: after === 'cursor-1'
          ? [
            mediaItem('m7', '2025-01-10T12:00:00Z', 1200, 800),
            mediaItem('m8', '2025-01-10T11:00:00Z', 900, 900),
            mediaItem('m9', '2024-06-15T12:00:00Z', 1400, 900),
            mediaItem('m10', '2024-06-15T11:00:00Z', 1000, 1000),
            mediaItem('m11', '2023-05-10T12:00:00Z', 1200, 800),
            mediaItem('m12', '2023-05-10T11:00:00Z', 900, 1300),
            mediaItem('m13', '2022-04-10T12:00:00Z', 1500, 1000),
            mediaItem('m14', '2021-02-08T12:00:00Z', 1100, 900),
            mediaItem('m15', '2020-01-05T12:00:00Z', 1500, 900),
          ]
          : [
            mediaItem('m1', '2026-09-12T12:00:00Z', 1200, 800),
            mediaItem('m2', '2026-09-12T11:00:00Z', 900, 1300),
            mediaItem('m3', '2026-03-28T12:00:00Z', 1400, 900),
            mediaItem('m4', '2026-03-28T11:00:00Z', 1000, 1000),
            mediaItem('m5', '2025-09-10T12:00:00Z', 1500, 900),
            mediaItem('m6', '2025-09-10T11:00:00Z', 800, 1200),
          ],
        total: 15,
        next_cursor: after === 'cursor-1' ? null : 'cursor-1',
        has_more: after !== 'cursor-1',
        page_size: 20,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route: Route) => {
    await route.fulfill({
      json: {
        buckets: [
          { year: 2026, month: 9, count: 2 },
          { year: 2026, month: 3, count: 2 },
          { year: 2025, month: 9, count: 2 },
          { year: 2025, month: 1, count: 2 },
          { year: 2024, month: 6, count: 2 },
          { year: 2023, month: 5, count: 2 },
          { year: 2022, month: 4, count: 1 },
          { year: 2021, month: 2, count: 1 },
          { year: 2020, month: 1, count: 1 },
        ],
      },
    });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_1X1,
    });
  });

  await page.exposeFunction('__gallerySearchRequests', () => searchRequests);
}

test.describe.serial('Gallery timeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('renders skeleton sections for all timeline months immediately on load', async ({ page }) => {
    // Delay search responses so we can observe the skeleton state before data arrives
    let resolveFirstSearch!: () => void;
    const firstSearchHeld = new Promise<void>((resolve) => { resolveFirstSearch = resolve; });

    await page.route('**/api/v1/media/search**', async (route: Route) => {
      await firstSearchHeld;
      await route.fulfill({
        json: {
          items: [mediaItem('m1', '2026-09-12T12:00:00Z')],
          total: 1,
          next_cursor: null,
          has_more: false,
          page_size: 20,
        },
      });
    });

    await page.route('**/api/v1/media/timeline**', async (route: Route) => {
      await route.fulfill({
        json: {
          buckets: [
            { year: 2026, month: 9, count: 2 },
            { year: 2025, month: 3, count: 3 },
            { year: 2024, month: 1, count: 1 },
          ],
        },
      });
    });

    await ensureAdminAuthenticated(page);
    await page.goto('/');

    // All three skeleton sections should be visible before any search page arrives
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(3);
    expect(await page.locator('.media-browser__skeleton-card').count()).toBeGreaterThan(0);

    // Unblock search — skeleton sections should be replaced by real content
    resolveFirstSearch();
    await expect(page.locator('.media-browser__day--skeleton')).not.toHaveCount(3);
  });

  test('auto-fetches all pages without user scrolling', async ({ page }) => {
    await registerGalleryRoutes(page);
    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');

    // Both pages should be fetched automatically (no scroll needed)
    await expect.poll(
      () => page.evaluate(() => (window as typeof window & { __gallerySearchRequests: () => number }).__gallerySearchRequests()),
      { timeout: 10000 },
    ).toBeGreaterThan(1);

    // All skeleton sections should eventually be replaced
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 10000 });
  });

  test('uses a full-height rail, tracks bottom progress, and jumps to any month instantly', async ({ page }) => {
    await registerGalleryRoutes(page);
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');
    await page.goto('/');
    await expect(page).toHaveURL('/');

    const content = page.locator('.media-browser__content');
    const timeline = page.locator('.media-timeline');
    const activeMonth = page.locator('.media-timeline__month--active').first();

    await expect(content).toBeVisible();
    await expect(timeline).toBeVisible();
    await expect(activeMonth).toHaveAttribute('aria-label', 'Sep 2026');

    // Timeline rail height matches content pane height
    const contentBox = await content.boundingBox();
    const timelineBox = await timeline.boundingBox();
    expect(contentBox).not.toBeNull();
    expect(timelineBox).not.toBeNull();
    expect(Math.abs((timelineBox?.height ?? 0) - (contentBox?.height ?? 0))).toBeLessThan(48);

    // Scrolling partway through changes the active chip
    await content.evaluate((node) => {
      node.scrollTop = node.scrollHeight * 0.45;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect(activeMonth).not.toHaveAttribute('aria-label', 'Sep 2026');

    // Clicking a month in the timeline scrolls to it — even before that page is fetched
    await page.getByRole('button', { name: 'Jan 2020' }).click();
    await expect(page.getByRole('heading', { name: 'January 5, 2020' })).toBeInViewport();

    // Scrolling to the bottom keeps the oldest section visible
    await content.evaluate((node) => {
      node.scrollTop = node.scrollHeight - node.clientHeight;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect(page.getByRole('heading', { name: 'January 5, 2020' })).toBeInViewport();
  });

  test('shows empty state when gallery has no media', async ({ page }) => {
    await page.route('**/api/v1/media/search**', async (route: Route) => {
      await route.fulfill({
        json: { items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 },
      });
    });
    await page.route('**/api/v1/media/timeline**', async (route: Route) => {
      await route.fulfill({ json: { buckets: [] } });
    });

    await ensureAdminAuthenticated(page);
    await page.goto('/');

    await expect(page.locator('.media-browser__empty')).toBeVisible();
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0);
  });
});
