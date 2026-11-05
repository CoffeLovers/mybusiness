import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Regresión visual (RD-08): capturas deterministas de la landing y del
 * dashboard en tema claro, oscuro y viewport móvil.
 *
 * El umbral global (`maxDiffPixelRatio` / `threshold`), la desactivación de
 * animaciones y el ocultado del caret se definen en `playwright.config.ts`.
 */

/** Inicia sesión con las credenciales del mock gateway */
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('ada@example.com');
  await page.getByLabel('Contraseña').fill('correct-password');
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/resumen'),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
  await page.waitForLoadState('load');
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

/**
 * Espera a que el SVG del gráfico deje de cambiar (ECharts anima por JS,
 * así que `animations: 'disabled'` no lo detiene).
 */
async function waitForChartStable(page: Page): Promise<void> {
  const svg = page.locator('section[aria-label^="Gráfico"] svg').first();
  await expect(svg).toBeVisible();
  let previous = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const signature = await svg.evaluate((node) =>
      Array.from(node.querySelectorAll('path'))
        .map((path) => path.getAttribute('d') ?? '')
        .join('|'),
    );
    if (signature !== '' && signature === previous) {
      return;
    }
    previous = signature;
    await page.waitForTimeout(100);
  }
  throw new Error('El gráfico de flujo de caja no se estabilizó a tiempo para la captura.');
}

/**
 * Espera a que la página esté lista para una captura estable:
 * fuentes cargadas y, en el dashboard, hidratación y gráfico estabilizado.
 */
async function prepare(page: Page, options: { dashboard?: boolean } = {}): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  if (!options.dashboard) {
    return;
  }
  await expect(page.locator('div[data-hydrated="true"]')).toBeVisible({ timeout: 15_000 });
  await waitForChartStable(page);
}

/** Captura de página completa con el umbral global de la configuración */
async function expectScreenshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}

const SUMMARY_URL = '/resumen?from=2026-10-01&to=2026-10-31&currency=EUR';
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;

test.describe('Regresión visual — escritorio', () => {
  test('landing en tema claro', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await prepare(page);
    await expectScreenshot(page, 'landing-light.png');
  });

  test('landing en tema oscuro', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await prepare(page);
    await expectScreenshot(page, 'landing-dark.png');
  });

  test('resumen en tema claro', async ({ page }) => {
    await login(page);
    await page.goto(SUMMARY_URL);
    await prepare(page, { dashboard: true });
    await expectScreenshot(page, 'resumen-light.png');
  });

  test('resumen en tema oscuro', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await login(page);
    await page.goto(SUMMARY_URL);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await prepare(page, { dashboard: true });
    await expectScreenshot(page, 'resumen-dark.png');
  });
});

test.describe('Regresión visual — móvil', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('landing en tema claro', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await prepare(page);
    await expectScreenshot(page, 'landing-mobile.png');
  });

  test('resumen en tema claro', async ({ page }) => {
    await login(page);
    await page.goto(SUMMARY_URL);
    await prepare(page, { dashboard: true });
    await expectScreenshot(page, 'resumen-mobile.png');
  });
});
