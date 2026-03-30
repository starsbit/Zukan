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
): Promise<{ id: string; visibility: string }> {
  return page.evaluate(async (token) => {
    const response = await fetch(
      '/api/v1/media/search?page_size=1&sort_by=created_at&sort_order=desc',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await response.json() as { items: Array<{ id: string; visibility: string }> };
    return data.items[0]!;
  }, accessToken);
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

  test('splits large file selections into multiple backend upload batches', async ({ page }) => {
    await page.route('**/api/v1/config/upload', async (route) => {
      await route.fulfill({
        json: {
          max_batch_size: 2,
          max_upload_size_mb: 50,
        },
      });
    });

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

    await page.locator('input[data-upload-kind="files"]').setInputFiles(chunkUploadFiles);
    await confirmUploadDialog(page);

    await expect.poll(() => uploadResponses.length).toBe(2);
    expect(uploadResponses.map((response) => response.accepted)).toEqual([2, 1]);

    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBe(beforeTotal + 3);
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
    expect(uploadResponses[0]?.accepted).toBe(2);
    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBe(beforeTotal + 2);
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

    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBe(beforeTotal + 2);
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

    await page.locator('input[data-upload-kind="files"]').setInputFiles([singleUploadFile]);
    await confirmUploadDialog(page, { isPublic: false });

    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBe(beforeTotal + 1);
    const media = await getMostRecentMedia(page, token);
    expect(media.visibility).toBe('private');
  });

  test('uploads with PUBLIC visibility when public checkbox is checked', async ({ page }) => {
    await ensureAdminAuthenticated(page);
    await expect(page).toHaveURL('/');

    const token = await getAccessToken(page);
    const beforeTotal = await getMediaTotal(page, token);

    await page.locator('input[data-upload-kind="files"]').setInputFiles([singleUploadFile]);
    await confirmUploadDialog(page, { isPublic: true });

    await expect.poll(async () => getMediaTotal(page, token), { timeout: 15000 }).toBe(beforeTotal + 1);
    const media = await getMostRecentMedia(page, token);
    expect(media.visibility).toBe('public');
  });
});
