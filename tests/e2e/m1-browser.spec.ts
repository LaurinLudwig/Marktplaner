import { expect, test } from '@playwright/test';
import { collectErrors, MOD, openApp, pageTabs } from './helpers';

/** Nachtrag M1: Browser-Modus ohne Tauri (Plattform-Fallbacks) und robuste Tab-Leiste. */

test.describe('M1 Browser-Modus', () => {
  test('Kein Tauri im Browser: keine Fehler über einen kompletten Bedienablauf', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window)).toBe(false);
    await page.locator('.tab-add').click();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'Name des Festplatzes' }).fill('X');
    await page.keyboard.press('Enter');
    await page.keyboard.press('h');
    await page.keyboard.press(`${MOD}+=`);
    await page.keyboard.press('Control+Tab');
    await page.keyboard.press(`${MOD}+Alt+t`);
    await page.keyboard.press('?');
    await page.keyboard.press('Escape');
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+Shift+s`);
    await download;
    await page.keyboard.press(`${MOD}+z`);
    expect(errors).toEqual([]);
  });

  test('Fenstertitel zeigt Projekt und Änderungsmarkierung (document.title)', async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle('Neues Projekt – Marktplaner');
    await page.locator('.tab-add').click();
    await expect(page).toHaveTitle('Neues Projekt • – Marktplaner');
  });

  test('Schließen mit ungespeicherten Änderungen löst beforeunload-Warnung aus, ohne Änderungen nicht', async ({ page }) => {
    await openApp(page);
    let asked = 0;
    page.on('dialog', async (d) => {
      if (d.type() === 'beforeunload') asked++;
      await d.dismiss();
    });
    await page.locator('.tab-add').click();
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toBe(1);
  });

  test('Ohne Änderungen kein beforeunload-Hinweis', async ({ page }) => {
    await openApp(page);
    let asked = 0;
    page.on('dialog', async (d) => {
      asked++;
      await d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    // Ohne Rückfrage ist die Seite sofort geschlossen
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(asked).toBe(0);
  });

  test('Öffnen-Dialog abbrechen (Browser „cancel“) lässt die App bedienbar', async ({ page }) => {
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    const fc = await chooser;
    await fc.setFiles([]);
    await page.locator('.tab-add').click();
    await expect(pageTabs(page)).toHaveCount(3);
  });

  test('Neu angelegte Page bleibt in einer vollen Tab-Leiste sichtbar', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await openApp(page);
    for (let i = 0; i < 14; i++) await page.locator('.tab-add').click();
    const active = page.locator('header.tabbar [role="tab"][aria-selected="true"]');
    await expect(active).toHaveAttribute('aria-label', 'Festplatz 15');
    const r = (await active.boundingBox())!;
    const c = (await page.locator('header.tabbar .tabs').boundingBox())!;
    expect(r.x + r.width).toBeLessThanOrEqual(c.x + c.width + 1);
  });
});
