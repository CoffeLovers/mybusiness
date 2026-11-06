import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E del panel de agente (SF3-05, issue #75).
 *
 * Usan el mock gateway incluido en `e2e/mock-gateway.mjs`. El mensaje controla
 * el escenario: contiene `degraded` para el modo degradado y `fail` para el
 * error del proveedor.
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('ada@example.com');
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

async function openAgent(page: Page): Promise<void> {
  await login(page);
  await page.goto('/agente');
  await expect(page.getByRole('heading', { level: 1, name: 'Agente' })).toBeVisible();
}

function messageInput(page: Page) {
  return page.getByLabel('Mensaje para el agente');
}

async function sendMessage(page: Page, message: string): Promise<void> {
  await messageInput(page).fill(message);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

test.describe('Panel de agente (Issue #75)', () => {
  test('envía un mensaje y muestra la respuesta con sus citas', async ({ page }) => {
    await openAgent(page);

    await sendMessage(page, '¿Cuál es mi saldo?');

    const log = page.getByRole('log');
    await expect(log.getByText('¿Cuál es mi saldo?', { exact: true })).toBeVisible();
    await expect(log.getByText(/Tu saldo actual es 45\.000,00 €/)).toBeVisible();

    const citations = log.getByRole('list', { name: 'Fuentes' });
    await expect(citations.getByText('Herramienta')).toBeVisible();
    await expect(citations.getByText('Resumen de flujo de caja')).toBeVisible();
    await expect(citations.getByText('Memoria')).toBeVisible();
    await expect(log.getByText(/tokens ·/)).toBeVisible();
  });

  test('el presupuesto se recalcula con el restante que devuelve el backend', async ({ page }) => {
    await openAgent(page);

    const progress = page.getByRole('progressbar', { name: 'Presupuesto consumido' });
    await expect(progress).toBeVisible();
    const before = await progress.getAttribute('aria-valuenow');

    await sendMessage(page, 'Resumen de flujo de caja del mes');

    await expect.poll(() => progress.getAttribute('aria-valuenow')).not.toBe(before);
    await expect(page.getByText(/Restante:/)).toBeVisible();
  });

  test('muestra el chip de modo degradado con su motivo', async ({ page }) => {
    await openAgent(page);

    await sendMessage(page, 'degraded');

    const log = page.getByRole('log');
    await expect(log.getByText(/Modo degradado/)).toBeVisible();
    await expect(log.getByText(/PROVIDER_UNAVAILABLE/)).toBeVisible();
  });

  test('un error del proveedor muestra Reintentar y reenvía el mensaje', async ({ page }) => {
    await openAgent(page);

    let calls = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/agent/chat')) {
        calls += 1;
      }
    });

    await sendMessage(page, 'fail');

    const alert = page.getByRole('alert').filter({ hasText: 'No se pudo obtener la respuesta' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    expect(calls).toBe(1);

    await alert.getByRole('button', { name: 'Reintentar' }).click();
    await expect.poll(() => calls).toBe(2);
  });

  test('las sugerencias rellenan el input sin enviar', async ({ page }) => {
    await openAgent(page);

    await page.getByRole('button', { name: 'Movimientos sin conciliar' }).click();

    await expect(messageInput(page)).toHaveValue('Movimientos sin conciliar');
    // Rellenar no envía: el hilo de mensajes sigue vacío.
    await expect(page.getByRole('log').locator('ol')).toHaveCount(0);
  });

  test('teclado: Enter envía y Shift+Enter añade una línea', async ({ page }) => {
    await openAgent(page);

    const input = messageInput(page);

    await input.fill('primera línea');
    await input.press('Shift+Enter');
    await input.pressSequentially('segunda línea');
    await expect(input).toHaveValue('primera línea\nsegunda línea');
    await expect(page.getByRole('log').getByText('primera línea', { exact: true })).toHaveCount(0);

    await input.press('Enter');
    await expect(page.getByRole('log').getByText('primera línea', { exact: false })).toBeVisible();
    await expect(input).toHaveValue('');
  });

  test('axe no reporta violaciones WCAG A/AA en /agente', async ({ page }) => {
    await openAgent(page);

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

    expect(results.violations).toEqual([]);
  });
});
