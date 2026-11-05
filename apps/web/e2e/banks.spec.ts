import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E de la página de bancos.
 *
 * Usan el mock gateway de `e2e/mock-gateway.mjs`, que expone una conexión
 * activa con dos cuentas para el tenant A y endpoints de sincronización y
 * desvinculación. Los casos se ejecutan en serie porque comparten estado en
 * memoria del mock dentro del mismo archivo.
 */

const GATEWAY_URL = 'http://127.0.0.1:3200';

test.describe.configure({ mode: 'serial' });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

async function openBanks(page: Page): Promise<void> {
  await page.goto('/bancos');
  await expect(page.getByRole('heading', { level: 1, name: 'Bancos' })).toBeVisible();
  await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');
}

test.describe('Bancos', () => {
  test('a. muestra la conexión activa y sus cuentas con saldo formateado', async ({ page }) => {
    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const card = page.getByRole('group', { name: 'Conexión Banco Andino Central' });

    await expect(card).toBeVisible();
    await expect(card.getByText('Proveedor: Plaid')).toBeVisible();
    await expect(card.getByText('Activa')).toBeVisible();

    await expect(card.getByText('Cuenta Corriente Principal')).toBeVisible();
    await expect(card.getByText(/•••• 1234/)).toBeVisible();
    await expect(card.getByText(/1\.250,50/)).toBeVisible();

    await expect(card.getByText('Cuenta de Ahorro Nómina')).toBeVisible();
    await expect(card.getByText(/•••• 9876/)).toBeVisible();
    await expect(card.getByText(/8\.300,75/)).toBeVisible();

    // La vinculación no se ofrece en web: no hay botón falso de Plaid Link.
    await expect(page.getByRole('button', { name: /^Vincular/ })).toHaveCount(0);
  });

  test('b. sincronizar anuncia el resultado y refresca los datos', async ({ page }) => {
    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const card = page.getByRole('group', { name: 'Conexión Banco Andino Central' });

    await card.getByRole('button', { name: 'Sincronizar Banco Andino Central' }).click();

    const status = page.getByRole('status');

    await expect(status).toContainText(
      'Sincronización de Banco Andino Central completada: 3 añadidos, 0 actualizados, 0 eliminados.',
    );
    await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    await expect(card).toBeVisible();
  });

  test('c. desvincular pide confirmación y elimina la conexión', async ({ page, request }) => {
    const exchangeResponse = await request.post(`${GATEWAY_URL}/api/v1/banking/exchange`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
      data: { provider: 'plaid', institution: 'Banco Efímero E2E' },
    });
    expect(exchangeResponse.status()).toBe(201);
    const connection = (await exchangeResponse.json()) as { id: string };

    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const card = page.getByRole('group', { name: 'Conexión Banco Efímero E2E' });

    await expect(card).toBeVisible();

    let dialogMessage = '';

    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await card.getByRole('button', { name: 'Desvincular Banco Efímero E2E' }).click();

    await expect.poll(() => dialogMessage).toContain('¿Desvincular Banco Efímero E2E?');
    await expect(page.getByRole('status')).toContainText('Banco Efímero E2E desvinculada.');
    await expect(card).toHaveCount(0);

    const connectionsResponse = await request.get(`${GATEWAY_URL}/api/v1/banking/connections`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
    });
    const connections = (await connectionsResponse.json()) as { id: string }[];

    expect(connections.some((item) => item.id === connection.id)).toBe(false);
  });

  test('d. estado vacío sin acciones falsas', async ({ page, request }) => {
    const connectionsResponse = await request.get(`${GATEWAY_URL}/api/v1/banking/connections`, {
      headers: { Authorization: 'Bearer access-tenant-b' },
    });
    const connections = (await connectionsResponse.json()) as { id: string }[];

    for (const connection of connections) {
      const deleteResponse = await request.delete(
        `${GATEWAY_URL}/api/v1/banking/connections/${connection.id}`,
        { headers: { Authorization: 'Bearer access-tenant-b' } },
      );

      expect(deleteResponse.status()).toBe(204);
    }

    await loginAs(page, 'bob@example.com');
    await openBanks(page);

    await expect(page.getByRole('heading', { name: 'No hay cuentas vinculadas' })).toBeVisible();
    await expect(
      page.getByText('Vincula tu banco desde la app Android o completa el exchange por API'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Vincular/ })).toHaveCount(0);
  });

  test('e. axe no reporta violaciones WCAG A/AA en /bancos', async ({ page }) => {
    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

    expect(results.violations).toEqual([]);
  });

  test('f. los botones se activan con teclado y mantienen el foco visible', async ({ page }) => {
    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const card = page.getByRole('group', { name: 'Conexión Banco Andino Central' });
    const syncButton = card.getByRole('button', { name: 'Sincronizar Banco Andino Central' });
    const disconnectButton = card.getByRole('button', {
      name: 'Desvincular Banco Andino Central',
    });

    await syncButton.focus();
    await expect(syncButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status')).toContainText(
      'Sincronización de Banco Andino Central completada',
    );

    await disconnectButton.focus();
    await expect(disconnectButton).toBeFocused();
  });
});
