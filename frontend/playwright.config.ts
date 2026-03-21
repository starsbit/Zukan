import path from 'node:path';
import { defineConfig } from '@playwright/test';

const workspaceRoot = path.resolve(__dirname, '..');
const storageRoot = path.join(workspaceRoot, '.e2e', 'storage');
const cacheRoot = path.join(workspaceRoot, '.e2e', 'model-cache');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: [
        'env',
        'DATABASE_URL=postgresql+asyncpg://zukan:zukan@127.0.0.1:55432/zukan',
        'E2E_MANAGE_DB=1',
        'E2E_DB_PORT=55432',
        `STORAGE_DIR=${storageRoot}`,
        `MODEL_CACHE_DIR=${cacheRoot}`,
        'HOST=127.0.0.1',
        'PORT=8000',
        './.venv/bin/python',
        'backend/scripts/run_e2e_server.py'
      ].join(' '),
      url: 'http://127.0.0.1:8000/healthz',
      cwd: workspaceRoot,
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: 'npm start -- --host 127.0.0.1 --port 4200',
      url: 'http://127.0.0.1:4200',
      cwd: path.join(workspaceRoot, 'frontend'),
      reuseExistingServer: false,
      timeout: 60_000
    }
  ],
  reporter: 'list'
});
