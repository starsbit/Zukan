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

      context.fillStyle = `rgb(${(60 + index * 50) % 255}, ${(120 + index * 40) % 255}, ${(180 + index * 30) % 255})`;
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
        new File([blob], `trash-e2e-${Date.now()}-${index + 1}.png`, { type: 'image/png' }),
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
  expect(result.payload.accepted).toBe(count);

  return result.payload.results
    .map((item) => item.id)
    .filter((id): id is string => !!id);
}

async function deleteMedia(page: Page, token: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await page.evaluate(async ({ authToken, mediaIds }) => {
    await fetch('/api/v1/media/actions/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_ids: mediaIds }),
    });
  }, { authToken: token, mediaIds: ids });
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

async function getMediaStatus(
  page: Page,
  token: string,
  id: string,
): Promise<{ deleted_at: string | null } | null> {
  return page.evaluate(async ({ authToken, mediaId }) => {
    const response = await fetch(`/api/v1/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (response.status === 404) {
      return null;
    }

    return response.json() as Promise<{ deleted_at: string | null }>;
  }, { authToken: token, mediaId: id });
}

async function getTrashedCount(page: Page, token: string): Promise<number> {
  return page.evaluate(async (authToken) => {
    const response = await fetch('/api/v1/media/search?state=trashed&page_size=1&include_total=true', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const payload = await response.json() as { total: number };
    return payload.total;
  }, token);
}

test.describe.serial('Trash, restore, and empty trash', () => {
  let token = '';
  const uploadedIds: string[] = [];

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

    const ids = await uploadPngs(page, token, 3);
    uploadedIds.push(...ids);
    expect(uploadedIds.length).toBe(3);

    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (uploadedIds.length === 0) return;
    const page = await browser.newPage();
    await page.goto('/');
    await purgeMedia(page, token, uploadedIds);
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

  test('deleting media moves it to the trash', async ({ page }) => {
    const [targetId] = uploadedIds;

    await deleteMedia(page, token, [targetId]);

    await expect.poll(
      async () => {
        const media = await getMediaStatus(page, token, targetId);
        return media?.deleted_at !== null;
      },
      { timeout: 10000 },
    ).toBe(true);

    await page.goto('/trash');
    await expect(page).toHaveURL('/trash');

    await expect.poll(
      async () => page.locator('zukan-media-card').count(),
      { timeout: 15000 },
    ).toBeGreaterThanOrEqual(1);
  });

  test('restore all brings trashed media back to the active gallery', async ({ page }) => {
    await deleteMedia(page, token, [uploadedIds[0]]);

    await page.goto('/trash');
    await expect(page).toHaveURL('/trash');

    await expect.poll(
      async () => page.locator('zukan-media-card').count(),
      { timeout: 15000 },
    ).toBeGreaterThanOrEqual(1);

    await page.getByRole('button', { name: 'Restore all' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore all' }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(
      async () => {
        const media = await getMediaStatus(page, token, uploadedIds[0]);
        return media?.deleted_at === null;
      },
      { timeout: 15000 },
    ).toBe(true);
  });

  test('empty trash permanently deletes all trashed media', async ({ page }) => {
    const toTrash = [uploadedIds[1], uploadedIds[2]];
    await deleteMedia(page, token, toTrash);

    await expect.poll(
      async () => getTrashedCount(page, token),
      { timeout: 10000 },
    ).toBeGreaterThanOrEqual(2);

    await page.goto('/trash');
    await expect(page).toHaveURL('/trash');

    await expect.poll(
      async () => page.locator('zukan-media-card').count(),
      { timeout: 15000 },
    ).toBeGreaterThanOrEqual(2);

    await page.getByRole('button', { name: 'Empty trash' }).click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Empty trash' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByText('Trash is empty')).toBeVisible({ timeout: 15000 });

    await expect.poll(
      async () => getMediaStatus(page, token, uploadedIds[1]),
      { timeout: 10000 },
    ).toBeNull();

    await expect.poll(
      async () => getMediaStatus(page, token, uploadedIds[2]),
      { timeout: 10000 },
    ).toBeNull();

    uploadedIds.splice(1, 2);
  });
});
