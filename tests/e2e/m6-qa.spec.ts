import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { activeTabName, MOD, openApp, tabbar } from './helpers';

/**
 * QA M6: Start-Page (spec.md §7). Ergänzt `m6-startpage.spec.ts`:
 * - CSV-Export exportiert nur die gefilterten/sortierten Zeilen (Geschäfte und Freiflächen).
 * - Freiflächenliste: Formelschutz/Sonderzeichen auch im CSV-Export der Freiflächen.
 * - M6-11 (freie Frontmeter) bei einer angeschnittenen (L-förmigen) Freifläche: Kennzahlen-Karte, Zeichenfläche
 *   und Freiflächenliste zeigen übereinstimmend die Hüllbreite; der Passt-Filter rechnet dagegen mit der
 *   kleinsten durchgehenden Tiefe.
 * - M6-01: Kennzahlen bleiben nach Page-Duplizieren und nach Rückgängig korrekt.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);

test.describe('QA M6: CSV exportiert nur die gefilterten Zeilen', () => {
  async function seed(page: Page) {
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, rot: 0 };
      s.change('Testdaten', (p: any) => {
        p.pages[0].name = 'Nord';
        p.pages[0].stands.push(
          { ...base, id: 's1', nr: 'A-1', name: 'Bratwurst Müller', cx: 0, cy: 0, w: 3, d: 3 },
          { ...base, id: 's2', nr: 'A-2', name: 'Café Süß', cx: 10, cy: 0, w: 4, d: 3 },
          { ...base, id: 's3', nr: 'A-3', name: 'Losbude', cx: 20, cy: 0, w: 2, d: 3 },
        );
      });
      s.setUi({ activePage: 'start' });
    });
  }

  test('Geschäftstabelle: Suche filtert die exportierte Liste', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.getByLabel('Geschäfte suchen').fill('café');
    await expect(page.getByTestId('stand-row')).toHaveCount(1);
    // Fokus liegt im Suchfeld (Textfeld): der Kurzbefehl greift dort bewusst nicht (spec.md Tastaturkürzel),
    // deshalb über den CSV-Button statt Cmd/Strg+Shift+E.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const file = await download;
    const text = readFileSync(await file.path(), 'utf8');
    // Seit M10 (#5) folgt nach einer Leerzeile der Vermerk „Marktplaner, Version …“; gezählt wird nur die Tabelle
    // (angepasst vom Entwickler)
    const [table, note] = text.slice(1).split('\r\n\r\n');
    expect(note).toMatch(/^Marktplaner, Version /);
    const lines = table!.split('\r\n').filter(Boolean);
    // Kopfzeile + genau die gefilterte Zeile, nicht die anderen beiden Stände
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Café Süß');
    expect(lines.join('\n')).not.toContain('Bratwurst');
    expect(lines.join('\n')).not.toContain('Losbude');
  });

  test('Freiflächenliste: Passt-Filter filtert die exportierte Liste; Formelschutz/Umlaut/Semikolon im Grundflächennamen', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        p.pages[0].name = 'Nord';
        // Grundfläche 30 × 8 m, Name mit Semikolon/Anführungszeichen/Formel-Präfix und Umlaut
        p.pages[0].areas.push({ id: 'g1', name: '=Längsplatz; "Mitte"', cx: 15, cy: 4, w: 30, d: 8, rot: 0 });
        // Ein Stand bei x=14..16 teilt die Freifläche in 14 m (links) und 14 m (rechts)
        p.pages[0].stands.push({ nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, id: 's1', cx: 15, cy: 4, w: 2, d: 3, rot: 0 });
      });
      s.setUi({ activePage: 'start' });
    });
    await page.keyboard.press(`${MOD}+2`);
    const rows = page.getByTestId('free-row');
    await expect(rows).toHaveCount(2);
    // Grenzfälle der 0,01-m-Toleranz (§4/§7): exakt passend (14 m) und 0,01 m zu klein (14,01 m) bleiben beide
    // Lücken erhalten; 0,02 m zu klein (über der Toleranz) lässt keine mehr passen.
    await page.locator('#fit-w').fill('14');
    await page.locator('#fit-w').press('Enter');
    await expect(rows).toHaveCount(2);
    await page.locator('#fit-w').fill('14,01');
    await page.locator('#fit-w').press('Enter');
    await expect(rows).toHaveCount(2);
    await page.locator('#fit-w').fill('14,02');
    await page.locator('#fit-w').press('Enter');
    await expect(rows).toHaveCount(0);
    await page.locator('#fit-w').fill('14');
    await page.locator('#fit-w').press('Enter');
    await expect(rows).toHaveCount(2);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const file = await download;
    const text = readFileSync(await file.path(), 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    // Seit M10 (#5) folgt nach einer Leerzeile der Vermerk „Marktplaner, Version …“; gezählt wird nur die Tabelle
    // (angepasst vom Entwickler)
    const [table, note] = text.slice(1).split('\r\n\r\n');
    expect(note).toMatch(/^Marktplaner, Version /);
    const lines = table!.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // Kopfzeile + 2 Lücken
    // Name mit Formel-Anfang, Semikolon und Anführungszeichen: Hochkomma-Schutz und doppelte Anführungszeichen
    expect(lines[1]).toContain(`"'=Längsplatz; ""Mitte"""`);
  });
});

test.describe('QA M6-11: freie Frontmeter bei angeschnittener (L-förmiger) Freifläche', () => {
  async function seedClipped(page: Page) {
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        p.pages[0].name = 'Nord';
        // Wie m6.test.ts „Angeschnittene Freifläche (L-Form)“: frühere Fläche überdeckt die hintere linke Ecke
        // der späteren 20 × 10 m Fläche → eine Freifläche über die volle Breite (20 m), aber nur 6 m durchgehend tief.
        p.pages[0].areas.push({ id: 'early', name: 'Früh', cx: 5, cy: 2, w: 10, d: 4, rot: 0 }, { id: 'late', name: 'Spät', cx: 10, cy: 5, w: 20, d: 10, rot: 0 });
      });
      s.setUi({ activePage: 'start' });
    });
  }

  test('Kennzahlen-Karte, Zeichenfläche und Freiflächenliste zeigen übereinstimmend die Hüllbreite 20 m; Passt-Filter rechnet mit der nutzbaren Tiefe', async ({ page }) => {
    await openApp(page);
    await seedClipped(page);
    await page.keyboard.press(`${MOD}+2`);
    // Freiflächenliste: „Früh“ (10 × 4 m, unangeschnitten) und „Spät“ (angeschnittene Zeile mit Hüllmaßen 20 × 10 m)
    const rows = page.getByTestId('free-row');
    await expect(rows).toHaveCount(2);
    const spaet = rows.filter({ hasText: 'Spät' });
    await expect(spaet).toHaveCount(1);
    await expect(spaet).toContainText('angeschnitten');
    await expect(spaet.locator('[role="gridcell"]').nth(3)).toHaveText('20');
    await expect(spaet.locator('[role="gridcell"]').nth(4)).toHaveText('10');
    // Passt-Filter: 6 m Tiefe passt nur bei „Spät“ (nutzbare Tiefe), 7 m bei keiner (Hüllmaß-Tiefe wäre 10, würde sonst passen)
    await page.locator('#fit-w').fill('8');
    await page.locator('#fit-w').press('Enter');
    await page.locator('#fit-d').fill('6');
    await page.locator('#fit-d').press('Enter');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Spät');
    await page.locator('#fit-d').fill('7');
    await page.locator('#fit-d').press('Enter');
    await expect(rows).toHaveCount(0);
    await page.locator('#fit-d').fill('');
    await page.locator('#fit-d').press('Enter');
    await page.locator('#fit-w').fill('');
    await page.locator('#fit-w').press('Enter');
    // Kennzahlen-Karte: 30 m freie Frontmeter gesamt (10 m „Früh“ + 20 m Hüllbreite „Spät“), gesamt ebenso (nur ein Festplatz)
    const cards = page.getByTestId('stat-page');
    await expect(cards.first().getByTestId('stat-free')).toHaveText('30 m');
    await expect(page.getByTestId('stat-total').getByTestId('stat-free')).toHaveText('30 m');
    // Zeichenfläche: Beschriftung „Frei 20 × 10 m“ für „Spät“ mit denselben Hüllmaßen wie Liste und Kennzahl
    await tabbar(page).getByRole('tab', { name: 'Nord' }).click();
    expect(await activeTabName(page)).toBe('Nord');
    await expect(page.locator('.free-label')).toHaveCount(2);
    await expect(page.locator('.free-label', { hasText: 'Frei 20 × 10 m' })).toHaveCount(1);
    expect(await store(page, 's.project.settings.minFreeWidth')).toBeLessThan(20); // Kontrolle: Mindestbreite greift nicht erst zufällig
  });
});

test.describe('QA M6-01: Kennzahlen nach Page-Duplizieren und Rückgängig', () => {
  test('Kennzahlen stimmen nach Duplizieren einer Page und nach Undo wieder mit dem Plan überein', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, rot: 0 };
      s.change('Testdaten', (p: any) => {
        p.pages[0].name = 'Nord';
        p.pages[0].stands.push({ ...base, id: 's1', cx: 0, cy: 0, w: 3 }, { ...base, id: 's2', cx: 10, cy: 0, w: 4 });
      });
      s.setUi({ activePage: 'start' });
    });
    await expect(page.getByTestId('stat-total').getByTestId('stat-front')).toHaveText('7 m');
    await tabbar(page).getByRole('tab', { name: 'Nord' }).click();
    // Festplatz duplizieren: zweite Karte mit denselben Werten, Gesamt verdoppelt sich
    await page.keyboard.press(`${MOD}+Alt+D`);
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    const cards = page.getByTestId('stat-page');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByTestId('stat-front')).toHaveText('7 m');
    await expect(cards.nth(1).getByTestId('stat-front')).toHaveText('7 m');
    await expect(page.getByTestId('stat-total').getByTestId('stat-front')).toHaveText('14 m');
    await expect(page.getByTestId('stat-total').getByTestId('stat-stands')).toHaveText('4');
    // Rückgängig: Duplikat verschwindet wieder, Kennzahlen wie zuvor
    await page.keyboard.press(`${MOD}+z`);
    await expect(cards).toHaveCount(1);
    await expect(page.getByTestId('stat-total').getByTestId('stat-front')).toHaveText('7 m');
    await expect(page.getByTestId('stat-total').getByTestId('stat-stands')).toHaveText('2');
    // Zelländerung in der Tabelle: Kennzahl folgt sofort, Undo stellt sie wieder her
    await page.keyboard.press(`${MOD}+1`);
    await page.locator('[data-stand-id="s1"] [data-col="w"]').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stat-total').getByTestId('stat-front')).toHaveText('9 m');
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId('stat-total').getByTestId('stat-front')).toHaveText('7 m');
  });
});
