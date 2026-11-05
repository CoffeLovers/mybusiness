import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E del shell y la navegación (RD-03, issue #92).
 *
 * Cubren el trunk test, el `h1` único, las migas, el skip link, el drawer
 * móvil, los atajos de la paleta de búsqueda y `axe` en `/` y `/libro-mayor`.
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('ada@example.com');
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

async function openLedger(page: Page): Promise<void> {
  await page.goto('/libro-mayor');
  await expect(page.getByRole('heading', { level: 1, name: 'Libro mayor' })).toBeVisible();
}

test.describe('Shell y navegación (Issue #92)', () => {
  test('el logo del shell devuelve a la raíz desde el libro mayor', async ({ page }) => {
    await login(page);
    await openLedger(page);

    await page.getByRole('link', { name: 'MyBusiness, ir al resumen' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
  });

  test('cada página del shell tiene exactamente un h1 visible', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    await openLedger(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Libro mayor' })).toBeVisible();
  });

  test('las migas y el ítem activo usan aria-current en /libro-mayor', async ({ page }) => {
    await login(page);
    await openLedger(page);

    const crumbs = page.getByRole('navigation', { name: 'Ruta de navegación' });

    await expect(crumbs).toHaveText(/Resumen\s*\/\s*Libro mayor/);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Libro mayor');
    await expect(crumbs.getByRole('link', { name: 'Resumen' })).toBeVisible();

    const mainNav = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(mainNav.getByRole('link', { name: 'Libro mayor' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(mainNav.getByRole('link', { name: 'Resumen' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // Los ítems sin ruta no navegan y nunca son el ítem activo.
    await expect(mainNav.getByText('Facturas')).toHaveAttribute('aria-disabled', 'true');
    await expect(mainNav.getByText('Bancos')).toHaveAttribute('aria-disabled', 'true');
    await expect(mainNav.getByText('Agente')).toHaveAttribute('aria-disabled', 'true');
  });

  test('el skip link es el primer foco y mueve el foco a #contenido', async ({ page }) => {
    await login(page);
    await openLedger(page);

    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/#contenido$/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('contenido');
  });

  test('el drawer móvil atrapa el foco, cierra con Escape y navega', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();

    const hamburger = page.getByRole('button', { name: 'Abrir navegación' });
    const drawer = page.getByRole('dialog', { name: 'Navegación' });

    await hamburger.click();
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('dialog') !== null))
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(hamburger).toBeFocused();

    await hamburger.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Libro mayor' }).click();

    await expect(page).toHaveURL(/\/libro-mayor/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Libro mayor' })).toBeVisible();
  });

  test('la paleta abre con / y Ctrl+K, filtra, navega y respeta los inputs', async ({ page }) => {
    await login(page);
    await openLedger(page);

    const palette = page.getByRole('dialog', { name: 'Buscar' });
    const input = page.getByLabel('Buscar en la navegación');

    // Atajo "/" en una ruta interna.
    await page.keyboard.press('/');
    await expect(palette).toBeVisible();
    await expect(input).toBeFocused();

    // Escribir en la paleta filtra sin cerrarla.
    await input.pressSequentially('libro');
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('button', { name: 'Libro mayor' })).toBeVisible();
    await input.press('Enter');
    await expect(palette).toBeHidden();

    // Atajo Ctrl+K y estado vacío.
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await input.fill('zzz');
    await expect(palette.getByRole('paragraph')).toHaveText('Sin resultados');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    // Escribir "/" dentro de un input de la página no abre la paleta.
    await openLedger(page);
    const ledgerSearch = page.getByLabel('Buscar movimientos por descripción o comercio');
    await ledgerSearch.click();
    await page.keyboard.press('/');

    await expect(ledgerSearch).toHaveValue('/');
    await expect(palette).toBeHidden();
  });

  test('axe no reporta violaciones WCAG A/AA en / ni en /libro-mayor', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
    const homeResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(homeResults.violations).toEqual([]);

    await openLedger(page);
    await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    const ledgerResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(ledgerResults.violations).toEqual([]);
  });
});
