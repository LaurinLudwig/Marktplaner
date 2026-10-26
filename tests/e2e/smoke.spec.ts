import { expect, test } from '@playwright/test';

test.describe('Smoke', () => {
  test('App startet ohne Fehler und zeigt die Tab-Leiste', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/');

    const tabbar = page.locator('header.tabbar');
    await expect(tabbar).toBeVisible();
    await expect(tabbar.getByRole('tab', { name: 'Start-Page' })).toBeVisible();
    await expect(tabbar.getByRole('tab', { name: 'Festplatz 1' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toBeVisible();
    await expect(page).toHaveTitle(/Marktplaner/);
    expect(errors).toEqual([]);
  });
});
