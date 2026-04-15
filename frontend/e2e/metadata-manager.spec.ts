import { expect, test, type Page } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

type TagItem = {
  id: number;
  name: string;
  media_count: number;
  category: number;
  category_name: string;
  category_key: string;
};

type MetadataItem = {
  id: string;
  name: string;
  media_count: number;
};

function aggregateTagItems(items: TagItem[]): TagItem[] {
  const byName = new Map<string, TagItem>();
  for (const item of items) {
    const existing = byName.get(item.name);
    if (existing) {
      existing.media_count += item.media_count;
      continue;
    }
    byName.set(item.name, { ...item });
  }
  return Array.from(byName.values());
}

function aggregateMetadataItems(items: MetadataItem[]): MetadataItem[] {
  const byName = new Map<string, MetadataItem>();
  for (const item of items) {
    const existing = byName.get(item.name);
    if (existing) {
      existing.media_count += item.media_count;
      continue;
    }
    byName.set(item.name, { ...item });
  }
  return Array.from(byName.values());
}

function matchesQuery(value: string, query: string): boolean {
  const normalize = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  return !normalizedQuery || normalizedValue.includes(normalizedQuery);
}

function ownerScopedQuerySeen(requests: URL[], expectedFragment: string): boolean {
  const normalize = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const normalized = normalize(expectedFragment);
  return requests.some((request) => {
    const q = normalize(request.searchParams.get('q') ?? '');
    return request.searchParams.get('scope') === 'owner' && q.includes(normalized);
  });
}

async function waitForOwnerScopedQuery(requests: URL[], expectedFragment: string): Promise<void> {
  await expect.poll(() => ownerScopedQuerySeen(requests, expectedFragment)).toBeTruthy();
}

async function registerMetadataManagerRoutes(page: Page) {
  const tagRequests: URL[] = [];
  const characterRequests: URL[] = [];
  const seriesRequests: URL[] = [];

  let tags: TagItem[] = [
    { id: 11, name: 'legacy', media_count: 2, category: 0, category_name: 'general', category_key: 'general' },
    { id: 12, name: 'shared', media_count: 4, category: 0, category_name: 'general', category_key: 'general' },
  ];
  let characters: MetadataItem[] = [
    { id: 'char-saber', name: 'Saber', media_count: 20 },
    { id: 'char-artoria', name: 'Artoria', media_count: 7 },
  ];
  let series: MetadataItem[] = [
    { id: 'series-fate', name: 'Fate', media_count: 20 },
    { id: 'series-fsn', name: 'Fate/stay night', media_count: 9 },
  ];

  await page.route('**/api/v1/tags**', async (route) => {
    const url = new URL(route.request().url());
    tagRequests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const items = tags.filter((item) => matchesQuery(item.name, q));
    await route.fulfill({
      json: {
        items,
        total: items.length,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      },
    });
  });

  await page.route('**/api/v1/character-names**', async (route) => {
    const url = new URL(route.request().url());
    characterRequests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const items = characters.filter((item) => matchesQuery(item.name, q));
    await route.fulfill({
      json: {
        items,
        total: items.length,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      },
    });
  });

  await page.route('**/api/v1/series-names**', async (route) => {
    const url = new URL(route.request().url());
    seriesRequests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const items = series.filter((item) => matchesQuery(item.name, q));
    await route.fulfill({
      json: {
        items,
        total: items.length,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      },
    });
  });

  await page.route('**/api/v1/tags/11/actions/merge', async (route) => {
    const body = route.request().postDataJSON() as { target_tag_id: number };
    expect(body.target_tag_id).toBe(12);
    tags = tags
      .filter((item) => item.id !== 11)
      .map((item) => item.id === 12 ? { ...item, media_count: 6 } : item);
    await route.fulfill({ json: { matched_media: 2, updated_media: 2, trashed_media: 0, already_trashed: 0, deleted_tag: true, deleted_source: true } });
  });

  await page.route('**/api/v1/tags/12/actions/remove-from-media', async (route) => {
    tags = [];
    await route.fulfill({ json: { matched_media: 6, updated_media: 6, trashed_media: 0, already_trashed: 0, deleted_tag: true, deleted_source: true } });
  });

  await page.route('**/api/v1/character-names/Saber/actions/merge', async (route) => {
    const body = route.request().postDataJSON() as { target_name: string };
    expect(body.target_name).toBe('Artoria');
    characters = characters
      .filter((item) => item.name !== 'Saber')
      .map((item) => item.name === 'Artoria' ? { ...item, media_count: 27 } : item);
    await route.fulfill({ json: { matched_media: 20, updated_media: 20, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  await page.route('**/api/v1/character-names/artoria/actions/remove-from-media', async (route) => {
    characters = [];
    await route.fulfill({ json: { matched_media: 27, updated_media: 27, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  await page.route('**/api/v1/series-names/Fate/actions/merge', async (route) => {
    const body = route.request().postDataJSON() as { target_name: string };
    expect(body.target_name).toBe('Fate/stay night');
    series = series
      .filter((item) => item.name !== 'Fate')
      .map((item) => item.name === 'Fate/stay night' ? { ...item, media_count: 29 } : item);
    await route.fulfill({ json: { matched_media: 20, updated_media: 20, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  await page.route('**/api/v1/series-names/fate_stay_night/actions/remove-from-media', async (route) => {
    series = [];
    await route.fulfill({ json: { matched_media: 29, updated_media: 29, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  return { tagRequests, characterRequests, seriesRequests };
}

async function registerMultiUserMetadataManagerRoutes(page: Page) {
  const tagRequests: URL[] = [];
  const characterRequests: URL[] = [];
  const seriesRequests: URL[] = [];

  let ownerTags: TagItem[] = [
    { id: 101, name: 'legacy', media_count: 20, category: 0, category_name: 'general', category_key: 'general' },
    { id: 102, name: 'shared', media_count: 6, category: 0, category_name: 'general', category_key: 'general' },
  ];
  const otherUserTags: TagItem[] = [
    { id: 201, name: 'legacy', media_count: 13, category: 0, category_name: 'general', category_key: 'general' },
    { id: 202, name: 'shared', media_count: 29, category: 0, category_name: 'general', category_key: 'general' },
  ];

  let ownerCharacters: MetadataItem[] = [
    { id: 'owner-char-saber', name: 'Saber', media_count: 20 },
    { id: 'owner-char-artoria', name: 'Artoria', media_count: 7 },
  ];
  const otherUserCharacters: MetadataItem[] = [
    { id: 'other-char-saber', name: 'Saber', media_count: 29 },
  ];

  let ownerSeries: MetadataItem[] = [
    { id: 'owner-series-fate', name: 'Fate', media_count: 20 },
    { id: 'owner-series-fsn', name: 'Fate/stay night', media_count: 9 },
  ];
  const otherUserSeries: MetadataItem[] = [
    { id: 'other-series-fate', name: 'Fate', media_count: 31 },
  ];

  await page.route('**/api/v1/tags**', async (route) => {
    const url = new URL(route.request().url());
    tagRequests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const scope = url.searchParams.get('scope');
    const items = scope === 'owner'
      ? ownerTags
      : aggregateTagItems([...ownerTags, ...otherUserTags]);
    const filtered = items.filter((item) => matchesQuery(item.name, q));
    await route.fulfill({
      json: {
        items: filtered,
        total: filtered.length,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      },
    });
  });

  await page.route('**/api/v1/character-names**', async (route) => {
    const url = new URL(route.request().url());
    characterRequests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const scope = url.searchParams.get('scope');
    const items = scope === 'owner'
      ? ownerCharacters
      : aggregateMetadataItems([...ownerCharacters, ...otherUserCharacters]);
    const filtered = items.filter((item) => matchesQuery(item.name, q));
    await route.fulfill({
      json: {
        items: filtered,
        total: filtered.length,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      },
    });
  });

  await page.route('**/api/v1/series-names**', async (route) => {
    const url = new URL(route.request().url());
    seriesRequests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const scope = url.searchParams.get('scope');
    const items = scope === 'owner'
      ? ownerSeries
      : aggregateMetadataItems([...ownerSeries, ...otherUserSeries]);
    const filtered = items.filter((item) => matchesQuery(item.name, q));
    await route.fulfill({
      json: {
        items: filtered,
        total: filtered.length,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      },
    });
  });

  await page.route('**/api/v1/tags/101/actions/merge', async (route) => {
    const body = route.request().postDataJSON() as { target_tag_id: number };
    expect(body.target_tag_id).toBe(102);
    ownerTags = ownerTags
      .filter((item) => item.id !== 101)
      .map((item) => item.id === 102 ? { ...item, media_count: 26 } : item);
    await route.fulfill({ json: { matched_media: 20, updated_media: 20, trashed_media: 0, already_trashed: 0, deleted_tag: true, deleted_source: true } });
  });

  await page.route('**/api/v1/tags/102/actions/remove-from-media', async (route) => {
    ownerTags = [];
    await route.fulfill({ json: { matched_media: 26, updated_media: 26, trashed_media: 0, already_trashed: 0, deleted_tag: true, deleted_source: true } });
  });

  await page.route('**/api/v1/character-names/Saber/actions/merge', async (route) => {
    const body = route.request().postDataJSON() as { target_name: string };
    expect(body.target_name).toBe('Artoria');
    ownerCharacters = ownerCharacters
      .filter((item) => item.name !== 'Saber')
      .map((item) => item.name === 'Artoria' ? { ...item, media_count: 27 } : item);
    await route.fulfill({ json: { matched_media: 20, updated_media: 20, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  await page.route('**/api/v1/character-names/artoria/actions/remove-from-media', async (route) => {
    ownerCharacters = [];
    await route.fulfill({ json: { matched_media: 27, updated_media: 27, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  await page.route('**/api/v1/series-names/Fate/actions/merge', async (route) => {
    const body = route.request().postDataJSON() as { target_name: string };
    expect(body.target_name).toBe('Fate/stay night');
    ownerSeries = ownerSeries
      .filter((item) => item.name !== 'Fate')
      .map((item) => item.name === 'Fate/stay night' ? { ...item, media_count: 29 } : item);
    await route.fulfill({ json: { matched_media: 20, updated_media: 20, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  await page.route('**/api/v1/series-names/fate_stay_night/actions/remove-from-media', async (route) => {
    ownerSeries = [];
    await route.fulfill({ json: { matched_media: 29, updated_media: 29, trashed_media: 0, already_trashed: 0, deleted_tag: false, deleted_source: true } });
  });

  return { tagRequests, characterRequests, seriesRequests };
}

async function openMergeDialog(page: Page, itemName: string): Promise<void> {
  const card = page.locator('article.metadata-item').filter({ hasText: itemName }).first();
  await card.getByRole('button', { name: 'Merge' }).click();
  await expect(page.locator('mat-dialog-container')).toBeVisible();
}

async function confirmRemoval(page: Page, itemName: string): Promise<void> {
  const card = page.locator('article.metadata-item').filter({ hasText: itemName }).first();
  await card.getByRole('button', { name: 'Remove from media' }).click();
  await expect(page.locator('mat-dialog-container')).toBeVisible();
  await page.locator('mat-dialog-container').getByRole('button', { name: /Remove/ }).last().click();
}

function resultBanner(page: Page, text: string) {
  return page.locator('.result-banner[role="status"]').filter({ hasText: text });
}

test('manages tags, characters, and series from the metadata manager', async ({ page }) => {
  const { tagRequests, characterRequests, seriesRequests } = await registerMetadataManagerRoutes(page);
  await seedAuthenticatedSession(page);

  await page.goto('/tags');

  await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
  await expect(page.locator('article.metadata-item').filter({ hasText: 'legacy' })).toBeVisible();
  expect(tagRequests.some((request) => request.searchParams.get('scope') === 'owner')).toBeTruthy();

  await openMergeDialog(page, 'legacy');
  const tagDialog = page.locator('mat-dialog-container');
  await tagDialog.locator('input').fill('shared');
  await expect(tagDialog.getByRole('option', { name: /shared/i })).toBeVisible();
  await tagDialog.getByRole('option', { name: /shared/i }).click();
  await expect(tagDialog.getByText('2 media using "Legacy" will use "Shared" instead.')).toBeVisible();
  await tagDialog.getByRole('button', { name: 'Merge into Shared' }).click();
  await expect(resultBanner(page, 'Merged "Legacy" into "Shared" on 2 media.')).toBeVisible();
  await expect(page.locator('article.metadata-item').filter({ hasText: 'legacy' })).toHaveCount(0);

  await confirmRemoval(page, 'shared');
  await expect(resultBanner(page, 'Removed "Shared" from 6 media. The source tag no longer has any remaining references.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No tags found' })).toBeVisible();

  await page.getByRole('tab', { name: 'Characters' }).click();
  await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible();
  expect(characterRequests.some((request) => request.searchParams.get('scope') === 'owner')).toBeTruthy();

  await openMergeDialog(page, 'Saber');
  const characterDialog = page.locator('mat-dialog-container');
  await characterDialog.locator('input').fill('Artoria');
  await waitForOwnerScopedQuery(characterRequests, 'Artoria');
  await expect(characterDialog.getByRole('option', { name: /Artoria/i })).toBeVisible();
  await characterDialog.getByRole('option', { name: /Artoria/i }).click();
  await expect(characterDialog.getByText('20 media using "Saber" will use "Artoria" instead.')).toBeVisible();
  await characterDialog.getByRole('button', { name: 'Merge into Artoria' }).click();
  await expect(resultBanner(page, 'Merged "Saber" into "Artoria" on 20 media. The source character name was fully cleaned up.')).toBeVisible();
  await expect(page.locator('article.metadata-item').filter({ hasText: 'Saber' })).toHaveCount(0);

  await confirmRemoval(page, 'Artoria');
  await expect(resultBanner(page, 'Removed "Artoria" from 27 media. The source character name no longer has any remaining references.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No characters found' })).toBeVisible();

  await page.getByRole('tab', { name: 'Series' }).click();
  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();
  expect(seriesRequests.some((request) => request.searchParams.get('scope') === 'owner')).toBeTruthy();

  await openMergeDialog(page, 'Fate');
  const seriesDialog = page.locator('mat-dialog-container');
  await seriesDialog.locator('input').fill('Fate/stay night');
  await waitForOwnerScopedQuery(seriesRequests, 'Fate/stay night');
  await expect(seriesDialog.getByRole('option', { name: /Fate\/stay night/i })).toBeVisible();
  await seriesDialog.getByRole('option', { name: /Fate\/stay night/i }).click();
  await expect(seriesDialog.getByText('20 media using "Fate" will use "Fate/stay night" instead.')).toBeVisible();
  await seriesDialog.getByRole('button', { name: 'Merge into Fate/stay night' }).click();
  await expect(resultBanner(page, 'Merged "Fate" into "Fate/stay night" on 20 media. The source series name was fully cleaned up.')).toBeVisible();
  await expect(page.locator('article.metadata-item').filter({ hasText: /^Fate$/ })).toHaveCount(0);

  await confirmRemoval(page, 'Fate/stay night');
  await expect(resultBanner(page, 'Removed "Fate/stay night" from 29 media. The source series name no longer has any remaining references.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No series found' })).toBeVisible();
});

test('keeps tag management owner-scoped when other users share the same names', async ({ page }) => {
  const { tagRequests, characterRequests, seriesRequests } = await registerMultiUserMetadataManagerRoutes(page);
  await seedAuthenticatedSession(page);

  await page.goto('/tags');

  await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
  expect(tagRequests.some((request) => request.searchParams.get('scope') === 'owner')).toBeTruthy();

  await openMergeDialog(page, 'legacy');
  const tagDialog = page.locator('mat-dialog-container');
  await tagDialog.locator('input').fill('shared');
  await expect(tagDialog.getByRole('option', { name: /shared/i })).toBeVisible();
  await tagDialog.getByRole('option', { name: /shared/i }).click();
  await expect(tagDialog.getByText('20 media using "Legacy" will use "Shared" instead.')).toBeVisible();
  await tagDialog.getByRole('button', { name: 'Merge into Shared' }).click();
  await expect(resultBanner(page, 'Merged "Legacy" into "Shared" on 20 media.')).toBeVisible();

  let accessibleTags = await page.evaluate(async () => {
    const response = await fetch('/api/v1/tags');
    return response.json();
  });
  let accessibleTagsByName = Object.fromEntries(accessibleTags.items.map((item: TagItem) => [item.name, item.media_count]));
  expect(accessibleTagsByName.shared).toBe(55);
  expect(accessibleTagsByName.legacy).toBe(13);

  await confirmRemoval(page, 'shared');
  await expect(resultBanner(page, 'Removed "Shared" from 26 media. The source tag no longer has any remaining references.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No tags found' })).toBeVisible();

  accessibleTags = await page.evaluate(async () => {
    const response = await fetch('/api/v1/tags');
    return response.json();
  });
  accessibleTagsByName = Object.fromEntries(accessibleTags.items.map((item: TagItem) => [item.name, item.media_count]));
  expect(accessibleTagsByName.shared).toBe(29);
  expect(accessibleTagsByName.legacy).toBe(13);

  await page.getByRole('tab', { name: 'Characters' }).click();
  await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible();
  expect(characterRequests.some((request) => request.searchParams.get('scope') === 'owner')).toBeTruthy();

  await openMergeDialog(page, 'Saber');
  const characterDialog = page.locator('mat-dialog-container');
  await characterDialog.locator('input').fill('Artoria');
  await waitForOwnerScopedQuery(characterRequests, 'Artoria');
  await expect(characterDialog.getByRole('option', { name: /Artoria/i })).toBeVisible();
  await characterDialog.getByRole('option', { name: /Artoria/i }).click();
  await expect(characterDialog.getByText('20 media using "Saber" will use "Artoria" instead.')).toBeVisible();
  await characterDialog.getByRole('button', { name: 'Merge into Artoria' }).click();
  await expect(resultBanner(page, 'Merged "Saber" into "Artoria" on 20 media. The source character name was fully cleaned up.')).toBeVisible();

  let accessibleCharacters = await page.evaluate(async () => {
    const response = await fetch('/api/v1/character-names');
    return response.json();
  });
  let accessibleCharactersByName = Object.fromEntries(accessibleCharacters.items.map((item: MetadataItem) => [item.name, item.media_count]));
  expect(accessibleCharactersByName.Saber).toBe(29);
  expect(accessibleCharactersByName.Artoria).toBe(27);

  await confirmRemoval(page, 'Artoria');
  await expect(resultBanner(page, 'Removed "Artoria" from 27 media. The source character name no longer has any remaining references.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No characters found' })).toBeVisible();

  accessibleCharacters = await page.evaluate(async () => {
    const response = await fetch('/api/v1/character-names');
    return response.json();
  });
  accessibleCharactersByName = Object.fromEntries(accessibleCharacters.items.map((item: MetadataItem) => [item.name, item.media_count]));
  expect(accessibleCharactersByName.Saber).toBe(29);
  expect(accessibleCharactersByName.Artoria).toBeUndefined();

  await page.getByRole('tab', { name: 'Series' }).click();
  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();
  expect(seriesRequests.some((request) => request.searchParams.get('scope') === 'owner')).toBeTruthy();

  await openMergeDialog(page, 'Fate');
  const seriesDialog = page.locator('mat-dialog-container');
  await seriesDialog.locator('input').fill('Fate/stay night');
  await waitForOwnerScopedQuery(seriesRequests, 'Fate/stay night');
  await expect(seriesDialog.getByRole('option', { name: /Fate\/stay night/i })).toBeVisible();
  await seriesDialog.getByRole('option', { name: /Fate\/stay night/i }).click();
  await expect(seriesDialog.getByText('20 media using "Fate" will use "Fate/stay night" instead.')).toBeVisible();
  await seriesDialog.getByRole('button', { name: 'Merge into Fate/stay night' }).click();
  await expect(resultBanner(page, 'Merged "Fate" into "Fate/stay night" on 20 media. The source series name was fully cleaned up.')).toBeVisible();

  let accessibleSeries = await page.evaluate(async () => {
    const response = await fetch('/api/v1/series-names');
    return response.json();
  });
  let accessibleSeriesByName = Object.fromEntries(accessibleSeries.items.map((item: MetadataItem) => [item.name, item.media_count]));
  expect(accessibleSeriesByName.Fate).toBe(31);
  expect(accessibleSeriesByName['Fate/stay night']).toBe(29);

  await confirmRemoval(page, 'Fate/stay night');
  await expect(resultBanner(page, 'Removed "Fate/stay night" from 29 media. The source series name no longer has any remaining references.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No series found' })).toBeVisible();

  accessibleSeries = await page.evaluate(async () => {
    const response = await fetch('/api/v1/series-names');
    return response.json();
  });
  accessibleSeriesByName = Object.fromEntries(accessibleSeries.items.map((item: MetadataItem) => [item.name, item.media_count]));
  expect(accessibleSeriesByName.Fate).toBe(31);
  expect(accessibleSeriesByName['Fate/stay night']).toBeUndefined();
});
