import { expect, test } from '@playwright/test';

import { createSession, seedLocalAuth } from './helpers/auth';
import { listMedia, waitForMedia } from './helpers/media-api';
import { bluePngFile } from './helpers/media-fixtures';

const API_BASE_URL = process.env['PLAYWRIGHT_E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8010';

test('pressing enter on an active character suggestion keeps the query and searches by character', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const upload = await request.post(`${API_BASE_URL}/media`, {
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
    return url.pathname === '/media' && url.searchParams.get('character_name') === 'ayanami_rei';
  });

  await searchInput.press('Enter');

  await searchResponsePromise;
  await expect(page.getByRole('button', { name: /remove character filter ayanami rei/i })).toBeVisible();
  await expect(searchInput).toHaveValue('');
  await expect(page.locator('img[alt="search-character-blue.png"]')).toBeVisible();
});
