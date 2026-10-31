import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
const GATEWAY_URL = 'http://127.0.0.1:3200';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-gateway.mjs',
      url: `${GATEWAY_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm build && pnpm start --port ${PORT}`,
      url: `${baseURL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        PORT: String(PORT),
        WEB_SESSION_SECRET: 'test-session-secret-0000000000000000',
        WEB_GATEWAY_URL: GATEWAY_URL,
        WEB_ALLOWED_ORIGINS: baseURL,
        WEB_SECURE_COOKIES: 'false',
      },
    },
  ],
});
