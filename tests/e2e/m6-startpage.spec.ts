import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { activeTabName, collectErrors, MOD, openApp, tabbar } from './helpers';

/** M6: Start-Page – Kennzahlen, Geschäftstabelle, Freiflächen, Einstellungen, CSV (spec.md §7). */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const stand = (page: Page, id: string) => store(page, `s.project.pages.flatMap((p) => p.stands).find((x) => x.id === '${id}')`) as Promise<any>;

/**
 * Zwei Festplätze: „Nord“ mit Grundfläche 50 × 10 m (Vorderseite unten) und drei Ständen, „Süd“ mit einem Stand
 * außerhalb jeder Grundfläche. Danach auf der Start-Page.
 */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, rot: 0 };
    s.change('Testdaten', (p: any) => {
      const nord = p.pages[0];
      nord.name = 'Nord';
      nord.areas.push({ id: 'g1', name: 'Hauptstraße', cx: 25, cy: 5, w: 50, d: 10, rot: 0 });
      nord.stands.push(
        { ...base, id: 's1', nr: 'A-10', name: 'Bratwurst Müller', owner: 'Hans Müller', ware: 'Wurst', cx: 24, cy: 8.5, w: 8, d: 3, powerKw: 5, connection: 'CEE16' },
        { ...base, id: 's2', nr: 'A-2', name: 'Café Süß', owner: 'Erika', ware: 'Kuchen', cx: 2, cy: 8.5, w: 4, d: 3, powerKw: 2.5, connection: '230V' },
        { ...base, id: 's3', name: 'Losbude', owner: 'Kai', ware: 'Lose', cx: 46, cy: 8.5, w: 3, d: 3 },
      );
      p.pages.push({ ...JSON.parse(JSON.stringify(nord)), id: 'p2', name: 'Süd', areas: [], stands: [{ ...base, id: 's4', nr: 'B-1', name: 'Karussell', owner: 'Fa. Strauß', ware: 'Fahrgeschäft', cx: 0, cy: 0, w: 6, d: 6, powerKw: 20, connection: 'CEE32' }] });
    });
    s.setUi({ activePage: 'start' });
  });
}

const grid = (page: Page) => page.getByTestId('stand-grid');
const rowNames = (page: Page) => page.getByTestId('stand-row').locator('[data-col="name"]').allInnerTexts();
const cell = (page: Page, id: string, col: string) => page.locator(`[data-stand-id="${id}"] [data-col="${col}"]`);

test.describe('M6: Start-Page', () => {
  test('M6-01: Kennzahlen gesamt und je Festplatz; Warnzahl öffnet die gefilterte Tabelle', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    const total = page.getByTestId('stat-total');
    await expect(total.getByTestId('stat-stands')).toHaveText('4');
    await expect(total.getByTestId('stat-front')).toHaveText('21 m');
    await expect(total).toContainText('27,5 kW');
    await expect(total.getByTestId('stat-conn')).toContainText('CEE 32 A');
    const cards = page.getByTestId('stat-page');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByTestId('stat-front')).toHaveText('15 m');
    // M6-11: freie Frontmeter (Lücken 4–20 und 28–44,5 m; 47,5–50 m = 2,5 m) = 35 m; Süd ohne Grundfläche 0
    await expect(cards.nth(0).getByTestId('stat-free')).toHaveText('35 m');
    await expect(cards.nth(1).getByTestId('stat-free')).toHaveText('0 m');
    await expect(total.getByTestId('stat-free')).toHaveText('35 m');
    // Limit für Nord: Balken auf der Start-Page
    await store(page, `s.change('Limit', (p) => { p.pages[0].powerLimitKw = 8; })`);
    await expect(cards.nth(0).getByTestId('power-meter')).toHaveAttribute('data-level', 'warn');
    await expect(cards.nth(0).getByTestId('power-meter')).toContainText('7,5 / 8 kW (93 %)');
    // Süd: Stand außerhalb → Warnung; Klick filtert die Tabelle
    await expect(cards.nth(1).getByTestId('stat-warn')).toHaveText(/1 Warnung/);
    await cards.nth(1).getByTestId('stat-warn').click();
    await expect.poll(() => rowNames(page)).toEqual(['Karussell']);
    await expect(page.getByTestId('stand-count')).toHaveText('1 von 4 Geschäften');
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(page.getByTestId('stand-row')).toHaveCount(4);
    // Kartentitel öffnet die Page
    await cards.nth(1).getByRole('button', { name: 'Süd öffnen' }).click();
    expect(await activeTabName(page)).toBe('Süd');
    expect(errors).toEqual([]);
  });

  test('M6-03: sortieren, suchen, filtern, Summenzeile, Spalten pro Rechner', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await expect.poll(() => rowNames(page)).toEqual(['Café Süß', 'Bratwurst Müller', 'Losbude', 'Karussell']);
    await page.getByRole('columnheader', { name: 'Nr' }).click();
    await expect.poll(() => rowNames(page)).toEqual(['Café Süß', 'Bratwurst Müller', 'Karussell', 'Losbude']);
    await page.getByRole('columnheader', { name: 'Nr' }).click();
    await expect.poll(() => rowNames(page)).toEqual(['Karussell', 'Bratwurst Müller', 'Café Süß', 'Losbude']);
    await page.getByLabel('Geschäfte suchen').fill('cafe');
    await expect.poll(() => rowNames(page)).toEqual(['Café Süß']);
    await expect(page.getByTestId('stand-sums')).toContainText('1 Geschäft');
    await expect(page.getByTestId('stand-sums')).toContainText('4 m Frontmeter');
    await page.getByLabel('Geschäfte suchen').fill('');
    await page.getByLabel('ohne Nummer').check();
    await expect.poll(() => rowNames(page)).toEqual(['Losbude']);
    await page.getByLabel('ohne Nummer').uncheck();
    await page.getByTestId('filter-connection').click();
    await page.getByRole('group', { name: 'Anschluss' }).getByLabel('ohne Angabe').uncheck();
    await expect(page.getByTestId('stand-row')).toHaveCount(3);
    await expect(page.getByTestId('stand-sums')).toContainText('27,5 kW');
    await page.keyboard.press('Escape');
    // Spalten: Eigentümer ausblenden, bleibt nach dem Neuladen (pro Rechner) erhalten
    await page.getByTestId('columns').click();
    await page.getByRole('group', { name: 'Spalten' }).getByLabel('Eigentümer').uncheck();
    await expect(page.getByRole('columnheader', { name: 'Eigentümer' })).toHaveCount(0);
    await page.reload();
    await seed(page);
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Eigentümer' })).toHaveCount(0);
  });

  test('M6-04/M6-08: Zellen bearbeiten mit Tastatur, ein Undo-Schritt je Zelle, Kurzbefehle der Zeichenfläche greifen nicht', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await cell(page, 's2', 'name').click();
    // Tippen beginnt die Bearbeitung und ersetzt den Inhalt; V/H lösen kein Werkzeug aus
    const before = await pastLen(page);
    await page.keyboard.type('Vanille Haus');
    await page.keyboard.press('Enter');
    expect((await stand(page, 's2')).name).toBe('Vanille Haus');
    expect(await pastLen(page)).toBe(before + 1);
    expect(await store(page, 's.ui.tool')).toBe('select');
    // Enter ging eine Zeile tiefer (Bratwurst), Pfeil rechts zu Eigentümer, F2 bearbeitet, Esc verwirft
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('F2');
    await page.keyboard.type(' XYZ');
    await page.keyboard.press('Escape');
    expect((await stand(page, 's1')).owner).toBe('Hans Müller');
    // Breite mit Komma; ungültig bleibt offen und rot
    await cell(page, 's1', 'w').click();
    await page.keyboard.type('7,5');
    await page.keyboard.press('Enter');
    expect((await stand(page, 's1')).w).toBe(7.5);
    await cell(page, 's1', 'w').dblclick();
    await page.keyboard.press(`${MOD}+A`);
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    await expect(cell(page, 's1', 'w').locator('input')).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Escape');
    expect((await stand(page, 's1')).w).toBe(7.5);
    // Rückgängig wirkt in der Tabelle global
    await grid(page).focus();
    await page.keyboard.press(`${MOD}+Z`);
    expect((await stand(page, 's1')).w).toBe(8);
    await page.keyboard.press(`${MOD}+Z`);
    expect((await stand(page, 's2')).name).toBe('Café Süß');
    // Leertaste fixiert die Nummer, Entf leert eine Textzelle
    await cell(page, 's2', 'nr').click();
    await page.keyboard.press(' ');
    expect((await stand(page, 's2')).nrLocked).toBe(true);
    await page.keyboard.press('Delete');
    expect((await stand(page, 's2')).nr).toBe('');
    // Auswahlzelle: Anschlussart
    await cell(page, 's3', 'connection').click();
    await page.keyboard.press('Enter');
    await cell(page, 's3', 'connection').locator('select').selectOption('CEE32');
    expect((await stand(page, 's3')).connection).toBe('CEE32');
  });

  test('M6-04: Stromlimit blockiert auch in der Tabelle; Reihenfolge bleibt nach einer Änderung stehen', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await store(page, `s.change('Limit', (p) => { p.pages[0].powerLimitKw = 10; p.pages[0].blockOverLimit = true; })`);
    await cell(page, 's3', 'power').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('alertdialog', { name: 'Stromlimit überschritten' });
    await expect(dlg).toContainText('Nord hätte 12,5 kW');
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect((await stand(page, 's3')).powerKw).toBe(0);
    await expect(cell(page, 's3', 'power')).toHaveText('');
    // Nach Namen sortieren, Name ändern: Zeile springt nicht weg, Hinweis „Sortierung veraltet“
    await page.getByRole('columnheader', { name: 'Name' }).click();
    await expect.poll(() => rowNames(page)).toEqual(['Bratwurst Müller', 'Café Süß', 'Karussell', 'Losbude']);
    await cell(page, 's1', 'name').click();
    await page.keyboard.type('Zuckerwatte');
    await page.keyboard.press('Enter');
    await expect.poll(() => rowNames(page)).toEqual(['Zuckerwatte', 'Café Süß', 'Karussell', 'Losbude']);
    await page.getByTestId('resort').click();
    await expect.poll(() => rowNames(page)).toEqual(['Café Süß', 'Karussell', 'Losbude', 'Zuckerwatte']);
  });

  test('M6-09: Sprung zum Stand wechselt die Page, wählt aus und hebt hervor; zurück bleiben Filter erhalten', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.getByLabel('Geschäfte suchen').fill('karussell');
    await cell(page, 's4', 'jump').getByRole('button').click();
    expect(await activeTabName(page)).toBe('Süd');
    await expect(page.getByTestId('jump-flash')).toHaveCount(1);
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'objects', ids: ['s4'] });
    // gezoomt: Stand (6 m) mit Rand mindestens 30 m sichtbar, also zwischen 10 und 40 px/m
    const sc = (await store(page, `s.views['p2'].scale`)) as number;
    expect(sc).toBeGreaterThan(10);
    expect(sc).toBeLessThan(40);
    await expect(page.getByTestId('jump-flash')).toHaveCount(0, { timeout: 4000 });
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    await expect(page.getByLabel('Geschäfte suchen')).toHaveValue('karussell');
    // Tastatur: Cmd/Strg+Enter springt
    await cell(page, 's4', 'name').click();
    await page.keyboard.press(`${MOD}+Enter`);
    expect(await activeTabName(page)).toBe('Süd');
  });

  test('M6-02: Freiflächen mit Passt-Filter und Sprung; verschwundene Freifläche zeigt die Grundfläche', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.keyboard.press(`${MOD}+2`);
    const rows = page.getByTestId('free-row');
    // Lücken auf 50 m: 0–4 (Café), 4–20, 28–44.5, 47.5–50
    await expect(rows).toHaveCount(3);
    await page.locator('#fit-w').fill('8');
    await page.locator('#fit-w').press('Enter');
    await page.locator('#fit-d').fill('10');
    await page.locator('#fit-d').press('Enter');
    await expect(rows).toHaveCount(2);
    // engste passende zuerst
    await expect(rows.nth(0).locator('[role="gridcell"]').nth(3)).toHaveText('16');
    await expect(rows.nth(1).locator('[role="gridcell"]').nth(3)).toHaveText('16,5');
    await page.locator('#fit-d').fill('10,02');
    await page.locator('#fit-d').press('Enter');
    await expect(rows).toHaveCount(0);
    await page.locator('#fit-d').fill('');
    await page.locator('#fit-d').press('Enter');
    await rows.nth(0).click();
    expect(await activeTabName(page)).toBe('Nord');
    await expect(page.getByTestId('jump-flash')).toHaveCount(1);
    // Freifläche verschwindet (Stand füllt die Lücke), Sprung zeigt die Grundfläche mit Hinweis
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    await expect(rows).toHaveCount(2);
    await store(page, `s.change('Lücken füllen', (p) => { p.pages[0].stands.push({ ...p.pages[0].stands[0], id: 'fill', cx: 25, w: 50, cy: 8.5 }); })`);
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ activePage: 'start' }));
    await expect(rows).toHaveCount(0);
    // Verweis direkt auflösen (wie ein Klick auf eine veraltete Zeile)
    await page.evaluate(async () => {
      const path = '/src/app/jump.ts'; // Modul des Dev-Servers
      const m = await import(/* @vite-ignore */ path);
      m.jumpToFreeSpace({ pageId: (window as any).__marktplanerStore.getState().project.pages[0].id, key: 'g1|s1|s3', areaId: 'g1', start: 28, end: 44.5 });
    });
    await expect(page.locator('.toast')).toContainText('angezeigt wird die Grundfläche');
    await expect(page.getByTestId('jump-flash')).toHaveCount(1);
  });

  test('M6-05/M6-07: Projekteinstellungen auf der Start-Page; Seitenleiste ohne projektweite Bereiche', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.getByRole('tab', { name: 'Einstellungen' }).click();
    const name = page.locator('#project-name');
    await name.fill('Schelmenmarkt 2027');
    await name.press('Enter');
    await expect(page.locator('.sp-head h1')).toHaveText('Schelmenmarkt 2027');
    await name.fill('   ');
    await name.press('Enter');
    await expect(name).toHaveValue('Schelmenmarkt 2027');
    await page.keyboard.press(`${MOD}+Z`);
    await expect(page.locator('.sp-head h1')).not.toHaveText('Schelmenmarkt 2027');
    await expect(page.locator('#label-template')).toBeVisible();
    await expect(page.locator('#free-min-width')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kategorie anlegen' })).toBeVisible();
    await expect(page.locator('#nr-scope')).toBeVisible();
    // Tab springt auf der Start-Page zwischen Bedienelementen (keine Panels)
    await name.focus();
    await page.keyboard.press('Tab');
    expect(await store(page, 's.ui.panelsHidden')).toBe(false);
    // Festplatz-Page: keine projektweiten Bereiche mehr, Link zu den Projekteinstellungen
    await tabbar(page).getByRole('tab', { name: 'Nord' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Seitenleiste' });
    await expect(sidebar.locator('#label-template')).toHaveCount(0);
    await expect(sidebar.getByRole('region', { name: 'Kategorien' })).toHaveCount(0);
    await expect(sidebar.getByTestId('nr-circle')).toContainText('pro Festplatz, ab 1, 1 Stelle');
    await sidebar.getByTestId('nr-circle').getByRole('button', { name: 'Projekteinstellungen' }).click();
    expect(await activeTabName(page)).toBe('Start-Page');
    await expect(page.getByTestId('project-settings')).toBeVisible();
  });

  test('M6-06: CSV-Export mit BOM, Semikolon, Komma-Zahlen und Formelschutz', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await store(page, `s.change('Formel', (p) => { p.pages[1].stands[0].owner = '=HYPERLINK("x")'; })`);
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+Shift+E`);
    const file = await download;
    expect(file.suggestedFilename().normalize('NFC')).toMatch(/– Geschäfte\.csv$/);
    const text = readFileSync(await file.path(), 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('Festplatz;Nr;Name;Eigentümer;Ware;Kategorie;Breite (m);Tiefe (m);Strom (kW);Anschlussart;Warnungen');
    expect(lines[1]).toBe('Nord;A-2;Café Süß;Erika;Kuchen;;4;3;2,5;230 V;');
    expect(lines[4]).toBe(`Süd;B-1;Karussell;"'=HYPERLINK(""x"")";Fahrgeschäft;;6;6;20;CEE 32 A;außerhalb`);
  });
});
