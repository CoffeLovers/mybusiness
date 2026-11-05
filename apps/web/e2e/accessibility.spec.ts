import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
  await expect(page.locator('div[data-hydrated="true"]')).toBeVisible();
}

/**
 * Analiza la página con axe (WCAG 2.0/2.1 A y AA) y falla si hay
 * violaciones de impacto `critical` o `serious`.
 */
async function expectNoBlockingViolations(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );

  if (blocking.length > 0) {
    const detail = blocking
      .map(
        (violation) =>
          `- ${violation.id} [${violation.impact ?? 'sin impacto'}] en ${label}: ${violation.help}`,
      )
      .join('\n');
    throw new Error(
      `Se encontraron ${blocking.length} violación(es) bloqueantes de axe en "${label}":\n${detail}`,
    );
  }
}

const PUBLIC_ROUTES = [
  { path: '/', label: 'landing pública' },
  { path: '/login', label: 'inicio de sesión' },
  { path: '/design-system', label: 'sistema de diseño' },
  { path: '/ruta-inexistente', label: 'página no encontrada (404)' },
] as const;

const AUTHENTICATED_ROUTES = [
  {
    path: '/resumen?from=2026-10-01&to=2026-10-31&currency=EUR',
    label: 'resumen (rango y moneda)',
  },
  { path: '/libro-mayor', label: 'libro mayor' },
] as const;

test.describe('Accesibilidad WCAG AA (RD-08)', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`ruta pública ${route.path} — ${route.label} sin violaciones bloqueantes`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await page.waitForLoadState('load');
      await expectNoBlockingViolations(page, route.label);
    });
  }

  for (const route of AUTHENTICATED_ROUTES) {
    test(`ruta autenticada ${route.path} — ${route.label} sin violaciones bloqueantes`, async ({
      page,
    }) => {
      await login(page);
      await page.goto(route.path);
      await page.waitForLoadState('load');
      await expectNoBlockingViolations(page, route.label);
    });
  }

  test('tema oscuro — landing pública y resumen sin violaciones bloqueantes', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
    });

    // Landing pública en tema oscuro
    await page.goto('/');
    await page.waitForLoadState('load');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoBlockingViolations(page, 'landing pública (tema oscuro)');

    // Resumen autenticado en tema oscuro
    await login(page);
    await page.goto('/resumen?from=2026-10-01&to=2026-10-31&currency=EUR');
    await page.waitForLoadState('load');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoBlockingViolations(page, 'resumen (tema oscuro)');
  });
});
