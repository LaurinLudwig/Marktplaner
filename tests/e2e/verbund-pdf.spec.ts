import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { mmToPt } from '../../src/core/pdf/writePdf';
import { collectErrors, MOD, openApp, tabbar } from './helpers';

/**
 * #15 Teil c: Blatt des Verbunds in der Gesamtansicht, PDF der Gesamtansicht und Nachbarn im PDF einer Einzelansicht
 * (Ebene „Nachbarn“ im Export-Profil und auf der Zeichenfläche). Ziegelturm (Grundfläche x 0–50, Z-01 bei x 10) und
 * Seestraße (Grundfläche x 45–95, SE-02 bei x 46–49) im Verbund „Unterstadt“; SE-02 ist Nachbar des Ziegelturms.
 */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const REF = 'verbund:u';

async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nrLocked: false, owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, suppressDistanceWarning: false, shape: 'rect', shapeTemplateId: null, labelOffset: null, parts: null, frontOverride: null, rot: 0, w: 3, d: 3, cy: -1.5 };
    s.change('Testdaten', (p: any) => {
      const z = p.pages[0];
      z.name = 'Ziegelturm';
      z.areas.push({ id: 'GZ', name: 'Ziegelturm', cx: 25, cy: -5, w: 50, d: 10, rot: 0 });
      z.stands.push({ ...base, id: 'z1', nr: 'Z-01', name: 'Waffeln', cx: 10 });
      const sp = JSON.parse(JSON.stringify(z));
      sp.id = 'S';
      sp.name = 'Seestraße';
      sp.areas = [{ id: 'GS', name: 'Seestraße', cx: 70, cy: -5, w: 50, d: 10, rot: 0 }];
      sp.stands = [{ ...base, id: 'se2', nr: 'SE-02', name: 'Crêpes', cx: 47.5 }];
      p.pages.push(sp);
      p.groups.push({
        id: 'u',
        name: 'Unterstadt',
        pageIds: [z.id, 'S'],
        sheet: JSON.parse(JSON.stringify(z.sheet)),
        titleBlock: { ...z.titleBlock },
        titleBlockText: '',
        legend: { ...z.legend },
        scaleBar: { ...z.scaleBar },
        northArrow: { ...z.northArrow },
        layers: JSON.parse(JSON.stringify(z.layers)),
        view: null,
      });
    });
  });
}

const overviewTab = (page: Page) => tabbar(page).getByTestId('verbund-tab');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Als PDF exportieren' });
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function openExport(page: Page) {
  await blur(page);
  await page.keyboard.press(`${MOD}+p`);
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
}

async function exportAndRead(page: Page) {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await dialog(page).getByRole('button', { name: 'Exportieren' }).click();
  const d = await download;
  return { name: d.suggestedFilename(), pdf: await readPdf(new Uint8Array(readFileSync((await d.path())!))) };
}

test.describe('#15 PDF der Gesamtansicht und Nachbarn im PDF (Teil c)', () => {
  test('Gesamtansicht: Blatt des Verbunds sichtbar, Format ändern ist ein Undo-Schritt und betrifft nur den Verbund', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await overviewTab(page).click();
    expect((await st(page)).ui.activePage).toBe(REF);
    // Blatt („Plan“ als Vorgabe) mit Schriftfeld und Legende auf der Zeichenfläche
    await expect(page.getByTestId('sheet-frame')).toHaveAttribute('data-kind', 'plan');
    await expect(page.getByTestId('title-block')).toHaveCount(1);
    await expect(page.getByTestId('legend')).toHaveCount(1);
    // Seitenleiste: Bereich „Verbund“ und „Blatt“, Ebene „Blatt“
    await expect(page.getByTestId('overview-verbund')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Blatt' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ebenen' }).locator('.layer-name')).toContainText(['Blatt']);
    // Format A2: im Verbund, nicht in den Mitgliedern
    const before = (await st(page)).history.past.length;
    await page.locator('#sheet-format').selectOption('A2');
    await expect(page.getByTestId('sheet-label')).toContainText('A2 quer');
    let s = await st(page);
    expect(s.project.groups[0].sheet.format).toBe('A2');
    expect(s.project.pages.map((p: any) => p.sheet.format)).toEqual(['plan', 'plan']);
    expect(s.history.past.length).toBe(before + 1);
    // Undo
    await blur(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId('sheet-frame')).toHaveAttribute('data-kind', 'plan');
    s = await st(page);
    expect(s.project.groups[0].sheet.format).toBe('plan');
    // Schriftfeld-Werkzeug und Legende (Shift+L) sind in der Gesamtansicht frei
    await page.keyboard.press('Shift+l');
    await expect(page.getByTestId('legend')).toHaveCount(0);
    expect((await st(page)).project.groups[0].legend.visible).toBe(false);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId('legend')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Export-Dialog listet „Unterstadt (gesamt)“; PDF der Gesamtansicht exakt im Blattmaß mit Ständen beider Plätze', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    // Blatt des Verbunds: A3 quer, 1:500, Mitte zwischen beiden Plätzen
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Blatt', (p: any) => Object.assign(p.groups[0].sheet, { format: 'A3', orientation: 'landscape', scale: 500, cx: 47.5, cy: -5 }));
    });
    await overviewTab(page).click();
    await openExport(page);
    const rows = dialog(page).getByTestId('export-page');
    await expect(rows).toHaveCount(3);
    await expect(rows.locator('.export-page-name')).toHaveText(['Unterstadt (gesamt)', 'Ziegelturm', 'Seestraße']);
    await expect(page.getByTestId('export-preview')).toContainText('Unterstadt (gesamt)');
    await expect(dialog(page).locator(`[data-ref="${REF}"]`).getByTestId('export-page-size')).toHaveText('420 × 297 mm');
    // Nur die Gesamtansicht
    await dialog(page).getByRole('radio', { name: 'Auswahl' }).check();
    const { name, pdf } = await exportAndRead(page);
    expect(name.normalize('NFC')).toContain('Unterstadt (gesamt)');
    expect(pdf.pages[0]!.w).toBeCloseTo(mmToPt(420), 1);
    expect(pdf.pages[0]!.h).toBeCloseTo(mmToPt(297), 1);
    expect(pdf.outline[0]).toBe('Unterstadt (gesamt)');
    expect(pdf.pages[0]!.text).toContain('Z-01');
    expect(pdf.pages[0]!.text).toContain('SE-02');
    // keine Nachbarbeschriftung: in der Gesamtansicht sind alle Stände eigene
    expect(pdf.pages[0]!.text).not.toContain('SE-02 · Seestraße');
    expect(errors).toEqual([]);
  });

  test('Einzel-PDF mit und ohne Ebene „Nachbarn“; Ebene „Nachbarn“ auf der Zeichenfläche', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    // Zeichenfläche: SE-02 blass, Ebene „Nachbarn“ blendet sie aus (kein Undo-Schritt), Freiflächen bleiben belegt
    await expect(page.locator('.layer-neighbours [data-neighbour="se2"]')).toHaveCount(1);
    const layers = page.getByRole('region', { name: 'Ebenen' });
    await expect(layers.locator('.layer-name')).toContainText(['Nachbarn']);
    const n0 = (await st(page)).history.past.length;
    await layers.getByRole('button', { name: 'Nachbarn ausblenden' }).click();
    await expect(page.locator('.layer-neighbours')).toHaveCount(0);
    expect((await st(page)).history.past.length).toBe(n0);
    await layers.getByRole('button', { name: 'Nachbarn einblenden' }).click();
    await expect(page.locator('.layer-neighbours [data-neighbour="se2"]')).toHaveCount(1);

    // PDF „Intern“ nur Ziegelturm: SE-02 blass mit „Nr · Platz“
    await openExport(page);
    await dialog(page).getByRole('radio', { name: 'Auswahl' }).check();
    const on = await exportAndRead(page);
    expect(on.pdf.pages[0]!.text).toContain('SE-02 · Seestraße');
    expect(on.pdf.pages[0]!.text).toContain('Z-01');

    // Kopie des Profils ohne Ebene „Nachbarn“
    await openExport(page);
    await dialog(page).getByRole('button', { name: 'Profile verwalten …' }).click();
    const editor = page.getByTestId('profile-editor');
    await editor.getByRole('button', { name: 'Als neues Profil kopieren' }).click();
    await editor.getByRole('checkbox', { name: 'Nachbarn', exact: true }).uncheck();
    await expect(page.getByTestId('profile-summary')).toContainText('Ebenen aus: Nachbarn');
    await dialog(page).getByRole('radio', { name: 'Auswahl' }).check();
    const off = await exportAndRead(page);
    expect(off.pdf.pages[0]!.text).not.toContain('SE-02');
    expect(off.pdf.pages[0]!.text).toContain('Z-01');
    expect(errors).toEqual([]);
  });
});
