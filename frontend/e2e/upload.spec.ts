import { APIRequestContext, Response, expect, test } from '@playwright/test';

import { createSession, seedLocalAuth } from './helpers/auth';
import {
  getMedia,
  listMedia,
  listMediaWithQuery,
  removeCharacterName,
  removeTag,
  trashMediaByCharacterName,
  trashMediaByTag,
  waitForMedia
} from './helpers/media-api';
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

async function uploadAndResolveMediaId(
  request: APIRequestContext,
  accessToken: string,
  file: ReturnType<typeof bluePngFile>
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    multipart: {
      files: file
    }
  });
  await expect(response).toBeOK();

  const payload = await response.json() as {
    results: Array<{ id: string | null; status: string }>;
  };
  const acceptedId = payload.results.find((item) => item.status === 'accepted' && item.id)?.id;
  if (acceptedId) {
    return acceptedId;
  }

  const listed = await waitForListedMedia(
    request,
    accessToken,
    file.name,
    'page=1&page_size=200&nsfw=include',
    10_000
  );
  return listed.id;
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
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `viewer-edit-blue-${runId}.png`;

  const mediaId = await uploadAndResolveMediaId(
    request,
    session.accessToken,
    bluePngFile(fileName)
  );

  await waitForMedia(
    request,
    session.accessToken,
    mediaId,
    (media) => media.tagging_status === 'done' && media.character_name === 'ayanami_rei'
  );

  await page.goto('/gallery');
  const card = page.locator('app-gallery-media-card').filter({
    has: page.locator(`img[alt="${fileName}"]`)
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

test('removes tags and character names through the management API and updates search sources', async ({ request }) => {
  const session = await createSession(request);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const blueUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile(`manage-blue-${runId}.png`, 'secondary')
    }
  });
  await expect(blueUpload).toBeOK();
  const greenUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: greenPngFile(`manage-green-${runId}.png`)
    }
  });
  await expect(greenUpload).toBeOK();

  const bluePayload = await blueUpload.json();
  const greenPayload = await greenUpload.json();
  expect(bluePayload.accepted).toBe(1);
  expect(greenPayload.accepted).toBe(1);
  const blueId = bluePayload.results[0]?.id as string;
  const greenId = greenPayload.results[0]?.id as string;
  expect(blueId).toBeTruthy();
  expect(greenId).toBeTruthy();

  await waitForMedia(request, session.accessToken, blueId, (media) => media.tagging_status === 'done');
  await waitForMedia(request, session.accessToken, greenId, (media) => media.tagging_status === 'done');

  const removedCharacter = await removeCharacterName(request, session.accessToken, 'ayanami_rei');
  expect(removedCharacter.matched_media).toBe(1);
  expect(removedCharacter.updated_media).toBe(1);

  const blueAfterCharacterDelete = await getMedia(request, session.accessToken, blueId);
  expect(blueAfterCharacterDelete.character_name).toBeNull();

  const removedTag = await removeTag(request, session.accessToken, 'forest');
  expect(removedTag.matched_media).toBe(1);
  expect(removedTag.updated_media).toBe(1);

  const greenAfterTagDelete = await getMedia(request, session.accessToken, greenId);
  expect(greenAfterTagDelete.tags).not.toContain('forest');
});

test('moves media to trash, restores one item from trash, and empties the remainder', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const firstName = `multi-select-a-${runId}.png`;
  const secondName = `multi-select-b-${runId}.png`;

  const firstMediaId = await uploadAndResolveMediaId(
    request,
    session.accessToken,
    bluePngFile(firstName)
  );
  const secondMediaId = await uploadAndResolveMediaId(
    request,
    session.accessToken,
    bluePngFile(secondName, 'secondary')
  );

  await waitForMedia(request, session.accessToken, firstMediaId, (media) => media.tagging_status === 'done');
  await waitForMedia(request, session.accessToken, secondMediaId, (media) => media.tagging_status === 'done');

  await page.goto('/gallery');
  await expect(page.locator(`img[alt="${firstName}"]`)).toBeVisible();
  await expect(page.locator(`img[alt="${secondName}"]`)).toBeVisible();

  const firstCard = page.locator('app-gallery-media-card').filter({ has: page.locator(`img[alt="${firstName}"]`) }).first();
  const secondCard = page.locator('app-gallery-media-card').filter({ has: page.locator(`img[alt="${secondName}"]`) }).first();
  const firstCardButton = firstCard.locator('.media-card');
  const secondCardButton = secondCard.locator('.media-card');

  await firstCard.hover();
  await firstCard.getByRole('button', { name: `Select ${firstName}` }).click();
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
  await expect(page.locator(`img[alt="${firstName}"]`)).toHaveCount(0);
  await expect(page.locator(`img[alt="${secondName}"]`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload media' })).toBeVisible();

  const activeItems = await listMedia(request, session.accessToken);
  expect(activeItems.some((item) => item.original_filename === firstName)).toBe(false);
  expect(activeItems.some((item) => item.original_filename === secondName)).toBe(false);

  const trashedItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashedItems.some((item) => item.original_filename === firstName)).toBe(true);
  expect(trashedItems.some((item) => item.original_filename === secondName)).toBe(true);

  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page).toHaveURL(/\/gallery\/trash$/);
  await expect(page.locator(`img[alt="${firstName}"]`)).toBeVisible();
  await expect(page.locator(`img[alt="${secondName}"]`)).toBeVisible();

  const trashedFirstCard = page.locator('app-gallery-media-card').filter({
    has: page.locator(`img[alt="${firstName}"]`)
  }).first();
  await trashedFirstCard.hover();
  await expect(trashedFirstCard.getByRole('button', { name: `Select ${firstName}` })).toBeVisible();
  await trashedFirstCard.getByRole('button', { name: `Select ${firstName}` }).click({ force: true });
  await page.locator('.selection-toolbar').getByRole('button', { name: 'Restore' }).click();

  await expect(page.locator(`img[alt="${firstName}"]`)).toHaveCount(0);
  await expect(page.locator(`img[alt="${secondName}"]`)).toBeVisible();

  const activeAfterRestore = await listMedia(request, session.accessToken);
  expect(activeAfterRestore.some((item) => item.original_filename === firstName)).toBe(true);
  expect(activeAfterRestore.some((item) => item.original_filename === secondName)).toBe(false);

  const trashAfterRestore = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashAfterRestore.some((item) => item.original_filename === firstName)).toBe(false);
  expect(trashAfterRestore.some((item) => item.original_filename === secondName)).toBe(true);

  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.locator(`img[alt="${firstName}"]`)).toBeVisible();
  await expect(page.locator(`img[alt="${secondName}"]`)).toHaveCount(0);

  await page.getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();

  const trashAfterEmpty = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashAfterEmpty).toEqual([]);
});

test('trashes media by tag and character name through the management API, then restores and purges with existing trash flows', async ({ page, request }) => {
  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const blueUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: bluePngFile('manage-trash-blue.png')
    }
  });
  await expect(blueUpload).toBeOK();

  const greenUpload = await request.post(`${API_BASE_URL}/media`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    },
    multipart: {
      files: greenPngFile('manage-trash-green.png')
    }
  });
  await expect(greenUpload).toBeOK();

  const blueId = (await blueUpload.json()).results[0]?.id as string;
  const greenId = (await greenUpload.json()).results[0]?.id as string;

  await waitForMedia(request, session.accessToken, blueId, (media) => media.tagging_status === 'done');
  await waitForMedia(request, session.accessToken, greenId, (media) => media.tagging_status === 'done');

  const tagTrashResult = await trashMediaByTag(request, session.accessToken, 'forest');
  expect(tagTrashResult.matched_media).toBe(1);
  expect(tagTrashResult.trashed_media).toBe(1);

  const characterTrashResult = await trashMediaByCharacterName(request, session.accessToken, 'ayanami_rei');
  expect(characterTrashResult.matched_media).toBe(1);
  expect(characterTrashResult.trashed_media).toBe(1);

  await page.goto('/gallery/trash');
  await expect(page.locator('img[alt="manage-trash-blue.png"]')).toBeVisible();
  await expect(page.locator('img[alt="manage-trash-green.png"]')).toBeVisible();

  const blueCard = page.locator('app-gallery-media-card').filter({
    has: page.locator('img[alt="manage-trash-blue.png"]')
  }).first();
  await blueCard.hover();
  await blueCard.getByRole('button', { name: 'Select manage-trash-blue.png' }).click();
  await page.locator('.selection-toolbar').getByRole('button', { name: 'Restore' }).click();

  await expect(page.locator('img[alt="manage-trash-blue.png"]')).toHaveCount(0);
  await expect(page.locator('img[alt="manage-trash-green.png"]')).toBeVisible();

  const activeItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&nsfw=include');
  expect(activeItems.some((item) => item.original_filename === 'manage-trash-blue.png')).toBe(true);
  expect(activeItems.some((item) => item.original_filename === 'manage-trash-green.png')).toBe(false);

  await page.getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();

  const trashedItems = await listMediaWithQuery(request, session.accessToken, 'page=1&page_size=50&state=trashed&nsfw=include');
  expect(trashedItems).toEqual([]);

  const greenResponse = await request.get(`${API_BASE_URL}/media/${greenId}`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    }
  });
  expect(greenResponse.status()).toBe(404);
});

test('allows reuploading the same files after trash is emptied through the API', async ({ request }) => {
  const session = await createSession(request);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const firstName = `reupload-after-purge-a-${runId}.png`;
  const secondName = `reupload-after-purge-b-${runId}.png`;

  const originalFiles = [
    bluePngFile(firstName),
    greenPngFile(secondName)
  ];

  for (const file of originalFiles) {
    const uploadResponse = await request.post(`${API_BASE_URL}/media`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      },
      multipart: {
        files: file
      }
    });
    await expect(uploadResponse).toBeOK();
    const payload = await uploadResponse.json();
    expect(payload.accepted).toBe(1);
    expect(payload.results[0]?.status).toBe('accepted');
  }

  const activeItems = await listMedia(request, session.accessToken);
  const mediaIds = activeItems
    .filter((item) => item.original_filename === firstName || item.original_filename === secondName)
    .map((item) => item.id);

  expect(mediaIds).toHaveLength(2);

  for (const file of originalFiles) {
    const duplicateResponse = await request.post(`${API_BASE_URL}/media`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      },
      multipart: {
        files: file
      }
    });
    await expect(duplicateResponse).toBeOK();
    const payload = await duplicateResponse.json();
    expect(payload.accepted).toBe(0);
    expect(payload.duplicates).toBe(1);
    expect(payload.results[0]?.status).toBe('duplicate');
  }

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

  for (const file of originalFiles) {
    const reuploadResponse = await request.post(`${API_BASE_URL}/media`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      },
      multipart: {
        files: file
      }
    });
    await expect(reuploadResponse).toBeOK();
    const payload = await reuploadResponse.json();
    expect(payload.accepted).toBe(1);
    expect(payload.results[0]?.status).toBe('accepted');
  }

  const itemsAfterReupload = await listMedia(request, session.accessToken);
  expect(itemsAfterReupload.filter((item) => item.original_filename === firstName || item.original_filename === secondName)).toHaveLength(2);
});

test('uploads a 250-image batch from the gallery without backend 400 errors', async ({ page, request }) => {
  test.setTimeout(180_000);

  const session = await createSession(request);
  await seedLocalAuth(page, session);

  const batchSize = 250;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const files = Array.from({ length: batchSize }, (_, index) => (
    bluePngFile(
      `bulk-upload-${runId}-${String(index + 1).padStart(3, '0')}.png`,
      index % 2 === 0 ? 'primary' : 'secondary'
    )
  ));

  const baselineResponse = await request.get(`${API_BASE_URL}/media?page=1&page_size=1&nsfw=include`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`
    }
  });
  await expect(baselineResponse).toBeOK();
  const baselineTotal = (await baselineResponse.json() as { total: number }).total;

  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Upload media' }).click();
  const uploadResponseStatuses: number[] = [];
  const uploadPayloadPromises: Array<Promise<{ accepted: number; duplicates: number; errors: number }>> = [];
  const onResponse = (response: Response) => {
    if (response.url() === `${API_BASE_URL}/media` && response.request().method() === 'POST') {
      uploadResponseStatuses.push(response.status());
      if (response.status() === 202) {
        uploadPayloadPromises.push(response.json() as Promise<{ accepted: number; duplicates: number; errors: number }>);
      }
    }
  };
  page.on('response', onResponse);
  await page.locator('input[type="file"]').setInputFiles(files);

  const deadline = Date.now() + 120_000;
  let observedTotal = 0;
  let lastObservedTotal = -1;
  let lastResponseCount = 0;
  let unchangedRounds = 0;
  while (Date.now() < deadline) {
    const response = await request.get(`${API_BASE_URL}/media?page=1&page_size=1&nsfw=include`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      }
    });
    await expect(response).toBeOK();

    const payload = await response.json() as { total: number };
    observedTotal = payload.total;

    const responseCount = uploadResponseStatuses.length;
    if (responseCount > 0 && observedTotal === lastObservedTotal && responseCount === lastResponseCount) {
      unchangedRounds += 1;
    } else {
      unchangedRounds = 0;
    }

    lastObservedTotal = observedTotal;
    lastResponseCount = responseCount;

    if (unchangedRounds >= 6) {
      break;
    }

    await page.waitForTimeout(500);
  }

  page.off('response', onResponse);
  const uploadPayloads = await Promise.all(uploadPayloadPromises);
  const acceptedTotal = uploadPayloads.reduce((sum, payload) => sum + payload.accepted, 0);
  const duplicatesTotal = uploadPayloads.reduce((sum, payload) => sum + payload.duplicates, 0);
  const errorsTotal = uploadPayloads.reduce((sum, payload) => sum + payload.errors, 0);

  expect(uploadResponseStatuses.length).toBeGreaterThan(0);
  expect(uploadResponseStatuses.every((status) => status === 202)).toBeTruthy();
  expect(acceptedTotal + duplicatesTotal + errorsTotal).toBe(batchSize);
  expect(errorsTotal).toBe(0);
  expect(observedTotal - baselineTotal).toBe(acceptedTotal);
});
