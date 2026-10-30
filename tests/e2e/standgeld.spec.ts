import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { artifact, backToPage, collectErrors, MOD, openApp, openSettings } from './helpers';

/** #5: Standgeld aus Frontmetern, Sonderpreise je Kategorie, MwSt. */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const standEl = (page: Page, id: string) => page.locator(`.stand[data-id="${id}"]`);
async function clickStand(page: Page, id: string) {
  const box = (await standEl(page, id).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
}

/** Drei Stände: 4,3 m ohne Kategorie, 3 m Imbiss, 12,5 m Fahrgeschäft; noch kein Preis. */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nrLocked: false, owner: '', ware: '', powerKw: 0, connection: null, note: '', color: null, rot: 0, d: 3, cy: 0, shape: 'rect', shapeTemplateId: null };
    s.change('Testdaten', (p: any) => {
      p.settings.warnOutside = false;
      p.categories.push({ id: 'imbiss', name: 'Imbiss', color: '#f0a35e', minDistance: null, price: null }, { id: 'fg', name: 'Fahrgeschäft', color: '#7986cb', minDistance: null, price: null });
      p.pages[0].stands.push(
        { ...base, id: 'a', nr: '1', name: 'Losbude', w: 4.3, cx: 0, categoryId: null },
        { ...base, id: 'b', nr: '2', name: 'Bratwurst', w: 3, cx: 10, categoryId: 'imbiss' },
        { ...base, id: 'c', nr: '3', name: 'Autoscooter', w: 12.5, cx: 25, categoryId: 'fg' },
      );
    });
    s.setView(s.project.pages[0].id, { scale: 10, tx: 200, ty: 300 });
  });
}

test.describe('#5 Standgeld', () => {
  test('Preise in den Projekteinstellungen; Seitenleiste, Tabelle, Summen, Kennzahlen und CSV; je ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);

    // Ohne Preis: nirgends Standgeld
    await clickStand(page, 'a');
    await expect(page.getByTestId('fee-info')).toHaveCount(0);
    await openSettings(page);
    await expect(page.getByTestId('stat-fee')).toHaveCount(0);

    // Preis je Frontmeter 25 €, MwSt 19 % (Standard)
    const n0 = (await st(page)).history.past.length;
    await page.getByLabel('Preis je Frontmeter (netto)').fill('25');
    await page.keyboard.press('Enter');
    expect((await st(page)).project.settings.pricing).toEqual({ perMeter: 25, roundUpMeters: false, vatRate: 19 });
    expect((await st(page)).history.past.length).toBe(n0 + 1);
    // 4,3 + 3 + 12,5 = 19,8 m × 25 € = 495 € netto; brutto 127,93 + 89,25 + 371,88 = 589,06 €
    await expect(page.getByTestId('stat-fee').first()).toHaveText('Standgeld netto495,00 €brutto589,06 €');

    // Fahrgeschäft: Pauschale 500 €
    await page.getByLabel('Preis für „Fahrgeschäft“').selectOption('flat');
    await page.getByLabel('Pauschale für „Fahrgeschäft“').fill('500');
    await page.keyboard.press('Enter');
    expect((await st(page)).project.categories[1].price).toEqual({ kind: 'flat', amount: 500 });
    // 107,50 + 75 + 500 = 682,50 € netto; brutto 127,93 + 89,25 + 595 = 812,18 €
    await expect(page.getByTestId('stat-fee').first()).toHaveText('Standgeld netto682,50 €brutto812,18 €');

    // angefangene Meter voll: 4,3 → 5 m (125 €)
    await page.getByLabel('Angefangene Meter voll berechnen (4,30 m → 5 m)').check();
    await expect(page.getByTestId('stat-fee').first()).toContainText('700,00 €');
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId('stat-fee').first()).toContainText('682,50 €');
    await page.screenshot({ path: artifact('standgeld-einstellungen.png') });

    // Tabelle: Spalten netto/brutto, Summenzeile, Sortierung
    await page.getByRole('tab', { name: /Geschäfte/ }).click();
    await expect(page.getByTestId('stand-sums-fee')).toHaveText('Standgeld 682,50 € netto · 812,18 € brutto');
    await page.getByRole('columnheader', { name: /Standgeld netto/ }).click();
    const firstRow = page.getByTestId('stand-row').first();
    await expect(firstRow).toContainText('Bratwurst');
    await expect(firstRow).toContainText('75,00');
    await expect(firstRow).toContainText('89,25');

    // CSV mit beiden Spalten
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const lines = readFileSync(await (await download).path(), 'utf8').slice(1).split('\r\n\r\n')[0]!.split('\r\n');
    expect(lines[0]).toContain('Standgeld netto (€);Standgeld brutto (€)');
    expect(lines.find((l) => l.includes('Autoscooter'))).toContain(';500;595;');

    // Seitenleiste: Betrag und Herkunft
    await backToPage(page);
    await clickStand(page, 'a');
    await expect(page.getByTestId('fee-info')).toContainText('107,50 € netto · 127,93 € brutto');
    await expect(page.getByTestId('fee-info')).toContainText('4,3 m × 25,00 €');
    await clickStand(page, 'c');
    await expect(page.getByTestId('fee-info')).toContainText('Pauschale der Kategorie');
    expect(errors).toEqual([]);
  });

  test('Eigener Preis je Frontmeter gilt auch ohne Projektpreis; MwSt-Satz begrenzt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await openSettings(page);
    await page.getByLabel('Preis für „Imbiss“').selectOption('perMeter');
    await page.getByLabel('Preis je Frontmeter für „Imbiss“').fill('40');
    await page.keyboard.press('Enter');
    expect((await st(page)).project.categories[0].price).toEqual({ kind: 'perMeter', amount: 40 });
    // eigener Preis gilt auch ohne Projektpreis: nur der Imbiss hat Standgeld
    await expect(page.getByTestId('stat-fee').first()).toContainText('120,00 €');

    // MwSt-Satz über 100 % wird abgewiesen
    const vat = page.getByLabel('MwSt-Satz');
    await vat.fill('150');
    await page.keyboard.press('Enter');
    expect((await st(page)).project.settings.pricing.vatRate).toBe(19);
    await vat.fill('7');
    await page.keyboard.press('Enter');
    expect((await st(page)).project.settings.pricing.vatRate).toBe(7);
    expect(errors).toEqual([]);
  });
});
