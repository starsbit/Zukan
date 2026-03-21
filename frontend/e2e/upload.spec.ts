import { expect, test } from '@playwright/test';

import { createSession, seedLocalAuth } from './helpers/auth';
import { listMedia, listMediaWithQuery, waitForMedia } from './helpers/media-api';
import { bluePngFile, redPngFile } from './helpers/media-fixtures';

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

test('processes uploaded media through the API and persists derived tags', async ({ request }) => {
  const session = await createSession(request);
  const upload = await request.post('http://127.0.0.1:8000/media', {
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
