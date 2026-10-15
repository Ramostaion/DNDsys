import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const environment = parseEnv(readFileSync('apps/api/.env', 'utf8'));
const webPort = Number(environment.WEB_PORT || new URL(environment.WEB_ORIGIN || 'http://localhost:5242').port || 5242);
const localWebUrl = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './apps/api/e2e',
  timeout: 90_000,
  workers: 1,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.DND_E2E_WEB_URL || localWebUrl,
    browserName: 'chromium',
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    actionTimeout: 10_000,
  },
  webServer:
    process.env.DND_E2E_EXTERNAL === '1'
      ? undefined
      : [
          {
            command: 'pnpm --filter @dnd/api dev',
            url: 'http://localhost:3001/api/health',
            reuseExistingServer: true,
            timeout: 30_000,
          },
          {
            command: 'pnpm --filter @dnd/web dev',
            url: `${localWebUrl}/login`,
            reuseExistingServer: true,
            timeout: 30_000,
          },
        ],
});
