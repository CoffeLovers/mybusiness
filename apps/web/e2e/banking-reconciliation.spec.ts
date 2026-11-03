import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const GATEWAY_URL = 'http://127.0.0.1:3200';

/** Inicia sesión en el portal web con credenciales del tenant */
async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

test.describe('E2E Multi-canal: Banking, Conciliación y Aislamiento Tenant (Issue #54)', () => {
  test('Flujo 1 + 2 + 3: login -> vincular cuenta vía gateway -> dashboard muestra datos consolidados', async ({
    page,
    request,
  }) => {
    // 1. Login de usuario Ada (Tenant A)
    await loginAs(page, 'ada@example.com');

    // 2. Vinculación bancaria a través de la API del gateway falso
    const connectRes = await request.post(`${GATEWAY_URL}/api/v1/banking/connect`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
      data: { provider: 'PLAID', institutionId: 'ins_santander' },
    });
    expect(connectRes.status()).toBe(201);
    const connectData = await connectRes.json();
    expect(connectData.linkToken).toBeDefined();

    const exchangeRes = await request.post(`${GATEWAY_URL}/api/v1/banking/exchange`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
      data: {
        provider: 'PLAID',
        publicToken: connectData.linkToken,
        institution: 'Banco Santander Empresas',
      },
    });
    expect(exchangeRes.status()).toBe(201);
    const connection = await exchangeRes.json();
    expect(connection.status).toBe('ACTIVE');
    expect(connection.id).toBeDefined();

    const accountsRes = await request.get(
      `${GATEWAY_URL}/api/v1/banking/connections/${connection.id}/accounts`,
      {
        headers: { Authorization: 'Bearer access-tenant-a' },
      },
    );
    expect(accountsRes.status()).toBe(200);
    const accounts = await accountsRes.json();
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0].name).toBe('Cuenta Operativa Principal');

    const syncRes = await request.post(
      `${GATEWAY_URL}/api/v1/banking/connections/${connection.id}/sync`,
      {
        headers: { Authorization: 'Bearer access-tenant-a' },
      },
    );
    expect(syncRes.status()).toBe(200);
    const syncData = await syncRes.json();
    expect(syncData.added).toBeGreaterThan(0);

    // 3. Verificar en UI que el Dashboard muestra las métricas consolidadas del tenant
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
    await expect(page.getByText('45.000,00 €')).toBeVisible(); // Saldo consolidado
    await expect(page.getByText('12.500,00 €')).toBeVisible(); // Ingresos
    await expect(page.getByText('8.200,00 €').first()).toBeVisible(); // Egresos
  });

  test('Flujo 3 + 4 + 5: dashboard -> libro mayor -> conciliación (run + confirmación) -> reflejo en UI con evidencia', async ({
    page,
    request,
  }) => {
    // 1. Login y navegación desde dashboard al libro mayor
    await loginAs(page, 'ada@example.com');
    await page.getByRole('link', { name: 'Libro mayor' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Libro mayor' })).toBeVisible();
    await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');

    // 2. Ejecutar corrida de conciliación inteligente vía API del gateway falso
    const runRes = await request.post(`${GATEWAY_URL}/api/v1/finance/reconciliation/run`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
      data: { trigger: 'MANUAL', lookbackDays: 30 },
    });
    expect(runRes.status()).toBe(201);
    const runResult = await runRes.json();
    expect(runResult.status).toBe('COMPLETED');

    // 3. Consultar bandeja de revisión y confirmar el match propuesto
    const reviewRes = await request.get(`${GATEWAY_URL}/api/v1/finance/reconciliation/review`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
    });
    expect(reviewRes.status()).toBe(200);
    const reviewItems = await reviewRes.json();
    expect(reviewItems.length).toBeGreaterThan(0);
    const itemToConfirm = reviewItems[0];
    expect(itemToConfirm.id).toBeDefined();

    const confirmRes = await request.post(
      `${GATEWAY_URL}/api/v1/finance/reconciliation/review/${itemToConfirm.id}/confirm`,
      {
        headers: { Authorization: 'Bearer access-tenant-a' },
      },
    );
    expect(confirmRes.status()).toBe(200);
    const confirmData = await confirmRes.json();
    expect(confirmData.confirmed).toBe(true);
    expect(confirmData.status).toBe('MANUAL_MATCHED');

    // 4. Verificar en UI (/libro-mayor) que el estado cambia a "Conciliado manual" y muestra el enlace de evidencia
    await page.goto('/libro-mayor?reconciliationStatus=MANUAL_MATCHED');
    await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');

    // Comprobar chip de estado "Conciliado manual" en la tabla
    await expect(page.locator('tbody').getByText('Conciliado manual').first()).toBeVisible();

    // Comprobar enlace de evidencia documental
    const evidenceLink = page
      .locator('tbody')
      .getByRole('link', { name: 'Factura-Auditoria-SF2.pdf' })
      .first();
    await expect(evidenceLink).toBeVisible();
    await expect(evidenceLink).toHaveAttribute('href', /^\/documentos\/doc-a-001/);
  });

  test('Aislamiento por Tenant A/B: estricta separación de datos en UI y 404 en acceso cruzado en API', async ({
    browser,
    request,
  }) => {
    // 1. Aislamiento a nivel API:
    // Tenant A crea una conexión y un caso de conciliación
    const exchangeRes = await request.post(`${GATEWAY_URL}/api/v1/banking/exchange`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
      data: { provider: 'PLAID', institution: 'Banco Santander A' },
    });
    const connA = await exchangeRes.json();

    await request.post(`${GATEWAY_URL}/api/v1/finance/reconciliation/run`, {
      headers: { Authorization: 'Bearer access-tenant-a' },
      data: {},
    });

    // Peticiones de Tenant B intentando acceder a los recursos de Tenant A
    const crossAccountRes = await request.get(
      `${GATEWAY_URL}/api/v1/banking/connections/${connA.id}/accounts`,
      {
        headers: { Authorization: 'Bearer access-tenant-b' },
      },
    );
    expect(crossAccountRes.status()).toBe(404);

    const crossSyncRes = await request.post(
      `${GATEWAY_URL}/api/v1/banking/connections/${connA.id}/sync`,
      {
        headers: { Authorization: 'Bearer access-tenant-b' },
      },
    );
    expect(crossSyncRes.status()).toBe(404);

    const crossConfirmRes = await request.post(
      `${GATEWAY_URL}/api/v1/finance/reconciliation/review/rev-a-001/confirm`,
      {
        headers: { Authorization: 'Bearer access-tenant-b' },
      },
    );
    expect(crossConfirmRes.status()).toBe(404);

    // Listar conexiones para Tenant B no incluye las de Tenant A
    const bConnectionsRes = await request.get(`${GATEWAY_URL}/api/v1/banking/connections`, {
      headers: { Authorization: 'Bearer access-tenant-b' },
    });
    const bConnections = await bConnectionsRes.json();
    const hasTenantAConn = bConnections.some((c: { id: string }) => c.id === connA.id);
    expect(hasTenantAConn).toBe(false);

    // 2. Aislamiento a nivel UI con dos contextos de navegador independientes
    // Contexto A: Ada (Tenant A)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await loginAs(pageA, 'ada@example.com');
    await expect(pageA.getByText('45.000,00 €')).toBeVisible();

    await pageA.goto('/libro-mayor');
    await expect(pageA.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    await expect(pageA.getByText(/50000 movimientos/)).toBeVisible();
    await expect(pageA.getByText('Movimiento Exclusivo Tenant B 001')).not.toBeVisible();

    // Contexto B: Bob (Tenant B)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await loginAs(pageB, 'bob@example.com');
    await expect(pageB.getByText('99.000,00 €')).toBeVisible();
    await expect(pageB.getByText('45.000,00 €')).not.toBeVisible();

    await pageB.goto('/libro-mayor');
    await expect(pageB.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    await expect(pageB.getByText(/2 movimientos/)).toBeVisible();
    await expect(pageB.getByText('Movimiento Exclusivo Tenant B 001')).toBeVisible();
    await expect(pageB.getByText(/50000 movimientos/)).not.toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
