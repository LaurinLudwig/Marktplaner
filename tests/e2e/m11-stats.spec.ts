import { expect, test, type Page } from '@playwright/test';
import { artifact, collectErrors, openApp } from './helpers';

/** M11 #7: Kennzahlen je Kategorie (Anzahl, Frontmeter, Strom) je Festplatz und gesamt (spec.md §7). */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);

async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, rot: 0, cy: 0, d: 3 };
    s.change('Testdaten', (p: any) => {
      p.categories = [
        { id: 'imbiss', name: 'Imbiss', color: '#d9534f' },
        { id: 'ware', name: 'Ware', color: '#5cb85c' },
      ];
      const nord = p.pages[0];
      nord.name = 'Nord';
      nord.stands.push(
        { ...base, id: 's1', name: 'Bratwurst', cx: 0, w: 4, powerKw: 5, categoryId: 'imbiss' },
        { ...base, id: 's2', name: 'Crêpes', cx: 10, w: 3.5, powerKw: 2.5, categoryId: 'imbiss' },
        { ...base, id: 's3', name: 'Lose', cx: 20, w: 3 },
      );
      p.pages.push({ ...JSON.parse(JSON.stringify(nord)), id: 'p2', name: 'Süd', stands: [{ ...base, id: 's4', name: 'Töpfe', cx: 0, w: 6, powerKw: 1, categoryId: 'ware' }] });
    });
    s.setUi({ activePage: 'start' });
  });
}

const rows = (card: ReturnType<Page['getByTestId']>) => card.getByTestId('stat-cat').locator('li');

test.describe('M11 #7: Kennzahlen je Kategorie', () => {
  test('Karten zeigen Anzahl · Frontmeter · Strom je Kategorie inkl. „ohne Kategorie“; Summe = Anzahl Geschäfte', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    const total = page.getByTestId('stat-total');
    await expect(rows(total)).toHaveText(['Imbiss2 · 7,5 m · 7,5 kW', 'Ware1 · 6 m · 1 kW', 'ohne Kategorie1 · 3 m · 0 kW']);
    const cards = page.getByTestId('stat-page');
    await expect(rows(cards.nth(0))).toHaveText(['Imbiss2 · 7,5 m · 7,5 kW', 'ohne Kategorie1 · 3 m · 0 kW']);
    await expect(rows(cards.nth(1))).toHaveText(['Ware1 · 6 m · 1 kW']);
    await page.getByTestId('stats').screenshot({ path: artifact('m11-stats.png') });
    // Farbfeld in der Kategoriefarbe
    await expect(total.locator('[data-category="imbiss"] .stat-cat-swatch')).toHaveCSS('background-color', 'rgb(217, 83, 79)');
    const counts = (await total.locator('.stat-cat-fig').allInnerTexts()).map((t) => Number(t.split(' ')[0]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(Number(await total.getByTestId('stat-stands').innerText()));
    expect(errors).toEqual([]);
  });

  test('Werte aktualisieren sich live; Klick öffnet die Tabelle gefiltert auf Festplatz und Kategorie', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await store(page, `s.change('Kategorie', (p) => { p.pages[0].stands[2].categoryId = 'ware'; p.pages[0].stands[0].w = 5; })`);
    const total = page.getByTestId('stat-total');
    await expect(rows(total)).toHaveText(['Imbiss2 · 8,5 m · 7,5 kW', 'Ware2 · 9 m · 1 kW']);
    await page.getByTestId('stat-page').nth(0).locator('[data-category="imbiss"]').click();
    await expect(page.getByTestId('stand-row')).toHaveCount(2);
    await expect(page.getByTestId('stand-count')).toHaveText('2 von 4 Geschäften');
    // „ohne Kategorie“ gesamt: nach dem Zurücksetzen der Kategorie wieder vorhanden
    await store(page, `s.change('ohne', (p) => { p.pages[1].stands[0].categoryId = null; })`);
    await store(page, `s.setUi({ activePage: 'start' })`);
    await page.getByTestId('stat-total').locator('[data-category=""]').click();
    await expect(page.getByTestId('stand-row')).toHaveCount(1);
    await expect(page.getByTestId('stand-row').locator('[data-col="name"]')).toHaveText('Töpfe');
  });
});
