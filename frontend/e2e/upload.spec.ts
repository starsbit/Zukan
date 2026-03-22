import { APIRequestContext, expect, test } from '@playwright/test';

import { createSession, seedLocalAuth } from './helpers/auth';
import { getMedia, listMedia, listMediaWithQuery, waitForMedia } from './helpers/media-api';
import { blackPngFile, bluePngFile, greenPngFile, redPngFile } from './helpers/media-fixtures';

const API_BASE_URL = process.env['PLAYWRIGHT_E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8010';

async function waitForListedMedia(
  request: APIRequestContext,
  accessToken: string,
  originalFilename: string,
  query = 'page=1&page_size=50&nsfw=include',
  timeoutMs = 10_000,
  predicate?: (item: Awaited<ReturnType<typeof listMediaWithQuery>>[number]) => boolean
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const items = await listMediaWithQuery(request, accessToken, query);
    const match = items.find((item) => item.original_filename === originalFilename);
    if (match && (!predicate || predicate(match))) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${originalFilename} to appear in ${query}`);
}

test('uploads an image through the UI, renders it in the gallery, and applies tags in the backend', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await expect(page.getByRole('button', { name: 'Upload media' })).toBeVisible();

  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([bluePngFile()]);

  await expect(page.locator('img[alt="blue-upload.png"]')).toBeVisible();

  const mediaItems = await listMedia(request, session.accessToken);
  const uploaded = mediaItems.find((item) => item.original_filename === 'blue-upload.png');
  expect(uploaded).toBeTruthy();

  const tagged = await waitForMedia(
    request,
    session.accessToken,
    uploaded!.id,
    (media) => media.tagging_status === 'done' && media.tags.includes('sky') && media.character_name === 'ayanami_rei'
  );

  expect(tagged.thumbnail_status).toBe('done');
});

test('auto refreshes uploaded image state in the gallery when tagging finishes', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([bluePngFile('auto-refresh-blue.png', 'secondary')]);

  const uploadedCard = page.locator('app-gallery-media-card').filter({
    has: page.locator('img[alt="auto-refresh-blue.png"]')
  }).first();
  const statusBadge = uploadedCard.locator('.status-badge');

  await expect(uploadedCard).toBeVisible();

  const mediaItems = await listMedia(request, session.accessToken);
  const uploaded = mediaItems.find((item) => item.original_filename === 'auto-refresh-blue.png');
  expect(uploaded).toBeTruthy();

  await waitForMedia(
    request,
    session.accessToken,
    uploaded!.id,
    (media) => media.tagging_status === 'done'
  );

  await expect(statusBadge).toHaveCount(0);
});

test('processes uploaded media through the API and persists derived tags', async ({ request }) => {
  const session = await createSession(request);
  const upload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('api-blue-upload.png')
    }
  });
  await expect(upload).toBeOK();

  const uploadPayload = await upload.json();
  const mediaId = uploadPayload.results[0]?.id as string;
  expect(mediaId).toBeTruthy();

  const tagged = await waitForMedia(
    request,
    session.accessToken,
    mediaId,
    (media) => media.tagging_status === 'done' && media.tags.includes('blue')
  );

  expect(tagged.tags).toContain('sky');
  expect(tagged.character_name).toBe('ayanami_rei');
});

test('marks red uploads as tagged and leaves them hidden from the default gallery filter', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([redPngFile()]);

  const tagged = await waitForListedMedia(
    request,
    session.accessToken,
    'red-upload.png',
    'page=1&page_size=50&nsfw=include',
    10_000,
    (media) => media.tagging_status === 'done' && media.tags.includes('rose')
  );

  expect(tagged.tags).toContain('rose');
  await expect(page.getByRole('heading', { name: 'Add the missing character' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('img[alt="red-upload.png"]')).toHaveCount(0);
});

test('opens the upload review popup for missing characters and saves manual tags', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([greenPngFile('green-review.png')]);

  await expect(page.getByRole('heading', { name: 'Add the missing character' })).toBeVisible();
  await expect(page.getByText(/no character was found/i)).toBeVisible();

  const characterInput = page.getByLabel('Character name');
  await characterInput.fill('ikari_shinji');

  const tagInput = page.getByLabel('Add tag');
  await tagInput.fill('mecha');
  await page.getByRole('button', { name: 'Add current tag' }).click();
  await page.getByRole('button', { name: 'Remove tag forest' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  const mediaItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&nsfw=include');
  const uploaded = mediaItems.find((item) => item.original_filename === 'green-review.png');
  expect(uploaded).toBeTruthy();

  const updated = await waitForMedia(
    request,
    session.accessToken,
    uploaded!.id,
    (media) => media.character_name === 'ikari_shinji' && media.tags.includes('mecha') && !media.tags.includes('forest')
  );

  expect(updated.tags).toContain('green');
});

test('shows the failure review popup and lets the user skip it', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([blackPngFile('failed-review.png')]);

  await expect(page.getByRole('heading', { name: 'Tagging needs your review' })).toBeVisible();
  await expect(page.getByText(/Synthetic tagging failure/i)).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tagging needs your review' })).toHaveCount(0);

  const mediaItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&nsfw=include');
  const uploaded = mediaItems.find((item) => item.original_filename === 'failed-review.png');
  expect(uploaded).toBeTruthy();

  const failed = await getMedia(request, session.accessToken, uploaded!.id);
  expect(failed.tagging_status).toBe('failed');
});

test('queues multiple flagged uploads sequentially and supports skip all', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([
    greenPngFile('queue-green.png'),
    blackPngFile('queue-black.png')
  ]);

  await expect(page.getByRole('heading', { name: 'Add the missing character' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tagging needs your review' })).toBeVisible();
  await page.getByText(/Synthetic tagging failure/i).waitFor();
  await page.getByRole('button', { name: 'Skip all' }).click();
  await expect(page.getByRole('heading', { name: 'Tagging needs your review' })).toHaveCount(0);
});

test('allows editing tags from the image inspector', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const upload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('viewer-edit-blue.png')
    }
  });
  await expect(upload).toBeOK();
  const payload = await upload.json();
  const mediaId = payload.results[0]?.id as string;

  await waitForMedia(
    request,
    session.accessToken,
    mediaId,
    (media) => media.tagging_status === 'done' && media.character_name === 'ayanami_rei'
  );

  await page.goto('/gallery');
  const card = page.locator('app-gallery-media-card').filter({
    has: page.locator('img[alt="viewer-edit-blue.png"]')
  }).first();
  await card.locator('.media-card').click();

  await page.getByRole('button', { name: 'Show tags panel' }).click();
  await page.getByRole('button', { name: 'Edit tags and character' }).click();
  await page.getByRole('button', { name: 'Remove tag sky' }).click();
  await page.getByLabel('Add tag').fill('eva');
  await page.getByRole('button', { name: 'Add current tag' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  const updated = await waitForMedia(
    request,
    session.accessToken,
    mediaId,
    (media) => media.tags.includes('eva') && !media.tags.includes('sky')
  );

  expect(updated.character_name).toBe('ayanami_rei');
});

test('moves media to trash, restores one item from trash, and empties the remainder', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const firstUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('multi-select-a.png')
    }
  });
  await expect(firstUpload).toBeOK();

  const secondUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('multi-select-b.png')
    }
  });
  await expect(secondUpload).toBeOK();
  await waitForListedMedia(request, session.accessToken, 'multi-select-a.png');
  await waitForListedMedia(request, session.accessToken, 'multi-select-b.png');

  await page.goto('/gallery');
  await expect(page.locator('img[alt="multi-select-a.png"]')).toBeVisible();
  await expect(page.locator('img[alt="multi-select-b.png"]')).toBeVisible();

  const firstCard = page.locator('app-gallery-media-card').filter({ has: page.locator('img[alt="multi-select-a.png"]') }).first();
  const secondCard = page.locator('app-gallery-media-card').filter({ has: page.locator('img[alt="multi-select-b.png"]') }).first();
  const firstCardButton = firstCard.locator('.media-card');
  const secondCardButton = secondCard.locator('.media-card');

  await firstCard.hover();
  await firstCard.getByRole('button', { name: 'Select multi-select-a.png' }).click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await expect(firstCardButton).toHaveClass(/media-card-selected/);

  await secondCardButton.click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(secondCardButton).toHaveClass(/media-card-selected/);

  await secondCardButton.click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await expect(secondCardButton).not.toHaveClass(/media-card-selected/);

  await secondCardButton.click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(secondCardButton).toHaveClass(/media-card-selected/);

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('img[alt="multi-select-a.png"]')).toHaveCount(0);
  await expect(page.locator('img[alt="multi-select-b.png"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload media' })).toBeVisible();

  const activeItems = await listMedia(request, session.accessToken);
  expect(activeItems.some((item) => item.original_filename === 'multi-select-a.png')).toBe(false);
  expect(activeItems.some((item) => item.original_filename === 'multi-select-b.png')).toBe(false);

  const trashedItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashedItems.some((item) => item.original_filename === 'multi-select-a.png')).toBe(true);
  expect(trashedItems.some((item) => item.original_filename === 'multi-select-b.png')).toBe(true);

  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page).toHaveURL(/\/gallery\/trash$/);
  await expect(page.locator('img[alt="multi-select-a.png"]')).toBeVisible();
  await expect(page.locator('img[alt="multi-select-b.png"]')).toBeVisible();

  const trashedFirstCard = page.locator('app-gallery-media-card').filter({
    has: page.locator('img[alt="multi-select-a.png"]')
  }).first();
  await trashedFirstCard.hover();
  await trashedFirstCard.getByRole('button', { name: 'Select multi-select-a.png' }).click();
  await page.locator('.selection-toolbar').getByRole('button', { name: 'Restore' }).click();

  await expect(page.locator('img[alt="multi-select-a.png"]')).toHaveCount(0);
  await expect(page.locator('img[alt="multi-select-b.png"]')).toBeVisible();

  const activeAfterRestore = await listMedia(request, session.accessToken);
  expect(activeAfterRestore.some((item) => item.original_filename === 'multi-select-a.png')).toBe(true);
  expect(activeAfterRestore.some((item) => item.original_filename === 'multi-select-b.png')).toBe(false);

  const trashAfterRestore = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashAfterRestore.some((item) => item.original_filename === 'multi-select-a.png')).toBe(false);
  expect(trashAfterRestore.some((item) => item.original_filename === 'multi-select-b.png')).toBe(true);

  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.locator('img[alt="multi-select-a.png"]')).toBeVisible();
  await expect(page.locator('img[alt="multi-select-b.png"]')).toHaveCount(0);

  await page.getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();

  const trashAfterEmpty = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashAfterEmpty).toEqual([]);
});

test('allows reuploading the same files after trash is emptied through the API', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const originalFiles = [
    bluePngFile('reupload-after-purge-a.png'),
    bluePngFile('reupload-after-purge-b.png')
  ];

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles(originalFiles);

  await expect(page.locator('img[alt="reupload-after-purge-a.png"]')).toBeVisible();
  await expect(page.locator('img[alt="reupload-after-purge-b.png"]')).toBeVisible();

  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles(originalFiles);

  await page.waitForTimeout(500);

  const activeItems = await listMedia(request, session.accessToken);
  const mediaIds = activeItems
    .filter((item) => item.original_filename === 'reupload-after-purge-a.png' || item.original_filename === 'reupload-after-purge-b.png')
    .map((item) => item.id);

  expect(mediaIds).toHaveLength(2);

  const trashResponse = await request.patch(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    data: {
      media_ids: mediaIds,
      deleted: true
    }
  });
  await expect(trashResponse).toBeOK();

  const emptyTrashResponse = await request.delete(`${API_BASE_URL}/media/trash`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    }
  });
  expect(emptyTrashResponse.status()).toBe(204);

  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles(originalFiles);

  await expect(page.locator('img[alt="reupload-after-purge-a.png"]')).toBeVisible();
  await expect(page.locator('img[alt="reupload-after-purge-b.png"]')).toBeVisible();
});
