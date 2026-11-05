import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
const GATEWAY_URL = 'http://127.0.0.1:3200';

const IS_CI = Boolean(process.env.CI);
// GitLab CI expone `GITLAB_CI=true`; el reporter `github` no aporta nada allí.
const IS_GITLAB = Boolean(process.env.GITLAB_CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  // Runners compartidos de GitLab: 2 vCPU. Limitar workers evita contención de
  // CPU con el `webServer` (build + start) y flakiness en snapshots visuales.
  workers: IS_GITLAB ? 2 : undefined,
  reporter: IS_GITLAB
    ? [
        ['list'],
        ['html', { open: 'never' }],
        // Publicado como `reports:junit` en `.gitlab/ci/web.yml`.
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : IS_CI
      ? [['github'], ['html', { open: 'never' }]]
      : 'list',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
    },
  },
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
