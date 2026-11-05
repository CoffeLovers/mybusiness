import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

test.describe('Dashboard de Flujo de Caja (Issue #50)', () => {
  test('login -> dashboard muestra tarjetas, gráfico y desglose de categorías', async ({
    page,
  }) => {
    await login(page);

    // 1. Selector de período y filtros
    await expect(page.getByRole('toolbar', { name: 'Filtro de período y moneda' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Últimos 30 días' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Últimos 90 días' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Año actual' })).toBeVisible();

    // 2. Tarjetas de métricas
    await expect(page.getByRole('heading', { level: 2, name: 'Saldo consolidado' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Ingresos' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Egresos' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Burn rate mensual' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Runway' })).toBeVisible();

    // Comprobar valores formateados
    await expect(page.getByText('45.000,00 €')).toBeVisible(); // Saldo consolidado
    await expect(page.getByText('12.500,00 €')).toBeVisible(); // Ingresos
    await expect(page.getByText('8.200,00 €').first()).toBeVisible(); // Egresos / Burn rate
    await expect(page.getByText('5.5 meses')).toBeVisible(); // Runway

    // 3. Gráfico de flujo de caja
    await expect(
      page.getByRole('region', { name: 'Gráfico de ingresos y egresos en el tiempo' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Evolución de flujo de caja' }),
    ).toBeVisible();

    // 4. Desglose por categorías
    await expect(
      page.getByRole('region', { name: 'Desglose de gastos por categoría' }),
    ).toBeVisible();
    await expect(page.getByText('Servicios en la nube')).toBeVisible();
    await expect(page.getByText('Nómina')).toBeVisible();

    await page.screenshot({ path: '../../docs/screenshots/dashboard-full.png', fullPage: true });
  });

  test('el cambio de período actualiza la URL y los datos del resumen', async ({ page }) => {
    await login(page);

    // Inicialmente en 30 días, Ingresos = 12.500,00 €
    await expect(page.getByText('12.500,00 €')).toBeVisible();

    // Cambiar a "Últimos 90 días"
    const button90d = page.getByRole('button', { name: 'Últimos 90 días' });
    await expect(button90d).toBeEnabled();
    await button90d.click();

    // La URL debe actualizarse con el rango de 90 días
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);

    // Los datos deben actualizarse según la respuesta del período mayor
    await expect(page.getByText('38.500,00 €')).toBeVisible();
  });

  test('selector de moneda conmuta divisas si hay más de una disponible', async ({ page }) => {
    await login(page);

    // Esperar a que la página esté hidratada y muestre el balance inicial
    await expect(page.getByText('45.000,00 €')).toBeVisible();

    const currencySelect = page.getByLabel('Moneda:');
    await expect(currencySelect).toBeVisible();
    await expect(currencySelect).toBeEnabled();
    await currencySelect.selectOption('USD');

    await expect(page).toHaveURL(/currency=USD/);
    await expect(page.getByText(/45\.000,00\s*(US\$|\$)/)).toBeVisible();
  });

  test('muestra estado vacío (empty state) cuando hasData=false con CTAs accionables', async ({
    page,
  }) => {
    await login(page);

    // Forzar escenario de datos vacíos mediante parámetro
    await page.goto('/resumen?currency=EMPTY');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Sin movimientos en el período' }),
    ).toBeVisible();
    await expect(page.getByText('No encontramos transacciones ni cuentas activas')).toBeVisible();

    // CTAs para vincular cuenta o subir factura
    const linkBancos = page.getByRole('link', { name: 'Vincular cuenta bancaria' });
    const linkFacturas = page.getByRole('link', { name: 'Subir factura' });
    await expect(linkBancos).toBeVisible();
    await expect(linkBancos).toHaveAttribute('href', '/bancos');
    await expect(linkFacturas).toBeVisible();
    await expect(linkFacturas).toHaveAttribute('href', '/facturas');

    await page.screenshot({ path: '../../docs/screenshots/dashboard-empty.png', fullPage: true });
  });

  test('muestra estado de error con botón de reintento funcional', async ({ page }) => {
    await login(page);

    // Forzar escenario de error
    await page.goto('/resumen?currency=ERROR');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Error al cargar el resumen' }),
    ).toBeVisible();
    await expect(page.getByText('Error interno del servicio de finanzas')).toBeVisible();

    const retryButton = page.getByRole('button', { name: 'Reintentar' });
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();

    await page.screenshot({ path: '../../docs/screenshots/dashboard-error.png', fullPage: true });

    await retryButton.click();
  });

  test('cumple accesibilidad WCAG sin violaciones críticas según axe', async ({ page }) => {
    await login(page);

    // Análisis de accesibilidad con axe-core
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical',
    );

    expect(criticalViolations).toEqual([]);
  });
});
