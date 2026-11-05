import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * E2E conversacional del agente (SF3-12 / issue #82).
 *
 * Canal API (`request`) contra el gateway falso (`mock-gateway.mjs`), en
 * cumplimiento de la directriz de QA de no construir pantallas de producto
 * nuevas en una issue de calidad (`docs/qa/e2e-matrix.md`, deuda #54).
 * La pantalla `/agente` (flujo UI completo) depende de la issue de UI
 * conversacional pendiente; este spec cubre el contrato perimetral exacto
 * que consumirá esa pantalla: login → pregunta → llamada del chat del
 * gateway → cita → presupuesto actualizado, incluidas las variantes
 * "con stub LLM", "sin LLM (respuesta degradada determinista)" y
 * "presupuesto agotado sin llamada al proveedor".
 */

const GATEWAY_URL = 'http://127.0.0.1:3200';
const AUTH_A = { Authorization: 'Bearer access-tenant-a' };
const AUTH_B = { Authorization: 'Bearer access-tenant-b' };
const BUDGET_MICRO_USD = 2_000_000;
const CASHFLOW_QUESTION = '¿Cuál es el flujo de caja del periodo 2026-01-01 al 2026-01-31?';

/** Inicia sesión en el portal web con credenciales del tenant. */
async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('correct-password');
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/resumen'),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

async function resetTenant(request: APIRequestContext, authorization: string): Promise<void> {
  const res = await request.post(`${GATEWAY_URL}/api/v1/agent/dev/reset`, {
    headers: { Authorization: authorization },
  });
  expect(res.status()).toBe(200);
}

async function agentChat(
  request: APIRequestContext,
  message: string,
  options: { authorization: string; headers?: Record<string, string> },
) {
  return request.post(`${GATEWAY_URL}/api/v1/agent/chat`, {
    headers: { Authorization: options.authorization, ...options.headers },
    data: { message },
  });
}

interface AgentChatResponse {
  answer: string;
  citations: Array<Record<string, unknown>>;
  degraded: boolean;
  reason?: string;
  code?: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    costMicroUsd: number;
    budgetRemainingMicroUsd: number;
    cacheHit: boolean;
  };
}

/** Deuda documentada: a11y de la futura pantalla /agente entra con la issue de UI. */
async function expectLoginA11y(page: Page): Promise<void> {
  await page.goto('/login');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(
    blocking,
    `violaciones axe bloqueantes en /login: ${blocking.map((v) => v.id).join(', ')}`,
  ).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.describe('E2E conversacional del agente (issue #82)', () => {
  test('accesibilidad del canal UI disponible: login sin violaciones axe bloqueantes', async ({
    page,
  }) => {
    await expectLoginA11y(page);
  });

  test('flujo feliz: login → pregunta → cita de herramienta → presupuesto actualizado', async ({
    page,
    request,
  }) => {
    // 1. Login real por UI (Tenant A)
    await loginAs(page, 'ada@example.com');
    await resetTenant(request, 'Bearer access-tenant-a');

    // 2. Pregunta con fechas explícitas → router determinista → get_cashflow_summary
    const chatRes = await agentChat(request, CASHFLOW_QUESTION, {
      authorization: AUTH_A.Authorization,
    });
    expect(chatRes.status()).toBe(200);
    const chat = (await chatRes.json()) as AgentChatResponse;

    expect(chat.degraded).toBe(false);
    expect(
      chat.citations.some((c) => c.source === 'tool' && c.tool === 'get_cashflow_summary'),
    ).toBe(true);
    // Orden "con stub": el proveedor compuso la respuesta con cifras fundamentadas
    // (mismas cifras que el dashboard del tenant A).
    expect(chat.answer).toContain('12.500,00 €');
    expect(chat.answer).toContain('8.200,00 €');
    expect(chat.answer).toContain('45.000,00 €');
    expect(chat.usage.promptTokens).toBeGreaterThan(0);
    expect(chat.usage.completionTokens).toBeGreaterThan(0);
    expect(chat.usage.costMicroUsd).toBeGreaterThan(0);
    expect(chat.usage.budgetRemainingMicroUsd).toBeLessThan(BUDGET_MICRO_USD);

    // 3. Presupuesto actualizado: persiste tras la liquidación de la conversación
    const budgetRes = await request.get(`${GATEWAY_URL}/api/v1/agent/budget`, {
      headers: AUTH_A,
    });
    expect(budgetRes.status()).toBe(200);
    const budget = await budgetRes.json();
    expect(budget.remainingMicroUsd).toBe(chat.usage.budgetRemainingMicroUsd);
    expect(budget.usedMicroUsd).toBeGreaterThan(0);
  });

  test('sin LLM: herramientas caídas → degradado determinista y 0 llamadas al proveedor', async ({
    request,
  }) => {
    await resetTenant(request, 'Bearer access-tenant-a');

    const chatRes = await agentChat(request, '¿Qué transacciones quedan sin conciliar?', {
      authorization: AUTH_A.Authorization,
      headers: { 'X-E2E-Scenario': 'all-tools-failed' },
    });
    expect(chatRes.status()).toBe(200);
    const chat = (await chatRes.json()) as AgentChatResponse;

    // Responde degradado con código estable, sin notas del proveedor
    expect(chat.degraded).toBe(true);
    expect(chat.code).toBe('ALL_TOOLS_FAILED');
    expect(chat.reason).toBe('PROVIDER_ERROR');
    expect(chat.citations.some((c) => c.source === 'tool')).toBe(false);
    expect(chat.usage.costMicroUsd).toBe(0);
    expect(chat.usage.promptTokens).toBe(0);
    expect(chat.usage.budgetRemainingMicroUsd).toBe(BUDGET_MICRO_USD);

    const statsRes = await request.get(`${GATEWAY_URL}/api/v1/agent/dev/stats`, {
      headers: AUTH_A,
    });
    const stats = await statsRes.json();
    expect(stats.llmProviderCalls).toBe(0);
  });

  test('con stub: repetir la misma pregunta acierta en caché y no consume presupuesto', async ({
    request,
  }) => {
    await resetTenant(request, 'Bearer access-tenant-a');

    const firstRes = await agentChat(request, CASHFLOW_QUESTION, {
      authorization: AUTH_A.Authorization,
    });
    expect(firstRes.status()).toBe(200);
    const first = (await firstRes.json()) as AgentChatResponse;
    expect(first.usage.cacheHit).toBe(false);

    const secondRes = await agentChat(request, CASHFLOW_QUESTION, {
      authorization: AUTH_A.Authorization,
    });
    expect(secondRes.status()).toBe(200);
    const second = (await secondRes.json()) as AgentChatResponse;

    expect(second.usage.cacheHit).toBe(true);
    expect(second.usage.costMicroUsd).toBe(0);
    expect(second.usage.budgetRemainingMicroUsd).toBe(first.usage.budgetRemainingMicroUsd);
    expect(second.degraded).toBe(false);

    const statsRes = await request.get(`${GATEWAY_URL}/api/v1/agent/dev/stats`, {
      headers: AUTH_A,
    });
    const stats = await statsRes.json();
    expect(stats.cacheHits).toBe(1);
    expect(stats.llmProviderCalls).toBe(1);
  });

  test('presupuesto agotado: respuesta degradada y nunca llama al proveedor', async ({
    request,
  }) => {
    await resetTenant(request, 'Bearer access-tenant-a');

    // Drena el presupuesto del tenant (mensaje de control determinista)
    const drainRes = await agentChat(request, 'agotar presupuesto del mes', {
      authorization: AUTH_A.Authorization,
    });
    expect(drainRes.status()).toBe(200);
    const drain = (await drainRes.json()) as AgentChatResponse;
    expect(drain.degraded).toBe(true);
    expect(drain.code).toBe('BUDGET_EXHAUSTED');
    expect(drain.usage.costMicroUsd).toBe(0);

    // Toda pregunta posterior responde degradado sin proveedor y sin consumo
    const chatRes = await agentChat(request, CASHFLOW_QUESTION, {
      authorization: AUTH_A.Authorization,
    });
    expect(chatRes.status()).toBe(200);
    const chat = (await chatRes.json()) as AgentChatResponse;

    expect(chat.degraded).toBe(true);
    expect(chat.reason).toBe('BUDGET_EXHAUSTED');
    expect(chat.answer).toContain('degradado');
    expect(chat.citations).toEqual([]);
    expect(chat.usage.costMicroUsd).toBe(0);
    expect(chat.usage.budgetRemainingMicroUsd).toBe(0);

    const statsRes = await request.get(`${GATEWAY_URL}/api/v1/agent/dev/stats`, {
      headers: AUTH_A,
    });
    const stats = await statsRes.json();
    expect(stats.llmProviderCalls).toBe(0);
    expect(stats.degradedEvents).toBeGreaterThanOrEqual(2);
  });

  test('RBAC del canal: VIEWER no puede conversar con el agente', async ({ request }) => {
    await resetTenant(request, 'Bearer access-tenant-a');

    const res = await agentChat(request, CASHFLOW_QUESTION, {
      authorization: AUTH_A.Authorization,
      headers: { 'X-E2E-Role': 'VIEWER' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toBe('insufficient_permissions');
  });

  test('aislamiento por tenant: A y B conversan sin fugas de datos cruzados', async ({
    browser,
    request,
  }) => {
    await resetTenant(request, 'Bearer access-tenant-a');
    await resetTenant(request, 'Bearer access-tenant-b');

    // Dos contextos de navegador aislados (sesión A y sesión B)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await loginAs(pageA, 'ada@example.com');
      await loginAs(pageB, 'bob@example.com');

      // La misma pregunta produce datos distintos y propios por tenant
      const [resA, resB] = await Promise.all([
        agentChat(request, CASHFLOW_QUESTION, { authorization: AUTH_A.Authorization }),
        agentChat(request, CASHFLOW_QUESTION, { authorization: AUTH_B.Authorization }),
      ]);
      expect(resA.status()).toBe(200);
      expect(resB.status()).toBe(200);

      const chatA = (await resA.json()) as AgentChatResponse;
      const chatB = (await resB.json()) as AgentChatResponse;

      // A sólo ve cifras de A
      expect(chatA.answer).toContain('45.000,00 €');
      expect(chatA.answer).not.toContain('99.000,00 €');
      expect(chatA.answer).not.toContain('21.000,00 €');

      // B sólo ve cifras de B
      expect(chatB.answer).toContain('99.000,00 €');
      expect(chatB.answer).not.toContain('45.000,00 €');
      expect(chatB.answer).not.toContain('12.500,00 €');

      // La memoria conversacional no cruza tenants: segunda ronda de B no cita
      // contenido guardado por A.
      const memoryQuestion = 'conciliación sin conciliar';
      const resMemoryB = await agentChat(request, memoryQuestion, {
        authorization: AUTH_B.Authorization,
      });
      expect(resMemoryB.status()).toBe(200);
      const chatMemoryB = (await resMemoryB.json()) as AgentChatResponse;
      expect(chatMemoryB.answer).not.toContain('Ada');
      expect(chatMemoryB.answer).not.toContain('45.000,00 €');
      const serializedB = JSON.stringify(chatMemoryB);
      expect(serializedB).not.toContain('Movimiento 00001');

      // Reflejo en UI existente (deuda #54): cada tenant ve su propio dashboard
      await expect(pageB.getByText('99.000,00 €')).toBeVisible();
      await expect(pageB.getByText('45.000,00 €')).toHaveCount(0);
      await expect(pageA.getByText('45.000,00 €')).toBeVisible();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
