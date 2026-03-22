import path from 'node:path';
import { defineConfig } from '@playwright/test';

const workspaceRoot = path.resolve(__dirname, '..');
const storageRoot = path.join(workspaceRoot, '.e2e', 'storage');
const cacheRoot = path.join(workspaceRoot, '.e2e', 'model-cache');
const frontendPort = process.env['PLAYWRIGHT_E2E_FRONTEND_PORT'] ?? '4300';
const backendPort = process.env['PLAYWRIGHT_E2E_BACKEND_PORT'] ?? '8010';
const dbPort = process.env['PLAYWRIGHT_E2E_DB_PORT'] ?? '55432';
const manageDb = process.env['PLAYWRIGHT_E2E_MANAGE_DB'] ?? '1';
const databaseUrl = process.env['PLAYWRIGHT_E2E_DATABASE_URL']
  ?? process.env['DATABASE_URL']
  ?? `postgresql+asyncpg://zukan:zukan@127.0.0.1:${dbPort}/zukan`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const backendBaseUrl = `http://127.0.0.1:${backendPort}`;
const dbContainerName = process.env['PLAYWRIGHT_E2E_DB_CONTAINER'] ?? `zukan-e2e-db-${dbPort}`;

process.env['PLAYWRIGHT_E2E_API_BASE_URL'] = backendBaseUrl;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
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
        `DATABASE_URL=${databaseUrl}`,
        `E2E_MANAGE_DB=${manageDb}`,
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
      gracefulShutdown: {
        signal: 'SIGTERM',
        timeout: 5_000
      },
      timeout: 60_000
    },
    {
      command: `npm start -- --host 127.0.0.1 --port ${frontendPort}`,
      url: frontendBaseUrl,
      cwd: path.join(workspaceRoot, 'frontend'),
      reuseExistingServer: false,
      gracefulShutdown: {
        signal: 'SIGTERM',
        timeout: 5_000
      },
      timeout: 60_000
    }
  ],
  reporter: 'list'
});
