import { expect, test, type Page } from '@playwright/test';
import { canvasBox, hoverTooltip, MOD, openApp, origin, scale, openSettings, backToPage } from './helpers';

/**
 * M5: Standnummern (spec.md §3, §5).
 * Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px.
 * Grundfläche G: 50 × 10 m, Vorderseite bei y = 0 von x = −25 bis 25.
 */

const G = { id: 'G', name: 'Nord', cx: 0, cy: -5, w: 50, d: 10 };

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const lastLabel = (page: Page) => store(page, 's.history.past.at(-1)?.label ?? null') as Promise<string | null>;
/** Nummern der Stände der aktiven Page, nach ID sortiert. */
const nrs = async (page: Page) => (await store(page, 'Object.fromEntries(s.project.pages.find((p) => p.id === s.ui.activePage).stands.map((x) => [x.id, x.nr]))')) as Record<string, string>;

async function seed(page: Page, objs: { areas?: any[]; stands?: any[] }) {
  await page.evaluate((o) => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false };
    s.change('Testdaten', (p: any) => {
      const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
      for (const a of o.areas ?? []) pg.areas.push({ name: '', rot: 0, ...a });
      for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, w: 2, d: 2, ...st });
    });
  }, objs);
}

const select = (page: Page, ids: string[]) => page.evaluate((sel) => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: sel } }), ids);

async function w2s(page: Page, p: { x: number; y: number }) {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

const panel = (page: Page) => page.getByRole('region', { name: 'Nummerierung' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Neu nummerieren' });
const option = (page: Page, name: 'Alle neu nummerieren' | 'Nur Stände ohne Nummer') => dialog(page).getByRole('radio', { name: new RegExp(`^${name}`) });

async function fill(page: Page, label: string, value: string) {
  const f = panel(page).getByLabel(label, { exact: true });
  await f.fill(value);
  await f.press('Enter');
}

test.describe('M5: Nummerierung', () => {
  test('M5-01/04/06: links → rechts mit Präfix und Stellen, Vorschau alt → neu, ein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'c', cx: 15, cy: -1.5 }, { id: 'a', cx: -15, cy: -1.5 }, { id: 'b', cx: 0, cy: -1.5, nr: '7' }] });
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 2 ohne Nummer');
    await fill(page, 'Präfix dieses Festplatzes', 'A-');
    await openSettings(page); // M6-07: Nummernkreis in den Projekteinstellungen
    await fill(page, 'Stellen', '2');
    await expect(panel(page).getByTestId('nr-example')).toHaveText('Beispiel: A-01, A-02 …');
    await backToPage(page);

    await panel(page).getByRole('button', { name: /Neu nummerieren/ }).click();
    await expect(dialog(page)).toBeVisible();
    await option(page, 'Alle neu nummerieren').check();
    await expect(dialog(page).getByTestId('renumber-summary')).toContainText('3 Nummern ändern sich');
    await expect(dialog(page).getByTestId('renumber-row')).toHaveText([/–\s*→\s*A-01/, /7\s*→\s*A-02/, /–\s*→\s*A-03/]);
    const n0 = await pastLen(page);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await nrs(page)).toEqual({ a: 'A-01', b: 'A-02', c: 'A-03' });
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Neu nummerieren');
    // Beschriftung zeigt die Nummer
    await expect(page.locator('.layer-labels text').filter({ hasText: 'A-01' })).toHaveCount(1);

    await page.keyboard.press(`${MOD}+Z`);
    expect(await nrs(page)).toEqual({ a: '', b: '7', c: '' });
  });

  test('M5-06: „Nur Stände ohne Nummer“ ist vorausgewählt, sobald Nummern existieren; beide Optionen mit Vorschau, je ein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: -15, cy: -1.5 }, { id: 'b', cx: -5, cy: -1.5, nr: '7' }, { id: 'c', cx: 5, cy: -1.5 }, { id: 'd', cx: 15, cy: -1.5, nr: '2' }] });
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(option(page, 'Nur Stände ohne Nummer')).toBeChecked();
    await expect(dialog(page).getByTestId('renumber-row')).toHaveText([/–\s*→\s*8/, /–\s*→\s*9/]);
    await expect(dialog(page).getByTestId('renumber-summary')).toContainText('2 Nummern ändern sich, 2 unverändert');
    // umschalten zeigt die andere Vorschau
    await option(page, 'Alle neu nummerieren').check();
    await expect(dialog(page).getByTestId('renumber-row')).toHaveCount(4);
    await option(page, 'Nur Stände ohne Nummer').check();
    const n0 = await pastLen(page);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    expect(await nrs(page)).toEqual({ a: '8', b: '7', c: '9', d: '2' });
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Neu nummerieren');

    // alle haben eine Nummer: „nur ohne Nummer“ ändert nichts, Übernehmen ist aus; „alle“ geht weiter
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(option(page, 'Nur Stände ohne Nummer')).toBeChecked();
    await expect(dialog(page).getByTestId('renumber-summary')).toContainText('keine Nummer ändert sich');
    await expect(dialog(page).getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    await option(page, 'Alle neu nummerieren').check();
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    expect(await nrs(page)).toEqual({ a: '1', b: '2', c: '3', d: '4' });
    expect(await pastLen(page)).toBe(n0 + 2);
  });

  test('QA-M5-03: in Textfeldern greifen keine Kurzbefehle außer den Datei-Befehlen (insbesondere keine mit Alt)', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0 }] });
    const prefix = panel(page).getByLabel('Präfix dieses Festplatzes', { exact: true });
    await prefix.focus();
    for (const k of [`${MOD}+Alt+N`, `${MOD}+Alt+D`, `${MOD}+Shift+N`, `${MOD}+Alt+T`]) await page.keyboard.press(k);
    await expect(dialog(page)).toHaveCount(0);
    expect(await store(page, 's.project.pages.length')).toBe(1);
    expect(await store(page, 's.ui.theme')).toBe('dark');
    await expect(prefix).toBeFocused();
  });

  test('QA-M5-03: Cmd/Strg+S im Namensfeld übernimmt die letzte Eingabe und speichert sie mit', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, name: 'Alt' }] });
    await select(page, ['a']);
    const name = page.getByRole('region', { name: 'Eigenschaften' }).getByLabel('Geschäftsname');
    await name.click();
    await name.fill('Crêpes Müller');
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+S`);
    const file = await (await download).path();
    const { readFileSync } = await import('node:fs');
    const { unzipSync, strFromU8 } = await import('fflate');
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(file)))['project.json']!));
    expect(json.project.pages[0].stands[0].name).toBe('Crêpes Müller');
    expect(await store(page, 's.project.pages[0].stands[0].name')).toBe('Crêpes Müller');
    expect(await lastLabel(page)).toBe('Geschäftsname ändern');
  });

  test('M5-06: Kurzbefehl öffnet die Vorschau, Esc bricht ohne Änderung ab; ohne Änderungen nur ein Hinweis', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: -15, cy: -1.5 }] });
    const n0 = await pastLen(page);
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await pastLen(page)).toBe(n0);
    expect(await nrs(page)).toEqual({ a: '' });

    await page.keyboard.press(`${MOD}+Alt+N`);
    await page.keyboard.press('Enter');
    expect(await nrs(page)).toEqual({ a: '1' });
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(page.locator('.toast')).toContainText('Alle Nummern sind schon aktuell');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('M5-01: links → rechts über den ganzen Festplatz, unabhängig von den Grundflächen; Reihenfolge der Grundflächen nur für §4', async ({ page }) => {
    await openApp(page);
    const S = { id: 'S', name: 'Süd', cx: 0, cy: 25, w: 50, d: 10 };
    await seed(page, {
      areas: [G, S],
      stands: [{ id: 'n1', cx: -10, cy: -1.5 }, { id: 'vorN', cx: 0, cy: 2 }, { id: 's1', cx: -20, cy: 28.5 }, { id: 'rechtsS', cx: 30, cy: 28.5 }, { id: 'unterN', cx: -10, cy: 10 }],
    });
    await page.keyboard.press(`${MOD}+Alt+N`);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    // gleiche x-Lage: der obere zuerst
    expect(await nrs(page)).toEqual({ s1: '1', n1: '2', unterN: '3', vorN: '4', rechtsS: '5' });

    // Reihenfolge der Grundflächen: eigener Bereich, Undo-Schritt, ändert die Nummerierung nicht
    const order = page.getByRole('region', { name: 'Grundflächen' }).getByTestId('area-order');
    await expect(order.locator('li')).toHaveText([/1\s*Nord · 50 × 10 m/, /2\s*Süd · 50 × 10 m/]);
    await order.locator('li').nth(0).getByRole('button', { name: 'Nach unten' }).click();
    await expect(order.locator('li')).toHaveText([/1\s*Süd/, /2\s*Nord/]);
    expect(await lastLabel(page)).toBe('Reihenfolge der Grundflächen ändern');
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(page.locator('.toast')).toContainText('Alle Nummern sind schon aktuell');
  });

  test('M5-02: Uhrzeigersinn um einen gesetzten Mittelpunkt, Startrichtung relativ zu Norden', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'W', cx: -10, cy: 0 }, { id: 'S', cx: 0, cy: 10 }, { id: 'E', cx: 10, cy: 0 }, { id: 'N', cx: 0, cy: -10 }] });
    await panel(page).getByLabel('Modus').selectOption('clockwise');
    await expect(page.getByTestId('clockwise-marker')).toBeVisible();
    // Vorgabe: Mitte aller Stände
    await expect(panel(page).getByLabel('Mitte X')).toHaveValue('0');
    // Mittelpunkt per Klick setzen (danach wieder das Auswahlwerkzeug)
    await panel(page).getByRole('button', { name: /Mittelpunkt auf dem Plan setzen/ }).click();
    await expect(page.locator('.tool-hint')).toContainText('Mittelpunkt der Nummerierung anklicken');
    const p = await w2s(page, { x: 30, y: 30 });
    await page.mouse.click(p.x, p.y);
    expect(await store(page, 's.ui.tool')).toBe('select');
    expect(await store(page, 's.project.pages[0].clockwise.center')).toEqual({ x: 30, y: 30 });
    expect(await lastLabel(page)).toBe('Mittelpunkt setzen');
    // zurück auf (0, 0) über die Felder, Start 90° = Osten
    await fill(page, 'Mitte X', '0');
    await fill(page, 'Mitte Y', '0');
    await fill(page, 'Start', '90');
    await page.keyboard.press(`${MOD}+Alt+N`);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    expect(await nrs(page)).toEqual({ E: '1', S: '2', W: '3', N: '4' });
    // Norden der Page dreht die Startrichtung mit
    await page.getByRole('region', { name: 'Norden' }).getByLabel('Nordrichtung').fill('90');
    await page.getByRole('region', { name: 'Norden' }).getByLabel('Nordrichtung').press('Enter');
    await page.keyboard.press(`${MOD}+Alt+N`);
    await option(page, 'Alle neu nummerieren').check();
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    expect(await nrs(page)).toEqual({ S: '1', W: '2', N: '3', E: '4' });
  });

  test('M5-05: fixierte Nummer wird übersprungen und nicht noch einmal vergeben', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: -15, cy: -1.5 }, { id: 'b', cx: -5, cy: -1.5 }, { id: 'c', cx: 5, cy: -1.5 }] });
    await select(page, ['b']);
    const props = page.getByRole('region', { name: 'Eigenschaften' });
    await props.getByLabel('Platznummer').fill('1');
    await props.getByLabel('Platznummer').press('Enter');
    await props.getByTestId('nr-lock').click();
    expect(await store(page, 's.project.pages[0].stands.find((x) => x.id === "b").nrLocked')).toBe(true);
    expect(await lastLabel(page)).toBe('Nummer fixieren');
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(dialog(page).getByTestId('renumber-summary')).toContainText('1 fixiert');
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    expect(await nrs(page)).toEqual({ a: '2', b: '1', c: '3' });

    // Mehrfachauswahl: das Schloss gilt für alle
    await select(page, ['a', 'c']);
    await props.getByTestId('nr-lock').click();
    expect(await store(page, 's.project.pages[0].stands.filter((x) => x.nrLocked).length')).toBe(3);
  });

  test('M5-03: Modus „manuell“ – Button aus, Kurzbefehl nennt den Grund', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: -15, cy: -1.5 }] });
    await panel(page).getByLabel('Modus').selectOption('manual');
    await expect(panel(page).getByRole('button', { name: /Neu nummerieren/ })).toBeDisabled();
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(page.locator('.toast')).toContainText('manuell nummeriert');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('M5-04/10: global durchgehend; kopierte Page erzeugt doppelte Nummern (Warnzähler, Hinweis, ignorieren)', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: -15, cy: -1.5, name: 'Crêpes' }, { id: 'b', cx: 5, cy: -1.5 }] });
    await openSettings(page); // M6-07
    await panel(page).getByLabel('Zählung').selectOption('global');
    await backToPage(page);
    await page.keyboard.press(`${MOD}+Alt+N`);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByTestId('warn-badge')).toHaveCount(0);

    // Festplatz duplizieren: dieselben Nummern auf beiden Pages
    await page.keyboard.press(`${MOD}+Alt+D`);
    const badges = page.getByTestId('warn-badge');
    await expect(badges).toHaveCount(2);
    await expect(badges.nth(0)).toHaveText('2');
    expect(await hoverTooltip(page, badges.nth(1))).toContain('2 mit doppelter Nummer');

    // Hinweis am Stand nennt den anderen Stand und seine Page
    const copyA = (await store(page, 's.project.pages[1].stands[0].id')) as string;
    await select(page, [copyA]);
    const warn = page.getByTestId('stand-warnings');
    await expect(warn.getByTestId('warn-chip-duplicate')).toHaveText('Nummer 1 auch bei: Crêpes (Festplatz 1)');
    await warn.getByLabel('doppelte Nummer ignorieren').check();
    await expect(badges.nth(1)).toHaveText('1');

    // pro Festplatz: keine Duplikate über Pages hinweg
    await page.keyboard.press('Escape');
    await openSettings(page);
    await panel(page).getByLabel('Zählung').selectOption('perPage');
    await expect(badges).toHaveCount(0);
    // projektweit abschaltbar
    await panel(page).getByLabel('Zählung').selectOption('global');
    await expect(badges).toHaveCount(2);
    await page.getByLabel('Warnung bei doppelten Platznummern').uncheck();
    await expect(badges).toHaveCount(0);
  });

  test('M5-06: neue Stände und Kopien bleiben ohne Nummer', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: -15, cy: -1.5, nr: '1' }] });
    await page.keyboard.press('g');
    const p = await w2s(page, { x: 10, y: -3 });
    await page.mouse.click(p.x, p.y);
    await select(page, ['a']);
    await page.keyboard.press(`${MOD}+D`);
    const all = Object.values(await nrs(page));
    expect(all.toSorted()).toEqual(['', '', '1']);
    await page.keyboard.press('Escape');
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 2 ohne Nummer');
  });
});
