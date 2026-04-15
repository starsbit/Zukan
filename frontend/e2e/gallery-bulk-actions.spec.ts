import { expect, test, type Page } from '@playwright/test';
import { ensureAdminAuthenticated } from './helpers/auth';

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() =>
    localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'),
  );

  if (!token) {
    throw new Error('No access token found after authentication');
  }

  return token;
}

async function uploadTaggedMedia(
  page: Page,
  token: string,
  tag: string,
  visibility: 'private' | 'public',
  count = 2,
): Promise<{
  status: number;
  body: {
    accepted: number;
    results: Array<{ id: string | null; status: string; original_filename: string }>;
  };
}> {
  const result = await page.evaluate(async ({ authToken, uploadTag, uploadVisibility, uploadCount }) => {
    const form = new FormData();
    const seed = Array.from(uploadTag).reduce((sum, character) => sum + character.charCodeAt(0), 0);

    for (let index = 0; index < uploadCount; index += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('2D context unavailable');
      }

      context.fillStyle = `rgb(${(40 + seed + index * 30) % 255}, ${(90 + seed + index * 20) % 255}, ${(160 + seed - index * 20 + 255) % 255})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `rgb(${(seed + index * 50) % 255}, ${(seed + index * 70) % 255}, ${(seed + index * 90) % 255})`;
      context.fillRect(index * 2, index * 2, 4, 4);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((resultBlob) => {
          if (resultBlob) {
            resolve(resultBlob);
            return;
          }
          reject(new Error('Unable to generate upload image'));
        }, 'image/png');
      });

      form.append(
        'files',
        new File([blob], `${uploadTag}-${index + 1}.png`, { type: 'image/png' }),
      );
    }
    form.append('tags', uploadTag);
    form.append('visibility', uploadVisibility);

    const response = await fetch('/api/v1/media', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: form,
    });

    return {
      status: response.status,
      body: await response.json() as {
        accepted: number;
        results: Array<{ id: string | null; status: string; original_filename: string }>;
      },
    };
  }, {
    authToken: token,
    uploadTag: tag,
    uploadVisibility: visibility,
    uploadCount: count,
  });

  expect(result.status).toBe(202);
  expect(result.body.accepted).toBe(count);
  return result;
}

async function fetchMediaByTag(
  page: Page,
  token: string,
  tag: string,
): Promise<Array<{ id: string; visibility: string; tagging_status: string }>> {
  return page.evaluate(async ({ authToken, searchTag }) => {
    const params = new URLSearchParams();
    params.append('tag', searchTag);
    params.set('sort_by', 'uploaded_at');
    params.set('sort_order', 'desc');
    params.set('page_size', '20');
    params.set('include_total', 'true');

    const response = await fetch(`/api/v1/media/search?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const payload = await response.json() as {
      items: Array<{ id: string; visibility: string; tagging_status: string }>;
    };
    return payload.items;
  }, { authToken: token, searchTag: tag });
}

async function createAlbum(
  page: Page,
  token: string,
  name: string,
): Promise<{ id: string; name: string }> {
  return page.evaluate(async ({ authToken, albumName }) => {
    const response = await fetch('/api/v1/albums', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: albumName,
        description: 'Created by e2e',
      }),
    });

    return await response.json() as { id: string; name: string };
  }, { authToken: token, albumName: name });
}

async function fetchAlbumMediaIds(
  page: Page,
  token: string,
  albumId: string,
): Promise<string[]> {
  return page.evaluate(async ({ authToken, targetAlbumId }) => {
    const response = await fetch(`/api/v1/albums/${targetAlbumId}/media?page_size=50`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const payload = await response.json() as {
      items: Array<{ id: string }>;
    };
    return payload.items.map((item) => item.id);
  }, { authToken: token, targetAlbumId: albumId });
}

async function waitForTaggedMedia(
  page: Page,
  token: string,
  tag: string,
  expectedCount: number,
): Promise<Array<{ id: string; visibility: string; tagging_status: string }>> {
  await expect.poll(async () => (await fetchMediaByTag(page, token, tag)).length, {
    timeout: 60000,
  }).toBe(expectedCount);

  return fetchMediaByTag(page, token, tag);
}

async function waitForTaggingDone(
  page: Page,
  token: string,
  tag: string,
  expectedCount: number,
): Promise<void> {
  await expect.poll(async () => {
    const items = await fetchMediaByTag(page, token, tag);
    if (items.length !== expectedCount) {
      return false;
    }
    return items.every((item) => item.tagging_status === 'done');
  }, {
    timeout: 60000,
  }).toBe(true);
}

async function applyVisibilityFilter(page: Page, visibilityLabel: 'Private' | 'Public'): Promise<void> {
  await page.getByRole('button', { name: 'Open filters' }).click();
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('combobox', { name: 'Visibility' }).click();
  await page.getByRole('option', { name: visibilityLabel }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);
}

async function selectAllVisibleMedia(page: Page): Promise<void> {
  await page.locator('.media-browser__day-header').first().hover();
  await page.getByLabel('Select date group').filter({ visible: true }).first().click();
  await expect(page.locator('.media-browser__action-bar')).toBeVisible();
}

async function moveTaggedMediaToTrash(page: Page, token: string, tag: string): Promise<void> {
  const items = await fetchMediaByTag(page, token, tag);
  if (items.length === 0) {
    return;
  }

  await deleteMediaIds(page, token, items.map((item) => item.id));
}

async function deleteMediaIds(page: Page, token: string, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) {
    return;
  }

  const response = await page.evaluate(async ({ authToken, mediaIds }) => {
    const result = await fetch('/api/v1/media/actions/delete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ media_ids: mediaIds }),
    });

    return {
      status: result.status,
      body: await result.json() as { processed: number; skipped: number },
    };
  }, {
    authToken: token,
    mediaIds,
  });

  expect(response.status).toBe(200);
  expect(response.body.processed).toBe(mediaIds.length);
}

test.describe.serial('Gallery bulk actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('bulk visibility and retag actions work against the backend and refresh the gallery timeline', async ({ page }) => {
    let searchRequests = 0;
    let timelineRequests = 0;
    page.on('request', (request) => {
      if (request.method() !== 'GET') {
        return;
      }
      if (request.url().includes('/api/v1/media/search')) {
        searchRequests += 1;
      }
      if (request.url().includes('/api/v1/media/timeline')) {
        timelineRequests += 1;
      }
    });

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');
    const token = await getAccessToken(page);
    const tag = `bulk-actions-${Date.now()}`;

    await uploadTaggedMedia(page, token, tag, 'private');
    await waitForTaggedMedia(page, token, tag, 2);
    await waitForTaggingDone(page, token, tag, 2);

    await page.goto('/');
    await expect(page).toHaveURL('/');
    await applyVisibilityFilter(page, 'Private');
    await expect.poll(async () => page.locator('zukan-media-card').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    await selectAllVisibleMedia(page);
    let searchBefore = searchRequests;
    let timelineBefore = timelineRequests;

    await page.getByRole('button', { name: 'Make public' }).click();
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Make public' }).click();

    await expect.poll(() => searchRequests, { timeout: 15000 }).toBeGreaterThan(searchBefore);
    await expect.poll(() => timelineRequests, { timeout: 15000 }).toBeGreaterThan(timelineBefore);
    await expect.poll(async () => {
      const items = await fetchMediaByTag(page, token, tag);
      return items.length === 2 && items.every((item) => item.visibility === 'public');
    }, { timeout: 15000 }).toBe(true);

    await applyVisibilityFilter(page, 'Public');
    await expect.poll(async () => page.locator('zukan-media-card').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    await selectAllVisibleMedia(page);
    searchBefore = searchRequests;
    timelineBefore = timelineRequests;

    await page.getByRole('button', { name: 'Make private' }).click();
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Make private' }).click();

    await expect.poll(() => searchRequests, { timeout: 15000 }).toBeGreaterThan(searchBefore);
    await expect.poll(() => timelineRequests, { timeout: 15000 }).toBeGreaterThan(timelineBefore);
    await expect.poll(async () => {
      const items = await fetchMediaByTag(page, token, tag);
      return items.length === 2 && items.every((item) => item.visibility === 'private');
    }, { timeout: 15000 }).toBe(true);

    await applyVisibilityFilter(page, 'Private');
    await expect.poll(async () => page.locator('zukan-media-card').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    await waitForTaggingDone(page, token, tag, 2);

    await selectAllVisibleMedia(page);
    searchBefore = searchRequests;
    timelineBefore = timelineRequests;

    await page.getByRole('button', { name: 'Reprocess tagging' }).click();
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Reprocess tagging' }).click();

    await expect(page.locator('.media-browser__action-bar')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('zukan-upload-status-island')).toContainText('Processing', { timeout: 15000 });
    await expect(page.locator('[aria-label="Processing"]').first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => searchRequests, { timeout: 15000 }).toBeGreaterThan(searchBefore);
    await expect.poll(() => timelineRequests, { timeout: 15000 }).toBeGreaterThan(timelineBefore);

    await moveTaggedMediaToTrash(page, token, tag);
  });

  test('adds selected media to an existing album from the gallery selection bar', async ({ page }) => {
    test.setTimeout(90000);

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');
    const token = await getAccessToken(page);
    const tag = `add-to-album-${Date.now()}`;
    const albumName = `Album ${tag}`;

    const upload = await uploadTaggedMedia(page, token, tag, 'private');
    const uploadedIds = upload.body.results
      .map((result) => result.id)
      .filter((id): id is string => !!id);
    expect(uploadedIds.length).toBe(2);
    const album = await createAlbum(page, token, albumName);

    await page.route('**/api/v1/media/search**', async (route) => {
      await route.fulfill({
        json: {
          items: uploadedIds.map((id, index) => ({
            id,
            uploader_id: 'u1',
            owner_id: 'u1',
            visibility: 'private',
            filename: `${tag}-${index + 1}.png`,
            original_filename: null,
            media_type: 'image',
            metadata: {
              file_size: 128,
              width: 16,
              height: 16,
              duration_seconds: null,
              frame_count: null,
              mime_type: 'image/png',
              captured_at: `2026-03-30T12:0${index}:00Z`,
            },
            version: 1,
            uploaded_at: `2026-03-30T12:0${index}:00Z`,
            deleted_at: null,
            tags: [tag],
            ocr_text_override: null,
            is_nsfw: false,
            tagging_status: 'done',
            tagging_error: null,
            thumbnail_status: 'done',
            poster_status: 'not_applicable',
            ocr_text: null,
            is_favorited: false,
          })),
          total: uploadedIds.length,
          next_cursor: null,
          has_more: false,
          page_size: 20,
        },
      });
    });

    await page.route('**/api/v1/media/timeline**', async (route) => {
      await route.fulfill({
        json: {
          buckets: [{ year: 2026, month: 3, count: uploadedIds.length }],
        },
      });
    });

    await page.route('**/api/v1/media/*/thumbnail', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#4f7fbd"/></svg>',
      });
    });

    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect.poll(async () => page.locator('zukan-media-card').count(), { timeout: 15000 }).toBe(2);

    await selectAllVisibleMedia(page);
    await page.getByRole('button', { name: 'Add to album' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Album' }).click();
    await page.getByRole('option', { name: new RegExp(albumName) }).click();
    await dialog.getByRole('button', { name: 'Add to album' }).click();

    await expect(page.locator('.media-browser__action-bar')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText(`Added 2 items to ${albumName}.`)).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
      const ids = await fetchAlbumMediaIds(page, token, album.id);
      return uploadedIds.every((id) => ids.includes(id));
    }, { timeout: 15000 }).toBe(true);

    await deleteMediaIds(page, token, uploadedIds);
  });
});
