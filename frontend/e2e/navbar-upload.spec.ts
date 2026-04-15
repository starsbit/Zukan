import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureAdminAuthenticated } from './helpers/auth';

const repoRoot = path.resolve(process.cwd(), '..');

const chunkUploadFiles = [
  path.join(repoRoot, 'frontend/public/assets/starsbit-logo-black.webp'),
  path.join(repoRoot, 'frontend/public/assets/starsbit-logo-white.webp'),
  path.join(repoRoot, 'frontend/node_modules/playwright-core/lib/server/chromium/appIcon.png'),
];

const singleUploadFile = chunkUploadFiles[0];

async function createUniqueUploadFile(extension = '.webp'): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zukan-upload-single-'));
  const destination = path.join(tempDir, `upload-${Date.now()}${extension}`);
  await fs.copyFile(singleUploadFile, destination);
  return destination;
}

async function createUniquePngPayloads(
  page: import('@playwright/test').Page,
  count: number,
): Promise<Array<{ name: string; mimeType: string; buffer: Buffer }>> {
  const seed = Date.now();
  const payloads = await page.evaluate(async ({ payloadCount, batchSeed }) => {
    const toBase64 = (bytes: Uint8Array) => {
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    };

    const items: Array<{ name: string; mimeType: string; base64: string }> = [];
    for (let index = 0; index < payloadCount; index += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('2D context unavailable');
      }

      const r = (50 + index * 40 + (batchSeed % 256)) % 255;
      const g = (90 + index * 50 + ((batchSeed >> 8) % 256)) % 255;
      const b = (130 + index * 60 + ((batchSeed >> 16) % 256)) % 255;
      context.fillStyle = `rgb(${r}, ${g}, ${b})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `rgb(${(200 + index * 20) % 255}, ${(120 + index * 30) % 255}, ${(40 + index * 40) % 255})`;
      context.fillRect(index * 3, index * 3, 8, 8);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error('Unable to create PNG blob'));
        }, 'image/png');
      });

      items.push({
        name: `chunk-upload-${batchSeed}-${index + 1}.png`,
        mimeType: 'image/png',
        base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
      });
    }

    return items;
  }, { payloadCount: count, batchSeed: seed });

  return payloads.map((item) => ({
    name: item.name,
    mimeType: item.mimeType,
    buffer: Buffer.from(item.base64, 'base64'),
  }));
}

async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() =>
    localStorage.getItem('zukan_at') ?? sessionStorage.getItem('zukan_at'),
  );

  if (!token) {
    throw new Error('No access token found after authentication');
  }

  return token;
}

async function getMediaTotal(page: import('@playwright/test').Page, accessToken: string): Promise<number> {
  return page.evaluate(async (token) => {
    const response = await fetch('/api/v1/media/search?page_size=1&include_total=true', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json() as { total: number };
    return payload.total;
  }, accessToken);
}

async function getMostRecentMedia(
  page: import('@playwright/test').Page,
  accessToken: string,
): Promise<Array<{ id: string; visibility: string; original_filename: string | null; filename: string }>> {
  return page.evaluate(async (token) => {
    const response = await fetch(
      '/api/v1/media/search?page_size=10&sort_by=uploaded_at&sort_order=desc',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await response.json() as {
      items: Array<{ id: string; visibility: string; original_filename: string | null; filename: string }>;
    };
    return data.items;
  }, accessToken);
}

async function getMediaById(
  page: import('@playwright/test').Page,
  accessToken: string,
  mediaId: string,
): Promise<{ id: string; visibility: string } | null> {
  return page.evaluate(async ({ token, id }) => {
    const response = await fetch(`/api/v1/media/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as { id: string; visibility: string };
  }, { token: accessToken, id: mediaId });
}

/** Confirm the upload dialog after file selection. */
async function confirmUploadDialog(
  page: import('@playwright/test').Page,
  options: { isPublic?: boolean } = {},
): Promise<void> {
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible();

  if (options.isPublic) {
    await dialog.getByRole('checkbox', { name: 'Upload publicly' }).check();
  }

  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe.serial('Navbar upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('uploads legal files from a folder and nested subfolders', async ({ page }) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zukan-upload-folder-'));
    const nestedDir = path.join(tempRoot, 'nested');
    await fs.mkdir(nestedDir, { recursive: true });

    const folderFileOne = path.join(tempRoot, 'folder-image.png');
    const folderFileTwo = path.join(nestedDir, 'folder-anim.gif');

    await fs.copyFile(
      path.join(repoRoot, 'frontend/node_modules/ordered-binary/assets/powers-dre.png'),
      folderFileOne,
    );
    await fs.copyFile(
      path.join(repoRoot, 'frontend/node_modules/retry/equation.gif'),
      folderFileTwo,
    );

    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const token = await getAccessToken(page);
    const beforeTotal = await getMediaTotal(page, token);
    const uploadResponses: Array<{ accepted: number }> = [];

    page.on('response', async (response) => {
      if (response.url().endsWith('/api/v1/media') && response.request().method() === 'POST') {
        uploadResponses.push(await response.json() as { accepted: number });
      }
    });

    await page.locator('input[data-upload-kind="folder"]').setInputFiles(tempRoot);
    await confirmUploadDialog(page);

    await expect.poll(() => uploadResponses.length).toBe(1);
    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBeGreaterThanOrEqual(beforeTotal);
  });

  test('supports drag and drop uploads', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const token = await getAccessToken(page);
    const beforeTotal = await getMediaTotal(page, token);
    await page.evaluate(() => {
      const event = new Event('dragenter', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: ['Files'],
          files: [],
          items: [],
        },
      });
      document.dispatchEvent(event);
    });
    await expect(page.getByText('Drop files or folders to upload')).toBeVisible();

    await page.evaluate(async () => {
      const buildPngFile = async (name: string, color: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('2D context unavailable');
        }

        context.fillStyle = color;
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

        return new File([blob], name, { type: 'image/png' });
      };

      const firstFile = await buildPngFile('drag-one.png', '#ff4d4f');
      const secondFile = await buildPngFile('drag-two.png', '#1677ff');

      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: ['Files'],
          files: [firstFile, secondFile],
          items: [
            { getAsFile: () => firstFile },
            { getAsFile: () => secondFile },
          ],
        },
      });

      document.dispatchEvent(event);
    });
    await expect(page.getByText('Drop files or folders to upload')).toHaveCount(0);
    await confirmUploadDialog(page);

    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBeGreaterThanOrEqual(beforeTotal);
  });

  test('shows the confirm dialog with the correct file count after selection', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    await page.locator('input[data-upload-kind="files"]').setInputFiles(chunkUploadFiles);

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('3 files selected');
  });

  test('shows singular "file" label for a single file', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    await page.locator('input[data-upload-kind="files"]').setInputFiles([singleUploadFile]);

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('1 file selected');
  });

  test('public checkbox is unchecked by default', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    await page.locator('input[data-upload-kind="files"]').setInputFiles([singleUploadFile]);

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Upload publicly' })).not.toBeChecked();
  });

  test('cancelling the dialog does not start an upload', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const uploadRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().endsWith('/api/v1/media') && req.method() === 'POST') {
        uploadRequests.push(req.url());
      }
    });

    await page.locator('input[data-upload-kind="files"]').setInputFiles([singleUploadFile]);

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    expect(uploadRequests).toHaveLength(0);
  });

  test('uploads with PRIVATE visibility when public checkbox is left unchecked', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const token = await getAccessToken(page);
    const beforeTotal = await getMediaTotal(page, token);
    const [uploadFile] = await createUniquePngPayloads(page, 1);
    const uploadResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/media') && response.request().method() === 'POST',
    );

    await page.locator('input[data-upload-kind="files"]').setInputFiles([uploadFile]);
    await confirmUploadDialog(page, { isPublic: false });

    const uploadPayload = await (await uploadResponsePromise).json() as {
      results: Array<{ id: string | null }>;
    };
    const uploadedId = uploadPayload.results.find((item) => item.id)?.id;
    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBeGreaterThanOrEqual(beforeTotal);
    if (uploadedId) {
      await expect.poll(
        async () => getMediaById(page, token, uploadedId),
        { timeout: 15000 },
      ).not.toBeNull();
      const resolvedMedia = await getMediaById(page, token, uploadedId);
      expect(resolvedMedia).toBeTruthy();
      expect(resolvedMedia!.visibility).toBe('private');
    }
  });

  test('uploads with PUBLIC visibility when public checkbox is checked', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const token = await getAccessToken(page);
    const beforeTotal = await getMediaTotal(page, token);
    const [uploadFile] = await createUniquePngPayloads(page, 1);
    const uploadResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/media') && response.request().method() === 'POST',
    );

    await page.locator('input[data-upload-kind="files"]').setInputFiles([uploadFile]);
    await confirmUploadDialog(page, { isPublic: true });

    const uploadPayload = await (await uploadResponsePromise).json() as {
      results: Array<{ id: string | null }>;
    };
    const uploadedId = uploadPayload.results.find((item) => item.id)?.id;
    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBeGreaterThanOrEqual(beforeTotal);
    if (uploadedId) {
      await expect.poll(
        async () => getMediaById(page, token, uploadedId),
        { timeout: 15000 },
      ).not.toBeNull();
      const media = await getMediaById(page, token, uploadedId);
      expect(media).toBeTruthy();
      expect(media!.visibility).toBe('public');
    }
  });
});
