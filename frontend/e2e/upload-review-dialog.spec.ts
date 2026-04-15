import { expect, test, type Page, type Route } from '@playwright/test';
import { API_BASE, ensureAdminAuthenticated } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=',
  'base64',
);

type ReviewItemState = 'character' | 'series' | 'both';

interface ReviewMedia {
  id: string;
  filename: string;
  originalFilename?: string | null;
  state: ReviewItemState;
  characters?: string[];
  series?: string[];
}

interface ReviewFixtureState {
  items: ReviewMedia[];
  groups: Array<{
    id: string;
    mediaIds: string[];
    confidence: number;
    characterSuggestions: string[];
    seriesSuggestions: string[];
    sharedSignals: Array<{ kind: 'tag' | 'visual' | 'ocr' | 'entity'; label: string }>;
  }>;
}

function buildMediaItem(id: string, filename: string, capturedAt: string) {
  return {
    id,
    uploader_id: 'u1',
    uploader_username: 'uploader',
    owner_id: 'u1',
    owner_username: 'owner',
    visibility: 'private',
    filename,
    original_filename: filename,
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
    tags: [],
    ocr_text_override: null,
    metadata_review_dismissed: false,
    is_nsfw: false,
    tagging_status: 'done',
    tagging_error: null,
    thumbnail_status: 'done',
    poster_status: 'not_applicable',
    ocr_text: null,
    is_favorited: false,
    favorite_count: 0,
    tag_details: [],
    external_refs: [],
    entities: [],
  };
}

function buildReviewFixtureState(): ReviewFixtureState {
  return {
    items: [
      {
        id: 'm-group-1',
        filename: 'group-one.png',
        state: 'both',
      },
      {
        id: 'm-group-2',
        filename: 'group-two.png',
        state: 'both',
      },
      {
        id: 'm-character-only',
        filename: 'character-only.png',
        state: 'character',
        series: ['existing_series'],
      },
      {
        id: 'm-series-only',
        filename: 'series-only.png',
        state: 'series',
        characters: ['existing_character'],
      },
      {
        id: 'm-both-ungrouped',
        filename: 'both-ungrouped.png',
        state: 'both',
      },
    ],
    groups: [
      {
        id: 'group-1',
        mediaIds: ['m-group-1', 'm-group-2'],
        confidence: 0.87,
        characterSuggestions: ['Saber Alter'],
        seriesSuggestions: ['Fate Stay Night'],
        sharedSignals: [
          { kind: 'tag', label: 'blue dress' },
          { kind: 'ocr', label: 'fuyuki' },
        ],
      },
    ],
  };
}

function buildLargeGroupFixtureState(): ReviewFixtureState {
  return {
    items: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `m-large-group-${index + 1}`,
        filename: `large-group-${index + 1}.png`,
        state: 'both' as const,
      })),
      {
        id: 'm-large-ungrouped',
        filename: 'large-ungrouped.png',
        state: 'both' as const,
      },
    ],
    groups: [
      {
        id: 'group-large',
        mediaIds: Array.from({ length: 6 }, (_, index) => `m-large-group-${index + 1}`),
        confidence: 0.91,
        characterSuggestions: ['Saber'],
        seriesSuggestions: ['Fate Stay Night', 'Fate Zero'],
        sharedSignals: [
          { kind: 'tag', label: 'blue dress' },
          { kind: 'visual', label: 'Visual match' },
        ],
      },
    ],
  };
}

function toReviewResponse(state: ReviewFixtureState) {
  return {
    total: state.items.length,
    items: state.items.map((item, index) => ({
      batch_item_id: `batch-item-${index + 1}`,
      source_filename: item.filename,
      missing_character: item.state === 'character' || item.state === 'both',
      missing_series: item.state === 'series' || item.state === 'both',
      entities: [
        ...(item.characters ?? []).map((name) => ({
          id: `${item.id}-character-${name}`,
          media_id: item.id,
          entity_type: 'character',
          name,
          role: 'primary',
          source: 'manual',
          confidence: 1,
        })),
        ...(item.series ?? []).map((name) => ({
          id: `${item.id}-series-${name}`,
          media_id: item.id,
          entity_type: 'series',
          name,
          role: 'primary',
          source: 'manual',
          confidence: 1,
        })),
      ],
      media: buildMediaItem(item.id, item.filename, `2026-03-${String(index + 1).padStart(2, '0')}T10:00:00Z`),
    })),
    recommendation_groups: state.groups
      .filter((group) => group.mediaIds.filter((id) => state.items.some((item) => item.id === id)).length >= 2)
      .map((group) => {
        const activeIds = group.mediaIds.filter((id) => state.items.some((item) => item.id === id));
        return {
          id: group.id,
          media_ids: activeIds,
          item_count: activeIds.length,
          missing_character_count: activeIds.filter((mediaId) => {
            const item = state.items.find((entry) => entry.id === mediaId);
            return item?.state === 'character' || item?.state === 'both';
          }).length,
          missing_series_count: activeIds.filter((mediaId) => {
            const item = state.items.find((entry) => entry.id === mediaId);
            return item?.state === 'series' || item?.state === 'both';
          }).length,
          suggested_characters: group.characterSuggestions.map((name) => ({ name, confidence: 0.95 })),
          suggested_series: group.seriesSuggestions.map((name) => ({ name, confidence: 0.91 })),
          shared_signals: group.sharedSignals.map((signal) => ({ ...signal, confidence: 0.8 })),
          confidence: group.confidence,
        };
      }),
  };
}

async function createSyntheticPngPayload(page: Page, namePrefix = 'review-upload') {
  const payload = await page.evaluate(async (prefix) => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D context unavailable');
    }

    context.fillStyle = '#60a5fa';
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
      name: `${prefix}-${Date.now()}.png`,
      mimeType: 'image/png',
      base64: btoa(binary),
    };
  }, namePrefix);

  return {
    name: payload.name,
    mimeType: payload.mimeType,
    buffer: Buffer.from(payload.base64, 'base64'),
  };
}

async function confirmUploadDialog(page: Page): Promise<void> {
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(dialog).toHaveCount(0);
}

async function triggerTrackedUpload(page: Page): Promise<void> {
  const payload = await createSyntheticPngPayload(page);
  await page.locator('input[data-upload-kind="files"]').setInputFiles([payload]);
  await confirmUploadDialog(page);
  await expect(page.locator('zukan-upload-status-island')).toBeVisible();
}

async function openReviewDialogFromIsland(page: Page): Promise<void> {
  await expect(page.locator('zukan-upload-status-island')).toBeVisible();
  await page.getByRole('button', { name: /need names/i }).click();
  await expect(page.getByRole('heading', { name: 'Review Missing Names' })).toBeVisible();
}

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() =>
    localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'),
  );

  if (!token) {
    throw new Error('No access token found after authentication');
  }

  return token;
}

async function findLatestReviewBatch(page: Page): Promise<string | null> {
  const accessToken = await getAccessToken(page);
  return page.evaluate(async (token) => {
    const batchesResponse = await fetch('/api/v1/me/import-batches?page_size=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const batchesPayload = await batchesResponse.json() as {
      items?: Array<{ id: string; type: string; created_at: string }>;
    };
    const uploadBatches = (batchesPayload.items ?? [])
      .filter((batch) => batch.type === 'upload')
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    for (const batch of uploadBatches) {
      const reviewResponse = await fetch(`/api/v1/me/import-batches/${batch.id}/review-items?page_size=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!reviewResponse.ok) {
        continue;
      }

      const reviewPayload = await reviewResponse.json() as { total: number };
      if (reviewPayload.total > 0) {
        return batch.id;
      }
    }

    return null;
  }, accessToken);
}

async function isBackendReachable(page: Page): Promise<boolean> {
  try {
    const response = await page.request.get(`${API_BASE}/api/v1/config/setup-required`);
    return response.ok() && (response.headers()['content-type'] ?? '').includes('application/json');
  } catch {
    return false;
  }
}

async function registerReviewFlowRoutes(
  page: Page,
  options: {
    state?: ReviewFixtureState;
    onEntitiesPatch?: (payload: {
      media_ids: string[];
      character_names?: string[];
      series_names?: string[];
    }) => void;
    onDismissPatch?: (payload: { media_ids: string[]; metadata_review_dismissed: boolean }) => void;
  } = {},
): Promise<void> {
  const state = options.state ?? buildReviewFixtureState();

  await page.route('**/api/v1/media/search**', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          buildMediaItem('existing-gallery-item', 'existing-gallery-item.png', '2026-02-20T10:00:00Z'),
        ],
        total: 1,
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
          { year: 2026, month: 2, count: 1 },
        ],
      },
    });
  });

  await page.route('**/api/v1/media**', async (route) => {
    const method = route.request().method();

    if (method === 'POST') {
      await route.fulfill({
        json: {
          batch_id: 'b-review',
          batch_url: '/api/v1/me/import-batches/b-review',
          batch_items_url: '/api/v1/me/import-batches/b-review/items',
          poll_after_seconds: 1,
          webhooks_supported: false,
          accepted: 1,
          duplicates: 0,
          errors: 0,
          results: [
            {
              id: 'm-uploaded',
              batch_item_id: 'item-uploaded',
              original_filename: 'review-upload.png',
              status: 'accepted',
              message: null,
            },
          ],
        },
      });
      return;
    }

    if (method === 'PATCH') {
      const payload = route.request().postDataJSON() as { media_ids: string[]; metadata_review_dismissed: boolean };
      options.onDismissPatch?.(payload);

      if (payload.metadata_review_dismissed) {
        const dismissedIds = new Set(payload.media_ids);
        state.items = state.items.filter((item) => !dismissedIds.has(item.id));
        state.groups = state.groups
          .map((group) => ({ ...group, mediaIds: group.mediaIds.filter((id) => !dismissedIds.has(id)) }))
          .filter((group) => group.mediaIds.length > 0);
      }

      await route.fulfill({ json: { processed: payload.media_ids.length, skipped: 0 } });
      return;
    }

    await route.continue();
  });

  await page.route('**/api/v1/me/import-batches/b-review', async (route) => {
    await route.fulfill({
      json: {
        id: 'b-review',
        user_id: 'u1',
        type: 'upload',
        status: 'done',
        total_items: 1,
        queued_items: 0,
        processing_items: 0,
        done_items: 1,
        failed_items: 0,
        uploaded_at: '2026-03-31T12:00:00Z',
        started_at: '2026-03-31T12:00:01Z',
        finished_at: '2026-03-31T12:00:05Z',
        last_heartbeat_at: '2026-03-31T12:00:05Z',
        app_version: null,
        worker_version: null,
        error_summary: null,
      },
    });
  });

  await page.route('**/api/v1/me/import-batches/b-review/items**', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 200,
        items: [
          {
            id: 'item-uploaded',
            batch_id: 'b-review',
            media_id: 'm-uploaded',
            source_filename: 'review-upload.png',
            status: 'done',
            step: 'tag',
            progress_percent: 100,
            error: null,
            updated_at: '2026-03-31T12:00:05Z',
          },
        ],
      },
    });
  });

  await page.route('**/api/v1/me/import-batches/b-review/review-items**', async (route) => {
    await route.fulfill({ json: toReviewResponse(state) });
  });

  await page.route('**/api/v1/media/entities', async (route) => {
    const payload = route.request().postDataJSON() as {
      media_ids: string[];
      character_names?: string[];
      series_names?: string[];
    };
    options.onEntitiesPatch?.(payload);

    const selectedIds = new Set(payload.media_ids);
    state.items = state.items.filter((item) => !selectedIds.has(item.id));
    state.groups = state.groups
      .map((group) => ({ ...group, mediaIds: group.mediaIds.filter((id) => !selectedIds.has(id)) }))
      .filter((group) => group.mediaIds.length > 0);

    await route.fulfill({ json: { processed: payload.media_ids.length, skipped: 0 } });
  });

  await page.route('**/api/v1/media/m-uploaded', async (route) => {
    await route.fulfill({
      json: buildMediaItem('m-uploaded', 'review-upload.png', '2026-03-31T12:00:00Z'),
    });
  });

  await page.route('**/api/v1/media/character-suggestions**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    await route.fulfill({
      json: query ? [{ name: 'Saber Alter', media_count: 4 }] : [],
    });
  });

  await page.route('**/api/v1/media/series-suggestions**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    await route.fulfill({
      json: query ? [{ name: 'Fate Stay Night', media_count: 7 }] : [],
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

test.describe('Upload review dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('review dialog opens from upload-status island when unresolved items exist and defaults to recommended groups', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page);

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    await expect(page.getByRole('radio', { name: 'Recommended' })).toBeChecked();
    await expect(page.getByText('Recommended groups')).toBeVisible();
    await expect(page.getByText('2 related items')).toBeVisible();
    await expect(page.getByText('5 still need character or series names.')).toBeVisible();
  });

  test('user can apply suggested character and series names to an entire grouped recommendation', async ({ page }) => {
    let submittedPayload: {
      media_ids: string[];
      character_names?: string[];
      series_names?: string[];
    } | null = null;

    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page, {
      onEntitiesPatch: (payload) => {
        submittedPayload = payload;
      },
    });

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    const groupCard = page.locator('.review-group-card').first();
    await groupCard.getByRole('button', { name: /click to select/i }).click();
    await groupCard.getByRole('gridcell', { name: 'Saber Alter' }).click();
    await groupCard.getByRole('gridcell', { name: 'Fate Stay Night' }).click();

    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Apply to selected' }).click();

    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload).toEqual({
      media_ids: ['m-group-1', 'm-group-2'],
      character_names: ['saber_alter'],
      series_names: ['fate_stay_night'],
    });

    await expect(page.getByText('Names applied to selected media.')).toBeVisible();
    await expect(page.getByText('3 still need character or series names.')).toBeVisible();
    await expect(page.locator('.review-group-card')).toHaveCount(0);
  });

  test('user can switch filters and see only matching missing-name items', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page);

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    await page.getByRole('radio', { name: 'All items' }).click();
    await expect(page.getByText('group-one.png')).toBeVisible();
    await expect(page.getByText('character-only.png')).toBeVisible();
    await expect(page.getByText('series-only.png')).toBeVisible();
    await expect(page.getByText('both-ungrouped.png')).toBeVisible();

    await page.getByRole('radio', { name: 'Character' }).click();
    await expect(page.getByText('character-only.png')).toBeVisible();
    await expect(page.getByText('both-ungrouped.png')).not.toBeVisible();
    await expect(page.getByText('series-only.png')).not.toBeVisible();

    await page.getByRole('radio', { name: 'Series' }).click();
    await expect(page.getByText('series-only.png')).toBeVisible();
    await expect(page.getByText('character-only.png')).not.toBeVisible();
    await expect(page.getByText('both-ungrouped.png')).not.toBeVisible();

    await page.getByRole('radio', { name: 'Both' }).click();
    await expect(page.getByText('both-ungrouped.png')).toBeVisible();
    await expect(page.getByText('character-only.png')).not.toBeVisible();
    await expect(page.getByText('series-only.png')).not.toBeVisible();
  });

  test('user can discard an entire recommendation group', async ({ page }) => {
    let dismissedPayload: { media_ids: string[]; metadata_review_dismissed: boolean } | null = null;

    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page, {
      onDismissPatch: (payload) => {
        dismissedPayload = payload;
      },
    });

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    await page.locator('.review-group-card').first().getByRole('button', { name: 'Discard group', exact: true }).click();

    await expect.poll(() => dismissedPayload).not.toBeNull();
    expect(dismissedPayload).toEqual({
      media_ids: ['m-group-1', 'm-group-2'],
      metadata_review_dismissed: true,
    });

    await expect(page.getByText('Group discarded from missing-name review.')).toBeVisible();
    await expect(page.locator('.review-group-card')).toHaveCount(0);
    await expect(page.getByText('3 still need character or series names.')).toBeVisible();
  });

  test('user can discard one grouped item and the remaining item falls back to manual review', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page);

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    await page.getByRole('button', { name: 'Discard group-one.png from review' }).click();

    await expect(page.getByText('Image discarded from missing-name review.')).toBeVisible();
    await expect(page.locator('.review-group-card')).toHaveCount(0);
    await expect(page.getByText('4 still need character or series names.')).toBeVisible();
    await expect(page.getByText('group-two.png')).toBeVisible();
  });

  test('large recommendation groups show a capped preview grid with overflow count', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page, { state: buildLargeGroupFixtureState() });

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    const groupCard = page.locator('.review-group-card').first();
    await expect(groupCard.getByText('6 related items')).toBeVisible();
    await expect(groupCard.locator('.review-group-card__preview-shell')).toHaveCount(4);
    await expect(groupCard.locator('.review-group-card__preview-more')).toContainText('+2');

    await expect(page.locator('.review-card')).toHaveCount(1);
    await expect(page.getByText('7 still need character or series names.')).toBeVisible();
  });

  test('applying a large recommendation group submits all grouped media ids and leaves ungrouped items behind', async ({ page }) => {
    let submittedPayload: {
      media_ids: string[];
      character_names?: string[];
      series_names?: string[];
    } | null = null;

    await ensureAdminAuthenticated(page);
    await registerReviewFlowRoutes(page, {
      state: buildLargeGroupFixtureState(),
      onEntitiesPatch: (payload) => {
        submittedPayload = payload;
      },
    });

    await page.goto('/');
    await triggerTrackedUpload(page);
    await openReviewDialogFromIsland(page);

    const groupCard = page.locator('.review-group-card').first();
    await groupCard.getByRole('button', { name: /click to select/i }).click();
    await groupCard.getByRole('gridcell', { name: 'Saber' }).click();
    await groupCard.getByRole('gridcell', { name: 'Fate Stay Night' }).click();

    await expect(page.getByText('6 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Apply to selected' }).click();

    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload).toEqual({
      media_ids: [
        'm-large-group-1',
        'm-large-group-2',
        'm-large-group-3',
        'm-large-group-4',
        'm-large-group-5',
        'm-large-group-6',
      ],
      character_names: ['saber'],
      series_names: ['fate_stay_night'],
    });

    await expect(page.locator('.review-group-card')).toHaveCount(0);
    await expect(page.locator('.review-card')).toHaveCount(1);
    await expect(page.getByText('large-ungrouped.png')).toBeVisible();
    await expect(page.getByText('1 still need character or series names.')).toBeVisible();
  });

  test('backend-backed smoke: unresolved review work is discoverable and the dialog opens', async ({ page }) => {
    test.skip(!(await isBackendReachable(page)), 'Backend API is not reachable from this Playwright environment.');

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const latestReviewBatchId = await findLatestReviewBatch(page);
    test.skip(!latestReviewBatchId, 'No unresolved metadata review batches are currently available in this environment.');

    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByText('Some uploaded media still need names')).toBeVisible();
    await page.getByRole('button', { name: 'Review now' }).click();

    await expect(page.getByRole('heading', { name: 'Review Missing Names' })).toBeVisible();
    await expect(page.locator('.review-group-card, .review-card').first()).toBeVisible();
  });
});
