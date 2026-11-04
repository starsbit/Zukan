import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

const MONTHS = [
  { year: 2026, month: 3, count: 500 },
  { year: 2026, month: 2, count: 400 },
  { year: 2026, month: 1, count: 300 },
  { year: 2025, month: 12, count: 200 },
];

const POSITION_TOLERANCE_PX = 5;
const SETTLE_MS = 1500;

interface MockOptions {
  monthDelayMs?: number;
  storyDelayMs?: number;
}

function mediaItem(year: number, month: number, index: number) {
  const id = `n-${year}-${month}-${index}`;
  const day = String(28 - (index % 28)).padStart(2, '0');
  const capturedAt = `${year}-${String(month).padStart(2, '0')}-${day}T12:00:00Z`;
  return {
    id,
    filename: `${id}.png`,
    original_filename: `${id}.png`,
    media_type: 'image',
    metadata: {
      file_size: 100,
      width: index % 3 === 0 ? 900 : 1200,
      height: index % 3 === 0 ? 1200 : 800,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/png',
      captured_at: capturedAt,
    },
    version: 1,
    uploaded_at: capturedAt,
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
    favorite_count: 0,
  };
}

function hash(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function layerScroller(page: Page): Locator {
  return page.locator('zukan-media-inspector-page');
}

async function scrollLayerTo(page: Page, top: number): Promise<number> {
  return layerScroller(page).evaluate((node, value) => {
    node.scrollTop = value;
    return node.scrollTop;
  }, top);
}

async function openSimilar(page: Page, index: number): Promise<string> {
  const card = page.locator('zukan-similar-media-grid zukan-media-card').nth(index);
  await card.scrollIntoViewIfNeeded();
  const mediaId = (await card.getAttribute('data-media-id'))!;
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/media/${mediaId}`));
  await expect(page.locator('zukan-media-inspector-dialog')).toContainText(`${mediaId}.png`);
  return mediaId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerRoutes(page: Page, options: MockOptions = {}) {
  const library = new Map(
    MONTHS.map(({ year, month, count }) => [
      `${year}-${month}`,
      Array.from({ length: count }, (_, index) => mediaItem(year, month, index)),
    ]),
  );
  const counters = { monthRequests: 0 };

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    const year = params.get('captured_year');
    const month = params.get('captured_month');
    const pageSize = Number(params.get('page_size') ?? 160);

    if (!year || !month) {
      await delay(options.storyDelayMs ?? 0);
      const items = Array.from({ length: 6 }, (_, index) => mediaItem(2024, 3, index));
      await route.fulfill({
        json: { items, total: 6, next_cursor: null, has_more: false, page_size: pageSize },
      });
      return;
    }

    counters.monthRequests += 1;
    await delay(options.monthDelayMs ?? 0);
    const items = library.get(`${year}-${Number(month)}`) ?? [];
    const offset = Number(params.get('after') ?? 0);
    const next = offset + pageSize;
    await route.fulfill({
      json: {
        items: items.slice(offset, next),
        total: items.length,
        next_cursor: next < items.length ? String(next) : null,
        has_more: next < items.length,
        page_size: pageSize,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route: Route) => {
    await route.fulfill({ json: { buckets: MONTHS } });
  });

  await page.route('**/api/v1/media/*/similar**', async (route: Route) => {
    const url = new URL(route.request().url());
    const seed = url.pathname.split('/').slice(-2)[0]!;
    const offset = Number(url.searchParams.get('after') ?? 0);
    const items = Array.from({ length: 40 }, (_, index) => ({
      ...mediaItem(2023, (hash(seed) % 12) + 1, offset + index),
      similarity: 0.9,
    }));
    const next = offset + 40;
    await route.fulfill({
      json: {
        items,
        next_cursor: next < 120 ? String(next) : null,
        has_more: next < 120,
        page_size: 40,
      },
    });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  await page.route('**/api/v1/media/*/file', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  await page.route('**/api/v1/tags**', async (route: Route) => {
    await route.fulfill({
      json: { items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 },
    });
  });

  await page.route(/\/api\/v1\/media\/n-\d+-\d+-\d+$/, async (route: Route) => {
    const id = route.request().url().split('/').pop()!;
    const [, year, month, index] = id.split('-');
    await route.fulfill({
      json: {
        ...mediaItem(Number(year), Number(month), Number(index)),
        tag_details: [],
        external_refs: [],
        entities: [],
        related_posts: [],
      },
    });
  });

  return counters;
}

async function addTagToDetails(page: Page, tag: string): Promise<void> {
  await page.route(/\/api\/v1\/media\/n-\d+-\d+-\d+$/, async (route: Route) => {
    const id = route.request().url().split('/').pop()!;
    const [, year, month, index] = id.split('-');
    await route.fulfill({
      json: {
        ...mediaItem(Number(year), Number(month), Number(index)),
        tags: [tag],
        tag_details: [
          {
            name: tag,
            category: 0,
            category_name: 'general',
            category_key: 'general',
            confidence: 0.95,
          },
        ],
        external_refs: [],
        entities: [],
        related_posts: [],
      },
    });
  });
}

async function filterByTagInLayer(page: Page, tag: string): Promise<void> {
  const feedRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/v1/media/search') &&
      new URL(request.url()).searchParams.getAll('tag').includes(tag),
  );
  await page.getByRole('button', { name: `Filter by tag ${tag}` }).click();
  await feedRequest;
  await expect(page.locator('zukan-media-inspector-page')).toHaveCount(0);
}

function cardLocator(page: Page, mediaId: string): Locator {
  return page.locator(`zukan-media-card[data-media-id="${mediaId}"]`);
}

async function scrollUntilCardExists(page: Page, mediaId: string): Promise<Locator> {
  const card = cardLocator(page, mediaId);
  for (let step = 0; step < 400; step += 1) {
    if ((await card.count()) > 0) {
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport();
      return card;
    }
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(100);
  }
  throw new Error(`Card ${mediaId} never rendered while scrolling`);
}

async function openCard(page: Page, card: Locator, mediaId: string): Promise<number> {
  await page.waitForTimeout(300);
  const top = await card.evaluate((node) => node.getBoundingClientRect().top);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/media/${mediaId}`));
  await expect(page.locator('zukan-media-inspector-dialog')).toContainText(`${mediaId}.png`);
  return top;
}

async function expectCardAt(page: Page, mediaId: string, expectedTop: number): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
  const card = cardLocator(page, mediaId);
  await expect(card, `card ${mediaId} should be rendered after returning`).toHaveCount(1);
  const top = await card.evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(top - expectedTop)).toBeLessThanOrEqual(POSITION_TOLERANCE_PX);
}

const OLDER_MONTH_CARD = 'n-2026-1-20';

test.describe('Media navigation position', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('returns to a card several large months down', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);

    await page.goBack();
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('returns correctly when responses are slow', async ({ page }) => {
    test.setTimeout(120_000);
    await seedAuthenticatedSession(page);
    await registerRoutes(page, { monthDelayMs: 800, storyDelayMs: 1500 });
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);

    await page.goBack();
    await page.waitForTimeout(3000);
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('input right after pressing Back does not lose the position', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page, { monthDelayMs: 300 });
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);

    await page.goBack();
    await page.keyboard.press('Shift');
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('survives Back, Forward, Back', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);

    await page.goBack();
    await expectCardAt(page, OLDER_MONTH_CARD, top);

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/media/${OLDER_MONTH_CARD}`));

    await page.goBack();
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('does not refetch the feed when returning', async ({ page }) => {
    await seedAuthenticatedSession(page);
    const counters = await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    await openCard(page, card, OLDER_MONTH_CARD);
    const requestsBeforeReturn = counters.monthRequests;

    await page.goBack();
    await page.waitForTimeout(SETTLE_MS);
    expect(counters.monthRequests).toBe(requestsBeforeReturn);
  });

  test('returns correctly when the detail route chunk is slow', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    await page.route('**/chunk-*.js', async (route: Route) => {
      await delay(1500);
      await route.fallback();
    });
    const top = await openCard(page, card, OLDER_MONTH_CARD);

    await page.goBack();
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('wheel input over the open layer does not move the grid', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);
    const scrollY = await page.evaluate(() => window.scrollY);

    await page.mouse.move(1200, 400);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    await page.goBack();
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('Escape returns to the grid after stepping, showing the last viewed card', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    await openCard(page, card, OLDER_MONTH_CARD);

    const viewer = page.locator('zukan-media-inspector-dialog');
    await viewer.getByRole('button', { name: 'Next media' }).click();
    await viewer.getByRole('button', { name: 'Next media' }).click();
    await expect(page).not.toHaveURL(new RegExp(OLDER_MONTH_CARD));
    const lastViewedId = new URL(page.url()).pathname.split('/').pop()!;

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/gallery');
    await expect(cardLocator(page, lastViewedId)).toBeInViewport();
  });

  test('closing after a reload stays in the app and shows the grid', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery/media/n-2026-3-2');

    const viewer = page.locator('zukan-media-inspector-dialog');
    await expect(viewer).toContainText('n-2026-3-2.png');
    await page.reload();
    await expect(viewer).toContainText('n-2026-3-2.png');

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/gallery');
    await expect(cardLocator(page, 'n-2026-3-2')).toBeInViewport();
  });

  test('keeps filters through the whole round trip', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery?ocr_text=hello');

    const card = await scrollUntilCardExists(page, 'n-2026-3-2');
    await card.click();
    await expect(page).toHaveURL('/gallery/media/n-2026-3-2?ocr_text=hello');

    await page.goBack();
    await expect(page).toHaveURL('/gallery?ocr_text=hello');
    await expect(cardLocator(page, 'n-2026-3-2')).toBeInViewport();
  });

  test('walks a chain of similar images and back at each saved position', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);
    await expect(page.locator('zukan-similar-media-grid zukan-media-card').first()).toBeVisible();
    const firstScroll = await scrollLayerTo(page, 900);
    expect(firstScroll).toBeGreaterThan(0);

    const second = await openSimilar(page, 8);
    await expect(page.locator('zukan-similar-media-grid zukan-media-card').first()).toBeVisible();
    const secondScroll = await scrollLayerTo(page, 700);
    expect(secondScroll).toBeGreaterThan(0);

    const third = await openSimilar(page, 6);
    await expect.poll(() => layerScroller(page).evaluate((node) => node.scrollTop)).toBeLessThan(5);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/media/${second}`));
    await expect
      .poll(() => layerScroller(page).evaluate((node) => node.scrollTop))
      .toBe(secondScroll);

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/media/${third}`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/media/${second}`));
    await expect
      .poll(() => layerScroller(page).evaluate((node) => node.scrollTop))
      .toBe(secondScroll);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/media/${OLDER_MONTH_CARD}`));
    await expect
      .poll(() => layerScroller(page).evaluate((node) => node.scrollTop))
      .toBe(firstScroll);

    await page.goBack();
    await expect(page).toHaveURL('/gallery');
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('Escape from three images deep goes straight back to the grid', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    const top = await openCard(page, card, OLDER_MONTH_CARD);
    await openSimilar(page, 2);
    await openSimilar(page, 3);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/gallery');
    await expectCardAt(page, OLDER_MONTH_CARD, top);
  });

  test('a plain wheel scrolls down to similar images and loads more', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery/media/n-2026-3-2');

    const cards = page.locator('zukan-similar-media-grid zukan-media-card');
    await expect(cards.first()).toBeAttached();
    await expect(cards).toHaveCount(40);

    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => layerScroller(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    await layerScroller(page).evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(cards).toHaveCount(80);
  });

  test('stepping with arrows fetches each detail once', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    const detailRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/v1\/media\/n-\d+-\d+-\d+$/.test(request.url()) && request.method() === 'GET') {
        detailRequests.push(request.url());
      }
    });
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, 'n-2026-3-2');
    await openCard(page, card, 'n-2026-3-2');
    await page.locator('zukan-media-inspector-dialog').getByRole('button', { name: 'Next media' }).click();
    await expect(page).not.toHaveURL(/n-2026-3-2$/);
    await page.waitForTimeout(500);

    expect(new Set(detailRequests).size).toBe(detailRequests.length);
  });

  test('a resize while the layer is open still returns to the card', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    await openCard(page, card, OLDER_MONTH_CARD);

    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(500);

    await page.goBack();
    await page.waitForTimeout(SETTLE_MS);
    await expect(cardLocator(page, OLDER_MONTH_CARD)).toBeInViewport();
  });

  test('filtering from the layer closes it and shows the filtered feed from the top', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await addTagToDetails(page, 'alert');
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, OLDER_MONTH_CARD);
    await openCard(page, card, OLDER_MONTH_CARD);
    await filterByTagInLayer(page, 'alert');

    await expect(page).toHaveURL('/gallery?tag=alert');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('filtering from the layer keeps filters that were already applied', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await addTagToDetails(page, 'alert');
    await page.goto('/gallery?ocr_text=hello');

    const card = await scrollUntilCardExists(page, 'n-2026-3-2');
    await card.click();
    await filterByTagInLayer(page, 'alert');

    await expect(page).toHaveURL(/\/gallery\?/);
    const params = new URL(page.url()).searchParams;
    expect(params.get('ocr_text')).toBe('hello');
    expect(params.getAll('tag')).toEqual(['alert']);
  });

  test('filtering from a favorites image stays in favorites', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await addTagToDetails(page, 'alert');
    await page.goto('/favorites/media/n-2026-3-2');

    await filterByTagInLayer(page, 'alert');

    await expect(page).toHaveURL('/favorites?tag=alert');
  });

  test('filtering from a direct image link goes to the gallery', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await addTagToDetails(page, 'alert');
    await page.goto('/media/n-2026-3-2');

    await filterByTagInLayer(page, 'alert');

    await expect(page).toHaveURL('/gallery?tag=alert');
  });

  test('Back after filtering reopens the image, and closing it drops the filter', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await addTagToDetails(page, 'alert');
    await page.goto('/gallery');

    const card = await scrollUntilCardExists(page, 'n-2026-3-2');
    await card.click();
    await filterByTagInLayer(page, 'alert');
    await expect(page).toHaveURL('/gallery?tag=alert');
    await expect(page.getByRole('button', { name: /^Remove alert$/i })).toBeVisible();

    const tagsRequested: string[][] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/media/search')) {
        tagsRequested.push(new URL(request.url()).searchParams.getAll('tag'));
      }
    });

    await page.goBack();
    await expect(page).toHaveURL('/gallery/media/n-2026-3-2');
    await expect(page.locator('zukan-media-inspector-dialog')).toContainText('n-2026-3-2.png');

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/gallery');
    await expect(page.locator('zukan-media-inspector-page')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove alert$/i })).toHaveCount(0);
    await expect.poll(() => tagsRequested.at(-1)).toEqual([]);
  });
});
