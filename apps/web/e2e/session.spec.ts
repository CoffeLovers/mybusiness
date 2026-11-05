import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3100';
const EMAIL = 'ada@example.com';
const PASSWORD = 'correct-password';

/**
 * Rellena el formulario de login y espera la respuesta del BFF.
 *
 * Esperar la respuesta garantiza que las cookies httpOnly ya estén en el
 * contexto del navegador antes de reutilizarlas vía `request`.
 */
async function login(page: Page, password: string = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(password);

  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/session/login'),
  );

  await page.getByRole('button', { name: 'Entrar' }).click();
  await responsePromise;
}

/** Valor actual de una cookie del contexto del navegador. */
async function cookieValue(page: Page, name: string): Promise<string | undefined> {
  const cookies = await page.context().cookies();

  return cookies.find((cookie) => cookie.name === name)?.value;
}

test.describe('sesión del BFF', () => {
  test('sin sesión, /resumen redirige al login', async ({ page }) => {
    await page.goto('/resumen');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Iniciar sesión' })).toBeVisible();
  });

  test('login correcto deja la sesión sólo en cookies httpOnly', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(`${ORIGIN}/resumen`);
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();

    const storage = await page.evaluate(() => ({
      cookie: document.cookie,
      localStorageKeys: Object.keys(window.localStorage),
      sessionStorageKeys: Object.keys(window.sessionStorage),
    }));

    expect(storage.cookie).not.toContain('access');
    expect(storage.cookie).not.toContain('refresh');
    expect(storage.localStorageKeys).toEqual([]);
    expect(storage.sessionStorageKeys).toEqual([]);
  });

  test('login incorrecto muestra el error y no navega', async ({ page }) => {
    await login(page, 'wrong-password');

    await expect(
      page.getByRole('alert').filter({ hasText: 'Credenciales inválidas.' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout sin token CSRF responde 403 csrf_invalid', async ({ page }) => {
    await login(page);

    const response = await page.request.post('/api/session/logout', {
      headers: { origin: ORIGIN },
      data: {},
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'csrf_invalid' });
  });

  test('un origen no permitido responde 403 origin_not_allowed', async ({ request }) => {
    const response = await request.post('/api/session/login', {
      headers: { origin: 'http://evil.example' },
      data: { email: EMAIL, password: PASSWORD },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'origin_not_allowed' });
  });

  test('el refresh rota la cookie de sesión', async ({ page }) => {
    await login(page);

    const before = await cookieValue(page, 'mb_session');
    const csrfToken = await cookieValue(page, 'mb_csrf');

    expect(before).toBeDefined();
    expect(csrfToken).toBeDefined();

    const response = await page.request.post('/api/session/refresh', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrfToken ?? '' },
      data: {},
    });

    expect(response.status()).toBe(200);

    const after = await cookieValue(page, 'mb_session');

    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  test('el logout con CSRF cierra la sesión', async ({ page }) => {
    await login(page);

    const csrfToken = await cookieValue(page, 'mb_csrf');

    expect(csrfToken).toBeDefined();

    const response = await page.request.post('/api/session/logout', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrfToken ?? '' },
      data: {},
    });

    expect(response.status()).toBe(200);

    await page.goto('/resumen');

    await expect(page).toHaveURL(/\/login$/);
  });
});
