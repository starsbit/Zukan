import path from 'node:path';
import { defineConfig } from '@playwright/test';

const workspaceRoot = path.resolve(__dirname, '..');
const storageRoot = path.join(workspaceRoot, '.e2e', 'storage');
const cacheRoot = path.join(workspaceRoot, '.e2e', 'model-cache');
const frontendPort = process.env['PLAYWRIGHT_E2E_FRONTEND_PORT'] ?? '4210';
const backendPort = process.env['PLAYWRIGHT_E2E_BACKEND_PORT'] ?? '8010';
const dbPort = process.env['PLAYWRIGHT_E2E_DB_PORT'] ?? '55433';
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const backendBaseUrl = `http://127.0.0.1:${backendPort}`;
const dbContainerName = process.env['PLAYWRIGHT_E2E_DB_CONTAINER'] ?? `zukan-e2e-db-${process.pid}`;

process.env['PLAYWRIGHT_E2E_API_BASE_URL'] = backendBaseUrl;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: frontendBaseUrl,
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: [
        'env',
        `DATABASE_URL=postgresql+asyncpg://zukan:zukan@127.0.0.1:${dbPort}/zukan`,
        'E2E_MANAGE_DB=1',
        `E2E_DB_PORT=${dbPort}`,
        `E2E_DB_CONTAINER=${dbContainerName}`,
        `STORAGE_DIR=${storageRoot}`,
        `MODEL_CACHE_DIR=${cacheRoot}`,
        `CORS_ALLOWED_ORIGINS='["${frontendBaseUrl}","http://localhost:${frontendPort}"]'`,
        'HOST=127.0.0.1',
        `PORT=${backendPort}`,
        './.venv/bin/python',
        'backend/scripts/run_e2e_server.py'
      ].join(' '),
      url: `${backendBaseUrl}/healthz`,
      cwd: workspaceRoot,
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: `npm start -- --host 127.0.0.1 --port ${frontendPort}`,
      url: frontendBaseUrl,
      cwd: path.join(workspaceRoot, 'frontend'),
      reuseExistingServer: false,
      timeout: 60_000
    }
  ],
  reporter: 'list'
});
