import { expect, test } from '@playwright/test';
import { artifact, collectErrors, hoverTooltip, MOD, openApp, pageTabs } from './helpers';

/** M1-10 … M1-14, M1-21 … M1-23: Layout, Werkzeugleiste, Theme, Shortcuts, Tooltips. */

const TOOLS_REQUIRED = [
  'Auswahl',
  'Hand',
  'Zoom',
  'Grundfläche erstellen',
  'Geschäft erstellen',
  'Infrastruktur',
  'Messen',
  'Kalibrieren',
  'Schriftfeld',
  'Fang an Vorderkante',
  'Fang am Raster',
  'Fang an Nachbarständen',
  'Raster ein/aus',
];

test.describe('M1 Layout und Bedienung', () => {
  test('M1-10: Grundlayout: Tab-Leiste oben, Steuerungsleiste, Werkzeugleiste links, Zeichenfläche Mitte, Seitenleiste rechts', async ({ page }) => {
    await openApp(page);
    const tabbar = (await page.locator('header.tabbar').boundingBox())!;
    const control = (await page.locator('.controlbar').boundingBox())!;
    const tools = (await page.getByRole('navigation', { name: 'Werkzeuge' }).boundingBox())!;
    const canvas = (await page.locator('svg.canvas').boundingBox())!;
    const side = (await page.getByRole('complementary', { name: 'Seitenleiste' }).boundingBox())!;
    expect(tabbar.y).toBe(0);
    expect(control.y).toBeGreaterThanOrEqual(tabbar.y + tabbar.height - 1);
    expect(tools.x).toBe(0);
    expect(tools.y).toBeGreaterThanOrEqual(control.y + control.height - 1);
    expect(canvas.x).toBeGreaterThanOrEqual(tools.x + tools.width - 1);
    expect(side.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
    expect(side.x + side.width).toBeCloseTo(1280, 0);
    // Zeichenfläche bekommt den meisten Platz
    expect(canvas.width * canvas.height).toBeGreaterThan(0.5 * 1280 * 800);
    await page.screenshot({ path: artifact('m1-layout-dark.png') });
  });

  test('M1-11: Werkzeugleiste nur aus Icons mit allen Werkzeugen der Spec', async ({ page }) => {
    await openApp(page);
    const nav = page.getByRole('navigation', { name: 'Werkzeuge' });
    for (const name of TOOLS_REQUIRED) await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(1);
    // kein sichtbarer Text, nur SVG-Icons
    const texts = await nav.locator('button').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    expect(texts.every((t) => t === '')).toBe(true);
    const iconCount = await nav.locator('button svg.icon').count();
    expect(iconCount).toBe(TOOLS_REQUIRED.length);
  });

  test('M1-11/M1-23: Tooltip mit Name, Kurzbeschreibung und Shortcut', async ({ page }) => {
    await openApp(page);
    const nav = page.getByRole('navigation', { name: 'Werkzeuge' });
    const t1 = await hoverTooltip(page, nav.getByRole('button', { name: 'Auswahl' }));
    expect(t1).toContain('Auswahl');
    expect(t1).toContain('V');
    expect(t1).toContain('Objekte auswählen');
    const t2 = await hoverTooltip(page, nav.getByRole('button', { name: 'Hand' }));
    expect(t2).toMatch(/Hand[\s\S]*H[\s\S]*Ansicht verschieben/);
    const t3 = await hoverTooltip(page, nav.getByRole('button', { name: 'Geschäft erstellen' }));
    expect(t3).toMatch(/Geschäft erstellen[\s\S]*G[\s\S]*Neuen Stand/);
    await page.screenshot({ path: artifact('m1-tooltip-geschaeft.png') });
  });

  test('M1-23: Tooltips an Buttons außerhalb der Werkzeugleiste (Tabs, +, Seitenleiste, Zoom)', async ({ page, browserName }) => {
    await openApp(page);
    const mod = browserName && process.platform === 'darwin' ? /⌘|Strg/ : /Strg/;
    expect(await hoverTooltip(page, page.locator('.tab-add'))).toMatch(/Neuer Festplatz[\s\S]*N/);
    expect(await hoverTooltip(page, page.getByRole('tab', { name: 'Start-Page' }))).toMatch(/Start-Page[\s\S]*0/);
    expect(await hoverTooltip(page, pageTabs(page).nth(1))).toMatch(/Festplatz 1[\s\S]*1/);
    expect(await hoverTooltip(page, page.locator('.controlbar .icon-btn'))).toMatch(/Seitenleiste[\s\S]*Tab/);
    expect(await hoverTooltip(page, page.locator('.statusbar').getByRole('button', { name: 'An Fenster anpassen' }))).toMatch(mod);
  });

  test('M1-23: Tooltip verschwindet beim Klicken und beim Verlassen', async ({ page }) => {
    await openApp(page);
    await hoverTooltip(page, page.getByRole('button', { name: 'Hand' }));
    await page.mouse.move(600, 400);
    await expect(page.locator('.tooltip')).toHaveCount(0);
    await hoverTooltip(page, page.getByRole('button', { name: 'Hand' }));
    await page.mouse.down();
    await expect(page.locator('.tooltip')).toHaveCount(0);
    await page.mouse.up();
  });

  test('M1-11: Aktives Werkzeug ist farblich hervorgehoben', async ({ page }) => {
    await openApp(page);
    const sel = page.getByRole('button', { name: 'Auswahl' });
    const hand = page.getByRole('button', { name: 'Hand' });
    const bg = (l: typeof sel) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
    const activeBg = await bg(sel);
    const idleBg = await bg(hand);
    expect(activeBg).not.toBe(idleBg);
    await hand.click();
    await page.mouse.move(600, 400);
    expect(await bg(hand)).toBe(activeBg);
  });

  test('M1-12: Icons sind lokal gebündelt; keine Anfrage an fremde Server', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url());
    });
    await openApp(page);
    await page.getByRole('button', { name: 'Hand' }).hover();
    await page.waitForTimeout(600);
    expect(external).toEqual([]);
    const paths = await page.locator('nav.toolbar svg.icon path').count();
    expect(paths).toBeGreaterThan(0);
    // Schrift kommt lokal (fontsource)
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toMatch(/IBM Plex Sans/);
  });

  test('M1-13: Dunkles Theme ist Standard, helles per Mod+Alt+T bzw. Menü; Einstellung bleibt nach Neuladen', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.querySelector('.toolbar')!).backgroundColor);
    await page.keyboard.press(`${MOD}+Alt+t`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.querySelector('.toolbar')!).backgroundColor);
    expect(lightBg).not.toBe(darkBg);
    await page.screenshot({ path: artifact('m1-layout-light.png') });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('.menu-btn').click();
    await page.getByRole('menuitem', { name: /Dunkles Design/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('M1-13: Dunkles Theme ist neutrales Grau (kein Farbstich) und kompakte Schrift', async ({ page }) => {
    await openApp(page);
    const rgb = await page.evaluate(() => getComputedStyle(document.querySelector('.toolbar')!).backgroundColor);
    const [r, g, b] = (rgb.match(/\d+/g) ?? []).map(Number);
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(6);
    expect(Math.max(r!, g!, b!)).toBeLessThan(90);
    const size = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.controlbar')!).fontSize));
    expect(size).toBeLessThanOrEqual(13);
  });

  test('M1-14: Seitenleiste per Button und Shift+Tab einklappbar; Tab blendet alle Panels aus', async ({ page }) => {
    await openApp(page);
    const side = page.getByRole('complementary', { name: 'Seitenleiste' });
    const canvasW = async () => (await page.locator('svg.canvas').boundingBox())!.width;
    const w0 = await canvasW();
    await page.locator('.controlbar .icon-btn').click();
    await expect(side).toHaveCount(0);
    expect(await canvasW()).toBeGreaterThan(w0);
    await page.locator('.controlbar .icon-btn').click();
    await expect(side).toBeVisible();
    // Schließen-Button in der Seitenleiste
    await side.getByRole('button', { name: 'Seitenleiste ausblenden' }).click();
    await expect(side).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await expect(side).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(side).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');

    // Tab blendet alle Panels aus
    await page.keyboard.press('Tab');
    await expect(side).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toHaveCount(0);
    await expect(page.locator('.controlbar')).toHaveCount(0);
    await expect(page.locator('svg.canvas')).toBeVisible();
    await page.screenshot({ path: artifact('m1-panels-hidden.png') });
    await page.keyboard.press('Tab');
    await expect(side).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toBeVisible();
  });

  test('M1-14: Tab im Textfeld bleibt Tab (Panels bleiben sichtbar)', async ({ page }) => {
    await openApp(page);
    await pageTabs(page).nth(1).dblclick();
    await page.getByRole('textbox', { name: 'Name des Festplatzes' }).press('Tab');
    await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toBeVisible();
  });

  test('M1-22: ? öffnet die Shortcut-Übersicht, Esc und Klick daneben schließen sie', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Shift+?');
    const dlg = page.getByRole('dialog', { name: 'Tastaturkürzel' });
    await expect(dlg).toBeVisible();
    for (const g of ['Datei', 'Bearbeiten', 'Werkzeuge', 'Ansicht', 'Pages', 'Fenster']) await expect(dlg.getByRole('heading', { name: g })).toBeVisible();
    await expect(dlg).toContainText('Rückgängig');
    await expect(dlg).toContainText('An Fenster anpassen');
    await expect(dlg).toContainText('Zu Festplatz 1 … 9');
    await page.screenshot({ path: artifact('m1-shortcuts-overlay.png') });
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(dlg).toBeVisible();
    await page.mouse.click(5, 795);
    await expect(dlg).toHaveCount(0);
  });

  test('M1-22: Übersicht ist auch auf der Start-Page und über das Menü erreichbar', async ({ page }) => {
    await openApp(page);
    await page.getByRole('tab', { name: 'Start-Page' }).click();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Tastaturkürzel' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.menu-btn').click();
    await page.getByRole('menuitem', { name: /Tastaturkürzel/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tastaturkürzel' })).toBeVisible();
  });

  test('M1-21: Shortcuts zeigen auf macOS Cmd-Symbole, sonst Strg', async ({ page }) => {
    await openApp(page);
    await page.locator('.menu-btn').click();
    const save = page.getByRole('menuitem', { name: /^Speichern/ }).first();
    const kbd = await save.locator('kbd').innerText();
    const isMac = await page.evaluate(() => /Mac/.test(navigator.platform));
    expect(kbd).toBe(isMac ? '⌘S' : 'Strg+S');
  });

  test('Menü enthält Datei- und Bearbeiten-Befehle; Rückgängig ist anfangs deaktiviert', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.locator('.menu-btn').click();
    const menu = page.getByRole('menu');
    for (const n of ['Neues Projekt', 'Öffnen …', 'Speichern', 'Speichern unter …', 'Rückgängig', 'Wiederholen']) {
      await expect(menu.getByRole('menuitem', { name: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first()).toBeVisible();
    }
    await expect(menu.getByRole('menuitem', { name: /^Rückgängig/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.locator('.tab-add').click();
    await page.locator('.menu-btn').click();
    await expect(page.getByRole('menuitem', { name: /^Rückgängig/ })).toBeEnabled();
    await page.getByRole('menuitem', { name: /^Rückgängig/ }).click();
    await expect(pageTabs(page)).toHaveCount(2);
    expect(errors).toEqual([]);
  });
});
