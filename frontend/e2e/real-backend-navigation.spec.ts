import { expect, test, type Page } from '@playwright/test';
import { ensureAdminAuthenticated, resetBrowserState } from './helpers/auth';

async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () => localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'),
  );
  if (!token) {
    throw new Error('No access token found after login');
  }
  return token;
}

async function uploadImages(page: Page, count: number): Promise<string[]> {
  const token = await accessToken(page);
  const result = await page.evaluate(
    async ({ authToken, uploadCount }) => {
      const form = new FormData();
      for (let index = 0; index < uploadCount; index += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d')!;
        for (let x = 0; x < 32; x += 4) {
          for (let y = 0; y < 32; y += 4) {
            context.fillStyle = `hsl(${Math.random() * 360}, 70%, 50%)`;
            context.fillRect(x, y, 4, 4);
          }
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('No blob'))), 'image/png');
        });
        form.append('files', new File([blob], `real-nav-${Date.now()}-${index}.png`, { type: 'image/png' }));
      }
      const response = await fetch('/api/v1/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });
      return {
        status: response.status,
        payload: (await response.json()) as { results: Array<{ id: string | null }> },
      };
    },
    { authToken: token, uploadCount: count },
  );
  expect(result.status).toBe(202);
  return result.payload.results.map((item) => item.id).filter((id): id is string => !!id);
}

async function postJson(page: Page, path: string, body: unknown): Promise<number> {
  const token = await accessToken(page);
  return page.evaluate(
    async ({ authToken, url, payload }) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.status;
    },
    { authToken: token, url: path, payload: body },
  );
}

test.describe.serial('Media navigation against the real API', () => {
  let mediaIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await resetBrowserState(page);
    await ensureAdminAuthenticated(page);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetBrowserState(page);
    await ensureAdminAuthenticated(page);
    await postJson(page, '/api/v1/media/actions/delete', { media_ids: mediaIds });
    await postJson(page, '/api/v1/media/actions/purge', { media_ids: mediaIds });
    await page.close();
  });

  test('opens an uploaded image, loads similar images and returns to the grid', async ({ page }) => {
    mediaIds = await uploadImages(page, 4);
    expect(mediaIds).toHaveLength(4);

    await page.goto('/gallery');
    const card = page.locator(`zukan-media-card[data-media-id="${mediaIds[0]}"]`);
    await expect(card).toBeVisible();
    const top = await card.evaluate((node) => node.getBoundingClientRect().top);

    const similar = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/media/${mediaIds[0]}/similar`),
    );
    await card.click();
    await expect(page).toHaveURL(`/gallery/media/${mediaIds[0]}`);
    expect((await similar).status()).toBe(200);
    await expect(page.locator('zukan-similar-media-grid')).toBeAttached();

    await page.goBack();
    await expect(page).toHaveURL('/gallery');
    await expect(card).toBeInViewport();
    const after = await card.evaluate((node) => node.getBoundingClientRect().top);
    expect(Math.abs(after - top)).toBeLessThanOrEqual(5);
  });

  test('a reload on an image keeps it open and closing stays in the app', async ({ page }) => {
    await page.goto(`/gallery/media/${mediaIds[1]}`);
    const viewer = page.locator('zukan-media-inspector-dialog');
    await expect(viewer).toBeVisible();

    await page.reload();
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/gallery');
    await expect(page.locator(`zukan-media-card[data-media-id="${mediaIds[1]}"]`)).toBeVisible();
  });

  test('stepping between real images updates the URL and keeps one Back to the grid', async ({ page }) => {
    await page.goto('/gallery');
    await page.locator(`zukan-media-card[data-media-id="${mediaIds[1]}"]`).click();
    await expect(page).toHaveURL(`/gallery/media/${mediaIds[1]}`);

    const viewer = page.locator('zukan-media-inspector-dialog');
    await viewer.getByRole('button', { name: 'Next media' }).click();
    await expect(page).not.toHaveURL(`/gallery/media/${mediaIds[1]}`);

    await page.goBack();
    await expect(page).toHaveURL('/gallery');
  });

  test('an unknown image shows an error with a way back', async ({ page }) => {
    await page.goto('/media/00000000-0000-4000-8000-000000000000');

    await expect(page.getByText('Unable to load this media.')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL('/gallery');
  });

  test('a trashed image opens from trash without asking for similar images', async ({ page }) => {
    expect(await postJson(page, '/api/v1/media/actions/delete', { media_ids: [mediaIds[3]] })).toBeLessThan(300);
    const similarRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/similar')) {
        similarRequests.push(request.url());
      }
    });

    await page.goto('/trash');
    await page.locator(`zukan-media-card[data-media-id="${mediaIds[3]}"]`).click();
    await expect(page).toHaveURL(`/trash/media/${mediaIds[3]}`);
    await expect(page.locator('zukan-media-inspector-dialog')).toBeVisible();
    expect(similarRequests).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL('/trash');
  });

  test('a series name containing a slash can be removed', async ({ page }) => {
    test.fail(true, 'Encoded slashes are decoded before routing, so /series-names/{series_name}/... returns 404.');
    const token = await accessToken(page);
    const status = await page.evaluate(
      async ({ authToken, mediaId }) => {
        const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
        const assigned = await fetch('/api/v1/media/entities', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ media_ids: [mediaId], series_names: ['Fate/stay night'] }),
        });
        if (!assigned.ok) {
          throw new Error(`Could not assign the series: ${assigned.status}`);
        }
        const response = await fetch(
          `/api/v1/series-names/${encodeURIComponent('Fate/stay night')}/actions/remove-from-media`,
          { method: 'POST', headers },
        );
        return response.status;
      },
      { authToken: token, mediaId: mediaIds[2] },
    );
    expect(status).toBe(200);
  });
});
