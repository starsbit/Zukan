import { expect, test } from '@playwright/test';

import { createSession, seedLocalAuth } from './helpers/auth';
import { listMedia, listMediaWithQuery, waitForMedia } from './helpers/media-api';
import { bluePngFile, redPngFile } from './helpers/media-fixtures';

const API_BASE_URL = process.env['PLAYWRIGHT_E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8010';

test('uploads an image through the UI, renders it in the gallery, and applies tags in the backend', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  await page.goto('/gallery');
  await expect(page.getByRole('button', { name: 'Upload media' })).toBeVisible();

  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles([bluePngFile()]);
  await page.getByRole('button', { name: 'Start upload' }).click();

  await expect(page.getByText('Upload status')).toBeVisible();
  await expect(page.locator('mat-dialog-container').getByText('Completed')).toBeVisible();
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
  await page.locator('input[type="file"]').setInputFiles([bluePngFile('auto-refresh-blue.png')]);
  await page.getByRole('button', { name: 'Start upload' }).click();

  const uploadedCard = page.locator('app-gallery-media-card').filter({
    has: page.locator('img[alt="auto-refresh-blue.png"]')
  }).first();
  const statusBadge = uploadedCard.locator('.status-badge');

  await expect(uploadedCard).toBeVisible();
  await expect(statusBadge).toContainText(/Pending|Processing/);

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
      files: bluePngFile('api-blue-upload.png', 'secondary')
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
  await page.getByRole('button', { name: 'Start upload' }).click();

  await expect(page.getByText('Upload status')).toBeVisible();

  const mediaItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&nsfw=include');
  const uploaded = mediaItems.find((item) => item.original_filename === 'red-upload.png');
  expect(uploaded).toBeTruthy();

  const deadline = Date.now() + 10_000;
  let tagged = uploaded!;
  while (Date.now() < deadline) {
    const items = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&nsfw=include');
    const nextMatch = items.find((item) => item.id === uploaded!.id);
    if (nextMatch && nextMatch.tagging_status === 'done' && nextMatch.tags.includes('rose')) {
      tagged = nextMatch;
      break;
    }
    await page.waitForTimeout(250);
  }

  expect(tagged.tags).toContain('rose');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Refresh gallery' }).click();
  await expect(page.locator('img[alt="red-upload.png"]')).toHaveCount(0);
});

test('moves media to trash, restores one item from trash, and empties the remainder', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const firstUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('multi-select-a.png', 'primary')
    }
  });
  await expect(firstUpload).toBeOK();

  const secondUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('multi-select-b.png', 'secondary')
    }
  });
  await expect(secondUpload).toBeOK();

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
    bluePngFile('reupload-after-purge-a.png', 'primary'),
    bluePngFile('reupload-after-purge-b.png', 'secondary')
  ];

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles(originalFiles);
  await page.getByRole('button', { name: 'Start upload' }).click();

  await expect(page.getByText('Upload status')).toBeVisible();
  await expect(page.locator('mat-dialog-container').getByText('2 accepted')).toBeVisible();
  await expect(page.locator('mat-dialog-container').getByText('0 duplicates')).toBeVisible();
  await expect(page.locator('img[alt="reupload-after-purge-a.png"]')).toBeVisible();
  await expect(page.locator('img[alt="reupload-after-purge-b.png"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Upload media' }).click();
  await page.locator('input[type="file"]').setInputFiles(originalFiles);
  await page.getByRole('button', { name: 'Start upload' }).click();

  await expect(page.locator('mat-dialog-container').getByText('0 accepted')).toBeVisible();
  await expect(page.locator('mat-dialog-container').getByText('2 duplicates')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

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
  await page.getByRole('button', { name: 'Start upload' }).click();

  await expect(page.locator('mat-dialog-container').getByText('2 accepted')).toBeVisible();
  await expect(page.locator('mat-dialog-container').getByText('0 duplicates')).toBeVisible();
});
