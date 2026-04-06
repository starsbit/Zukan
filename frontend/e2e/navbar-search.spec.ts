import { expect, test, type Page, type Route } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

type MockMedia = ReturnType<typeof sampleMedia> & {
  searchable_status?: string;
};

function sampleMedia(
  id: string,
  capturedAt: string,
  width: number,
  height: number,
  overrides: Partial<MockMedia> = {},
) {
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
    is_sensitive: false,
    tagging_status: 'done',
    tagging_error: null,
    thumbnail_status: 'done',
    poster_status: 'not_applicable',
    ocr_text: null,
    is_favorited: false,
    searchable_status: 'done',
    ...overrides,
  };
}

function fulfillEmptySearch(route: Route): Promise<void> {
  return route.fulfill({
    json: {
      items: [],
      total: 0,
      next_cursor: null,
      has_more: false,
      page_size: 20,
    },
  });
}

function matchesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

async function registerSearchRoutes(page: Page, searchRequests: URL[]): Promise<void> {
  await page.route('**/api/v1/albums/album-1', async (route) => {
    await route.fulfill({
      json: {
        id: 'album-1',
        owner_id: 'u1',
        owner: { id: 'u1', username: 'owner' },
        access_role: 'owner',
        name: 'Album 1',
        description: 'Shared album',
        cover_media_id: null,
        preview_media: [],
        media_count: 3,
        version: 1,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-20T00:00:00Z',
      },
    });
  });

  await page.route('**/api/v1/media/search**', async (route) => {
    searchRequests.push(new URL(route.request().url()));
    await fulfillEmptySearch(route);
  });

  await page.route('**/api/v1/media/timeline**', async (route) => {
    await route.fulfill({ json: { buckets: [] } });
  });

  await page.route('**/api/v1/tags**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    const items = query && matchesQuery('Saber', query)
      ? [
          {
            id: 1,
            name: 'Saber',
            media_count: 12,
            category: 4,
            category_name: 'character',
            category_key: 'character',
          },
        ]
      : [];

    await route.fulfill({
      json: {
        items,
        total: items.length,
        next_cursor: null,
        has_more: false,
        page_size: 6,
      },
    });
  });

  await page.route('**/api/v1/media/character-suggestions**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';

    const items = [
      { name: 'Rin Tohsaka', media_count: 5 },
      { name: 'Saber Alter', media_count: 3 },
    ].filter((character) => matchesQuery(character.name, query));

    await route.fulfill({ json: items });
  });
}

async function registerMobileGalleryRoutes(page: Page, searchRequests: URL[]): Promise<void> {
  await page.route('**/api/v1/albums/album-1', async (route) => {
    await route.fulfill({
      json: {
        id: 'album-1',
        owner_id: 'u1',
        owner: { id: 'u1', username: 'owner' },
        access_role: 'owner',
        name: 'Album 1',
        description: 'Shared album',
        cover_media_id: null,
        preview_media: [],
        media_count: 3,
        version: 1,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-20T00:00:00Z',
      },
    });
  });

  await page.route('**/api/v1/media/search**', async (route) => {
    searchRequests.push(new URL(route.request().url()));
    await route.fulfill({
      json: {
        items: [
          sampleMedia('mobile-1', '2026-03-28T12:00:00Z', 1440, 960),
          sampleMedia('mobile-2', '2026-03-28T12:05:00Z', 960, 1280),
          sampleMedia('mobile-3', '2026-02-20T09:00:00Z', 1500, 900),
        ],
        total: 3,
        next_cursor: null,
        has_more: false,
        page_size: 20,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route) => {
    await route.fulfill({
      json: {
        buckets: [
          { year: 2026, month: 3, count: 2 },
          { year: 2026, month: 2, count: 1 },
        ],
      },
    });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#7aa37a"/></svg>',
    });
  });

  await page.route('**/api/v1/tags**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    const items = query && matchesQuery('Saber', query)
      ? [
          {
            id: 1,
            name: 'Saber',
            media_count: 12,
            category: 4,
            category_name: 'character',
            category_key: 'character',
          },
        ]
      : [];

    await route.fulfill({
      json: {
        items,
        total: items.length,
        next_cursor: null,
        has_more: false,
        page_size: 6,
      },
    });
  });

  await page.route('**/api/v1/media/character-suggestions**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    const items = query && matchesQuery('Rin Tohsaka', query)
      ? [{ name: 'Rin Tohsaka', media_count: 5 }]
      : [];
    await route.fulfill({ json: items });
  });
}

function matchesMediaAgainstFilters(media: MockMedia, request: URL): boolean {
  const tags = request.searchParams.getAll('tag');
  if (tags.length > 0 && !tags.every((tag) => media.tags.includes(tag))) {
    return false;
  }

  const excludedTags = request.searchParams.getAll('exclude_tag');
  if (excludedTags.some((tag) => media.tags.includes(tag))) {
    return false;
  }

  const ocrText = request.searchParams.get('ocr_text');
  if (ocrText && !(media.ocr_text ?? '').toLowerCase().includes(ocrText.toLowerCase())) {
    return false;
  }

  const nsfw = request.searchParams.get('nsfw');
  if (nsfw === 'only' && !media.is_nsfw) {
    return false;
  }

  const sensitive = request.searchParams.get('sensitive');
  if (sensitive === 'only' && !media.is_sensitive) {
    return false;
  }

  const status = request.searchParams.get('status');
  if (status && media.tagging_status !== status && media.searchable_status !== status) {
    return false;
  }

  const favorited = request.searchParams.get('favorited');
  if (favorited === 'true' && !media.is_favorited) {
    return false;
  }
  if (favorited === 'false' && media.is_favorited) {
    return false;
  }

  const visibility = request.searchParams.get('visibility');
  if (visibility && media.visibility !== visibility) {
    return false;
  }

  const mediaTypes = request.searchParams.getAll('media_type');
  if (mediaTypes.length > 0 && !mediaTypes.includes(media.media_type)) {
    return false;
  }

  const capturedAt = new Date(media.metadata.captured_at);
  const capturedYear = request.searchParams.get('captured_year');
  if (capturedYear && capturedAt.getUTCFullYear() !== Number(capturedYear)) {
    return false;
  }

  const capturedMonth = request.searchParams.get('captured_month');
  if (capturedMonth && capturedAt.getUTCMonth() + 1 !== Number(capturedMonth)) {
    return false;
  }

  const capturedDay = request.searchParams.get('captured_day');
  if (capturedDay && capturedAt.getUTCDate() !== Number(capturedDay)) {
    return false;
  }

  const capturedAfter = request.searchParams.get('captured_after');
  if (capturedAfter && capturedAt < new Date(capturedAfter)) {
    return false;
  }

  const capturedBefore = request.searchParams.get('captured_before');
  if (capturedBefore && capturedAt > new Date(capturedBefore)) {
    return false;
  }

  const capturedBeforeYear = request.searchParams.get('captured_before_year');
  if (capturedBeforeYear && capturedAt.getUTCFullYear() >= Number(capturedBeforeYear)) {
    return false;
  }

  return true;
}

function sortMediaForRequest(items: MockMedia[], request: URL): MockMedia[] {
  const sortBy = request.searchParams.get('sort_by');
  const sortOrder = request.searchParams.get('sort_order') === 'asc' ? 1 : -1;

  if (!sortBy) {
    return items.sort((left, right) =>
      new Date(right.metadata.captured_at).getTime() - new Date(left.metadata.captured_at).getTime(),
    );
  }

  return items.sort((left, right) => {
    const comparison = (() => {
      switch (sortBy) {
        case 'captured_at':
          return new Date(left.metadata.captured_at).getTime() - new Date(right.metadata.captured_at).getTime();
        case 'created_at':
          return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        case 'filename':
          return left.filename.localeCompare(right.filename);
        case 'file_size':
          return (left.metadata.file_size ?? 0) - (right.metadata.file_size ?? 0);
        default:
          return 0;
      }
    })();

    return comparison * sortOrder;
  });
}

async function registerAdvancedFilterRoutes(
  page: Page,
  searchRequests: URL[],
  timelineRequests: URL[] = [],
): Promise<void> {
  const media: MockMedia[] = [
    sampleMedia('public-video-fav', '2026-03-28T12:00:00Z', 1440, 960, {
      visibility: 'public',
      filename: 'b-video.mp4',
      media_type: 'video',
      metadata: {
        file_size: 800,
        width: 1440,
        height: 960,
        duration_seconds: null,
        frame_count: null,
        mime_type: 'video/mp4',
        captured_at: '2026-03-28T12:00:00Z',
      },
      poster_status: 'done',
      is_favorited: true,
      searchable_status: 'reviewed',
      ocr_text: 'moonlight duel',
      tags: ['hero'],
    }),
    sampleMedia('private-image-fav', '2026-03-28T08:00:00Z', 1200, 900, {
      visibility: 'private',
      filename: 'a-image.jpg',
      is_favorited: true,
      searchable_status: 'reviewed',
      ocr_text: 'hidden archive',
      tags: ['spoiler'],
    }),
    sampleMedia('public-image-nsfw', '2026-03-29T09:30:00Z', 1200, 900, {
      visibility: 'public',
      filename: 'c-public.jpg',
      is_nsfw: true,
      tagging_status: 'failed',
      ocr_text: 'danger zone',
      tags: ['alert'],
    }),
    sampleMedia('private-gif', '2025-12-01T10:00:00Z', 960, 960, {
      visibility: 'private',
      filename: 'd-loop.gif',
      media_type: 'gif',
      metadata: {
        file_size: 200,
        width: 960,
        height: 960,
        duration_seconds: null,
        frame_count: null,
        mime_type: 'image/gif',
        captured_at: '2025-12-01T10:00:00Z',
      },
      ocr_text: 'looping forest',
      tagging_status: 'processing',
      tags: ['loop'],
    }),
  ];

  await page.route('**/api/v1/albums/album-1', async (route) => {
    await route.fulfill({
      json: {
        id: 'album-1',
        owner_id: 'u1',
        owner: { id: 'u1', username: 'owner' },
        access_role: 'owner',
        name: 'Album 1',
        description: 'Shared album',
        cover_media_id: null,
        preview_media: [],
        media_count: 3,
        version: 1,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-20T00:00:00Z',
      },
    });
  });

  await page.route('**/api/v1/media/search**', async (route) => {
    const requestUrl = new URL(route.request().url());
    searchRequests.push(requestUrl);

    const items = sortMediaForRequest(
      media
        .filter((item) => matchesMediaAgainstFilters(item, requestUrl))
        .map(({ searchable_status: _searchStatus, ...item }) => item),
      requestUrl,
    );

    await route.fulfill({
      json: {
        items,
        total: items.length,
        next_cursor: null,
        has_more: false,
        page_size: 20,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route) => {
    timelineRequests.push(new URL(route.request().url()));
    await route.fulfill({ json: { buckets: [] } });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#7aa37a"/></svg>',
    });
  });

  await page.route('**/api/v1/media/*/poster', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#7a8fa3"/></svg>',
    });
  });

  await page.route('**/api/v1/media/*/file', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: 'GIF89a',
    });
  });

  await page.route('**/api/v1/tags**', async (route) => {
    await route.fulfill({
      json: {
        items: [],
        total: 0,
        next_cursor: null,
        has_more: false,
        page_size: 6,
      },
    });
  });

  await page.route('**/api/v1/media/character-suggestions**', async (route) => {
    await route.fulfill({ json: [] });
  });
}

async function waitForMatchingSearchRequest(
  searchRequests: URL[],
  predicate: (request: URL) => boolean,
): Promise<URL> {
  await expect
    .poll(() => {
      const match = [...searchRequests].reverse().find(predicate);
      return match?.toString() ?? null;
    })
    .not.toBeNull();

  return [...searchRequests].reverse().find(predicate)!;
}

async function typeSearch(page: Page, value: string): Promise<void> {
  const input = page.getByLabel('Search your photos');
  await input.focus();
  await input.fill(value);
}

async function openFiltersDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open filters' }).click();
  await expect(page.getByRole('dialog')).toContainText('Search Filters');
}

async function selectDialogOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

function tagOption(page: Page, value: string) {
  return page.getByRole('option', { name: new RegExp(`^${value}\\d+ matches(?: \\(Tags\\))?$`, 'i') }).first();
}

function chipRow(page: Page, label: string) {
  return page.getByRole('button', { name: `Remove ${label}` });
}

test.describe.serial('Navbar search', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('shows tag and character suggestions and keeps only one character chip', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerSearchRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );

    await typeSearch(page, 'sab');
    await expect(tagOption(page, 'Saber')).toBeVisible();
    await tagOption(page, 'Saber').click();
    await expect(chipRow(page, 'Saber')).toBeVisible();

    await typeSearch(page, 'rin');
    await expect(page.getByRole('option', { name: /Rin Tohsaka/i })).toBeVisible();
    await page.getByRole('option', { name: /Rin Tohsaka/i }).click();
    await expect(chipRow(page, 'Rin Tohsaka')).toBeVisible();

    await typeSearch(page, 'saber alter');
    await expect(page.getByRole('option', { name: /Saber Alter/i })).toBeVisible();
    await page.getByRole('option', { name: /Saber Alter/i }).click();
    await expect(chipRow(page, 'Saber Alter')).toBeVisible();
    await expect(chipRow(page, 'Rin Tohsaka')).toHaveCount(0);
  });

  test('applies OCR search on enter, persists across routes, and escape clears it', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerSearchRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );

    await typeSearch(page, 'burning field text');
    await page.getByLabel('Search your photos').press('Enter');

    let request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.get('state') === 'active'
        && candidate.searchParams.get('ocr_text') === 'burning field text'
        && candidate.searchParams.getAll('tag').length === 0,
    );
    await expect(chipRow(page, 'OCR: "burning field text"')).toBeVisible();

    await page.getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL('/gallery');
    await expect(chipRow(page, 'OCR: "burning field text"')).toBeVisible();

    request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.pathname.endsWith('/api/v1/media/search')
        && candidate.searchParams.get('state') === 'active'
        && candidate.searchParams.get('ocr_text') === 'burning field text'
        && candidate.searchParams.getAll('tag').length === 0,
    );

    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page).toHaveURL('/trash');
    await expect(chipRow(page, 'OCR: "burning field text"')).toBeVisible();

    request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.get('state') === 'trashed'
        && candidate.searchParams.get('ocr_text') === 'burning field text'
        && candidate.searchParams.getAll('tag').length === 0,
    );

    await page.getByLabel('Search your photos').press('Escape');
    await expect(page.locator('mat-chip-row')).toHaveCount(0);
    await expect(page.getByLabel('Search your photos')).toHaveValue('');

    request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.get('state') === 'trashed'
        && candidate.searchParams.getAll('tag').length === 0
        && !candidate.searchParams.get('character_name')
        && !candidate.searchParams.get('ocr_text'),
    );
    expect(request.searchParams.getAll('tag')).toEqual([]);
  });

  test('includes album context when search is applied on the album page', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerSearchRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');
    await page.goto('/album/album-1');
    await expect(page).toHaveURL('/album/album-1');

    await typeSearch(page, 'album text');
    await page.getByLabel('Search your photos').press('Enter');

    const request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.get('state') === 'active'
        && candidate.searchParams.get('album_id') === 'album-1'
        && candidate.searchParams.get('ocr_text') === 'album text'
        && candidate.searchParams.getAll('tag').length === 0,
    );
    expect(request.searchParams.getAll('tag')).toEqual([]);
  });

  test('stays usable on mobile across gallery and album routes', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerMobileGalleryRoutes(page, searchRequests);
    await page.setViewportSize({ width: 390, height: 844 });

    await ensureAdminAuthenticated(page);
    await page.goto('/gallery');
    await expect(page).toHaveURL('/gallery');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );

    await typeSearch(page, 'sab');
    await expect(tagOption(page, 'Saber')).toBeVisible();
    await tagOption(page, 'Saber').click();
    await expect(page.locator('.search-chip').filter({ hasText: 'Saber' })).toBeVisible();
    await expect(page.locator('.media-timeline')).toBeVisible();
    await expect(page.locator('.media-card')).toHaveCount(3);

    const hasHorizontalOverflow = await page.locator('body').evaluate((body) =>
      body.scrollWidth > body.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.goto('/album/album-1');
    await expect(page).toHaveURL('/album/album-1');
    await expect(page.locator('zukan-media-browser .media-card')).toHaveCount(3);
    await expect(page.locator('.media-timeline')).toBeVisible();
  });

  test('applies visibility, favorites, media type, and sort filters from the dialog', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerAdvancedFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL('/gallery');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );
    await expect(page.locator('.media-card')).toHaveCount(4);

    await openFiltersDialog(page);
    await selectDialogOption(page, 'Favorites', 'Only favorites');
    await selectDialogOption(page, 'Visibility', 'Public');
    await page.getByRole('combobox', { name: 'Media Types' }).click();
    await page.getByRole('option', { name: 'Videos' }).click();
    await page.keyboard.press('Escape');
    await selectDialogOption(page, 'Sort By', 'Filename');
    await selectDialogOption(page, 'Sort Order', 'Ascending');
    await page.getByRole('button', { name: 'Apply' }).click();

    const request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.get('state') === 'active'
        && candidate.searchParams.get('favorited') === 'true'
        && candidate.searchParams.get('visibility') === 'public'
        && candidate.searchParams.getAll('media_type').includes('video')
        && candidate.searchParams.get('sort_by') === 'filename'
        && candidate.searchParams.get('sort_order') === 'asc',
    );

    expect(request.searchParams.getAll('media_type')).toEqual(['video']);
    await expect(page.locator('.media-card')).toHaveCount(1);
  });

  test('applies status, NSFW, sensitive, and exclude-tag filters from the dialog', async ({ page }) => {
    const searchRequests: URL[] = [];
    const timelineRequests: URL[] = [];
    await registerAdvancedFilterRoutes(page, searchRequests, timelineRequests);

    await ensureAdminAuthenticated(page);
    await page.getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL('/gallery');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );

    await openFiltersDialog(page);
    await page.getByLabel('Exclude Tags').fill('spoiler');
    await selectDialogOption(page, 'NSFW', 'Only NSFW');
    await selectDialogOption(page, 'Sensitive', 'Only sensitive');
    await selectDialogOption(page, 'Status', 'Failed');
    const requestCountBeforeApply = searchRequests.length;
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();

    await expect.poll(() => searchRequests.length).toBeGreaterThan(requestCountBeforeApply);
    await expect.poll(() => timelineRequests.length).toBeGreaterThan(0);
    await expect(page.locator('.media-card')).toHaveCount(1);
  });

  test('preserves applied filters across gallery, favorites, trash, and album routes', async ({ page }) => {
    const searchRequests: URL[] = [];
    await registerAdvancedFilterRoutes(page, searchRequests);

    await ensureAdminAuthenticated(page);
    await page.getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL('/gallery');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );

    await typeSearch(page, 'moon');
    await page.getByLabel('Search your photos').press('Enter');
    await openFiltersDialog(page);
    await page.getByLabel('Exclude Tags').fill('spoiler');
    await selectDialogOption(page, 'Status', 'Done');
    await page.getByRole('combobox', { name: 'Media Types' }).click();
    await page.getByRole('option', { name: 'Videos' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(chipRow(page, 'OCR: "moon"')).toBeVisible();

    await page.getByRole('link', { name: 'Favorites' }).click();
    await expect(page).toHaveURL('/favorites');
    await expect(chipRow(page, 'OCR: "moon"')).toBeVisible();

    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page).toHaveURL('/trash');
    await expect(chipRow(page, 'OCR: "moon"')).toBeVisible();

    await page.goto('/album/album-1');
    await expect(page).toHaveURL('/album/album-1');
    await expect(page.getByRole('heading', { name: 'Album 1' })).toBeVisible();
  });
});
