import { expect, test, type Page, type Route } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

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

const ALL_MEDIA = [
  mediaItem('m-2026-03', '2026-03-15T12:00:00Z'),
  mediaItem('m-2026-01', '2026-01-10T12:00:00Z'),
  mediaItem('m-2025-12', '2025-12-20T12:00:00Z'),
  mediaItem('m-2025-09', '2025-09-05T12:00:00Z'),
  mediaItem('m-2024-06', '2024-06-01T12:00:00Z'),
];

// Timeline always returns all months regardless of filters — this is how the real backend behaves.
const FULL_TIMELINE = {
  buckets: [
    { year: 2026, month: 3, count: 1 },
    { year: 2026, month: 1, count: 1 },
    { year: 2025, month: 12, count: 1 },
    { year: 2025, month: 9, count: 1 },
    { year: 2024, month: 6, count: 1 },
  ],
};

async function registerDateFilterRoutes(
  page: Page,
  searchRequests: URL[],
): Promise<void> {
  await page.route('**/api/v1/media/search**', async (route: Route) => {
    const url = new URL(route.request().url());
    searchRequests.push(url);

    const capturedBefore = url.searchParams.get('captured_before');
    const capturedAfter = url.searchParams.get('captured_after');
    const capturedBeforeYear = url.searchParams.get('captured_before_year');
    const capturedYear = url.searchParams.get('captured_year');
    const capturedMonth = url.searchParams.get('captured_month');
    const capturedDay = url.searchParams.get('captured_day');

    const items = ALL_MEDIA.filter((item) => {
      const t = new Date(item.metadata.captured_at);
      if (capturedBefore && t >= new Date(capturedBefore)) return false;
      if (capturedAfter && t <= new Date(capturedAfter)) return false;
      if (capturedBeforeYear && t.getUTCFullYear() >= Number(capturedBeforeYear)) return false;
      if (capturedYear && t.getUTCFullYear() !== Number(capturedYear)) return false;
      if (capturedMonth && (t.getUTCMonth() + 1) !== Number(capturedMonth)) return false;
      if (capturedDay && t.getUTCDate() !== Number(capturedDay)) return false;
      return true;
    });

    await route.fulfill({
      json: { items, total: items.length, next_cursor: null, has_more: false, page_size: 20 },
    });
  });

  // Timeline always returns the full month list — date range params are intentionally stripped
  // from the timeline request, so this simulates real backend behaviour.
  await page.route('**/api/v1/media/timeline**', async (route: Route) => {
    await route.fulfill({ json: FULL_TIMELINE });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#888"/></svg>',
    });
  });
}

async function openFiltersDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open filters' }).click();
  await expect(page.getByRole('dialog')).toContainText('Search Filters');
}

async function applyFilters(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

// Chrome's datetime-local inputs have a native date-picker UI that blocks fill().
// Setting the value directly via JS is the only reliable cross-platform approach.
async function fillDatetimeLocal(page: Page, formcontrolname: string, value: string): Promise<void> {
  await page.locator(`input[formcontrolname="${formcontrolname}"]`).evaluate(
    (el: HTMLInputElement, v: string) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

test.describe.serial('Gallery date filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('captured_before filter shows only older media without leaving permanent skeletons', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerDateFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');

    // Wait for initial load — all 5 items visible
    await expect(page.locator('.media-card')).toHaveCount(5, { timeout: 10000 });

    // Apply captured_before to see only media from before 2026
    await openFiltersDialog(page);
    await fillDatetimeLocal(page, 'capturedBefore', '2026-01-01T00:00');
    await applyFilters(page);

    // Verify the search request carries the filter param
    await expect.poll(
      () => searchRequests.some((r) => r.searchParams.get('captured_before') === '2026-01-01T00:00'),
      { timeout: 8000 },
    ).toBe(true);

    // Only 3 items from before 2026 should be visible
    await expect(page.locator('.media-card')).toHaveCount(3, { timeout: 8000 });

    // No skeleton placeholders should linger — months without matching data must not show skeletons
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 8000 });
  });

  test('captured_after filter shows only newer media without leaving permanent skeletons', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerDateFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.locator('.media-card')).toHaveCount(5, { timeout: 10000 });

    await openFiltersDialog(page);
    await fillDatetimeLocal(page, 'capturedAfter', '2025-12-31T23:59');
    await applyFilters(page);

    await expect.poll(
      () => searchRequests.some((r) => r.searchParams.get('captured_after') === '2025-12-31T23:59'),
      { timeout: 8000 },
    ).toBe(true);

    // Only 2026 items match
    await expect(page.locator('.media-card')).toHaveCount(2, { timeout: 8000 });
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 8000 });
  });

  test('captured_before_year filter shows only older media without leaving permanent skeletons', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerDateFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.locator('.media-card')).toHaveCount(5, { timeout: 10000 });

    await openFiltersDialog(page);
    await page.getByLabel('Captured Before Year').fill('2025');
    await applyFilters(page);

    await expect.poll(
      () => searchRequests.some((r) => r.searchParams.get('captured_before_year') === '2025'),
      { timeout: 8000 },
    ).toBe(true);

    // Only the 2024 item qualifies (captured_before_year=2025 means year < 2025)
    await expect(page.locator('.media-card')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 8000 });
  });

  test('captured_year filter shows only media from that year without leaving permanent skeletons', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerDateFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.locator('.media-card')).toHaveCount(5, { timeout: 10000 });

    await openFiltersDialog(page);
    await page.getByLabel('Captured Year').fill('2025');
    await applyFilters(page);

    await expect.poll(
      () => searchRequests.some((r) => r.searchParams.get('captured_year') === '2025'),
      { timeout: 8000 },
    ).toBe(true);

    // 2025-12 and 2025-09 match
    await expect(page.locator('.media-card')).toHaveCount(2, { timeout: 8000 });
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 8000 });
  });

  test('captured_year + captured_month filter shows only that specific month', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerDateFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.locator('.media-card')).toHaveCount(5, { timeout: 10000 });

    await openFiltersDialog(page);
    await page.getByLabel('Captured Year').fill('2025');
    await page.getByLabel('Captured Month').fill('12');
    await applyFilters(page);

    await expect.poll(
      () => searchRequests.some(
        (r) => r.searchParams.get('captured_year') === '2025' && r.searchParams.get('captured_month') === '12',
      ),
      { timeout: 8000 },
    ).toBe(true);

    await expect(page.locator('.media-card')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 8000 });
  });

  test('date filter with no matching results shows empty state instead of endless skeletons', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerDateFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.locator('.media-card')).toHaveCount(5, { timeout: 10000 });

    // Filter to a time range with no media — before the earliest item
    await openFiltersDialog(page);
    await fillDatetimeLocal(page, 'capturedBefore', '2020-01-01T00:00');
    await applyFilters(page);

    await expect.poll(
      () => searchRequests.some((r) => r.searchParams.get('captured_before') === '2020-01-01T00:00'),
      { timeout: 8000 },
    ).toBe(true);

    // No results should clear cards and skeletons even if the timeline rail still has historical buckets
    await expect(page.locator('.media-browser__day--skeleton')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.media-card')).toHaveCount(0);
  });
});
