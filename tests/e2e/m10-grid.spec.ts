import { expect, test } from '@playwright/test';
import { collectErrors, openApp } from './helpers';

/** M10-02 (#1): Deckkraft des Rasters, pro Rechner gespeichert, ohne Undo und ohne Änderungsmarkierung. */

test('M10-02: Raster-Deckkraft wirkt live und bleibt nach Neustart erhalten', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  const slider = page.locator('#grid-opacity');
  const grid = page.locator('svg.canvas g.grid');
  await expect(slider).toHaveValue('100');
  await expect(grid).toHaveAttribute('opacity', '1');

  await slider.fill('30');
  await expect(grid).toHaveAttribute('opacity', '0.3');
  await expect(page.locator('output[for="grid-opacity"]')).toHaveText('30 %');
  // Ansichtseinstellung: keine Änderungsmarkierung
  await expect(page.locator('.file-state .dot')).toHaveCount(0);

  // Helles Design: dieselbe Deckkraft
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await expect(grid).toHaveAttribute('opacity', '0.3');

  await page.reload();
  await expect(page.locator('header.tabbar')).toBeVisible();
  await expect(page.locator('#grid-opacity')).toHaveValue('30');
  await expect(page.locator('svg.canvas g.grid')).toHaveAttribute('opacity', '0.3');

  // 0 %: Raster unsichtbar, bleibt aber eingeblendet (Fang hängt nur an „Anzeigen“)
  await page.locator('#grid-opacity').fill('0');
  await expect(page.locator('svg.canvas g.grid')).toHaveAttribute('opacity', '0');
  expect(await page.locator('svg.canvas .grid-minor').getAttribute('d')).not.toBe('');
  expect(errors).toEqual([]);
});
