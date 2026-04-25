import { expect, test } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

const transparentWebp = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=',
  'base64',
);

test.describe('Character graph', () => {
  test('renders a graph and opens character details from search', async ({ page }) => {
    await seedAuthenticatedSession(page, { is_admin: false });

    await page.route('**/api/v1/graphs/characters/search**', async (route) => {
      await route.fulfill({
        json: [{ id: 'c1', name: 'Saber', media_count: 5 }],
      });
    });

    await page.route(/\/api\/v1\/graphs\/characters(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          model_version: 'clip_onnx_v1',
          total_characters_considered: 2,
          center_entity_id: null,
          nodes: [
            {
              id: 'c1',
              name: 'Saber',
              media_count: 5,
              embedding_support: 5,
              series_names: ['fate'],
              representative_media_ids: ['m1'],
            },
            {
              id: 'c2',
              name: 'Rin Tohsaka',
              media_count: 4,
              embedding_support: 4,
              series_names: ['fate'],
              representative_media_ids: [],
            },
          ],
          edges: [
            {
              id: 'c1:c2',
              source: 'c1',
              target: 'c2',
              similarity: 0.9,
              shared_series: ['fate'],
            },
          ],
        },
      });
    });

    await page.route('**/api/v1/media/m1/thumbnail', async (route) => {
      await route.fulfill({
        body: transparentWebp,
        contentType: 'image/webp',
      });
    });

    await page.goto('/graph/characters');
    await expect(page.getByRole('heading', { name: 'Similarity Map' })).toBeVisible();
    await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('.graph-canvas canvas'));
      return canvases.some((canvas) => {
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) {
          return false;
        }
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 0) {
            return true;
          }
        }
        return false;
      });
    })).toBe(true);

    await page.getByLabel('Character search').fill('Saber');
    await page.getByRole('option', { name: /Saber/ }).click();

    await expect(page.getByRole('heading', { name: 'Saber' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open media search/ })).toBeVisible();
  });
});
