import { expect, test, type Page, type Route } from '@playwright/test';
import { seedAuthenticatedSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function mediaItem(
  id: string,
  mediaType: 'image' | 'gif' | 'video',
  overrides: Partial<Record<string, unknown>> = {},
) {
  const mimeType =
    mediaType === 'video' ? 'video/mp4' : mediaType === 'gif' ? 'image/gif' : 'image/png';

  return {
    id,
    uploader_id: 'u1',
    uploader_username: 'admin',
    owner_id: 'u1',
    owner_username: 'admin',
    visibility: 'private',
    filename: `${id}.${mediaType === 'video' ? 'mp4' : mediaType === 'gif' ? 'gif' : 'png'}`,
    original_filename: `${id}-original.${mediaType === 'video' ? 'mp4' : mediaType === 'gif' ? 'gif' : 'png'}`,
    media_type: mediaType,
    metadata: {
      file_size: 100,
      width: 1200,
      height: 800,
      duration_seconds: mediaType === 'video' ? 4 : null,
      frame_count: mediaType === 'video' ? 96 : null,
      mime_type: mimeType,
      captured_at: '2026-03-28T12:00:00Z',
    },
    version: 1,
    created_at: '2026-03-28T12:00:00Z',
    deleted_at: null,
    tags: mediaType === 'image' ? ['starter-tag'] : [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: 'done',
    tagging_error: null,
    thumbnail_status: 'done',
    poster_status: mediaType === 'video' ? 'done' : 'not_applicable',
    ocr_text: mediaType === 'image' ? 'Detected line' : null,
    is_favorited: false,
    favorite_count: 0,
    ...overrides,
  };
}

function mediaDetail(media: ReturnType<typeof mediaItem>) {
  return {
    ...media,
    tag_details: [],
    external_refs:
      media.id === 'm1'
        ? [
            {
              id: 'ref-1',
              provider: 'pixiv',
              external_id: '123',
              url: 'https://example.com/art/123',
            },
          ]
        : [],
    entities:
      media.id === 'm1'
        ? [
            {
              id: 'entity-1',
              entity_type: 'character',
              entity_id: null,
              name: 'Saber Alter',
              role: 'primary',
              source: 'manual',
              confidence: 0.95,
            },
          ]
        : [],
  };
}

async function registerViewerRoutes(page: Page) {
  await seedAuthenticatedSession(page);
  const state = new Map([
    ['m1', mediaDetail(mediaItem('m1', 'image'))],
    ['m2', mediaDetail(mediaItem('m2', 'gif'))],
    ['m3', mediaDetail(mediaItem('m3', 'video'))],
  ]);
  const patchBodies: Array<Record<string, unknown>> = [];

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    await route.fulfill({
      json: {
        items: Array.from(state.values()).map(
          ({ tag_details: _tagDetails, external_refs: _refs, entities: _entities, ...media }) =>
            media,
        ),
        total: state.size,
        next_cursor: null,
        has_more: false,
        page_size: 20,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route: Route) => {
    await route.fulfill({
      json: { buckets: [{ year: 2026, month: 3, count: state.size }] },
    });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });

  await page.route('**/api/v1/media/*/file', async (route: Route) => {
    const id = route.request().url().split('/').slice(-2)[0];
    const media = state.get(id);
    const body =
      media?.media_type === 'gif'
        ? GIF_1X1
        : media?.media_type === 'video'
          ? Buffer.from('')
          : PNG_1X1;
    const contentType = media?.metadata.mime_type ?? 'application/octet-stream';
    await route.fulfill({ status: 200, contentType, body });
  });

  await page.route('**/api/v1/media/character-suggestions**', async (route: Route) => {
    await route.fulfill({
      json: [
        { name: 'Rin Tohsaka', media_count: 4 },
        { name: 'Sakura Matou', media_count: 2 },
      ],
    });
  });

  await page.route('**/api/v1/tags**', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 1,
            name: 'hero',
            category: 0,
            category_name: 'general',
            category_key: 'general',
            media_count: 12,
          },
          {
            id: 2,
            name: 'starter-tag',
            category: 0,
            category_name: 'general',
            category_key: 'general',
            media_count: 8,
          },
        ],
        total: 2,
        next_cursor: null,
        has_more: false,
        page_size: 20,
      },
    });
  });

  await page.route(/\/api\/v1\/media\/m\d+$/, async (route: Route) => {
    const request = route.request();
    const id = request.url().split('/').pop()!;
    if (request.method() === 'GET') {
      await route.fulfill({ json: state.get(id) });
      return;
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as {
        tags: string[];
        entities: Array<{ entity_type: 'character'; name: string }>;
        ocr_text_override: string | null;
      };
      patchBodies.push(body);
      const current = state.get(id)!;
      const updated = {
        ...current,
        tags: body.tags,
        ocr_text_override: body.ocr_text_override,
        version: current.version + 1,
        entities: body.entities.map((entity, index) => ({
          id: `entity-${index + 1}`,
          entity_type: entity.entity_type,
          entity_id: null,
          name: entity.name,
          role: 'primary',
          source: 'manual',
          confidence: null,
        })),
      };
      state.set(id, updated);
      await route.fulfill({ json: updated });
      return;
    }
    await route.fallback();
  });

  return { patchBodies };
}

test.describe.serial('Media viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('opens from the gallery, navigates media, and saves tag/character/OCR edits', async ({
    page,
  }) => {
    const { patchBodies } = await registerViewerRoutes(page);
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('zukan_at', 'test-access-token');
      localStorage.setItem('zukan_rt', 'test-refresh-token');
    });
    await page.goto('/gallery');
    await expect(page).toHaveURL('/gallery');

    const firstCard = page.locator('.media-card').first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('m1.png');
    await expect(dialog.locator('img')).toBeVisible();

    await dialog.getByRole('button', { name: 'Next media' }).click();
    await expect(dialog).toContainText('m2.gif');
    await expect(dialog.locator('img')).toBeVisible();

    await dialog.getByRole('button', { name: 'Next media' }).click();
    await expect(dialog).toContainText('m3.mp4');
    await expect(dialog.locator('video')).toBeVisible();

    await dialog.getByRole('button', { name: 'Previous media' }).click();
    await dialog.getByRole('button', { name: 'Previous media' }).click();
    await expect(dialog).toContainText('m1.png');

    await dialog.getByRole('button', { name: 'Edit' }).click();
    const characterInput = dialog.getByRole('combobox', { name: 'Add character' });
    const tagInput = dialog.getByRole('combobox', { name: 'Add tag' });
    await characterInput.fill('Rin Tohsaka');
    await characterInput.press('Enter');
    await tagInput.fill('hero');
    await tagInput.press('Enter');
    await dialog.getByLabel('OCR override').fill('Manual OCR text');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => patchBodies.length, { timeout: 5000 }).toBe(1);
    expect(patchBodies[0]).toEqual({
      tags: ['starter-tag', 'hero'],
      entities: [
        { entity_type: 'character', name: 'Saber Alter' },
        { entity_type: 'character', name: 'Rin Tohsaka' },
      ],
      ocr_text_override: 'Manual OCR text',
      version: 1,
    });

    await expect(dialog).toContainText('Manual OCR text');
    await expect(dialog).toContainText('Rin Tohsaka');
    await expect(dialog).toContainText('Hero');
  });
});
