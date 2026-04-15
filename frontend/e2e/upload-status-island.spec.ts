import { expect, test, type Page, type Route } from '@playwright/test';
import { resetBrowserState, seedAuthenticatedSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

function mediaItem(id: string, capturedAt: string, state: 'processing' | 'done' = 'done') {
  return {
    id,
    uploader_id: 'u1',
    owner_id: 'u1',
    visibility: 'private',
    filename: `${id}.jpg`,
    original_filename: null,
    media_type: 'image',
    metadata: {
      file_size: 100,
      width: 1200,
      height: 800,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: capturedAt,
    },
    version: 1,
    uploaded_at: capturedAt,
    deleted_at: null,
    tags: state === 'done' ? ['tagged'] : [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: state === 'done' ? 'done' : 'processing',
    tagging_error: null,
    thumbnail_status: state === 'done' ? 'done' : 'processing',
    poster_status: 'not_applicable',
    ocr_text: null,
    is_favorited: false,
    tag_details: [],
    external_refs: [],
    entities: [],
  };
}

async function confirmUploadDialog(page: Page): Promise<void> {
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(dialog).toHaveCount(0);
}

async function createSyntheticPngPayload(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const payload = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D context unavailable');
    }

    context.fillStyle = '#4ade80';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
          return;
        }

        reject(new Error('Unable to create blob'));
      }, 'image/png');
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return {
      name: `timeline-insert-${Date.now()}.png`,
      mimeType: 'image/png',
      base64: btoa(binary),
    };
  });

  return {
    name: payload.name,
    mimeType: payload.mimeType,
    buffer: Buffer.from(payload.base64, 'base64'),
  };
}

async function uploadSyntheticImage(page: Page): Promise<void> {
  const payload = await createSyntheticPngPayload(page);
  await page.locator('input[data-upload-kind="files"]').setInputFiles([payload]);
}

async function registerUploadStatusRoutes(page: Page): Promise<void> {
  let batchStatusCalls = 0;
  let batchItemsCalls = 0;

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          mediaItem('newer', '2025-11-02T12:00:00Z'),
          mediaItem('older', '2025-10-24T12:00:00Z'),
        ],
        total: 2,
        next_cursor: null,
        has_more: false,
        page_size: 20,
      },
    });
  });

  await page.route('**/api/v1/media/timeline**', async (route) => {
    await route.fulfill({
      json: {
        buckets: [
          { year: 2025, month: 11, count: 1 },
          { year: 2025, month: 10, count: 1 },
        ],
      },
    });
  });

  await page.route('**/api/v1/media', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      json: {
        batch_id: 'b-upload',
        batch_url: '/api/v1/me/import-batches/b-upload',
        batch_items_url: '/api/v1/me/import-batches/b-upload/items',
        poll_after_seconds: 1,
        webhooks_supported: false,
        accepted: 1,
        duplicates: 0,
        errors: 0,
        results: [
          {
            id: 'm-uploaded',
            batch_item_id: 'item-uploaded',
            original_filename: 'timeline-insert.png',
            status: 'accepted',
            message: null,
          },
        ],
      },
    });
  });

  await page.route('**/api/v1/me/import-batches/b-upload', async (route) => {
    batchStatusCalls += 1;
    await route.fulfill({
      json: {
        id: 'b-upload',
        user_id: 'u1',
        type: 'upload',
        status: batchStatusCalls === 1 ? 'running' : 'done',
        total_items: 1,
        queued_items: 0,
        processing_items: batchStatusCalls === 1 ? 1 : 0,
        done_items: batchStatusCalls === 1 ? 0 : 1,
        failed_items: 0,
        uploaded_at: '2025-10-31T12:00:00Z',
        started_at: '2025-10-31T12:00:01Z',
        finished_at: batchStatusCalls === 1 ? null : '2025-10-31T12:00:05Z',
        last_heartbeat_at: '2025-10-31T12:00:05Z',
        app_version: null,
        worker_version: null,
        error_summary: null,
      },
    });
  });

  await page.route('**/api/v1/me/import-batches/b-upload/items**', async (route) => {
    batchItemsCalls += 1;
    await route.fulfill({
      json: {
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 200,
        items: [
          {
            id: 'item-uploaded',
            batch_id: 'b-upload',
            media_id: 'm-uploaded',
            source_filename: 'timeline-insert.png',
            status: batchItemsCalls === 1 ? 'processing' : 'done',
            step: batchItemsCalls === 1 ? 'thumbnail' : 'tag',
            progress_percent: batchItemsCalls === 1 ? 30 : 100,
            error: null,
            updated_at: batchItemsCalls === 1 ? '2025-10-31T12:00:02Z' : '2025-10-31T12:00:05Z',
          },
        ],
      },
    });
  });

  await page.route('**/api/v1/me/import-batches/b-upload/review-items**', async (route) => {
    await route.fulfill({
      json: {
        total: 0,
        items: [],
        recommendation_groups: [],
      },
    });
  });

  await page.route('**/api/v1/media/m-uploaded', async (route) => {
    await route.fulfill({
      json: mediaItem('m-uploaded', '2025-10-31T12:00:00Z', 'done'),
    });
  });

  await page.route('**/api/v1/media/*/thumbnail', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_1X1,
    });
  });
}

test.describe.serial('Upload status island', () => {
  test.beforeEach(async ({ page }) => {
    await resetBrowserState(page);
  });

  test('shows optimistic uploads immediately, keeps them in timeline order, and resolves them after processing', async ({ page }) => {
    await seedAuthenticatedSession(page);
    await registerUploadStatusRoutes(page);
    await expect(page).toHaveURL('/');

    await page.goto('/');
    await expect(page).toHaveURL('/');

    await uploadSyntheticImage(page);
    const uploadResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/media') && response.request().method() === 'POST',
    );
    await confirmUploadDialog(page);
    await uploadResponse;

    await expect(page.locator('zukan-upload-status-island')).toBeVisible();
    await expect(page.locator('.media-browser__day-header h2')).toHaveText([
      'November 2, 2025',
      'October 31, 2025',
      'October 24, 2025',
    ]);
    await expect(page.locator('zukan-upload-status-island')).toContainText('Upload and processing finished');
  });
});
