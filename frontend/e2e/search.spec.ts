import { expect, test } from '@playwright/test';

import { createSession, seedLocalAuth } from './helpers/auth';
import { listMedia, waitForMedia } from './helpers/media-api';
import { bluePngFile, greenPngFile } from './helpers/media-fixtures';

const API_BASE_URL = process.env['PLAYWRIGHT_E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8010';
const API_V1 = `${API_BASE_URL}/api/v1`;

test('searching by a custom tag sends correct repeated query params and shows only matching media', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const blueUpload = await request.post(`${API_V1}/media`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    multipart: { files: bluePngFile('custom-tag-search-blue.png', 'primary') }
  });
  await expect(blueUpload).toBeOK();

  const greenUpload = await request.post(`${API_V1}/media`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    multipart: { files: greenPngFile('custom-tag-search-green.png', 'primary') }
  });
  await expect(greenUpload).toBeOK();

  const allMedia = await listMedia(request, session.accessToken);
  const blueId = allMedia.find((item) => item.original_filename === 'custom-tag-search-blue.png')?.id ?? null;
  const greenId = allMedia.find((item) => item.original_filename === 'custom-tag-search-green.png')?.id ?? null;
  expect(blueId).toBeTruthy();
  expect(greenId).toBeTruthy();

  await waitForMedia(request, session.accessToken, blueId!, (m) => m.tagging_status === 'done');

  const tagPatch = await request.patch(`${API_V1}/media/${blueId}`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json'
    },
    data: JSON.stringify({ tags: ['my_unique_custom_tag', 'rating:general'] })
  });
  await expect(tagPatch).toBeOK();

  await page.goto('/gallery');
  await expect(page.locator('img[alt="custom-tag-search-blue.png"]')).toBeVisible();
  await expect(page.locator('img[alt="custom-tag-search-green.png"]')).toBeVisible();

  const searchInput = page.getByRole('combobox', { name: 'Search gallery' });

  const searchResponsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') {
      return false;
    }
    const url = new URL(response.url());
    return url.pathname === '/api/v1/media' && url.searchParams.getAll('tag').includes('my_unique_custom_tag');
  });

  await searchInput.fill('tag:my_unique_custom_tag');
  await searchInput.press('Enter');

  await searchResponsePromise;

  await expect(page.locator('img[alt="custom-tag-search-blue.png"]')).toBeVisible();
  await expect(page.locator('img[alt="custom-tag-search-green.png"]')).not.toBeVisible();
});

test('pressing enter on an active character suggestion keeps the query and searches by character', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const upload = await request.post(`${API_V1}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('search-character-blue.png', 'primary')
    }
  });
  await expect(upload).toBeOK();
  const mediaItems = await listMedia(request, session.accessToken);
  const mediaId = mediaItems.find((item) => item.original_filename === 'search-character-blue.png')?.id ?? null;
  expect(mediaId).toBeTruthy();

  await waitForMedia(
    request,
    session.accessToken,
    mediaId,
    (media) => media.tagging_status === 'done' && media.character_name === 'ayanami_rei'
  );

  await page.goto('/gallery');
  await expect(page.locator('img[alt="search-character-blue.png"]')).toBeVisible();

  const searchInput = page.getByRole('combobox', { name: 'Search gallery' });
  await searchInput.fill('ayanami');
  await expect(page.getByRole('option', { name: /ayanami rei/i }).first()).toBeVisible();

  const searchResponsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') {
      return false;
    }

    const url = new URL(response.url());
    return url.pathname === '/api/v1/media' && url.searchParams.get('character_name') === 'ayanami_rei';
  });

  await searchInput.press('Enter');

  await searchResponsePromise;
  await expect(page.getByRole('button', { name: /remove character filter ayanami rei/i })).toBeVisible();
  await expect(searchInput).toHaveValue('');
  await expect(page.locator('img[alt="search-character-blue.png"]')).toBeVisible();
});
