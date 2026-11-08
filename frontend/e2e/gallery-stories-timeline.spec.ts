import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
const STORY_YEAR = CURRENT_YEAR - 1;

function buildMonths(total = 14, uneven = false): { year: number; month: number; count: number }[] {
  const months = [];
  let year = CURRENT_YEAR;
  let month = CURRENT_MONTH;
  for (let index = 0; index < total; index += 1) {
    const count = uneven
      ? [3, 900, 12, 1, 450, 60, 2000, 7, 300, 25][index % 10]!
      : 180 + ((index * 53) % 220);
    months.push({ year, month, count });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

const MONTHS = buildMonths();
const STORY_MONTH = MONTHS.find((m) => m.year === STORY_YEAR && m.month === CURRENT_MONTH)!;
const STORY_INDEX = STORY_MONTH.count - 5;
const STORY_ID = `s-${STORY_YEAR}-${CURRENT_MONTH}-${STORY_INDEX}`;

function mediaItem(year: number, month: number, index: number, total: number) {
  const id = `s-${year}-${month}-${index}`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.max(1, daysInMonth - Math.floor((index / total) * daysInMonth));
  const capturedAt = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`;
  return {
    id,
    filename: `${id}.png`,
    original_filename: `${id}.png`,
    media_type: 'image',
    metadata: {
      file_size: 100,
      width: [900, 1200, 1600, 800][index % 4],
      height: [1200, 800, 900, 800][index % 4],
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

async function registerRoutes(page: Page, monthDelayMs = 0, months = MONTHS) {
  const library = new Map(
    months.map(({ year, month, count }) => [
      `${year}-${month}`,
      Array.from({ length: count }, (_, index) => mediaItem(year, month, index, count)),
    ]),
  );

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    const year = params.get('captured_year');
    const month = params.get('captured_month');
    const pageSize = Number(params.get('page_size') ?? 160);

    if (!year || !month) {
      const story = library.get(`${STORY_YEAR}-${CURRENT_MONTH}`)![STORY_INDEX]!;
      await route.fulfill({
        json: { items: [story], total: 1, next_cursor: null, has_more: false, page_size: pageSize },
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, monthDelayMs));
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
    await route.fulfill({ json: { buckets: months } });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  await page.route('**/api/v1/media/*/file', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  await page.route('**/api/v1/media/*/similar**', async (route: Route) => {
    await route.fulfill({
      json: { items: [], next_cursor: null, has_more: false, page_size: 40 },
    });
  });

  await page.route('**/api/v1/tags**', async (route: Route) => {
    await route.fulfill({
      json: { items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 },
    });
  });

  await page.route(/\/api\/v1\/media\/s-\d+-\d+-\d+$/, async (route: Route) => {
    const id = route.request().url().split('/').pop()!;
    const [, year, month, index] = id.split('-');
    const count = months.find((m) => m.year === Number(year) && m.month === Number(month))?.count ?? 1;
    await route.fulfill({
      json: {
        ...mediaItem(Number(year), Number(month), Number(index), count),
        tag_details: [],
        external_refs: [],
        entities: [],
        related_posts: [],
      },
    });
  });
}

function cardLocator(page: Page, mediaId: string): Locator {
  return page.locator(`zukan-media-card[data-media-id="${mediaId}"]`);
}

async function openStoryViewer(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Open memory from/ }).first().click();
  await expect(page.locator('zukan-today-stories-viewer img.stories-viewer__media')).toBeVisible();
}

async function firstVisibleCard(page: Page): Promise<{ id: string; top: number } | null> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('zukan-media-card[data-media-id]'));
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) {
        return { id: card.dataset['mediaId']!, top: rect.top };
      }
    }
    return null;
  });
}

async function tickPositions(page: Page): Promise<string[]> {
  return page.locator('.media-timeline__month').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).style.top),
  );
}

test.describe('Gallery stories and timeline stability', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('shows a memory at its location in the timeline', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    await openStoryViewer(page);
    await page.getByRole('button', { name: 'Show in timeline' }).click();

    const card = cardLocator(page, STORY_ID);
    await expect(card).toBeInViewport();
    await expect(card).toHaveClass(/media-browser__card--highlight/);
    await page.waitForTimeout(1500);
    await expect(card).toBeInViewport();
  });

  test('opens a memory in the media viewer and returns to it in the timeline', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerRoutes(page);
    await page.goto('/gallery');

    await openStoryViewer(page);
    await page.locator('zukan-today-stories-viewer img.stories-viewer__media').click();

    await expect(page).toHaveURL(new RegExp(`/gallery/media/${STORY_ID}`));
    await expect(page.locator('zukan-media-inspector-dialog')).toContainText(`${STORY_ID}.png`);

    await page.goBack();
    await expect(page.locator('zukan-media-inspector-page')).toHaveCount(0);
    await expect(cardLocator(page, STORY_ID)).toBeInViewport();
  });

  test('keeps content and scrubber ticks steady while fast scrolling', async ({ page }) => {
    test.setTimeout(90_000);
    await seedAuthenticatedSession(page);
    await registerRoutes(page, 150);
    await page.goto('/gallery');
    await expect(page.locator('.media-timeline__month').first()).toBeAttached();

    const initialTicks = await tickPositions(page);
    await page.mouse.move(600, 450);
    for (let step = 0; step < 40; step += 1) {
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(30);
    }
    expect(await tickPositions(page)).toEqual(initialTicks);

    await page.waitForTimeout(1200);
    const before = await firstVisibleCard(page);
    expect(before).not.toBeNull();
    await page.waitForTimeout(1500);
    const after = await page.evaluate((id) => {
      const card = document.querySelector<HTMLElement>(`zukan-media-card[data-media-id="${id}"]`);
      return card ? card.getBoundingClientRect().top : null;
    }, before!.id);
    expect(after).not.toBeNull();
    expect(Math.abs(after! - before!.top)).toBeLessThanOrEqual(2);
    expect(await tickPositions(page)).toEqual(initialTicks);
  });

  test('keeps the viewport anchored while months above settle after a scrubber drag', async ({ page }) => {
    test.setTimeout(90_000);
    await seedAuthenticatedSession(page);
    await registerRoutes(page, 250);
    await page.goto('/gallery');
    const rail = page.locator('.media-timeline__rail');
    await expect(rail).toBeVisible();

    const box = (await rail.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(800);
    const settledAt = await firstVisibleCard(page);
    expect(settledAt).not.toBeNull();
    await page.waitForTimeout(2000);
    const top = await page.evaluate((id) => {
      const card = document.querySelector<HTMLElement>(`zukan-media-card[data-media-id="${id}"]`);
      return card ? card.getBoundingClientRect().top : null;
    }, settledAt!.id);
    expect(top).not.toBeNull();
    expect(Math.abs(top! - settledAt!.top)).toBeLessThanOrEqual(2);
  });

  test('renders media after jumping into the middle of a large uneven library', async ({ page }) => {
    test.setTimeout(90_000);
    await seedAuthenticatedSession(page);
    const months = buildMonths(120, true);
    months.push(...MONTHS.filter((m) => !months.some((o) => o.year === m.year && o.month === m.month)));
    await registerRoutes(page, 300, months);
    await page.goto('/gallery');
    const rail = page.locator('.media-timeline__rail');
    await expect(rail).toBeVisible();

    for (const fraction of [0.5, 0.35, 0.8]) {
      const box = (await rail.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * fraction);
      await page.waitForTimeout(2500);
      const visible = await firstVisibleCard(page);
      expect(visible, `cards visible after jumping to ${fraction}`).not.toBeNull();
    }
  });

  test('lands in the month shown by the scrubber label', async ({ page }) => {
    test.setTimeout(90_000);
    await seedAuthenticatedSession(page);
    await registerRoutes(page, 100, buildMonths(60, true));
    await page.goto('/gallery');
    const rail = page.locator('.media-timeline__rail');
    await expect(rail).toBeVisible();

    for (const fraction of [0.12, 0.43, 0.71]) {
      const box = (await rail.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height * fraction;
      await page.mouse.move(x, y);
      const label = (await page.locator('.media-timeline__chip').textContent())!.trim();
      await page.mouse.click(x, y);
      await page.mouse.move(box.x - 300, y);
      await page.waitForTimeout(2000);

      const visibleMonth = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll<HTMLElement>('section.media-browser__month'));
        const section = sections.find((el) => el.getBoundingClientRect().bottom > 120);
        return section?.dataset['month'] ?? null;
      });
      const [monthName, year] = label.split(' ');
      const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthName!) + 1;
      expect(visibleMonth, `label ${label} at ${fraction}`).toBe(`${year}-${String(month).padStart(2, '0')}`);
    }
  });
});

