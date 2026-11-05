import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { mmToPt } from '../../src/core/pdf/writePdf';
import { canvasBox, collectErrors, MOD, openApp, scale } from './helpers';

/**
 * #13: Blatt ohne festes Papierformat (spec.md §8, §9): „Plan“ (Inhalt + Rand, Standard für neue Pages) und
 * „Ausschnitt“ (Rechteck aufziehen, verschieben, an den Griffen ändern); Export-Dialog und Vorschau zeigen das Maß.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const sheet = (page: Page) => store(page, 's.project.pages.find((p) => p.id === s.ui.activePage).sheet') as Promise<any>;
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Als PDF exportieren' });

/** Grundfläche 200 × 50 m von (0, 0) bis (200, 50) auf der aktiven Page. */
async function seedWide(page: Page, w = 200) {
  await page.evaluate((width) => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Testdaten', (p: any) => {
      const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
      pg.areas.push({ id: 'G', name: '', cx: width / 2, cy: 25, w: width, d: 50, rot: 0 });
    });
  }, w);
}

/** Alle Papier-Elemente im Bereich „Blatt“ ausblenden: Das Blatt ist dann genau Inhalt + Rand. */
async function hidePaperElements(page: Page) {
  const panel = page.getByRole('region', { name: 'Blatt' });
  for (const name of [/^Schriftfeld/, /^Legende/, /^Maßstabsbalken/, /^Nordpfeil/]) await panel.getByRole('checkbox', { name }).uncheck();
}

async function setScale(page: Page, n: number) {
  const field = page.locator('#sheet-scale-input');
  await field.fill(String(n));
  await field.press('Enter');
}

test.describe('#13: Blatt „Plan“', () => {
  test('neue Page: „Plan“ ist Standard; Marke und Schriftfeld zeigen das freie Maß', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seedWide(page);
    expect(await sheet(page)).toMatchObject({ format: 'plan', scale: null, margin: null, targetWidth: 841 });
    await expect(page.locator('#sheet-format')).toHaveValue('plan');
    await expect(page.getByTestId('sheet-label')).toHaveText(/^[\d.]+ × [\d.]+ mm · 1:[\d.]+$/);
    await expect(page.getByTestId('title-block')).toContainText(/bei Druck in Originalgröße \([\d.]+ × [\d.]+ mm\)/);
    // Zielbreite 841 mm: das Blatt ist höchstens so breit
    const w = Number((await page.getByTestId('sheet-label').textContent())!.split(' × ')[0]!.replace(/\./g, ''));
    expect(w).toBeLessThanOrEqual(841);
    expect(errors).toEqual([]);
  });

  test('Maßstab 1:200 und Rand: 1.060 × 310 mm, Rand 20 mm → 1.040 × 290 mm, „Automatisch“ zurück; je ein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seedWide(page);
    await hidePaperElements(page);
    await setScale(page, 200);
    await expect(page.getByTestId('sheet-label')).toHaveText('1.060 × 310 mm · 1:200');
    await expect(page.locator('#sheet-margin')).toHaveAttribute('placeholder', '30 (automatisch)');
    const margin = page.locator('#sheet-margin');
    await margin.fill('20');
    await margin.press('Enter');
    expect((await sheet(page)).margin).toBe(20);
    await expect(page.getByTestId('sheet-label')).toHaveText('1.040 × 290 mm · 1:200');
    await page.getByRole('button', { name: 'Automatisch' }).click();
    expect((await sheet(page)).margin).toBeNull();
    await expect(page.getByTestId('sheet-label')).toHaveText('1.060 × 310 mm · 1:200');
    await page.keyboard.press(`${MOD}+z`);
    expect((await sheet(page)).margin).toBe(20);
    // Schriftfeld einblenden: Das Blatt wächst (unten rechts, 10 + Höhe + 3 mm), statt den Inhalt zu verdecken
    await page.getByRole('region', { name: 'Blatt' }).getByRole('checkbox', { name: /^Schriftfeld/ }).check();
    await expect(page.getByTestId('sheet-label')).not.toHaveText('1.040 × 290 mm · 1:200');
    const [w, h] = (await page.getByTestId('sheet-label').textContent())!.split(' mm')[0]!.split(' × ').map((t) => Number(t.replace(/\./g, '')));
    expect(w).toBe(1040);
    expect(h).toBeGreaterThan(290);
    // Zielbreite: Maßstab ergibt sich, Feld „Zielbreite“ bestimmt das Blatt
    await page.getByRole('checkbox', { name: 'Maßstab über Zielbreite' }).check();
    const target = page.locator('#sheet-target-width');
    await target.fill('600');
    await target.press('Enter');
    expect(await sheet(page)).toMatchObject({ scale: null, targetWidth: 600 });
    const w2 = Number((await page.getByTestId('sheet-label').textContent())!.split(' × ')[0]!.replace(/\./g, ''));
    expect(w2).toBeLessThanOrEqual(600);
    await expect(page.getByTestId('sheet-print-hint')).toContainText('Druck auf DIN-Papier');
  });

  test('über 5.080 mm je Seite: Warnung in der Seitenleiste und im Export-Dialog', async ({ page }) => {
    await openApp(page);
    await seedWide(page, 1200);
    await hidePaperElements(page);
    await setScale(page, 200);
    await expect(page.getByTestId('sheet-too-large')).toBeVisible();
    await page.keyboard.press(`${MOD}+p`);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByTestId('export-page-too-large')).toBeVisible();
    await page.keyboard.press('Escape');
    await setScale(page, 500);
    await expect(page.getByTestId('sheet-too-large')).toHaveCount(0);
  });
});

test.describe('#13: Blatt „Ausschnitt“', () => {
  test('aufziehen, an einem Griff vergrößern, am Rahmen verschieben; Esc bricht das Aufziehen ab', async ({ page }) => {
    await openApp(page);
    await seedWide(page);
    // ohne Papier-Elemente, damit Griffe und Rahmen frei liegen
    await hidePaperElements(page);
    await page.keyboard.press(`${MOD}+0`);
    await page.locator('#sheet-format').selectOption('region');
    // Wechsel ohne Ausschnitt: das bisherige Blatt wird der Ausschnitt
    expect((await sheet(page)).region).not.toBeNull();
    const box = await canvasBox(page);
    const k = await scale(page);
    // Esc bricht ab
    await page.getByRole('button', { name: 'Ausschnitt aufziehen' }).click();
    expect(await store(page, 's.ui.tool')).toBe('sheetRegion');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Escape');
    expect(await store(page, 's.ui.tool')).toBe('select');
    // Aufziehen: 200 × 100 px
    await page.getByRole('button', { name: 'Ausschnitt aufziehen' }).click();
    const a = { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 - 50 };
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + 60, { steps: 5 });
    await expect(page.getByTestId('sheet-region-draft')).toBeVisible();
    await page.mouse.move(a.x + 200, a.y + 100, { steps: 5 });
    await page.mouse.up();
    let r = (await sheet(page)).region;
    expect(r.w).toBeCloseTo(200 / k, 0);
    expect(r.h).toBeCloseTo(100 / k, 0);
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'paper', element: 'sheet' });
    expect(await store(page, 's.ui.tool')).toBe('select');
    expect(await store(page, 's.history.past.at(-1).label')).toBe('Ausschnitt aufziehen');
    // Frame und Marke zeigen das Maß
    await expect(page.getByTestId('sheet-frame')).toHaveAttribute('data-kind', 'region');
    await expect(page.getByTestId('sheet-label')).toHaveText(/^[\d.]+ × [\d.]+ mm · 1:[\d.]+$/);
    // Griffe: rechts in der Mitte um 80 px nach rechts ziehen
    await expect(page.getByTestId('sheet-handle')).toHaveCount(8);
    const handle = (await page.locator('[data-testid="sheet-handle"][data-handle="1,0"]').boundingBox())!;
    const hc = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(hc.x, hc.y);
    await page.mouse.down();
    await page.mouse.move(hc.x + 80, hc.y, { steps: 8 });
    await page.mouse.up();
    const r2 = (await sheet(page)).region;
    expect(r2.w).toBeCloseTo(r.w + 80 / k, 0);
    // linke Kante bleibt
    expect(r2.cx - r2.w / 2).toBeCloseTo(r.cx - r.w / 2, 1);
    expect(r2.h).toBeCloseTo(r.h, 2);
    r = r2;
    // am oberen Rahmen (ausgewählt) um 50 px nach unten verschieben
    const frame = (await page.getByTestId('sheet-frame').boundingBox())!;
    const top = { x: frame.x + frame.width * 0.3, y: frame.y };
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(top.x, top.y + 50, { steps: 8 });
    await page.mouse.up();
    const r3 = (await sheet(page)).region;
    expect(r3.cy).toBeCloseTo(r.cy + 50 / k, 0);
    expect(r3.w).toBeCloseTo(r.w, 2);
    await page.keyboard.press(`${MOD}+z`);
    expect((await sheet(page)).region.cy).toBeCloseTo(r.cy, 2);
  });
});

test.describe('#13: Export-Dialog', () => {
  test('zeigt das freie Maß je Page und in der Vorschau; PDF-Seite exakt in mm', async ({ page }) => {
    await openApp(page);
    await seedWide(page);
    await hidePaperElements(page);
    await setScale(page, 200);
    await page.keyboard.press(`${MOD}+p`);
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
    await expect(dialog(page).getByLabel('Format Festplatz 1')).toHaveValue('plan');
    await expect(dialog(page).getByTestId('export-page-size')).toHaveText('1.060 × 310 mm');
    await expect(dialog(page).getByTestId('export-preview-size')).toContainText('1.060 × 310 mm · 1:200');
    // Format im Dialog ändern: A3 quer, Maß folgt; zurück auf „Plan“ (Maßstab bleibt 1:200)
    await dialog(page).getByLabel('Format Festplatz 1').selectOption('A3');
    await expect(dialog(page).getByTestId('export-page-size')).toHaveText('420 × 297 mm');
    await dialog(page).getByLabel('Format Festplatz 1').selectOption('plan');
    await expect(dialog(page).getByTestId('export-page-size')).toHaveText('1.060 × 310 mm');
    await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await dialog(page).getByRole('button', { name: 'Exportieren' }).click();
    const pdf = await readPdf(new Uint8Array(readFileSync((await (await download).path())!)));
    expect(pdf.pages[0]!.w).toBeCloseTo(mmToPt(1060), 1);
    expect(pdf.pages[0]!.h).toBeCloseTo(mmToPt(310), 1);
  });
});
