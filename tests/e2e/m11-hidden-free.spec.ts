import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { artifact, canvasBox, collectErrors, MOD, openApp } from './helpers';

/** M11 #8: Freiflächen per Rechtsklick ausblenden, in der Liste wieder anzeigen, Verfall beim Verschieben (spec.md §4, §7). */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const hidden = (page: Page) => store(page, 's.project.pages[0].hiddenFree') as Promise<{ key: string; start: number; end: number }[]>;

/** Grundfläche 50 × 10 m (y 0 … 10, Vorderseite unten), Stand 8 m bei x = 20 … 28: Freiflächen 20 m und 22 m. */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, rot: 0 };
    s.change('Testdaten', (p: any) => {
      const nord = p.pages[0];
      nord.name = 'Nord';
      nord.areas.push({ id: 'g1', name: 'Hauptstraße', cx: 25, cy: 5, w: 50, d: 10, rot: 0 });
      nord.stands.push({ ...base, id: 's1', name: 'Bratwurst', cx: 24, cy: 8.5, w: 8, d: 3 });
    });
    s.setView(s.project.pages[0].id, { scale: 10, tx: 50, ty: 100 });
  });
}

/** Bildschirmpunkt eines Weltpunkts bei Ansicht 10 px/m, Versatz (50, 100). */
async function at(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  return { x: box.x + 50 + x * 10, y: box.y + 100 + y * 10 };
}

async function rightClick(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
}

test.describe('M11 #8: Freiflächen ausblenden', () => {
  test('Rechtsklick → „nicht mehr anzeigen“: nicht gezeichnet, freie Frontmeter sinken; Undo stellt sie wieder her', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await expect(page.locator('.free-label')).toHaveCount(2);
    await rightClick(page, 10, 5);
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Freifläche nicht mehr anzeigen');
    await expect(menu).toContainText('20 × 10 m');
    await page.screenshot({ path: artifact('m11-free-menu.png') });
    await menu.getByRole('menuitem', { name: /Freifläche nicht mehr anzeigen/ }).click();
    await expect(page.locator('.free-label')).toHaveCount(1);
    expect(await hidden(page)).toEqual([{ key: 'g1|^|s1', start: 0, end: 20 }]);
    // Kein Menü auf einem Stand
    await rightClick(page, 24, 8.5);
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Linksklick wählt weiter die Grundfläche
    const p = await at(page, 40, 5);
    await page.mouse.click(p.x, p.y);
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'objects', ids: ['g1'] });
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.free-label')).toHaveCount(2);
    // Kennzahlen: 42 m → nach erneutem Ausblenden 22 m
    await rightClick(page, 10, 5);
    await page.getByRole('menuitem', { name: /Freifläche nicht mehr anzeigen/ }).click();
    await store(page, `s.setUi({ activePage: 'start' })`);
    await expect(page.getByTestId('stat-total').getByTestId('stat-free')).toHaveText('22 m');
    expect(errors).toEqual([]);
  });

  test('Freiflächenliste: Schalter „ausgeblendete zeigen“, ausblenden und wieder anzeigen', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await store(page, `s.setUi({ activePage: 'start' })`);
    await page.getByRole('tab', { name: /Freiflächen/ }).click();
    const rowsEl = page.getByTestId('free-row');
    await expect(rowsEl).toHaveCount(2);
    await rowsEl.nth(1).getByTestId('free-hide').click(); // Standard: Breite absteigend → 20 m an zweiter Stelle
    await expect(rowsEl).toHaveCount(1);
    await expect(page.getByTestId('free-count')).toHaveText('1 Freifläche');
    await expect(page.getByTestId('free-sums')).toContainText('22 m');
    expect(await store(page, 's.ui.activePage')).toBe('start'); // Knopf springt nicht
    const toggle = page.getByTestId('free-show-hidden');
    await expect(toggle).toContainText('(1)');
    await toggle.locator('input').check();
    await expect(rowsEl).toHaveCount(2);
    await expect(page.locator('.vt-row.hidden-free')).toHaveCount(1);
    await expect(page.getByTestId('free-sums')).toContainText('22 m');
    await page.getByTestId('free-unhide').click();
    await expect(page.locator('.vt-row.hidden-free')).toHaveCount(0);
    expect(await hidden(page)).toEqual([]);
    expect(await store(page, 's.history.past.length')).toBe(3);
  });

  test('Verschieben des Stands hebt die Ausblendung auf; Speichern und Öffnen behält sie', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await rightClick(page, 40, 5);
    await page.getByRole('menuitem', { name: /Freifläche nicht mehr anzeigen/ }).click();
    expect(await hidden(page)).toEqual([{ key: 'g1|s1|$', start: 28, end: 50 }]);
    // Speichern und wieder öffnen
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const bytes = readFileSync((await (await download).path())!);
    // Neues Projekt, damit das Öffnen die Ausblendung wirklich aus der Datei liest
    await store(page, `s.loadBundle({ project: { ...s.project, pages: s.project.pages.map((p) => ({ ...p, hiddenFree: [] })) }, assets: {} }, { path: null, name: null })`);
    expect(await hidden(page)).toEqual([]);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles({ name: 'm11.mplan', mimeType: 'application/zip', buffer: bytes });
    await expect.poll(() => hidden(page)).toEqual([{ key: 'g1|s1|$', start: 28, end: 50 }]);
    await store(page, `s.setView(s.project.pages[0].id, { scale: 10, tx: 50, ty: 100 })`);
    await expect(page.locator('.free-label')).toHaveCount(1);
    // Stand mit der Pfeiltaste verschieben → Lücke ändert sich → Ausblendung verfällt
    const p = await at(page, 24, 8.5);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.free-label')).toHaveCount(2);
    expect(await hidden(page)).toEqual([]);
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => hidden(page)).toHaveLength(1);
    await expect(page.locator('.free-label')).toHaveCount(1);
  });

  test('QA-M11-01: kein Menü, wenn ein Papier-Element über der Freifläche liegt', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      // Riesige Grundfläche ohne Stände unter einem Blatt mit festem Maßstab (A3 quer 1:500 = 210 × 148,5 m um 0/0):
      // jeder Punkt des Blatts, auch unter der Legende, liegt auf einer Freifläche
      s.change('Testdaten', (p: any) => {
        p.pages[0].areas.push({ id: 'g1', name: 'Platz', cx: 0, cy: 0, w: 4000, d: 4000, rot: 0 });
        p.pages[0].sheet = { format: 'A3', orientation: 'landscape', scale: 500, cx: 0, cy: 0 };
      });
    });
    const c = await canvasBox(page);
    await store(page, `s.setView(s.project.pages[0].id, { scale: 4, tx: ${c.width / 2}, ty: ${c.height / 2} })`);
    const legend = await page.getByTestId('legend').boundingBox();
    if (!legend) throw new Error('Legende nicht sichtbar');
    await page.mouse.click(legend.x + legend.width / 2, legend.y + legend.height / 2, { button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Gegenprobe daneben: Freifläche ohne Papier-Element darüber
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2, { button: 'right' });
    await expect(page.getByRole('menu')).toContainText('Freifläche nicht mehr anzeigen');
  });
});
