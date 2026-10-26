import { expect, test } from '@playwright/test';
import { activeTabName, collectErrors, MOD, openApp, pageTabs, tabbar, tabNames } from './helpers';

/** M1-03 … M1-09: Start-Page und Festplatz-Tabs. */

test.describe('M1 Pages / Tab-Leiste', () => {
  test('M1-03/M1-04: Start-Page ist ganz links, danach die Festplatz-Pages; Wechsel per Klick', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    expect(await activeTabName(page)).toBe('Start-Page');
    await expect(page.locator('section.startpage')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toHaveCount(0);
    await tabbar(page).getByRole('tab', { name: 'Festplatz 1' }).click();
    expect(await activeTabName(page)).toBe('Festplatz 1');
    await expect(page.locator('svg.canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('M1-03: Start-Page hat kein Kontextmenü zum Löschen und lässt sich nicht umbenennen', async ({ page }) => {
    await openApp(page);
    const start = tabbar(page).getByRole('tab', { name: 'Start-Page' });
    await start.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0);
    await start.dblclick();
    await expect(page.getByRole('textbox', { name: 'Name des Festplatzes' })).toHaveCount(0);
    // F2 und Strg/Cmd+Alt+Backspace auf der Start-Page tun nichts
    await page.keyboard.press('F2');
    await expect(page.getByRole('textbox', { name: 'Name des Festplatzes' })).toHaveCount(0);
    await page.keyboard.press(`${MOD}+Alt+Backspace`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });

  test('M1-05: „+“ legt eine neue Festplatz-Page an und aktiviert sie; Undo/Redo', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.locator('.tab-add').click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 2', 'Festplatz 3']);
    expect(await activeTabName(page)).toBe('Festplatz 3');
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 2']);
    // aktive Page muss nach Undo noch existieren
    expect(['Festplatz 1', 'Festplatz 2']).toContain(await activeTabName(page));
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 2', 'Festplatz 3']);
  });

  test('M1-05: Shortcut Neuer Festplatz (Mod+Shift+N) und Start-Page-Karte', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${MOD}+Shift+n`);
    expect(await tabNames(page)).toContain('Festplatz 2');
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    await page.locator('section.startpage').getByRole('button', { name: 'Neuer Festplatz' }).click();
    expect(await tabNames(page)).toContain('Festplatz 3');
  });

  test('M1-06: Umbenennen per Doppelklick: Enter übernimmt, Esc bricht ab, leer wird ignoriert', async ({ page }) => {
    await openApp(page);
    const tab = pageTabs(page).nth(1);
    await tab.dblclick();
    const input = page.getByRole('textbox', { name: 'Name des Festplatzes' });
    await expect(input).toBeFocused();
    await input.fill('Obermarkt');
    await input.press('Enter');
    expect(await tabNames(page)).toEqual(['Start-Page', 'Obermarkt']);
    await expect(page.locator('.controlbar .title')).toHaveText('Obermarkt');

    // Esc verwirft
    await pageTabs(page).nth(1).dblclick();
    await input.fill('Verworfen');
    await input.press('Escape');
    expect(await tabNames(page)).toEqual(['Start-Page', 'Obermarkt']);

    // Leer bzw. nur Leerzeichen wird ignoriert
    await pageTabs(page).nth(1).dblclick();
    await input.fill('   ');
    await input.press('Enter');
    expect(await tabNames(page)).toEqual(['Start-Page', 'Obermarkt']);

    // Leerzeichen werden abgeschnitten
    await pageTabs(page).nth(1).dblclick();
    await input.fill('  Untermarkt  ');
    await input.press('Enter');
    expect(await tabNames(page)).toEqual(['Start-Page', 'Untermarkt']);

    // Undo nimmt die Umbenennungen zurück
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Obermarkt']);
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });

  test('M1-06: Umbenennen mit sehr langem Namen sprengt die Tab-Leiste nicht', async ({ page }) => {
    await openApp(page);
    await pageTabs(page).nth(1).dblclick();
    const long = 'Festplatz mit einem außergewöhnlich langen Namen '.repeat(6).trim();
    await page.getByRole('textbox', { name: 'Name des Festplatzes' }).fill(long);
    await page.keyboard.press('Enter');
    expect(await tabNames(page)).toEqual(['Start-Page', long]);
    const box = await pageTabs(page).nth(1).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(260);
    await expect(page.locator('.tab-add')).toBeInViewport();
  });

  test('M1-06: F2 benennt die aktive Page um; Blur übernimmt', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('F2');
    const input = page.getByRole('textbox', { name: 'Name des Festplatzes' });
    await expect(input).toBeFocused();
    await input.fill('Per F2');
    await page.locator('svg.canvas').click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Per F2']);
  });

  test('M1-07: Kontextmenü Duplizieren und Löschen, beides rückgängig machbar', async ({ page }) => {
    await openApp(page);
    const tab = pageTabs(page).nth(1);
    await tab.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: /Duplizieren/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Löschen/ })).toBeVisible();
    await menu.getByRole('menuitem', { name: /Duplizieren/ }).click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 1 (Kopie)']);
    expect(await activeTabName(page)).toBe('Festplatz 1 (Kopie)');

    // nochmal duplizieren → Kopie 2
    await pageTabs(page).nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Duplizieren/ }).click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 1 (Kopie 2)', 'Festplatz 1 (Kopie)']);

    await pageTabs(page).nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Löschen/ }).click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1 (Kopie 2)', 'Festplatz 1 (Kopie)']);

    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 1 (Kopie 2)', 'Festplatz 1 (Kopie)']);
  });

  test('M1-07: Esc und Klick daneben schließen das Kontextmenü', async ({ page }) => {
    await openApp(page);
    await pageTabs(page).nth(1).click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await pageTabs(page).nth(1).click({ button: 'right' });
    await page.mouse.click(600, 400);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('M1-07: Letzte Festplatz-Page löschen → nur Start-Page bleibt, App bleibt bedienbar', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await pageTabs(page).nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Löschen/ }).click();
    expect(await tabNames(page)).toEqual(['Start-Page']);
    expect(await activeTabName(page)).toBe('Start-Page');
    await expect(page.locator('section.startpage')).toBeVisible();
    // Shortcuts, die eine Zeichen-Page brauchen, dürfen nicht abstürzen
    await page.keyboard.press(`${MOD}+0`);
    await page.keyboard.press('Control+Tab');
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
    expect(errors).toEqual([]);
  });

  test('M1-08: Pages per Ziehen umsortieren, Undo stellt die Reihenfolge wieder her', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.locator('.tab-add').click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 2', 'Festplatz 3']);

    const from = (await pageTabs(page).nth(1).boundingBox())!;
    const to = (await pageTabs(page).nth(3).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
    await page.mouse.move(to.x + to.width - 5, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 2', 'Festplatz 3', 'Festplatz 1']);

    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 2', 'Festplatz 3']);
  });

  test('M1-08: Start-Page lässt sich nicht verschieben, Page nicht vor die Start-Page ziehen', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    const start = (await pageTabs(page).nth(0).boundingBox())!;
    const last = (await pageTabs(page).nth(2).boundingBox())!;
    // Festplatz 2 ganz nach links ziehen
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + 2, start.y + start.height / 2, { steps: 10 });
    await page.mouse.up();
    expect((await tabNames(page))[0]).toBe('Start-Page');
    // Start-Page ziehen
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width, last.y + last.height / 2, { steps: 10 });
    await page.mouse.up();
    expect((await tabNames(page))[0]).toBe('Start-Page');
  });

  test('M1-08: Kurzer Klick (unter 5 px Bewegung) sortiert nicht um und erzeugt keinen Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await pageTabs(page).nth(1).click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 2']);
    await page.keyboard.press(`${MOD}+z`);
    // Ein Undo nimmt nur das Anlegen zurück
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });

  test('M1-09: Pages per Shortcut durchschalten (Strg+Tab, Strg+Shift+Tab, Strg+Bild, Alt+Ziffer)', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await pageTabs(page).nth(1).click();
    expect(await activeTabName(page)).toBe('Festplatz 1');
    await page.keyboard.press('Control+Tab');
    expect(await activeTabName(page)).toBe('Festplatz 2');
    await page.keyboard.press('Control+Tab');
    expect(await activeTabName(page)).toBe('Start-Page'); // läuft über
    await page.keyboard.press('Control+Shift+Tab');
    expect(await activeTabName(page)).toBe('Festplatz 2');
    await page.keyboard.press('Control+PageUp');
    expect(await activeTabName(page)).toBe('Festplatz 1');
    await page.keyboard.press('Control+PageDown');
    expect(await activeTabName(page)).toBe('Festplatz 2');
    await page.keyboard.press('Alt+0');
    expect(await activeTabName(page)).toBe('Start-Page');
    await page.keyboard.press('Alt+1');
    expect(await activeTabName(page)).toBe('Festplatz 1');
    await page.keyboard.press('Alt+2');
    expect(await activeTabName(page)).toBe('Festplatz 2');
    // Alt+9 ohne 9. Page: bleibt stehen
    await page.keyboard.press('Alt+9');
    expect(await activeTabName(page)).toBe('Festplatz 2');
  });

  test('M1-07: Shortcuts Duplizieren (Mod+Alt+D) und Löschen (Mod+Alt+Backspace)', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${MOD}+Alt+d`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Festplatz 1 (Kopie)']);
    await page.keyboard.press(`${MOD}+Alt+Backspace`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });

  test('Seitenwechsel ist kein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await pageTabs(page).nth(0).click();
    await pageTabs(page).nth(1).click();
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });
});
