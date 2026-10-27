import 'dotenv/config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: 'msedge',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
