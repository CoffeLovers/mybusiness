import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('sistema de diseño', () => {
  test('no tiene violaciones de axe', async ({ page }) => {
    await page.goto('/design-system');

    const { violations } = await new AxeBuilder({ page }).analyze();

    expect(violations).toEqual([]);
  });

  test('los controles cumplen 44x44', async ({ page }) => {
    await page.goto('/design-system');

    const controls = page.locator('button, input, select, textarea, [role="button"]');
    const count = await controls.count();

    for (let index = 0; index < count; index += 1) {
      const box = await controls.nth(index).boundingBox();

      if (box) {
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('el diálogo atrapa el foco y cierra con Escape', async ({ page }) => {
    await page.goto('/design-system');

    const trigger = page.getByRole('button', { name: 'Abrir diálogo' });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Confirmar acción' });
    await expect(dialog).toBeVisible();

    const focusInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('dialog')),
    );
    expect(focusInside).toBe(true);

    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      const stillInside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('dialog')),
      );
      expect(stillInside).toBe(true);
    }

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
