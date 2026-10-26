import { expect, test, type Page } from '@playwright/test';
import { canvasBox, collectErrors, hoverTooltip, MOD, openApp, origin, scale, openSettings, backToPage } from './helpers';

/**
 * QA M5: Standnummern und Strom (spec.md §3, §5, §6, §10, Tastaturkürzel). Siehe qa/M5.md.
 * Tests mit `test.fail` dokumentieren offene Befunde (QA-M5-xx); sie schlagen erwartungsgemäß fehl,
 * solange der Befund besteht. Nach der Behebung `test.fail` entfernen.
 *
 * Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px, y nach unten.
 */

type P = { x: number; y: number };

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const lastLabel = (page: Page) => store(page, 's.history.past.at(-1)?.label ?? null') as Promise<string | null>;
/** Nummern der Stände einer Page (Index in project.pages, Standard: aktive Page) nach ID. */
const nrs = async (page: Page, idx?: number) =>
  (await store(page, `Object.fromEntries((${idx === undefined ? 's.project.pages.find((p) => p.id === s.ui.activePage)' : `s.project.pages[${idx}]`}).stands.map((x) => [x.id, x.nr]))`)) as Record<string, string>;
/** IDs der Stände der aktiven Page, sortiert nach ihrer (numerischen) Nummer. */
const orderByNr = async (page: Page) => {
  const m = await nrs(page);
  return Object.entries(m)
    .toSorted((a, b) => Number(a[1].replace(/\D/g, '')) - Number(b[1].replace(/\D/g, '')))
    .map(([id]) => id);
};
const powers = (page: Page, idx = 0) => store(page, `s.project.pages[${idx}].stands.map((x) => x.powerKw)`) as Promise<number[]>;
const standCount = (page: Page, idx = 0) => store(page, `s.project.pages[${idx}].stands.length`) as Promise<number>;

// suppressInfraWarning (M7, Formatversion 4), shape und shapeTemplateId (M12, Formatversion 8): Teil des Modells, ergänzt vom Entwickler
const BASE = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, shape: 'rect', shapeTemplateId: null };

/** Objekte auf die Page `idx` (Standard: aktive Page) legen, ein Undo-Schritt „Testdaten“. */
async function seed(page: Page, objs: { areas?: any[]; stands?: any[]; pageIdx?: number; pagePatch?: Record<string, unknown> }) {
  await page.evaluate(
    ({ o, base }) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        const pg = o.pageIdx === undefined ? p.pages.find((x: any) => x.id === s.ui.activePage) : p.pages[o.pageIdx];
        for (const a of o.areas ?? []) pg.areas.push({ name: '', rot: 0, ...a });
        for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, w: 2, d: 2, ...st });
        Object.assign(pg, o.pagePatch ?? {});
      });
    },
    { o: objs, base: BASE },
  );
}

const setSettings = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((pt) => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Testdaten', (p: any) => {
      Object.assign(p.settings.numbering, pt);
    });
  }, patch);

const select = (page: Page, ids: string[]) => page.evaluate((sel) => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: sel } }), ids);

async function w2s(page: Page, p: P) {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

async function drag(page: Page, a: P, b: P, opts: { hold?: string[] } = {}) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  for (const k of opts.hold ?? []) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const k of opts.hold ?? []) await page.keyboard.up(k);
}

const nrPanel = (page: Page) => page.getByRole('region', { name: 'Nummerierung' });
const powerPanel = (page: Page) => page.getByRole('region', { name: 'Strom' });
const props = (page: Page) => page.getByRole('region', { name: 'Eigenschaften' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Neu nummerieren' });
const alert = (page: Page) => page.getByRole('alertdialog');

async function fillIn(scope: ReturnType<Page['locator']>, label: string, value: string) {
  const f = scope.getByLabel(label, { exact: true });
  await f.fill(value);
  await f.press('Enter');
}

/** Fokus aus Textfeldern nehmen (dort wirken Esc, Undo usw. auf das Feld). */
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/**
 * Seit der QA-Nacharbeit M5 bietet der Dialog „Alle neu nummerieren“ und „Nur Stände ohne Nummer“ (Vorauswahl,
 * sobald Nummern existieren). Diese Tests prüfen die vollständige Neunummerierung (angepasst vom Entwickler).
 */
const chooseAll = (page: Page) => dialog(page).getByRole('radio', { name: /^Alle neu nummerieren/ }).check();

/** Neu nummerieren per Kurzbefehl („Alle neu nummerieren“) und übernehmen. */
async function renumber(page: Page) {
  await blur(page);
  await page.keyboard.press(`${MOD}+Alt+N`);
  await expect(dialog(page)).toBeVisible();
  await chooseAll(page);
  await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog(page)).toHaveCount(0);
}

const G = { id: 'G', name: 'Nord', cx: 0, cy: -5, w: 50, d: 10 };

// =============================================================================================
test.describe('QA M5: Nummerierung links → rechts (§5)', () => {
  test('quer über den Festplatz nach der Standmitte: gedrehte Stände und Grundflächen, Stände außerhalb, 0,01 m weiter links zuerst', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [G, { id: 'G2', cx: 30, cy: 20, w: 40, d: 8, rot: 30 }],
      stands: [
        { id: 'r45', cx: 10, cy: -2, w: 6, d: 2, rot: 45 }, // gedreht: zählt die Mitte, nicht die linke Ecke
        { id: 'wide', cx: 5, cy: 30, w: 30, d: 2, rot: 90 }, // gedreht, Hülle reicht weit nach links
        { id: 'out', cx: -100, cy: 50 }, // weit außerhalb jeder Grundfläche: zählt mit
        { id: 'tLow', cx: 0, cy: 5 }, // 0,01 m weiter links: zuerst, obwohl weiter unten (ohne Toleranz, QA-M5-01)
        { id: 'tUp', cx: 0.01, cy: -5 },
        { id: 'uLeft', cx: 20, cy: 5 }, // 0,02 m auseinander: links vor oben
        { id: 'uRight', cx: 20.02, cy: -5 },
        { id: 'g2', cx: 33, cy: 18, rot: 30 }, // in der gedrehten Grundfläche
      ],
    });
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['out', 'tLow', 'tUp', 'wide', 'r45', 'uLeft', 'uRight', 'g2']);
  });

  // Regel geändert von Laurin (2026-10-12, QA-M5-01): ohne Toleranz; angepasst vom Entwickler, siehe qa/M5.md
  test('ohne Toleranz: 0,01 m weiter links zuerst; bei exakt gleichem x der obere zuerst', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'low', cx: 1.0, cy: 5 }, { id: 'up', cx: 1.01, cy: -5 }, { id: 'low2', cx: 3, cy: 5 }, { id: 'up2', cx: 3, cy: -5 }] });
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['low', 'up', 'up2', 'low2']);
  });

  test('QA-M5-01: Reihenfolge hängt nicht von der Anlegereihenfolge ab (Spalte mit je 0,01 m Versatz)', async ({ page }) => {
    // Drei Stände untereinander, Mitten je 0,01 m nach rechts versetzt. Nachbarn gelten als „gleiche Lage“
    // (oberer zuerst), oben und unten aber nicht (0,02 m). Die Sortierung ist nicht transitiv; das Ergebnis
    // darf trotzdem nicht davon abhängen, in welcher Reihenfolge die Stände angelegt wurden.
    const run = async (order: string[]) => {
      await openApp(page);
      const all: Record<string, any> = { a: { id: 'a', cx: 0, cy: 10 }, b: { id: 'b', cx: 0.01, cy: 5 }, c: { id: 'c', cx: 0.02, cy: 0 } };
      await seed(page, { stands: order.map((id) => all[id]) });
      await renumber(page);
      return orderByNr(page);
    };
    const first = await run(['a', 'b', 'c']);
    const second = await run(['a', 'c', 'b']);
    expect(second).toEqual(first);
  });
});

// =============================================================================================
test.describe('QA M5: Nummerierung im Uhrzeigersinn (§5)', () => {
  const RING = [
    { id: 'N', cx: 0, cy: -10 },
    { id: 'E', cx: 10, cy: 0 },
    { id: 'S', cx: 0, cy: 10 },
    { id: 'W', cx: -10, cy: 0 },
  ];

  test('Erstes Umschalten: Mittelpunkt = Mitte aller Grundflächen und Stände; Fadenkreuz nur in diesem Modus', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'A', cx: 20, cy: 0, w: 20, d: 10 }], stands: [{ id: 's', cx: -10, cy: 20 }] });
    const marker = page.getByTestId('clockwise-marker');
    await expect(marker).toHaveCount(0);
    await nrPanel(page).getByLabel('Modus').selectOption('clockwise');
    // Hülle: x −11 … 30, y −5 … 21 → Mitte 9,5 / 8
    expect(await store(page, 's.project.pages[0].clockwise')).toEqual({ center: { x: 9.5, y: 8 }, startAngle: 0 });
    await expect(nrPanel(page).getByLabel('Mitte X', { exact: true })).toHaveValue('9,5');
    await expect(marker).toHaveCount(1);
    await nrPanel(page).getByLabel('Modus').selectOption('frontLtr');
    await expect(marker).toHaveCount(0);
    await nrPanel(page).getByLabel('Modus').selectOption('manual');
    await expect(marker).toHaveCount(0);
    // Zurück: der gesetzte Mittelpunkt bleibt (nur beim ersten Umschalten Vorgabe)
    await nrPanel(page).getByLabel('Modus').selectOption('clockwise');
    expect(await store(page, 's.project.pages[0].clockwise.center')).toEqual({ x: 9.5, y: 8 });
  });

  test('Mittelpunkt per Klick, per Feldern; Esc bricht „Mittelpunkt setzen“ ab', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: RING });
    await nrPanel(page).getByLabel('Modus').selectOption('clockwise');
    // Klick
    await nrPanel(page).getByRole('button', { name: /Mittelpunkt auf dem Plan setzen/ }).click();
    expect(await store(page, 's.ui.tool')).toBe('numberCenter');
    const p = await w2s(page, { x: 25, y: -20 });
    await page.mouse.click(p.x, p.y);
    expect(await store(page, 's.project.pages[0].clockwise.center')).toEqual({ x: 25, y: -20 });
    expect(await store(page, 's.ui.tool')).toBe('select');
    await page.keyboard.press(`${MOD}+Z`);
    expect(await store(page, 's.project.pages[0].clockwise.center')).toEqual({ x: 0, y: 0 });
    // Esc
    await nrPanel(page).getByRole('button', { name: /Mittelpunkt auf dem Plan setzen/ }).click();
    const n0 = await pastLen(page);
    await page.keyboard.press('Escape');
    expect(await store(page, 's.ui.tool')).toBe('select');
    await page.mouse.click(p.x, p.y);
    expect(await store(page, 's.project.pages[0].clockwise.center')).toEqual({ x: 0, y: 0 });
    expect(await pastLen(page)).toBe(n0);
    // Felder
    await fillIn(nrPanel(page), 'Mitte X', '-3,5');
    await fillIn(nrPanel(page), 'Mitte Y', '2.25');
    expect(await store(page, 's.project.pages[0].clockwise.center')).toEqual({ x: -3.5, y: 2.25 });
  });

  test('Startrichtung relativ zu Norden; 0° = Norden; Nordrichtung dreht mit; gleicher Winkel → näher am Mittelpunkt zuerst', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [...RING, { id: 'N2', cx: 0, cy: -20 }, { id: 'N05', cx: 0.01, cy: -5 }] });
    await nrPanel(page).getByLabel('Modus').selectOption('clockwise');
    await fillIn(nrPanel(page), 'Mitte X', '0');
    await fillIn(nrPanel(page), 'Mitte Y', '0');
    await renumber(page);
    // N05 liegt 0,11° neben Norden (nicht gleich), N2 genau auf Norden, weiter weg als N
    expect(await orderByNr(page)).toEqual(['N', 'N2', 'N05', 'E', 'S', 'W']);
    await fillIn(nrPanel(page), 'Start', '90');
    await renumber(page);
    expect((await orderByNr(page)).slice(0, 4)).toEqual(['E', 'S', 'W', 'N']);
    // Nordrichtung der Page 90° (Norden zeigt nach rechts) und Start 90° → Süden zuerst
    await seed(page, { pagePatch: { northAngle: 90 } });
    await renumber(page);
    expect((await orderByNr(page)).slice(0, 4)).toEqual(['S', 'W', 'N', 'N2']);
    // Start −90 wird auf 270 normiert
    await fillIn(nrPanel(page), 'Start', '-90');
    expect(await store(page, 's.project.pages[0].clockwise.startAngle')).toBe(270);
  });
});

// =============================================================================================
test.describe('QA M5: Nummernkreis, Format, Fixieren (§5)', () => {
  test('global: Reihenfolge der Tabs, manuelle Page übersprungen und ihre Nummern belegt; pro Festplatz beginnt jede Page neu', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.locator('.tab-add').click();
    await seed(page, { pageIdx: 0, stands: [{ id: 'a1', cx: 0, cy: 0 }, { id: 'a2', cx: 5, cy: 0 }], pagePatch: { prefix: '' } });
    await seed(page, { pageIdx: 1, stands: [{ id: 'm1', cx: 0, cy: 0, nr: '3' }, { id: 'm2', cx: 5, cy: 0, nr: '004' }], pagePatch: { numberingMode: 'manual', prefix: '' } });
    await seed(page, { pageIdx: 2, stands: [{ id: 'c1', cx: 0, cy: 0 }, { id: 'c2', cx: 5, cy: 0 }, { id: 'c3', cx: 9, cy: 0 }], pagePatch: { prefix: '' } });
    await setSettings(page, { scope: 'global' });
    await renumber(page);
    expect(await nrs(page, 0)).toEqual({ a1: '1', a2: '2' });
    expect(await nrs(page, 1)).toEqual({ m1: '3', m2: '004' }); // manuell: unverändert
    expect(await nrs(page, 2)).toEqual({ c1: '5', c2: '6', c3: '7' }); // 3 und 4 belegt
    // Tab-Reihenfolge ändern: dritte Page nach vorn
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        p.pages.unshift(p.pages.pop());
      });
    });
    await renumber(page);
    expect(await nrs(page, 0)).toEqual({ c1: '1', c2: '2', c3: '5' });
    expect(await nrs(page, 1)).toEqual({ a1: '6', a2: '7' });
    // pro Festplatz: jede Page beginnt bei der Startnummer, betroffen ist nur die aktive Page
    await setSettings(page, { scope: 'perPage', start: 10 });
    await page.getByRole('tab', { name: 'Festplatz 1' }).click();
    await renumber(page);
    expect(await nrs(page, 1)).toEqual({ a1: '10', a2: '11' });
    expect(await nrs(page, 0)).toEqual({ c1: '1', c2: '2', c3: '5' });
  });

  test('Format: Präfix, Startnummer 0, Stellen 1–4 (Grenzen), leeres Präfix', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0 }, { id: 'b', cx: 5, cy: 0 }] });
    await fillIn(nrPanel(page), 'Präfix dieses Festplatzes', 'A-');
    await openSettings(page); // M6-07: Nummernkreis in den Projekteinstellungen
    await fillIn(nrPanel(page), 'Stellen', '2');
    await backToPage(page);
    await renumber(page);
    expect(await nrs(page)).toEqual({ a: 'A-01', b: 'A-02' });
    await openSettings(page);
    await fillIn(nrPanel(page), 'Startnummer', '0');
    await fillIn(nrPanel(page), 'Stellen', '4');
    await expect(nrPanel(page).getByTestId('nr-example')).toHaveText('Beispiel: A-0000, A-0001 …');
    await backToPage(page);
    await renumber(page);
    expect(await nrs(page)).toEqual({ a: 'A-0000', b: 'A-0001' });
    // außerhalb der Grenzen: Stellen bleiben 1–4, Startnummer ≥ 0
    await openSettings(page);
    await fillIn(nrPanel(page), 'Stellen', '9');
    expect(await store(page, 's.project.settings.numbering.digits')).toBeLessThanOrEqual(4);
    await fillIn(nrPanel(page), 'Stellen', '0');
    expect(await store(page, 's.project.settings.numbering.digits')).toBeGreaterThanOrEqual(1);
    await fillIn(nrPanel(page), 'Startnummer', '-5');
    expect(await store(page, 's.project.settings.numbering.start')).toBeGreaterThanOrEqual(0);
    // leeres Präfix
    await backToPage(page);
    await fillIn(nrPanel(page), 'Präfix dieses Festplatzes', '');
    await openSettings(page);
    await fillIn(nrPanel(page), 'Stellen', '1');
    await fillIn(nrPanel(page), 'Startnummer', '1');
    await backToPage(page);
    await renumber(page);
    expect(await nrs(page)).toEqual({ a: '1', b: '2' });
  });

  test('Fixieren bei Mehrfachauswahl; fixiert und leer bleibt leer; fixierte „A-012“ sperrt „A-12“', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 'a', cx: 0, cy: 0 },
        { id: 'b', cx: 5, cy: 0, nr: 'A-012' },
        { id: 'c', cx: 10, cy: 0 },
        { id: 'd', cx: 15, cy: 0, nr: 'X' },
      ],
      pagePatch: { prefix: 'A-' },
    });
    await setSettings(page, { start: 12 });
    await select(page, ['b', 'c']);
    const lock = props(page).getByTestId('nr-lock');
    await expect(lock).toHaveAttribute('aria-pressed', 'false');
    const n0 = await pastLen(page);
    await lock.click();
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await store(page, 's.project.pages[0].stands.map((x) => x.nrLocked)')).toEqual([false, true, true, false]);
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    // gemischt: Hinweis „teilweise fixiert“
    await select(page, ['a', 'b']);
    await expect(props(page)).toContainText('teilweise fixiert');
    await page.keyboard.press('Escape');
    await renumber(page);
    // a → A-12 ist belegt (A-012) → A-13; c fixiert und leer bleibt leer; d → A-14
    expect(await nrs(page)).toEqual({ a: 'A-13', b: 'A-012', c: '', d: 'A-14' });
    // Fixierte Nummer bleibt von Hand änderbar
    await select(page, ['b']);
    const f = props(page).getByLabel('Platznummer', { exact: true });
    await f.fill('A-99');
    await f.press('Enter');
    expect((await nrs(page)).b).toBe('A-99');
    expect(await store(page, 's.project.pages[0].stands[1].nrLocked')).toBe(true);
  });

  test('Vorschau stimmt mit dem Ergebnis überein; Übernehmen ist ein Undo-Schritt, Redo stellt alles wieder her', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await seed(page, { pageIdx: 0, stands: [{ id: 'a', cx: 9, cy: 0, name: 'Alpha', nr: '1' }, { id: 'b', cx: 0, cy: 0, name: 'Beta', nr: '2' }, { id: 'f', cx: 4, cy: 0, name: 'Fix', nr: '2', nrLocked: true }], pagePatch: { prefix: '' } });
    await seed(page, { pageIdx: 1, stands: [{ id: 'c', cx: 0, cy: 0, name: 'Gamma' }, { id: 'd', cx: 1, cy: 0, name: 'Delta', nr: '5' }], pagePatch: { prefix: '' } });
    await setSettings(page, { scope: 'global' });
    await blur(page);
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(dialog(page)).toBeVisible();
    await chooseAll(page);
    await expect(dialog(page).getByTestId('renumber-summary')).toHaveText(/alle Festplätze.*3 Nummern ändern sich, 1 fixiert, 1 unverändert\./);
    const rows = await dialog(page).getByTestId('renumber-row').evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '')));
    // Spalten: Festplatz, Alt, →, Neu, Geschäft
    const preview = Object.fromEntries(rows.map((r) => [r[4], r[3]]));
    expect(preview).toEqual({ Beta: '1', Alpha: '3', Gamma: '4' });
    // Delta hat schon „5“ und bleibt unverändert (nicht in der Liste)
    const n0 = await pastLen(page);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    const byName = async () => (await store(page, 'Object.fromEntries(s.project.pages.flatMap((p) => p.stands).map((x) => [x.name, x.nr]))')) as Record<string, string>;
    const after = await byName();
    for (const [name, nr] of Object.entries(preview)) expect(after[name]).toBe(nr);
    expect(after).toEqual({ Alpha: '3', Beta: '1', Fix: '2', Gamma: '4', Delta: '5' });
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Neu nummerieren');
    await page.keyboard.press(`${MOD}+Z`);
    expect(await byName()).toEqual({ Alpha: '1', Beta: '2', Fix: '2', Gamma: '', Delta: '5' });
    await page.keyboard.press(`${MOD}+Shift+Z`);
    expect(await byName()).toEqual(after);
  });
});

// =============================================================================================
test.describe('QA M5: Doppelte Nummern (§3, §5)', () => {
  test('Vergleich mit Präfix: „A-12“ = „a-012 “, „A-12“ ≠ „B-12“; leere nie doppelt; Zähler am Tab', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [G],
      stands: [
        { id: 'a', cx: 0, cy: -5, nr: 'A-12' },
        { id: 'b', cx: 5, cy: -5, nr: 'a-012 ' },
        { id: 'c', cx: 10, cy: -5, nr: 'B-12' },
        { id: 'd', cx: 15, cy: -5, nr: '' },
        { id: 'e', cx: 20, cy: -5, nr: '' },
      ],
    });
    const badge = page.getByTestId('warn-badge');
    await expect(badge).toHaveText('2');
    expect(await hoverTooltip(page, badge)).toContain('2 mit doppelter Nummer');
    await select(page, ['c']);
    await expect(page.getByTestId('warn-chip-duplicate')).toHaveCount(0);
    await select(page, ['a']);
    await expect(page.getByTestId('warn-chip-duplicate')).toContainText('Nummer A-12 auch bei:');
  });

  test('pro Nummernkreis: pro Festplatz keine Warnung über Pages hinweg; Page duplizieren bei „global“ bzw. „pro Festplatz“', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'a', cx: 0, cy: -5, nr: '1' }, { id: 'b', cx: 5, cy: -5, nr: '2' }] });
    await page.keyboard.press(`${MOD}+Alt+D`);
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByTestId('warn-badge')).toHaveCount(0); // pro Festplatz (Standard)
    await setSettings(page, { scope: 'global' });
    await expect(page.getByTestId('warn-badge')).toHaveText(['2', '2']);
    // Ignorieren am Stand (ein Undo-Schritt) und projektweit abschalten (ein Undo-Schritt)
    const id = (await store(page, 's.project.pages[1].stands[0].id')) as string;
    await select(page, [id]);
    const n0 = await pastLen(page);
    await page.getByTestId('stand-warnings').getByLabel('doppelte Nummer ignorieren').check();
    expect(await pastLen(page)).toBe(n0 + 1);
    await expect(page.getByTestId('warn-badge')).toHaveText(['2', '1']);
    await page.keyboard.press('Escape');
    await openSettings(page); // M6-07: Warnungsschalter in den Projekteinstellungen
    await page.getByLabel('Warnung bei doppelten Platznummern').uncheck();
    await expect(page.getByTestId('warn-badge')).toHaveCount(0);
    await page.keyboard.press(`${MOD}+Z`);
    await expect(page.getByTestId('warn-badge')).toHaveText(['2', '1']);
  });

  test('Vorschau nennt verbleibende Duplikate zwischen fixierten Ständen', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, nr: '5', nrLocked: true }, { id: 'b', cx: 5, cy: 0, nr: '05', nrLocked: true }, { id: 'c', cx: 10, cy: 0 }], pagePatch: { prefix: '' } });
    await blur(page);
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(dialog(page).getByTestId('renumber-duplicates')).toContainText('2 Stände mit doppelter Nummer');
    await chooseAll(page);
    await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
    expect(await nrs(page)).toEqual({ a: '5', b: '05', c: '1' });
  });
});

// =============================================================================================
test.describe('QA M5: Strom (§6)', () => {
  const meter = (page: Page) => powerPanel(page).getByTestId('power-meter');
  async function setLimit(page: Page, v: string) {
    await fillIn(powerPanel(page), 'Limit', v);
  }
  async function setStandPower(page: Page, v: string) {
    const f = props(page).getByLabel('Strom');
    await f.fill(v);
    await f.press('Enter');
  }

  test('Stufen genau an der Grenze (Limit 100 kW)', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, powerKw: 89.9 }] });
    await setLimit(page, '100');
    const lv = (v: string) => expect(meter(page)).toHaveAttribute('data-level', v);
    await lv('ok');
    await expect(page.getByTestId('power-badge')).toHaveCount(0);
    await select(page, ['a']);
    await setStandPower(page, '90');
    await lv('warn');
    await setStandPower(page, '100');
    await lv('warn');
    await expect(page.getByTestId('power-badge')).toHaveCount(0);
    await setStandPower(page, '100,1');
    await lv('over');
    await expect(page.getByTestId('power-badge')).toHaveCount(1);
    await setStandPower(page, '0');
    await lv('ok');
    await expect(page.getByTestId('power-badge')).toHaveCount(0);
    // Limit leeren = kein Limit
    await blur(page);
    await page.keyboard.press('Escape');
    await setLimit(page, '');
    await expect(meter(page)).toHaveCount(0);
    expect(await store(page, 's.project.pages[0].powerLimitKw')).toBe(null);
  });

  test('QA-M5-02: genau 90 % ist gelb, auch wenn 0,9 × Limit Gleitkomma-Reste hat (11,7 von 13 kW)', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, powerKw: 11.7 }] });
    await setLimit(page, '13');
    await expect(meter(page)).toContainText('11,7 / 13 kW (90 %)');
    await expect(meter(page)).toHaveAttribute('data-level', 'warn', { timeout: 1000 });
  });

  test('QA-M5-02: Prozentangabe passt zur Farbstufe (89,9 % grün zeigt nicht „90 %“, 100,1 % rot zeigt nicht „100 %“)', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, powerKw: 89.9 }] });
    await setLimit(page, '100');
    await expect(meter(page)).toHaveAttribute('data-level', 'ok');
    await expect(meter(page)).not.toContainText('(90 %)', { timeout: 1000 });
  });

  test('Summen je Anschlussart, Blitz-Symbol am Tab mit Tooltip, getrennt vom Warnzähler', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [G],
      stands: [
        { id: 'a', cx: 0, cy: -5, powerKw: 2.5, connection: '230V' },
        { id: 'b', cx: 4, cy: -5, powerKw: 3.5, connection: '230V' },
        { id: 'c', cx: 8, cy: -5, powerKw: 22, connection: 'CEE32' },
        { id: 'd', cx: 12, cy: -5, powerKw: 1.25 },
      ],
    });
    await expect(powerPanel(page).getByTestId('power-table').locator('tr')).toHaveText([/230 V\s*2 Stände\s*6 kW/, /CEE 16 A\s*0 Stände\s*0 kW/, /CEE 32 A\s*1 Stand\s*22 kW/, /ohne Angabe\s*1 Stand\s*1,25 kW/]);
    await expect(powerPanel(page).getByTestId('power-sum')).toHaveText('29,25 kW');
    await setLimit(page, '20');
    await expect(page.getByTestId('power-badge')).toHaveCount(1);
    await expect(page.getByTestId('warn-badge')).toHaveCount(0);
    expect(await hoverTooltip(page, page.getByTestId('power-badge'))).toContain('29,25 / 20 kW');
  });

  test('Blockieren: Strom-Feld einzeln und bei Mehrfachauswahl; Senkungen, Undo/Redo und Limit unter Summe bleiben erlaubt', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, powerKw: 3 }, { id: 'b', cx: 5, cy: 0, powerKw: 3 }] });
    await setLimit(page, '10');
    await powerPanel(page).getByLabel('Überschreitung blockieren').check();
    // einzeln: 3 → 8 ergäbe 11 kW
    await select(page, ['a']);
    const n0 = await pastLen(page);
    await setStandPower(page, '8');
    await expect(alert(page)).toContainText('Stromlimit überschritten');
    await expect(alert(page)).toContainText('11 kW bei einem Limit von 10 kW');
    await alert(page).getByRole('button', { name: 'OK' }).click();
    expect(await powers(page)).toEqual([3, 3]);
    expect(await pastLen(page)).toBe(n0);
    await expect(props(page).getByLabel('Strom')).toHaveValue('3');
    // genau auf das Limit ist erlaubt
    await setStandPower(page, '7');
    expect(await powers(page)).toEqual([7, 3]);
    // Mehrfachauswahl: beide auf 6 → 12 kW: abgewiesen
    await select(page, ['a', 'b']);
    await setStandPower(page, '6');
    await expect(alert(page)).toBeVisible();
    await alert(page).getByRole('button', { name: 'OK' }).click();
    expect(await powers(page)).toEqual([7, 3]);
    // Senkung bei Mehrfachauswahl
    await setStandPower(page, '2');
    expect(await powers(page)).toEqual([2, 2]);
    // Undo stellt 7/3 wieder her (Erhöhung durch Undo nicht blockiert), Redo senkt wieder
    await blur(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${MOD}+Z`);
    expect(await powers(page)).toEqual([7, 3]);
    await page.keyboard.press(`${MOD}+Shift+Z`);
    expect(await powers(page)).toEqual([2, 2]);
    // Limit unter die Summe: erlaubt, Überschreitung bleibt sichtbar und wird nicht korrigiert
    await setLimit(page, '3');
    expect(await store(page, 's.project.pages[0].powerLimitKw')).toBe(3);
    await expect(page.getByTestId('power-badge')).toHaveCount(1);
    // Senkung, die noch über dem Limit bleibt: erlaubt
    await select(page, ['a']);
    await setStandPower(page, '1,5');
    expect(await powers(page)).toEqual([1.5, 2]);
    await expect(alert(page)).toHaveCount(0);
    // Undo über die Grenze hinaus (Erhöhung) ist erlaubt
    await blur(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${MOD}+Z`);
    expect(await powers(page)).toEqual([2, 2]);
  });

  test('Blockieren: Einfügen auf derselben und auf einer anderen Page, Duplizieren, Alt+Ziehen', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, w: 3, d: 3, powerKw: 6 }] });
    await setLimit(page, '10');
    await powerPanel(page).getByLabel('Überschreitung blockieren').check();
    await select(page, ['a']);
    const n0 = await pastLen(page);
    // Duplizieren
    await page.keyboard.press(`${MOD}+D`);
    await expect(alert(page)).toContainText('Stromlimit überschritten');
    await alert(page).getByRole('button', { name: 'OK' }).click();
    expect(await standCount(page)).toBe(1);
    // Einfügen auf derselben Page
    await select(page, ['a']);
    await page.keyboard.press(`${MOD}+C`);
    await page.keyboard.press(`${MOD}+V`);
    await expect(alert(page)).toBeVisible();
    await alert(page).getByRole('button', { name: 'OK' }).click();
    expect(await standCount(page)).toBe(1);
    // Alt+Ziehen: keine Kopie, Original bleibt an seinem Platz
    await select(page, ['a']);
    await drag(page, { x: 0, y: 0 }, { x: 10, y: 0 }, { hold: ['Alt'] });
    await expect(alert(page)).toBeVisible();
    await alert(page).getByRole('button', { name: 'OK' }).click();
    expect(await store(page, 's.project.pages[0].stands.map((x) => [x.cx, x.cy])')).toEqual([[0, 0]]);
    expect(await pastLen(page)).toBe(n0);
    await expect(page.locator('.stand')).toHaveCount(1);
    // Einfügen auf einer anderen Page mit eigenem Limit 5 kW und Blockieren
    await page.locator('.tab-add').click();
    await setLimit(page, '5');
    await powerPanel(page).getByLabel('Überschreitung blockieren').check();
    await page.keyboard.press(`${MOD}+V`);
    await expect(alert(page)).toContainText('Festplatz 2 hätte 6 kW');
    await alert(page).getByRole('button', { name: 'OK' }).click();
    expect(await standCount(page, 1)).toBe(0);
    // ohne Blockieren auf der anderen Page: Einfügen gilt, Hinweis erscheint
    await powerPanel(page).getByLabel('Überschreitung blockieren').uncheck();
    await page.keyboard.press(`${MOD}+V`);
    expect(await standCount(page, 1)).toBe(1);
    await expect(page.locator('.toast')).toContainText('Stromlimit überschritten: Festplatz 2 hat 6 von 5 kW');
    // Blockieren nachträglich einschalten: bestehende Überschreitung bleibt; Page duplizieren wird nie blockiert
    await powerPanel(page).getByLabel('Überschreitung blockieren').check();
    expect(await standCount(page, 1)).toBe(1);
    await page.keyboard.press(`${MOD}+Alt+D`);
    await expect(page.getByRole('tab')).toHaveCount(4);
    await expect(alert(page)).toHaveCount(0);
    expect(await standCount(page, 2)).toBe(1);
  });
});

// =============================================================================================
test.describe('QA M5: Dateiformat Version 3 (§10)', () => {
  for (const [file, version] of [
    ['format-v1-m3.schelme', 1],
    ['format-v2-m4.schelme', 2],
  ] as const) {
    test(`echte Datei Version ${version} (${file}) öffnen, Felder aus M5 ergänzt, Speichern schreibt Version 3`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press(`${MOD}+o`);
      await (await chooser).setFiles(`tests/fixtures/${file}`);
      await expect.poll(() => store(page, 's.project.pages.reduce((n, p) => n + p.stands.length, 0)')).toBe(500);
      const p = (await store(page, 's.project')) as any;
      expect(p.settings.numbering.digits).toBe(1);
      expect(p.settings.warnDuplicateNr).toBe(true);
      expect(p.pages.flatMap((x: any) => x.stands).every((s: any) => s.suppressDuplicateWarning === false)).toBe(true);
      expect(await pastLen(page)).toBe(0);
      // Die Datei ist ohne doppelte Nummern: kein Warnzähler wegen doppelter Nummern
      for (const b of await page.getByTestId('warn-badge').all()) expect(await hoverTooltip(page, b)).not.toContain('doppelter');
      const download = page.waitForEvent('download');
      await page.keyboard.press(`${MOD}+s`);
      const path = await (await download).path();
      const { readFileSync } = await import('node:fs');
      const { unzipSync, strFromU8 } = await import('fflate');
      const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(path)))['project.json']!));
      // Seit M12 Formatversion 8 (Speichern schreibt die aktuelle Version), angepasst vom Entwickler (vorher 7)
      expect(json.schemaVersion).toBe(8);
      expect(json.project.settings.numbering.digits).toBe(1);
      expect(errors).toEqual([]);
    });
  }

  test('M5-Einstellungen überstehen Speichern und Öffnen', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, nr: 'A-7', nrLocked: true, powerKw: 4, suppressDuplicateWarning: true }] });
    await openSettings(page); // M6-07
    await fillIn(nrPanel(page), 'Stellen', '3');
    await backToPage(page);
    await fillIn(nrPanel(page), 'Präfix dieses Festplatzes', 'A-');
    await nrPanel(page).getByLabel('Modus').selectOption('clockwise');
    await fillIn(nrPanel(page), 'Start', '45');
    await setLimit(page, '3,5');
    await powerPanel(page).getByLabel('Überschreitung blockieren').check();
    const before = (await store(page, 'JSON.stringify(s.project)')) as string;
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const path = await (await download).path();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles(path);
    await expect.poll(() => store(page, 's.project.pages[0].stands.length')).toBe(1);
    const after = (await store(page, 'JSON.stringify(s.project)')) as string;
    const pick = (j: string) => {
      const p = JSON.parse(j);
      return { numbering: p.settings.numbering, dup: p.settings.warnDuplicateNr, page: { prefix: p.pages[0].prefix, mode: p.pages[0].numberingMode, cw: p.pages[0].clockwise, limit: p.pages[0].powerLimitKw, block: p.pages[0].blockOverLimit }, stand: p.pages[0].stands[0] };
    };
    expect(pick(after)).toEqual(pick(before));
    expect(pick(after).page).toMatchObject({ prefix: 'A-', mode: 'clockwise', limit: 3.5, block: true });
    expect(pick(after).page.cw.startAngle).toBe(45);
    async function setLimit(pg: Page, v: string) {
      await fillIn(powerPanel(pg), 'Limit', v);
    }
  });
});

// =============================================================================================
test.describe('QA M5: Tastenkürzel, AltGr (Windows, deutsches Layout)', () => {
  /** Zeichen, die unter Windows mit AltGr (= Strg+Alt) entstehen: [Zeichen, event.code]. */
  const ALTGR: [string, string][] = [
    ['@', 'KeyQ'],
    ['€', 'KeyE'],
    ['µ', 'KeyM'],
    ['{', 'Digit7'],
    ['[', 'Digit8'],
    [']', 'Digit9'],
    ['}', 'Digit0'],
    ['\\', 'Minus'],
    ['~', 'BracketRight'],
    ['|', 'IntlBackslash'],
    ['²', 'Digit2'],
    ['³', 'Digit3'],
  ];

  test('AltGr-Zeichen (Strg+Alt) im Präfix- und Namensfeld lösen keinen Kurzbefehl aus und werden nicht verhindert (Windows-Emulation)', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' }));
    await openApp(page);
    expect(await page.evaluate(() => navigator.platform)).toBe('Win32');
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0 }] });
    const prefix = nrPanel(page).getByLabel('Präfix dieses Festplatzes', { exact: true });
    await prefix.focus();
    const state0 = await store(page, 'JSON.stringify({ pages: s.project.pages.length, tool: s.ui.tool, past: s.history.past.length })');
    for (const [key, code] of ALTGR) {
      const prevented = await prefix.evaluate(
        (el, k) => {
          const e = new KeyboardEvent('keydown', { key: k.key, code: k.code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
          el.dispatchEvent(e);
          return e.defaultPrevented;
        },
        { key, code },
      );
      expect(prevented, `AltGr-Zeichen ${key}`).toBe(false);
    }
    await expect(dialog(page)).toHaveCount(0);
    expect(await store(page, 'JSON.stringify({ pages: s.project.pages.length, tool: s.ui.tool, past: s.history.past.length })')).toBe(state0);
    // Eingabe der Zeichen selbst
    const all = ALTGR.map(([k]) => k).join('');
    await prefix.fill(all);
    await prefix.press('Enter');
    expect(await store(page, 's.project.pages[0].prefix')).toBe(all);
    await select(page, ['a']);
    const name = props(page).getByLabel('Geschäftsname');
    await name.fill(`Wurst ${all}`);
    await name.press('Enter');
    expect(await store(page, 's.project.pages[0].stands[0].name')).toBe(`Wurst ${all}`);
  });

  test('Einbuchstabige Kurzbefehle und Alt+Ziffer greifen nicht im Textfeld (macOS: Option+5 = „[“)', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    const prefix = nrPanel(page).getByLabel('Präfix dieses Festplatzes', { exact: true });
    await prefix.focus();
    await page.keyboard.type('gvh');
    const prevented = await prefix.evaluate((el) => {
      const e = new KeyboardEvent('keydown', { key: '[', code: 'Digit1', altKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
    expect(await store(page, 's.ui.tool')).toBe('select');
    await expect(page.getByRole('tab', { name: 'Festplatz 2' })).toHaveAttribute('aria-selected', 'true');
    await expect(prefix).toHaveValue('gvh');
  });

  test('QA-M5-03: Kurzbefehle mit Strg/Cmd+Alt (Neu nummerieren, Festplatz duplizieren) greifen nicht, solange ein Textfeld den Fokus hat', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0 }] });
    const prefix = nrPanel(page).getByLabel('Präfix dieses Festplatzes', { exact: true });
    await prefix.focus();
    await page.keyboard.press(`${MOD}+Alt+N`);
    await page.keyboard.press(`${MOD}+Alt+D`);
    await expect(dialog(page)).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByRole('tab')).toHaveCount(2, { timeout: 1000 });
  });
});
