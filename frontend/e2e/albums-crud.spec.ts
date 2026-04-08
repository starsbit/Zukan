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

async function uploadPngs(
  page: Page,
  token: string,
  count: number,
): Promise<string[]> {
  const result = await page.evaluate(async ({ authToken, uploadCount }) => {
    const form = new FormData();

    for (let index = 0; index < uploadCount; index += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('2D context unavailable');
      }

      context.fillStyle = `rgb(${(80 + index * 45) % 255}, ${(140 + index * 35) % 255}, ${(200 + index * 25) % 255})`;
      context.fillRect(0, 0, canvas.width, canvas.height);

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
        new File([blob], `album-e2e-${Date.now()}-${index + 1}.png`, { type: 'image/png' }),
      );
    }

    form.append('visibility', 'private');

    const response = await fetch('/api/v1/media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });

    const payload = await response.json() as {
      accepted: number;
      results: Array<{ id: string | null; status: string }>;
    };

    return { status: response.status, payload };
  }, { authToken: token, uploadCount: count });

  expect(result.status).toBe(202);

  return result.payload.results
    .map((item) => item.id)
    .filter((id): id is string => !!id);
}

async function purgeMedia(page: Page, token: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await page.evaluate(async ({ authToken, mediaIds }) => {
    await fetch('/api/v1/media/actions/purge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_ids: mediaIds }),
    });
  }, { authToken: token, mediaIds: ids });
}

async function getAlbumMediaIds(page: Page, token: string, albumId: string): Promise<string[]> {
  return page.evaluate(async ({ authToken, targetAlbumId }) => {
    const response = await fetch(`/api/v1/albums/${targetAlbumId}/media?page_size=50`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const payload = await response.json() as { items: Array<{ id: string }> };
    return payload.items.map((item) => item.id);
  }, { authToken: token, targetAlbumId: albumId });
}

async function selectAllVisibleMedia(page: Page): Promise<void> {
  await page.locator('.media-browser__day-header').first().hover();
  await page.getByLabel('Select date group').filter({ visible: true }).first().click();
  await expect(page.locator('.media-browser__action-bar')).toBeVisible();
}

test.describe.serial('Albums CRUD', () => {
  let token = '';
  let uploadedIds: string[] = [];
  let albumId = '';
  const albumBaseName = `e2e-album-${Date.now()}`;
  const renamedAlbumName = `${albumBaseName}-renamed`;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await ensureAdminAuthenticated(page);
    token = await getAccessToken(page);

    uploadedIds = await uploadPngs(page, token, 2);
    expect(uploadedIds.length).toBe(2);

    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    if (uploadedIds.length > 0) {
      await purgeMedia(page, token, uploadedIds);
    }
    if (albumId) {
      await page.evaluate(async ({ authToken, targetAlbumId }) => {
        await fetch(`/api/v1/albums/${targetAlbumId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }, { authToken: token, targetAlbumId: albumId });
    }
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await ensureAdminAuthenticated(page);
  });

  test('create album via the albums page', async ({ page }) => {
    await page.goto('/album');
    await expect(page).toHaveURL('/album');

    await page.getByRole('button', { name: 'Create album' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Create album' })).toBeVisible();

    await dialog.getByLabel('Name').fill(albumBaseName);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(
      async () => page.locator('zukan-album-card').count(),
      { timeout: 10000 },
    ).toBeGreaterThanOrEqual(1);

    await expect(page.locator('zukan-album-card').filter({ hasText: albumBaseName })).toBeVisible();

    albumId = await page.evaluate(async (authToken) => {
      const response = await fetch('/api/v1/albums?page_size=50', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const payload = await response.json() as { items: Array<{ id: string; name: string }> };
      return payload.items.find((album) => album.name.includes('e2e-album-'))?.id ?? '';
    }, token);

    expect(albumId).not.toBe('');
  });

  test('edit album name via the albums page', async ({ page }) => {
    await page.goto('/album');
    await expect(page).toHaveURL('/album');

    await expect.poll(
      async () => page.locator('zukan-album-card').filter({ hasText: albumBaseName }).count(),
      { timeout: 10000 },
    ).toBeGreaterThanOrEqual(1);

    const card = page.locator('zukan-album-card').filter({ hasText: albumBaseName });
    await card.getByRole('button', { name: 'Edit album' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();

    const nameField = dialog.getByLabel('Name');
    await nameField.clear();
    await nameField.fill(renamedAlbumName);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(
      async () => page.locator('zukan-album-card').filter({ hasText: renamedAlbumName }).count(),
      { timeout: 10000 },
    ).toBeGreaterThanOrEqual(1);
  });

  test('add media to album via bulk gallery selection', async ({ page }) => {
    test.setTimeout(90000);

    await page.route('**/api/v1/media/search**', async (route) => {
      await route.fulfill({
        json: {
          items: uploadedIds.map((id, index) => ({
            id,
            uploader_id: 'u1',
            owner_id: 'u1',
            visibility: 'private',
            filename: `album-e2e-${index + 1}.png`,
            original_filename: null,
            media_type: 'image',
            metadata: {
              file_size: 128,
              width: 16,
              height: 16,
              duration_seconds: null,
              frame_count: null,
              mime_type: 'image/png',
              captured_at: `2026-04-01T12:0${index}:00Z`,
            },
            version: 1,
            created_at: `2026-04-01T12:0${index}:00Z`,
            deleted_at: null,
            tags: [],
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
          buckets: [{ year: 2026, month: 4, count: uploadedIds.length }],
        },
      });
    });

    await page.route('**/api/v1/media/*/thumbnail', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#5a8fc2"/></svg>',
      });
    });

    await page.goto('/');
    await expect(page).toHaveURL('/');

    await expect.poll(
      async () => page.locator('zukan-media-card').count(),
      { timeout: 15000 },
    ).toBe(2);

    await selectAllVisibleMedia(page);
    await page.getByRole('button', { name: 'Add to album' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Album' }).click();
    await page.getByRole('option', { name: new RegExp(renamedAlbumName) }).click();
    await dialog.getByRole('button', { name: 'Add to album' }).click();

    await expect(page.locator('.media-browser__action-bar')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText(`Added 2 items to ${renamedAlbumName}.`)).toBeVisible({ timeout: 15000 });

    await expect.poll(
      async () => {
        const ids = await getAlbumMediaIds(page, token, albumId);
        return uploadedIds.every((id) => ids.includes(id));
      },
      { timeout: 15000 },
    ).toBe(true);
  });

  test('album detail page shows the added media', async ({ page }) => {
    await page.route('**/api/v1/media/*/thumbnail', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#5a8fc2"/></svg>',
      });
    });

    await page.goto(`/album/${albumId}`);

    await expect.poll(
      async () => page.locator('zukan-media-card').count(),
      { timeout: 15000 },
    ).toBe(2);
  });

  test('delete album removes it from the albums list', async ({ page }) => {
    await page.goto('/album');
    await expect(page).toHaveURL('/album');

    await expect.poll(
      async () => page.locator('zukan-album-card').filter({ hasText: renamedAlbumName }).count(),
      { timeout: 10000 },
    ).toBeGreaterThanOrEqual(1);

    const card = page.locator('zukan-album-card').filter({ hasText: renamedAlbumName });
    await card.getByRole('button', { name: 'Delete album' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete album' }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(
      async () => page.locator('zukan-album-card').filter({ hasText: renamedAlbumName }).count(),
      { timeout: 10000 },
    ).toBe(0);

    albumId = '';
  });
});
