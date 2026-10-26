import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { collectErrors, MOD, openApp, pageTabs } from './helpers';

/** M10-01 (#10): Umbenennung in Marktplaner, Dateiendung .mplan, alte .schelme-Dateien und Einstellungen. */

test.describe('M10-01: Marktplaner', () => {
  test('Titel heißt Marktplaner; Öffnen-Dialog nimmt .mplan und .schelme an', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await expect(page).toHaveTitle('Neues Projekt – Marktplaner');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    const fc = await chooser;
    expect(await fc.element().getAttribute('accept')).toBe('.mplan,.schelme');
    expect(errors).toEqual([]);
  });

  test('alte .schelme-Datei öffnet; Speichern schlägt .mplan vor', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    const bytes = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v4-m7.schelme'));
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles({ name: 'altes-projekt.schelme', mimeType: 'application/zip', buffer: bytes });
    await expect(page.locator('.file-state')).toContainText('altes-projekt.schelme');
    await expect(pageTabs(page)).not.toHaveCount(1);

    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    expect((await download).suggestedFilename()).toBe('altes-projekt.mplan');
    expect(errors).toEqual([]);
  });

  test('Einstellungen unter dem alten Namen werden übernommen', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('m10-init')) return;
      sessionStorage.setItem('m10-init', '1');
      localStorage.clear();
      localStorage.setItem('schelmeplaner.theme', 'light');
    });
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('marktplaner.theme'))).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('schelmeplaner.theme'))).toBe('light');
  });
});
