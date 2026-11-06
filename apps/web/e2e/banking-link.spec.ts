import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * E2E del flujo de vinculación con Plaid Link.
 *
 * El CDN de Plaid se intercepta con un stub: la prueba verifica el contrato
 * (link-token → navegación → `open()` → exchange) sin depender de la red
 * externa ni del widget real.
 */

const PLAID_SCRIPT_URL = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

const PLAID_STUB = `
window.Plaid = {
  create: function () {
    return {
      open: function () {
        window.Plaid.__opened = true;
      },
    };
  },
};
`;

/**
 * Stub que dispara `onSuccess` al abrir el widget, como haría Plaid tras
 * autorizar el banco. Se usa para observar el destino de vuelta real.
 */
const PLAID_SUCCESS_STUB = `
window.Plaid = {
  create: function (options) {
    return {
      open: function () {
        window.Plaid.__opened = true;
        options.onSuccess('public-sandbox-1', {});
      },
    };
  },
};
`;

async function stubPlaidScript(page: Page, body: string = PLAID_STUB): Promise<void> {
  await page.route(PLAID_SCRIPT_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body }),
  );
}

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

test.describe('Vinculación Plaid Link', () => {
  test('a. /bancos ofrece el botón "Vincular cuenta"', async ({ page }) => {
    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const button = page.getByRole('button', { name: 'Vincular cuenta' });

    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
  });

  test('b. el botón pide un link-token y navega al lanzador', async ({ page }) => {
    await stubPlaidScript(page);
    await loginAs(page, 'ada@example.com');
    await openBanks(page);

    const tokenRequest = page.waitForRequest(
      (request) => request.url().includes('/api/banking/link-token') && request.method() === 'POST',
    );

    await page.getByRole('button', { name: 'Vincular cuenta' }).click();

    const request = await tokenRequest;

    expect(request.postDataJSON()).toEqual({ provider: 'plaid' });
    await expect(page).toHaveURL(/\/banking\/link\?token=link-sandbox-test/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Vinculando tu banco' }),
    ).toBeVisible();
  });

  test('c. el lanzador carga el script de Plaid y abre el widget', async ({ page }) => {
    await stubPlaidScript(page);
    await loginAs(page, 'ada@example.com');

    await page.goto('/banking/link?token=link-sandbox-test&redirect_uri=/bancos&provider=plaid');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Vinculando tu banco' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as { Plaid?: { __opened?: boolean } }).Plaid?.__opened),
        ),
      )
      .toBe(true);
  });

  test('d. volver con public_token canjea la conexión y refresca la lista', async ({ page }) => {
    await loginAs(page, 'ada@example.com');

    const exchangeRequest = page.waitForRequest(
      (request) => request.url().includes('/api/banking/exchange') && request.method() === 'POST',
    );

    await page.goto('/bancos?public_token=public-sandbox-test');

    const request = await exchangeRequest;

    expect(request.postDataJSON()).toEqual({
      provider: 'plaid',
      publicToken: 'public-sandbox-test',
    });

    await expect(page).toHaveURL(/\/bancos(\?|$)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bancos' })).toBeVisible();
    await expect(page.getByText('Banco Santander Empresas').first()).toBeVisible();
  });

  test('e. redirect_uri nativo conserva el deep link al volver del widget', async ({ page }) => {
    await stubPlaidScript(page, PLAID_SUCCESS_STUB);

    const response = await page.goto(
      '/banking/link?token=link-test&redirect_uri=mybusiness%3A%2F%2Fbanking%2Freturn',
    );

    // El destino resuelto viaja en el payload RSC del componente cliente: debe
    // ser el deep link literal, no `/bancos`.
    const html = (await response?.text()) ?? '';

    expect(html).toContain('mybusiness://banking/return');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Vinculando tu banco' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as { Plaid?: { __opened?: boolean } }).Plaid?.__opened),
        ),
      )
      .toBe(true);

    // Chromium no entrega `mybusiness://` sin gesto de usuario, así que la
    // navegación al esquema se bloquea en el navegador. Lo que sí se verifica
    // aquí es que el flujo nativo NO cae al portal web (`/bancos`); el destino
    // exacto (`mybusiness://banking/return?public_token=…`) queda cubierto por
    // el test unitario de `resolveReturnTo` y el `withQuery` del lanzador.
    await page.waitForTimeout(500);

    expect(page.url()).toContain('/banking/link');
    expect(page.url()).not.toContain('/bancos');
  });
});
