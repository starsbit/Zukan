import { expect, test, type Page, type Route } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

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
    uploaded_at: capturedAt,
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
  const normalize = (input: string) => input.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  return normalize(value).includes(normalize(query));
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
        uploaded_at: '2026-03-20T00:00:00Z',
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

  await page.route('**/api/v1/media/series-suggestions**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';

    const items = [
      { name: 'Fate/stay night', media_count: 9 },
      { name: 'Tsukihime', media_count: 4 },
    ].filter((series) => matchesQuery(series.name, query));

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
        uploaded_at: '2026-03-20T00:00:00Z',
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

  await page.route('**/api/v1/media/series-suggestions**', async (route) => {
    await route.fulfill({ json: [] });
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
        case 'uploaded_at':
          return new Date(left.uploaded_at).getTime() - new Date(right.uploaded_at).getTime();
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
      is_sensitive: true,
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
        uploaded_at: '2026-03-20T00:00:00Z',
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

  await page.route('**/api/v1/media/*', async (route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/^\/api\/v1\/media\/([^/]+)$/);
    const id = match?.[1] ?? '';
    if (!match || ['search', 'timeline', 'character-suggestions', 'series-suggestions'].includes(id)) {
      await route.fallback();
      return;
    }

    const item = media.find((candidate) => candidate.id === id);
    if (!item) {
      await route.fulfill({ status: 404, json: { detail: 'Not found' } });
      return;
    }

    const { searchable_status: _searchableStatus, ...detail } = item;
    await route.fulfill({
      json: {
        ...detail,
        tag_details: detail.tags.map((name, index) => ({
          name,
          category: index,
          category_name: 'general',
          category_key: 'general',
          confidence: 0.95,
        })),
        external_refs: [],
        entities: [
          {
            id: `${detail.id}-character`,
            entity_type: 'character',
            entity_id: null,
            name: 'Rin Tohsaka',
            role: 'primary',
            source: 'manual',
            confidence: 0.92,
          },
          {
            id: `${detail.id}-series`,
            entity_type: 'series',
            entity_id: null,
            name: 'Fate/stay night',
            role: 'primary',
            source: 'manual',
            confidence: 0.88,
          },
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

  await page.route('**/api/v1/media/series-suggestions**', async (route) => {
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

async function selectDialogOption(
  page: Page,
  label: string,
  option: string,
  options?: { force?: boolean },
): Promise<void> {
  await page.getByRole('combobox', { name: label }).click({ force: options?.force });
  await page.getByRole('option', { name: option }).click();
}

async function closeSelectOverlayWithEscape(page: Page, optionLabel: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option', { name: optionLabel })).toHaveCount(0);
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

  test('shows tag, character, and series suggestions and keeps multiple entity chips', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerSearchRoutes(page, searchRequests);
    await page.goto('/');
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
    await expect(chipRow(page, 'Rin Tohsaka')).toBeVisible();

    await typeSearch(page, 'fate');
    await expect(page.getByRole('option', { name: /Fate\/stay night/i })).toBeVisible();
    await page.getByRole('option', { name: /Fate\/stay night/i }).click();
    await expect(chipRow(page, 'Fate/stay night')).toBeVisible();

    await typeSearch(page, 'tsukihime');
    await expect(page.getByRole('option', { name: /Tsukihime/i })).toBeVisible();
    await page.getByRole('option', { name: /Tsukihime/i }).click();
    await expect(chipRow(page, 'Tsukihime')).toBeVisible();

    const request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.getAll('character_name').join(',') === 'Rin Tohsaka,Saber Alter'
        && candidate.searchParams.getAll('series_name').join(',') === 'Fate/stay night,Tsukihime',
    );
    expect(request.searchParams.getAll('character_name')).toEqual(['Rin Tohsaka', 'Saber Alter']);
    expect(request.searchParams.getAll('series_name')).toEqual(['Fate/stay night', 'Tsukihime']);
  });

  test('hydrates filters from the route and navigates filter history', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerSearchRoutes(page, searchRequests);
    await page.goto('/gallery?tag=Saber&character_name=Rin%20Tohsaka');

    await expect(chipRow(page, 'Saber')).toBeVisible();
    await expect(chipRow(page, 'Rin Tohsaka')).toBeVisible();
    const hydratedRequest = await waitForMatchingSearchRequest(
      searchRequests,
      (request) =>
        request.searchParams.getAll('tag').join(',') === 'saber'
        && request.searchParams.getAll('character_name').join(',') === 'Rin Tohsaka',
    );
    expect(hydratedRequest.searchParams.getAll('tag')).toEqual(['saber']);

    await typeSearch(page, 'fate');
    await page.getByRole('option', { name: /Fate\/stay night/i }).click();
    await expect(page).toHaveURL(/series_name=Fate%2Fstay\+night|series_name=Fate%2Fstay%20night/);
    await expect(chipRow(page, 'Fate/stay night')).toBeVisible();

    await page.goBack();
    await expect(chipRow(page, 'Fate/stay night')).toHaveCount(0);
    await expect(chipRow(page, 'Saber')).toBeVisible();

    await page.goForward();
    await expect(chipRow(page, 'Fate/stay night')).toBeVisible();
  });

  test('applies OCR search on enter, persists across routes, and escape clears it', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerSearchRoutes(page, searchRequests);
    await page.goto('/');
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
    await expect(page).toHaveURL(/\/gallery\?ocr_text=burning(\+|%20)field(\+|%20)text$/);
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
    await expect(page).toHaveURL(/\/trash\?ocr_text=burning(\+|%20)field(\+|%20)text$/);
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
        && candidate.searchParams.getAll('character_name').length === 0
        && !candidate.searchParams.get('ocr_text'),
    );
    expect(request.searchParams.getAll('tag')).toEqual([]);
  });

  test('includes album context when search is applied on the album page', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerSearchRoutes(page, searchRequests);
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

  test('applies visibility and favorites filters from the dialog', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerAdvancedFilterRoutes(page, searchRequests);
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );
    await expect(page.locator('.media-card')).toHaveCount(4);

    await openFiltersDialog(page);
    await selectDialogOption(page, 'Favorites', 'Only favorites');
    await selectDialogOption(page, 'Visibility', 'Public');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.locator('.media-card')).toHaveCount(1);
  });

  test('clicking inspector metadata adds a current-view filter and closes the inspector', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerAdvancedFilterRoutes(page, searchRequests);
    await page.goto('/');
    await expect(page.locator('.media-card')).toHaveCount(4);

    await page.locator('.media-card').first().click();
    await expect(page.getByRole('button', { name: 'Filter by tag Alert' })).toBeVisible();
    await page.getByRole('button', { name: 'Filter by tag Alert' }).click();

    await expect(page.getByRole('button', { name: 'Filter by tag Alert' })).toHaveCount(0);
    await expect(chipRow(page, 'Alert')).toBeVisible();
    await expect(page).toHaveURL(/tag=alert/);
    const request = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) => candidate.searchParams.getAll('tag').join(',') === 'alert',
    );
    expect(request.searchParams.getAll('tag')).toEqual(['alert']);
  });

  test('applies status, NSFW, sensitive, and exclude-tag filters from the dialog', async ({ page }) => {
    const searchRequests: URL[] = [];
    const timelineRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerAdvancedFilterRoutes(page, searchRequests, timelineRequests);
    await page.goto('/');
    await expect(page).toHaveURL('/');
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

  test('applies separate character and series matching modes from the dialog', async ({ page }) => {
    const searchRequests: URL[] = [];
    const timelineRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerSearchRoutes(page, searchRequests);
    await page.route('**/api/v1/media/timeline**', async (route) => {
      timelineRequests.push(new URL(route.request().url()));
      await route.fulfill({ json: { buckets: [] } });
    });
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await waitForMatchingSearchRequest(
      searchRequests,
      (request) => request.searchParams.get('state') === 'active',
    );

    await typeSearch(page, 'rin');
    await page.getByRole('option', { name: /Rin Tohsaka/i }).click();
    await typeSearch(page, 'saber alter');
    await page.getByRole('option', { name: /Saber Alter/i }).click();
    await typeSearch(page, 'fate');
    await page.getByRole('option', { name: /Fate\/stay night/i }).click();

    await openFiltersDialog(page);
    await selectDialogOption(page, 'Character Matching', 'Match any');
    await selectDialogOption(page, 'Series Matching', 'Match all');
    const requestCountBeforeApply = searchRequests.length;
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();

    await expect.poll(() => searchRequests.length).toBeGreaterThan(requestCountBeforeApply);
    const searchRequest = await waitForMatchingSearchRequest(
      searchRequests,
      (candidate) =>
        candidate.searchParams.get('character_mode') === 'or'
        && candidate.searchParams.get('series_mode') === 'and',
    );
    expect(searchRequest.searchParams.getAll('character_name')).toEqual(['Rin Tohsaka', 'Saber Alter']);
    expect(searchRequest.searchParams.getAll('series_name')).toEqual(['Fate/stay night']);

    await expect.poll(() => timelineRequests.length).toBeGreaterThan(0);
    const timelineRequest = [...timelineRequests].reverse().find(
      (candidate) =>
        candidate.searchParams.get('character_mode') === 'or'
        && candidate.searchParams.get('series_mode') === 'and',
    );
    expect(timelineRequest?.searchParams.getAll('character_name')).toEqual(['Rin Tohsaka', 'Saber Alter']);
    expect(timelineRequest?.searchParams.getAll('series_name')).toEqual(['Fate/stay night']);
  });

  test('preserves applied filters across gallery, favorites, trash, and album routes', async ({ page }) => {
    const searchRequests: URL[] = [];
    await seedAuthenticatedSession(page);
    await registerAdvancedFilterRoutes(page, searchRequests);
    await page.goto('/');
    await expect(page).toHaveURL('/');
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
    await closeSelectOverlayWithEscape(page, 'Videos');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(chipRow(page, 'OCR: "moon"')).toBeVisible();

    await page.getByRole('link', { name: 'Favorites' }).click();
    await expect(page).toHaveURL(/\/favorites\?/);
    await expect(chipRow(page, 'OCR: "moon"')).toBeVisible();

    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page).toHaveURL(/\/trash\?/);
    await expect(chipRow(page, 'OCR: "moon"')).toBeVisible();

    await page.goto('/album/album-1');
    await expect(page).toHaveURL(/\/album\/album-1/);
    await expect(page.getByRole('heading', { name: 'Album 1' })).toBeVisible();
  });
});
