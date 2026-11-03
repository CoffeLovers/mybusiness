import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E del libro mayor (issue #51).
 *
 * Usan el mock gateway incluido en `e2e/mock-gateway.mjs`, que genera 50.000
 * movimientos deterministas y expone los endpoints del BFF. Cada caso inicia
 * sesión con el usuario de pruebas.
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('ada@example.com');
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

/** Abre el libro mayor y espera a que la tabla tenga filas y no esté ocupada. */
async function openLedger(page: Page): Promise<void> {
  await login(page);
  await page.goto('/libro-mayor');
  await expect(page.getByRole('heading', { level: 1, name: 'Libro mayor' })).toBeVisible();
  await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/** Anuncio `aria-live` propio de la vista (hijo directo de la sección). */
function liveAnnouncement(page: Page) {
  return page.locator('section[aria-busy] > p[role="status"]');
}

test.describe('Libro mayor (Issue #51)', () => {
  test('a. 50.000 filas sin bloquear: ordenar por importe responde rápido y virtualiza', async ({
    page,
  }, testInfo) => {
    await openLedger(page);

    // El total viene del gateway, no de las filas cargadas en el cliente.
    await expect(page.getByText(/50000 movimientos/)).toBeVisible();

    const startedAt = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Ordenar por Importe' }).click();
    await page.waitForFunction(() => window.location.search.includes('sortBy=amount'));
    const finishedAt = await page.evaluate(() => performance.now());

    const elapsed = finishedAt - startedAt;

    testInfo.annotations.push({ type: 'sort-latency', description: `${elapsed.toFixed(0)} ms` });
    expect(elapsed).toBeLessThan(2000);

    // La virtualización mantiene en el DOM sólo las filas visibles + overscan.
    const renderedRows = await page.locator('tbody tr').count();

    expect(renderedRows).toBeLessThan(60);
    await expect(page.getByText(/50000 movimientos/)).toBeVisible();
  });

  test('b. orden y búsqueda van al servidor sin recargar la página', async ({ page }) => {
    await openLedger(page);

    const ledgerRequests: string[] = [];

    page.on('request', (request) => {
      if (request.url().includes('/api/ledger?')) {
        ledgerRequests.push(request.url());
      }
    });

    await page.evaluate(() => {
      (window as unknown as { __ledgerMounted?: boolean }).__ledgerMounted = true;
    });

    await page.getByRole('button', { name: 'Ordenar por Importe' }).click();
    await page.waitForFunction(() => window.location.search.includes('sortBy=amount'));

    expect(
      ledgerRequests.some((url) => url.includes('sortBy=amount') && url.includes('sortDir=asc')),
    ).toBe(true);

    // `replaceState` mantiene el montaje: un reload perdería esta marca.
    expect(
      await page.evaluate(
        () => (window as unknown as { __ledgerMounted?: boolean }).__ledgerMounted ?? false,
      ),
    ).toBe(true);

    await page.getByRole('button', { name: /Ordenar por Importe/ }).click();
    await page.waitForFunction(() => window.location.search.includes('sortDir=desc'));

    // La búsqueda tiene debounce: no se emite una petición por tecla.
    const search = page.getByLabel('Buscar movimientos por descripción o comercio');
    const beforeTyping = ledgerRequests.length;

    await search.fill('Movimiento 0001');
    await page.waitForTimeout(150);
    expect(ledgerRequests.length).toBe(beforeTyping);

    await page.waitForFunction(() => window.location.search.includes('q='));
    expect(ledgerRequests.some((url) => url.includes('q=Movimiento'))).toBe(true);
  });

  test('c. edición optimista con rollback y conflicto anunciado', async ({ page }) => {
    await openLedger(page);

    const normalCell = page
      .getByRole('button', { name: /^Categoría de .*Pulsa para editar$/ })
      .first();

    await normalCell.click();

    const editor = page.getByRole('textbox', { name: /^Categoría de / }).first();

    await editor.fill('Marketing E2E');

    const patchRequest = page.waitForRequest(
      (request) => request.method() === 'PATCH' && request.url().includes('/api/ledger/'),
    );

    await editor.press('Enter');

    const request = await patchRequest;

    expect(request.headers()['x-csrf-token']?.length ?? 0).toBeGreaterThan(0);
    await expect(
      page.getByRole('button', { name: /Categoría de .*Marketing E2E/ }).first(),
    ).toBeVisible();

    // Fila que fuerza un 409 en el mock: se revierte el valor y se anuncia.
    const conflictCell = page
      .getByRole('button', { name: /^Categoría de .*Pulsa para editar$/ })
      .nth(1);

    await conflictCell.click();

    const conflictEditor = page.getByRole('textbox', { name: /^Categoría de / }).first();

    await conflictEditor.fill('__fail');
    await conflictEditor.press('Enter');

    await expect(liveAnnouncement(page)).toContainText('conflict');

    await page.keyboard.press('Escape');

    // Rollback: el valor optimista ya no aparece en la tabla tras el conflicto.
    await expect(page.locator('tbody')).not.toContainText('__fail');
  });

  test('d. acción masiva con confirmación y rechazo de lotes > 500', async ({ page }) => {
    await openLedger(page);

    const checkboxes = page.locator('tbody input[type="checkbox"]');

    for (let index = 0; index < 3; index += 1) {
      await checkboxes.nth(index).check();
    }

    const bulkBar = page.getByRole('region', { name: 'Acciones masivas' });

    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText('3 seleccionados');

    await bulkBar.getByLabel('Categoría').fill('Bulk E2E');

    page.once('dialog', (dialog) => {
      void dialog.accept();
    });

    await bulkBar.getByRole('button', { name: 'Aplicar a 3' }).click();

    await expect(liveAnnouncement(page)).toContainText('Categoría aplicada a 3 movimientos');
    await expect(bulkBar).toBeHidden();

    // El BFF rechaza un lote por encima del máximo antes de tocar el gateway.
    const rejection = await page.evaluate(async () => {
      const csrf = document.cookie.match(/(?:^|; )mb_csrf=([^;]*)/)?.[1] ?? '';
      const ids = Array.from(
        { length: 501 },
        (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      );
      const response = await fetch('/api/ledger/bulk-categorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ ids, category: 'Bulk E2E' }),
      });

      return { status: response.status, body: (await response.json()) as { error?: string } };
    });

    expect(rejection.status).toBe(400);
    expect(rejection.body.error).toBe('too_many_rows');
  });

  test('e. exportación CSV con nombre y contenido correctos', async ({ page }) => {
    await openLedger(page);

    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('button', { name: 'Exportar CSV' }).click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('libro-mayor.csv');

    const filePath = await download.path();

    if (filePath === null) {
      throw new Error('La descarga no generó un archivo local');
    }

    const content = await readFile(filePath, 'utf8');

    expect(content.startsWith('\uFEFFfecha,descripcion,')).toBe(true);
    expect(content.split('\n').length).toBeGreaterThan(2);
  });

  test('f. vistas guardadas: crear con prompt y eliminar con confirmación', async ({ page }) => {
    await openLedger(page);

    const viewName = 'Vista E2E';
    const viewsSelect = page.getByLabel('Vistas guardadas');

    page.once('dialog', (dialog) => {
      void dialog.accept(viewName);
    });

    await page.getByRole('button', { name: 'Guardar vista' }).click();

    const savedOption = viewsSelect.locator('option', { hasText: viewName });

    await expect(savedOption).toHaveCount(1);

    await viewsSelect.selectOption({ label: viewName });

    page.once('dialog', (dialog) => {
      void dialog.accept();
    });

    await page.getByRole('button', { name: 'Eliminar vista' }).click();

    await expect(savedOption).toHaveCount(0);
    await expect(
      page.locator('p[role="status"][aria-live="polite"]').filter({ hasText: 'eliminada' }),
    ).toContainText('eliminada');
  });

  test('g. accesibilidad: sin violaciones críticas en /libro-mayor', async ({ page }) => {
    await openLedger(page);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (violation) => violation.impact === 'critical',
    );

    expect(criticalViolations).toEqual([]);
  });

  test('h. teclado: Tab alcanza la celda, Enter abre y Escape cierra el editor', async ({
    page,
  }) => {
    await openLedger(page);

    const search = page.getByLabel('Buscar movimientos por descripción o comercio');

    await search.focus();

    let reached = false;

    for (let index = 0; index < 250 && !reached; index += 1) {
      await page.keyboard.press('Tab');

      const label = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') ?? '',
      );

      reached = label.startsWith('Categoría de ');
    }

    expect(reached).toBe(true);

    await page.keyboard.press('Enter');

    const editor = page.getByRole('textbox', { name: /^Categoría de / }).first();

    await expect(editor).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
  });
});
