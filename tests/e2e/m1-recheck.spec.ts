import { expect, test, type Page } from '@playwright/test';
import { activeTabName, canvasBox, hoverTooltip, MOD, openApp, origin, pageTabs, tabNames } from './helpers';

/**
 * QA-Nachprüfung M1: Grenzfälle der Fixes zu QA-M1-03, -04, -06 und neue Befunde (QA-M1-07 ff.).
 */

const LS_KEY = 'marktplaner.autosave';
const backup = (page: Page) => page.evaluate((k) => localStorage.getItem(k), LS_KEY);

async function renameActive(page: Page, name: string) {
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Name des Festplatzes' });
  await input.fill(name);
  await input.press('Enter');
}

/** Liegt der aktive Tab vollständig im sichtbaren Bereich der Tab-Leiste? */
async function activeTabVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const box = document.querySelector('header.tabbar .tabs')!.getBoundingClientRect();
    const el = document.querySelector('header.tabbar [role="tab"][aria-selected="true"]')!.getBoundingClientRect();
    return el.left >= box.left - 1 && el.right <= box.right + 1;
  });
}

const tabsScrollLeft = (page: Page) => page.locator('header.tabbar .tabs').evaluate((el) => el.scrollLeft);

test.describe('M1 Nachprüfung: Autosave nach Undo (QA-M1-03)', () => {
  test('Undo zum gespeicherten Stand entfernt die Sicherung sofort, ohne auf das Intervall zu warten', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.clock.runFor(31_000);
    await expect.poll(() => backup(page)).not.toBeNull();
    await page.keyboard.press(`${MOD}+z`);
    // kein runFor: das Store-Abo soll sofort reagieren
    await expect.poll(() => backup(page)).toBeNull();
  });

  test('Redo nach dem Entfernen: wieder ungespeichert, nach 30 s erneut gesichert und wiederherstellbar', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await renameActive(page, 'Redo-Stand');
    await page.clock.runFor(31_000);
    await expect.poll(() => backup(page)).not.toBeNull();
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => backup(page)).toBeNull();
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(() => activeTabName(page)).toBe('Redo-Stand');
    await page.clock.runFor(31_000);
    await expect.poll(() => backup(page)).not.toBeNull();
    await page.reload();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('Sicherung gefunden');
    await dlg.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect.poll(() => tabNames(page)).toEqual(['Start-Page', 'Redo-Stand']);
  });

  test('Wiederhergestelltes Projekt: Änderung + Undo bleibt ungespeichert, die Sicherung bleibt erhalten', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await renameActive(page, 'Wiederhergestellt');
    await page.clock.runFor(31_000);
    await expect.poll(() => backup(page)).not.toBeNull();
    await page.reload();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect.poll(() => tabNames(page)).toEqual(['Start-Page', 'Wiederhergestellt']);
    await page.locator('.tab-add').click();
    await page.clock.runFor(31_000);
    await page.keyboard.press(`${MOD}+z`);
    await page.clock.runFor(31_000);
    // Projekt ist weiterhin nicht gespeichert → Sicherung muss bleiben
    await expect(page.locator('.file-state .dot')).toBeVisible();
    expect(await backup(page)).not.toBeNull();
    await page.reload();
    await expect(page.getByRole('alertdialog')).toContainText('Sicherung gefunden');
  });

  test('QA-M1-08: Sicherung per Esc „behalten“ geht verloren, sobald im neuen Projekt gesichert und per Undo zurückgegangen wird', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await renameActive(page, 'Alter Stand');
    await page.clock.runFor(31_000);
    await expect.poll(() => backup(page)).not.toBeNull();
    await page.reload();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('Sicherung gefunden');
    await page.keyboard.press('Escape'); // „später entscheiden“: Sicherung behalten (cancelId 'keep')
    await expect(dlg).toHaveCount(0);
    await page.locator('.tab-add').click();
    await page.clock.runFor(31_000);
    await page.keyboard.press(`${MOD}+z`);
    await page.clock.runFor(31_000);
    await page.reload();
    // Erwartet: die behaltene Sicherung „Alter Stand“ wird weiterhin angeboten
    await expect(page.getByRole('alertdialog')).toContainText('Sicherung gefunden', { timeout: 2000 });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect.poll(() => tabNames(page)).toEqual(['Start-Page', 'Alter Stand']);
  });
});

test.describe('M1 Nachprüfung: Tab-Leiste hält aktive Page sichtbar (QA-M1-04)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await openApp(page);
    for (let i = 0; i < 14; i++) await page.locator('.tab-add').click();
    await expect(pageTabs(page)).toHaveCount(16);
  });

  test('Alt+1 / Alt+0 / Strg+Tab-Umlauf scrollen den aktiven Tab in Sicht', async ({ page }) => {
    expect(await tabsScrollLeft(page)).toBeGreaterThan(0);
    await page.keyboard.press('Alt+1');
    await expect.poll(() => activeTabName(page)).toBe('Festplatz 1');
    expect(await activeTabVisible(page)).toBe(true);
    await page.keyboard.press('Control+Shift+Tab'); // zur Start-Page
    await expect.poll(() => activeTabName(page)).toBe('Start-Page');
    expect(await activeTabVisible(page)).toBe(true);
    await page.keyboard.press('Control+Shift+Tab'); // Umlauf zur letzten Page
    await expect.poll(() => activeTabName(page)).toBe('Festplatz 15');
    expect(await activeTabVisible(page)).toBe(true);
    await page.keyboard.press('Control+Tab'); // Umlauf zur Start-Page
    await expect.poll(() => activeTabName(page)).toBe('Start-Page');
    expect(await activeTabVisible(page)).toBe(true);
    expect(await tabsScrollLeft(page)).toBe(0);
    await page.keyboard.press('Alt+0');
    expect(await activeTabVisible(page)).toBe(true);
  });

  test('Duplizieren und Undo in voller Leiste: aktiver Tab bleibt sichtbar', async ({ page }) => {
    await page.keyboard.press('Alt+1');
    await page.keyboard.press(`${MOD}+Alt+d`);
    await expect(pageTabs(page)).toHaveCount(17);
    expect(await activeTabVisible(page)).toBe(true);
    await page.keyboard.press(`${MOD}+z`);
    await expect(pageTabs(page)).toHaveCount(16);
    expect(await activeTabVisible(page)).toBe(true);
  });

  test('QA-M1-09: Nach Verkleinern des Fensters bleibt der aktive Tab sichtbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Alt+0');
    await page.keyboard.press('Control+Shift+Tab'); // letzte Page, Leiste ganz rechts
    await expect.poll(() => activeTabName(page)).toBe('Festplatz 15');
    expect(await activeTabVisible(page)).toBe(true);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(() => activeTabVisible(page), { timeout: 2000 }).toBe(true);
  });

  test('QA-M1-09: Nach Umbenennen in einen langen Namen ist der aktive Tab vollständig sichtbar', async ({ page }) => {
    expect(await activeTabVisible(page)).toBe(true);
    await renameActive(page, 'Ein sehr langer Festplatzname für den Obermarkt Gelnhausen');
    await expect.poll(() => activeTabName(page)).toContain('Ein sehr langer');
    if (process.env.QA_SHOT) await page.screenshot({ path: 'qa/screenshots/recheck-tab-rename-cut.png' });
    await expect.poll(() => activeTabVisible(page), { timeout: 2000 }).toBe(true);
  });

  test('Mausrad über der Tab-Leiste scrollt sie seitwärts', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'page.mouse.wheel erzeugt in Playwright-WebKit keine verlässlichen Raddaten (siehe QA-M1-02)');
    await page.keyboard.press('Alt+0');
    expect(await tabsScrollLeft(page)).toBe(0);
    const box = (await page.locator('header.tabbar .tabs').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => tabsScrollLeft(page)).toBeGreaterThan(0);
  });
});

test.describe('M1 Nachprüfung: zugängliche Namen (QA-M1-06)', () => {
  test('Karte und „+“-Button haben unterschiedliche Namen; Tooltips unverändert', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Alt+0');
    const card = page.locator('.card.link[data-tip]');
    await expect(card).not.toHaveAttribute('aria-label', /.*/);
    await expect(card).toHaveAccessibleName(/^Neuer Festplatz/);
    await expect(page.locator('.tab-add')).toHaveAccessibleName('Festplatz-Tab hinzufügen');
    await expect(page.getByRole('button', { name: 'Neuer Festplatz' })).toHaveCount(1);
    expect(await hoverTooltip(page, page.locator('.tab-add'))).toContain('Neuer Festplatz');
    expect(await hoverTooltip(page, card)).toContain('Neuer Festplatz');
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await expect(pageTabs(page)).toHaveCount(3);
    await page.keyboard.press('Alt+0');
    await card.click();
    await expect(pageTabs(page)).toHaveCount(4);
  });
});

test.describe('M1 Nachprüfung: Wischrichtung (QA-M1-02 / QA-M1-07)', () => {
  test('QA-M1-07: Waagerechtes Wischen bewegt Zeichenfläche und Tab-Leiste in dieselbe Richtung', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'page.mouse.wheel erzeugt in Playwright-WebKit keine verlässlichen Raddaten (siehe QA-M1-02)');
    await page.setViewportSize({ width: 1000, height: 600 });
    await openApp(page);
    for (let i = 0; i < 14; i++) await page.locator('.tab-add').click();
    await page.keyboard.press('Alt+1');
    // Tab-Leiste: natives Scrollen des Browsers (Systemkonvention)
    const tabs = page.locator('header.tabbar .tabs');
    const tb = (await tabs.boundingBox())!;
    const firstTab = page.locator('header.tabbar [role="tab"]').nth(1);
    const t0 = (await firstTab.boundingBox())!.x;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.wheel(60, 0);
    await expect.poll(async () => (await firstTab.boundingBox())!.x).not.toBe(t0);
    const tabContentMove = (await firstTab.boundingBox())!.x - t0;
    // Zeichenfläche: gleiche Geste
    const cb = await canvasBox(page);
    await page.mouse.move(cb.x + 300, cb.y + 200);
    const o0 = await origin(page);
    await page.mouse.wheel(60, 0);
    await expect.poll(async () => (await origin(page)).x).not.toBe(o0.x);
    const canvasContentMove = (await origin(page)).x - o0.x;
    expect(Math.sign(canvasContentMove)).toBe(Math.sign(tabContentMove));
  });
});
