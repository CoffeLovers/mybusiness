import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Inicia sesión con las credenciales del gateway falso de los E2E. */
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('ada@example.com');
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => url.pathname === '/resumen');
  await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
}

test.describe('smoke del portal', () => {
  test('/healthz responde con estado ok', async ({ request }) => {
    const response = await request.get('/healthz');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const body: unknown = await response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'web' });
  });

  test('sin sesión, la portada pública muestra la landing', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1, name: /La confianza se construye/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Iniciar sesión' }),
    ).toBeVisible();
  });

  test('sin sesión, /resumen redirige al login', async ({ page }) => {
    await page.goto('/resumen');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Iniciar sesión' })).toBeVisible();
  });

  test('el login muestra sus campos y el botón habilitado', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { level: 2, name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.getByLabel('Correo electrónico')).toBeVisible();
    await expect(page.getByLabel('Contraseña')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  test('el resumen con sesión muestra el enlace de salto', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeAttached();
  });

  test('el botón de tema activa la clase dark en html', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: /tema/i }).click();

    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('una ruta inexistente muestra la página 404', async ({ page }) => {
    await page.goto('/ruta-inexistente');

    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  });
});
