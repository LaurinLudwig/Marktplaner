import { expect, test, type Page } from '@playwright/test';
import { canvasBox, collectErrors, MOD, openApp, origin, scale, openSettings, backToPage, confirmNewProject } from './helpers';

/**
 * QA M4: Freiflächen, Fang, Warnungen, Dateiformat (spec.md §3, §4, §10, Allgemein).
 * Geprüft gegen die Formulierung in spec.md, nicht gegen das Backlog.
 *
 * Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px (Fangabstand 8 px = 0,8 m,
 * Lösen 16 px = 1,6 m).
 * Grundfläche G: 50 × 10 m, Vorderseite bei y = 0 von x = −25 bis 25 (Achse s = x + 25, Tiefe t = −y).
 */

type P = { x: number; y: number };
const G = { id: 'G', cx: 0, cy: -5, w: 50, d: 10 };

const pastLen = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
const lastLabel = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.at(-1)?.label ?? null);
const activePg = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    return s.project.pages.find((p: any) => p.id === s.ui.activePage);
  });
const stands = async (page: Page) => (await activePg(page)).stands as any[];
const standById = async (page: Page, id: string) => (await stands(page)).find((s) => s.id === id);
const selIds = (page: Page) =>
  page.evaluate(() => {
    const sel = (window as any).__marktplanerStore.getState().ui.selection;
    return sel?.kind === 'objects' ? sel.ids : [];
  });
const hasPreview = (page: Page) => page.evaluate(() => !!(window as any).__marktplanerStore.getState().preview);

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}
async function clickAt(page: Page, p: P) {
  const s = await w2s(page, p);
  await page.mouse.click(s.x, s.y);
}
async function moveTo(page: Page, p: P, steps = 10) {
  const s = await w2s(page, p);
  await page.mouse.move(s.x, s.y, { steps });
}

/** Ziehen von Weltpunkt a nach b; `hold` = Tasten, die beim Mausdruck schon gedrückt sind. */
async function drag(page: Page, a: P, b: P, opts: { hold?: string[]; steps?: number; keepDown?: boolean } = {}) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  for (const k of opts.hold ?? []) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 12 });
  if (opts.keepDown) return;
  await page.mouse.up();
  for (const k of opts.hold ?? []) await page.keyboard.up(k);
}

const BASE = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false };
async function seed(page: Page, objs: { areas?: any[]; stands?: any[] }) {
  await page.evaluate(
    ({ o, base }) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        // M4 prüft bündiges Anliegen; seit M10 (#2) ist das Abstand 0 (Standard neuer Projekte 0,3 m), angepasst vom Entwickler
        p.settings.snapGap = 0;
        const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
        for (const a of o.areas ?? []) pg.areas.push({ name: '', rot: 0, ...a });
        for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, ...st });
      });
    },
    { o: objs, base: BASE },
  );
}

/** Stand in G: Achse s von a bis b, Tiefe t von t0 bis t1 (achsenparallel). */
const inG = (id: string, a: number, b: number, t0 = 0, t1 = 3, extra: object = {}) => ({ id, cx: (a + b) / 2 - 25, cy: -(t0 + t1) / 2, w: b - a, d: t1 - t0, ...extra });

const freeLabels = (page: Page) => page.locator('.free-label');
const sortedTexts = async (page: Page) => (await freeLabels(page).allTextContents()).toSorted();

/**
 * Orakel gegen Reste und veraltete Freiflächen: Die gezeichneten Freiflächen (Polygone und
 * Beschriftungen) müssen genau der frischen Berechnung aus dem Projekt bzw. der laufenden Vorschau
 * entsprechen (ohne Zwischenspeicher). Liefert die Abweichungen als Text, leer = stimmig.
 */
async function freeSpaceMismatch(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const fs = await import('/src/core/freeSpace.ts' as string);
    const der = await import('/src/core/derive.ts' as string);
    const label = await import('/src/core/label.ts' as string);
    const s = (window as any).__marktplanerStore.getState();
    const stored = s.project.pages.find((p: any) => p.id === s.ui.activePage);
    const pg = der.effectivePage(stored, s.preview);
    const res = fs.pageFreeSpaces(pg.areas, pg.stands, s.project.settings.minFreeWidth);
    const pts = (poly: any[]) => poly.map((p: any) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
    const want = res.flatMap((r: any) => r.free.flatMap((f: any) => f.polygons.map((poly: any) => `${f.key}@${pts(poly)}`))).toSorted();
    const got = [...document.querySelectorAll('.free-space')].map((e) => `${e.getAttribute('data-key')}@${e.getAttribute('points')}`).toSorted();
    const wantLabels = res.flatMap((r: any) => r.free.map((f: any) => `${f.key}=${label.freeSpaceLabel(f.width, f.depth)}`)).toSorted();
    const gotLabels = [...document.querySelectorAll('.free-label')].map((e) => `${e.getAttribute('data-key')}=${e.textContent}`).toSorted();
    const out: string[] = [];
    if (JSON.stringify(want) !== JSON.stringify(got)) out.push(`Polygone: erwartet ${JSON.stringify(want)}, gezeichnet ${JSON.stringify(got)}`);
    // Beschriftungen nur prüfen, wenn alle sichtbar sein sollten (kleine Szenen im Bild)
    if (gotLabels.length && JSON.stringify(wantLabels) !== JSON.stringify(gotLabels)) out.push(`Beschriftung: erwartet ${JSON.stringify(wantLabels)}, gezeichnet ${JSON.stringify(gotLabels)}`);
    return out.join('\n');
  });
}
const expectConsistent = async (page: Page) => expect.poll(() => freeSpaceMismatch(page)).toBe('');

/** Warnzähler am Tab der aktiven Page ('' = kein Zähler) und ob er rot ist. */
async function badge(page: Page, tabIndex?: number) {
  const tab = tabIndex === undefined ? page.locator('header.tabbar [role="tab"][aria-selected="true"]') : page.locator('header.tabbar [role="tab"]').nth(tabIndex);
  const b = tab.locator('[data-testid="warn-badge"]');
  if (!(await b.count())) return '';
  const cls = (await b.getAttribute('class')) ?? '';
  return `${await b.innerText()}${cls.includes('overlap') ? ' rot' : ''}`;
}
/** Erwarteter Zähler aus einer frischen Berechnung (unabhängig vom Zwischenspeicher). */
const expectedBadge = (page: Page) =>
  page.evaluate(async () => {
    const w = await import('/src/core/warnings.ts' as string);
    const s = (window as any).__marktplanerStore.getState();
    const pg = s.project.pages.find((p: any) => p.id === s.ui.activePage);
    const n = w.countWarnings(w.pageWarnings(pg.areas, pg.stands), pg.stands, s.project.settings);
    return n.stands ? `${n.stands}${n.overlap ? ' rot' : ''}` : '';
  });
async function expectBadge(page: Page, want: string) {
  await expect.poll(() => badge(page)).toBe(want);
  expect(await expectedBadge(page)).toBe(want);
}

// =============================================================================================
test.describe('QA M4-01/05/13: Freiflächen-Fälle aus spec.md §4 in der Oberfläche', () => {
  test('Beispiel 50 × 10 m mit Stand 8 m bei x = 20: 20 × 10 und 22 × 10; nie hinter dem Stand, auch wenn er hinten steht', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28, 7, 10)] });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    // Volle Tiefe, kein Streifen vor oder hinter dem Stand
    const polys = await page.locator('.free-space').evaluateAll((els) => els.map((e) => e.getAttribute('points')));
    expect(polys).toHaveLength(2);
    // Beschriftung horizontal
    for (const t of await freeLabels(page).all()) expect(await t.getAttribute('transform')).toBeNull();
    await expectConsistent(page);
  });

  test('Berührung von außen belegt nichts; Eindringen genau 0,01 m belegt nichts, 0,02 m belegt', async ({ page }) => {
    // (behoben 2026-10-11, test.fail entfernt) QA-M4-01: Toleranzgrenze hängt von Gleitkomma-Resten ab (1,49 − 1,5 = −0,010000000000000009)
    await openApp(page);
    // Vorderseite y = 0; Stand vor der Fläche (y 0 … 3)
    await seed(page, { areas: [G], stands: [{ id: 'v', cx: 0, cy: 1.5, w: 3, d: 3 }] });
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
    // genau 0,01 m hinein (y −0,01 … 2,99)
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('t', (p: any) => void (p.pages[0].stands[0].cy = 1.49));
    });
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
    // 0,02 m hinein
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('t', (p: any) => void (p.pages[0].stands[0].cy = 1.48));
    });
    await expect(freeLabels(page)).toHaveText(['Frei 23,5 × 10 m', 'Frei 23,5 × 10 m']);
    await expectConsistent(page);
  });

  test('Eindringen genau 0,01 m an allen vier Seiten und an anderen Koordinaten belegt nichts (Gleitkomma)', async ({ page }) => {
    // (behoben 2026-10-11, test.fail entfernt) QA-M4-01: „hinten“ und „rechts“ belegen, „links“ und „vorn“ nicht (Gleitkomma)
    await openApp(page);
    // Fläche A: x 10 … 30, y 10,37 … 18,37 (krumme Werte)
    const A = { id: 'A', cx: 20, cy: 14.37, w: 20, d: 8 };
    // Stände, die jeweils genau 0,01 m in A hineinragen, an jeder Seite
    const s = [
      { id: 'links', cx: 10.01 - 1.5, cy: 14.37, w: 3, d: 3 },
      { id: 'rechts', cx: 29.99 + 1.5, cy: 14.37, w: 3, d: 3 },
      { id: 'vorn', cx: 20, cy: 18.36 + 1.5, w: 3, d: 3 },
      { id: 'hinten', cx: 15, cy: 10.38 - 1.5, w: 3, d: 3 },
    ];
    await seed(page, { areas: [A], stands: s });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 8 m']);
  });

  test('Gedrehter Stand belegt seine volle Projektion (45°, 4 × 4 m → 5,66 m)', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 'r', cx: 0, cy: -5, w: 4, d: 4, rot: 45 }] });
    await expect(freeLabels(page)).toHaveText(['Frei 22,17 × 10 m', 'Frei 22,17 × 10 m']);
    await expectConsistent(page);
  });

  test('Seitlich überstehender Stand: nur der Teil innerhalb zählt; hinten überstehend ebenso', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('links', -2, 3), inG('hinten', 10, 13, 8, 12)] });
    await expect(freeLabels(page)).toHaveText(['Frei 7 × 10 m', 'Frei 37 × 10 m']);
    await expectConsistent(page);
  });

  test('Gedrehte Grundfläche (30°) mit Stand an der Vorderseite', async ({ page }) => {
    await openApp(page);
    const rot = 30;
    const r = (rot * Math.PI) / 180;
    const local = (lx: number, ly: number) => ({ x: lx * Math.cos(r) - ly * Math.sin(r), y: lx * Math.sin(r) + ly * Math.cos(r) });
    const c = local(-5, 5 - 1.5);
    await seed(page, { areas: [{ id: 'A', cx: 0, cy: 0, w: 40, d: 10, rot }], stands: [{ id: 's', cx: c.x, cy: c.y, w: 3, d: 3, rot }] });
    expect(await sortedTexts(page)).toEqual(['Frei 13,5 × 10 m', 'Frei 23,5 × 10 m']);
    await expectConsistent(page);
  });

  test('Zwei aneinanderliegende Grundflächen, Stand über der Fuge: belegt beide, keine Warnung „außerhalb“', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G, { id: 'K', cx: 50, cy: -5, w: 50, d: 10 }], stands: [{ id: 'f', cx: 25, cy: -1.5, w: 4, d: 3 }] });
    await expect(freeLabels(page)).toHaveText(['Frei 48 × 10 m', 'Frei 48 × 10 m']);
    await expect(page.locator('.stand[data-id="f"]')).not.toHaveAttribute('data-warning', /.+/);
  });

  test('Überlappende Grundflächen: frühere gewinnt, spätere L-förmig mit Hüllmaßen; Stand im Überlappungsbereich belegt nur die frühere', async ({ page }) => {
    await openApp(page);
    // H (später): x 15 … 35, y −20 … 0, Vorderseite y = 0; Überlappung mit G: x 15 … 25, y −10 … 0
    const H = { id: 'H', cx: 25, cy: -10, w: 20, d: 20 };
    await seed(page, { areas: [G, H] });
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m', 'Frei 20 × 20 m']);
    await expect(page.locator('.free-space[data-area="H"]')).toHaveCount(2); // L-Form aus zwei Stücken
    const gBefore = await page.locator('.free-space[data-area="G"]').evaluateAll((els) => els.map((e) => e.getAttribute('points')));
    // Stand in H außerhalb von G: x 26 … 29
    await seed(page, { stands: [{ id: 'h1', cx: 27.5, cy: -1.5, w: 3, d: 3 }] });
    expect(await sortedTexts(page)).toEqual(['Frei 11 × 20 m', 'Frei 50 × 10 m', 'Frei 6 × 20 m']);
    // Stand im Überlappungsbereich (x 20 … 23): belegt G, in H nichts
    await seed(page, { stands: [{ id: 'g1', cx: 21.5, cy: -1.5, w: 3, d: 3 }] });
    expect(await sortedTexts(page)).toEqual(['Frei 11 × 20 m', 'Frei 2 × 10 m', 'Frei 45 × 10 m', 'Frei 6 × 20 m']);
    await expectConsistent(page);
    // Die frühere Fläche ändert sich durch die spätere nie: G ohne H gleich G mit H
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('t', (p: any) => void (p.pages[0].stands = p.pages[0].stands.filter((x: any) => x.id !== 'g1')));
    });
    const gAfter = await page.locator('.free-space[data-area="G"]').evaluateAll((els) => els.map((e) => e.getAttribute('points')));
    expect(gAfter).toEqual(gBefore);
  });

  test('Mindestbreite: Grenzen 0,05–100 m, leere und ungültige Eingaben, Undo/Redo', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28), inG('s2', 28.4, 31)] });
    const field = page.locator('#free-min-width');
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 19 × 10 m']);
    await openSettings(page); // M6-07: Mindestbreite in den Projekteinstellungen
    const minW = () => page.evaluate(() => (window as any).__marktplanerStore.getState().project.settings.minFreeWidth);
    // Ungültig (außerhalb 0,05–100, leer, Text): Feld rot, Wert bleibt, kein Undo-Schritt
    const n0 = await pastLen(page);
    for (const input of ['0,01', '0,049', '100,01', 'abc', '', '-1']) {
      await field.fill(input);
      await field.press('Enter');
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(await minW()).toBe(0.5);
    }
    expect(await pastLen(page)).toBe(n0);
    // Grenzen selbst gültig
    for (const [input, v] of [
      ['100', 100],
      ['0,05', 0.05],
    ] as const) {
      await field.fill(input);
      await field.press('Enter');
      expect(await minW()).toBe(v);
    }
    await field.fill('100');
    await field.press('Enter');
    await backToPage(page);
    await expect(page.locator('.free-space')).toHaveCount(0);
    await openSettings(page);
    await field.fill('0.3');
    await field.press('Enter');
    await expect(field).toHaveValue('0,3');
    await backToPage(page);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 0,4 × 10 m', 'Frei 19 × 10 m']);
    await page.keyboard.press('Escape');
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.free-space')).toHaveCount(0);
    await openSettings(page);
    await expect(field).toHaveValue('100');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(field).toHaveValue('0,3');
    await backToPage(page);
    await expectConsistent(page);
  });

  test('Beschriftung erscheint erst ab 6 px Schrifthöhe; Freiflächen bleiben sichtbar', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    const fontSize = await page.evaluate(() => (window as any).__marktplanerStore.getState().project.settings.labelFontSize);
    const setScale = (k: number) =>
      page.evaluate((kk) => {
        const s = (window as any).__marktplanerStore.getState();
        s.setView(s.project.pages[0].id, { scale: kk, tx: s.ui.viewport.w / 2, ty: s.ui.viewport.h / 2 });
      }, k);
    await setScale(6.2 / fontSize);
    await expect(freeLabels(page)).toHaveCount(2);
    await setScale(5.8 / fontSize);
    await expect(freeLabels(page)).toHaveCount(0);
    await expect(page.locator('.free-space')).toHaveCount(2);
  });
});

// =============================================================================================
test.describe('QA M4-04: Live-Aktualisierung ohne Reste', () => {
  test('Ziehen (live), Esc, Drehen (Drehgriff, live), Maße, Löschen, Undo, Redo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);

    // Ziehen: während des Ziehens live, Fang aus (Mod gedrückt, damit die Lage der Maus folgt)
    await clickAt(page, { x: -1, y: -1.5 });
    await drag(page, { x: -1, y: -1.5 }, { x: 4, y: -1.5 }, { hold: [MOD], keepDown: true });
    await expect(freeLabels(page)).toHaveText(['Frei 25 × 10 m', 'Frei 17 × 10 m']);
    await expectConsistent(page);
    await moveTo(page, { x: 30, y: -1.5 }); // ganz hinaus
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
    await expectConsistent(page);
    await page.mouse.up();
    await page.keyboard.up(MOD);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+z`);

    // Drehen am Drehgriff (live während des Drehens)
    await clickAt(page, { x: -1, y: -1.5 });
    const h = await page.getByTestId('rotate-handle').boundingBox();
    const c = await w2s(page, { x: -1, y: -1.5 });
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
    await page.mouse.down();
    // 90° im Uhrzeigersinn: Griff nach rechts vom Mittelpunkt
    await page.mouse.move(c.x + 60, c.y, { steps: 15 });
    await expect.poll(async () => (await page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects?.s1?.rot)) ?? -1).toBeCloseTo(90, 0);
    await expect(freeLabels(page)).toHaveText(['Frei 22,5 × 10 m', 'Frei 24,5 × 10 m']);
    await expectConsistent(page);
    await page.mouse.up();
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);

    // Maße über die Seitenleiste
    await clickAt(page, { x: -1, y: -1.5 });
    await page.locator('#sb-w').fill('12');
    await page.locator('#sb-w').press('Enter');
    await expect(freeLabels(page)).toHaveText(['Frei 18 × 10 m', 'Frei 20 × 10 m']);
    await expectConsistent(page);
    // Drehung numerisch
    await page.locator('#sb-rot').fill('90');
    await page.locator('#sb-rot').press('Enter');
    await expectConsistent(page);
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);

    // Löschen, Undo, Redo
    await clickAt(page, { x: -1, y: -1.5 });
    await page.keyboard.press('Delete');
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
    await expectConsistent(page);
    expect(errors).toEqual([]);
  });

  test('Einfügen, Duplizieren, Pfeiltasten und Alt+Ziehen (live, Esc ohne Reste)', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    await clickAt(page, { x: -1, y: -1.5 });
    // Kopieren / Einfügen: Kopie 1 m nach rechts unten (belegt s 21 … 29)
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 21 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    // Pfeiltasten
    await clickAt(page, { x: -1, y: -1.5 });
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(freeLabels(page)).toHaveText(['Frei 18 × 10 m', 'Frei 24 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);

    // Alt+Ziehen: Kopie nach s 36 … 44, live sichtbar
    await drag(page, { x: -1, y: -1.5 }, { x: 15, y: -1.5 }, { hold: ['Alt', MOD], keepDown: true });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 8 × 10 m', 'Frei 6 × 10 m']);
    await expectConsistent(page);
    // Esc: Kopie verschwindet, nichts bleibt stehen
    await page.keyboard.press('Escape');
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    await expectConsistent(page);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.keyboard.up(MOD);
    expect(await stands(page)).toHaveLength(1);
    await expectConsistent(page);
    // Alt+Ziehen übernehmen, dann Undo/Redo
    await drag(page, { x: -1, y: -1.5 }, { x: 15, y: -1.5 }, { hold: ['Alt', MOD] });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 8 × 10 m', 'Frei 6 × 10 m']);
    await page.keyboard.press(`${MOD}+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    await expectConsistent(page);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 8 × 10 m', 'Frei 6 × 10 m']);
    await expectConsistent(page);
  });

  test('Grundfläche verschieben, Größe am Griff, Vorderseite wechseln, Page wechseln', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    // Grundfläche auswählen (Klick in freie Stelle der Fläche) und am rechten Griff um 10 m verlängern
    await clickAt(page, { x: -20, y: -8 });
    expect(await selIds(page)).toEqual(['G']);
    const handle = page.locator('.resize-handle[data-handle="1,0"]');
    const hb = await handle.boundingBox();
    const to = await w2s(page, { x: 35, y: -5 });
    await page.mouse.move(hb!.x + 4, hb!.y + 4);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 32 × 10 m']);
    await expectConsistent(page);
    await page.mouse.up();
    await expectConsistent(page);
    // Vorderseite auf die gegenüberliegende Kante: Achse läuft andersherum, Maße gleich
    await page.evaluate(async () => {
      const m = await import('/src/state/objects.ts' as string);
      const s = (window as any).__marktplanerStore.getState();
      m.setAreaFront(s.project.pages[0].id, 'G', 0);
    });
    expect(await sortedTexts(page)).toEqual(['Frei 20 × 10 m', 'Frei 32 × 10 m']);
    await expectConsistent(page);
    // Grundfläche verschieben (ausgewählt): Stand bleibt stehen, Freiflächen wandern mit
    await drag(page, { x: -20, y: -8 }, { x: -20, y: -18 }, { hold: [MOD] });
    await expectConsistent(page);
    await expect(freeLabels(page)).toHaveText(['Frei 60 × 10 m']);
    // Page wechseln: keine Freiflächen der anderen Page bleiben stehen
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await expect(page.locator('.free-space')).toHaveCount(0);
    await page.locator('header.tabbar [role="tab"]').nth(1).click();
    await expectConsistent(page);
  });
});

// =============================================================================================
test.describe('QA M4-06/15/16/17: Fang', () => {
  const ROT = 30;
  const R = (ROT * Math.PI) / 180;
  /** Grundfläche A (40 × 10 m, 30°) um den Ursprung; lokale Koordinaten → Welt. */
  const L = (lx: number, ly: number) => ({ x: lx * Math.cos(R) - ly * Math.sin(R), y: lx * Math.sin(R) + ly * Math.cos(R) });
  /** Welt → lokale Koordinaten von A. */
  const toL = (p: P) => ({ x: p.x * Math.cos(R) + p.y * Math.sin(R), y: -p.x * Math.sin(R) + p.y * Math.cos(R) });
  const A = { id: 'A', name: 'Nord', cx: 0, cy: 0, w: 40, d: 10, rot: ROT };

  test('Vorderkante einer gedrehten Grundfläche: rastet ein, übernimmt die Drehung, gleitet, Hilfslinie, löst sich mit ursprünglicher Drehung', async ({ page }) => {
    await openApp(page);
    // Stand 3 × 3 m, Drehung 17°, Mittelpunkt 2,3 m hinter der Vorderseite (Vorderseite 0,8 m entfernt, wenn er parallel stünde)
    const c0 = L(0, 5 - 2.3);
    await seed(page, { areas: [A], stands: [{ id: 's', cx: c0.x, cy: c0.y, w: 3, d: 3, rot: 17 }] });
    // Kleine Bewegung parallel zur Vorderseite: Abstand 0,3 m = 3 px → rastet ein
    const c1 = L(1, 5 - 1.8);
    await drag(page, c0, c1, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="front"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="snap-guides"] text')).toContainText('Nord');
    await page.mouse.up();
    let s = await standById(page, 's');
    expect(s.rot).toBeCloseTo(ROT, 5);
    let l = toL({ x: s.cx, y: s.cy });
    expect(l.y).toBeCloseTo(5 - 1.5, 1); // Vorderseite bündig (Rundung 0,01 m)
    expect(l.x).toBeCloseTo(1, 1);
    // Gleiten entlang der Vorderseite mit 1,2 m (12 px) Abstand quer dazu: bleibt eingerastet
    const g0 = L(1, 3.5);
    const g1 = L(10, 3.5 - 1.2);
    await drag(page, g0, g1, { steps: 25 });
    s = await standById(page, 's');
    l = toL({ x: s.cx, y: s.cy });
    expect(s.rot).toBeCloseTo(ROT, 5);
    expect(l.y).toBeCloseTo(3.5, 1);
    expect(l.x).toBeCloseTo(10, 0);
    // Lösen innerhalb einer Geste: ursprüngliche Drehung der Geste zurück
    await seed(page, { stands: [{ id: 't', cx: L(-12, 0).x, cy: L(-12, 0).y, w: 3, d: 3, rot: 17 }] });
    await drag(page, L(-12, 0), L(-12, 3.3), { keepDown: true });
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects?.t?.rot)).toBeCloseTo(ROT, 5);
    await moveTo(page, L(-12, 0.5), 20);
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects?.t?.rot)).toBe(17);
    await expect(page.locator('[data-testid="snap-guides"]')).toHaveCount(0);
    await page.mouse.up();
    expect(await standById(page, 't')).toMatchObject({ rot: 17 });
  });

  test('Eingerastet: fängt am Ende der Vorderseite und an Nachbarständen (Hilfslinien)', async ({ page }) => {
    await openApp(page);
    // Nachbar n: lokal x 0 … 3 an der Vorderseite
    const n = L(1.5, 3.5);
    const c0 = L(-10, 3.5);
    await seed(page, { areas: [A], stands: [{ id: 'n', cx: n.x, cy: n.y, w: 3, d: 3, rot: ROT }, { id: 's', cx: c0.x, cy: c0.y, w: 3, d: 3, rot: ROT }] });
    // s Richtung linkes Ende: linke Kante 0,5 m vor dem Ende (lokal −20) → rastet bei −20 ein
    await drag(page, c0, L(-18, 3.5), { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="end"]')).toHaveCount(1);
    await page.mouse.up();
    let s = await standById(page, 's');
    expect(toL({ x: s.cx, y: s.cy }).x).toBeCloseTo(-18.5, 1);
    // s an den Nachbarn: rechte Kante 0,5 m vor dessen linker Kante (lokal 0) → bündig
    await drag(page, L(-18.5, 3.5), L(-2, 3.5), { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="contact"]')).toHaveCount(1);
    await page.mouse.up();
    s = await standById(page, 's');
    expect(toL({ x: s.cx, y: s.cy }).x).toBeCloseTo(-1.5, 1);
    // Freiflächen: zwischen s und n keine Lücke
    expect(await sortedTexts(page)).toEqual(['Frei 17 × 10 m', 'Frei 17 × 10 m']);
  });

  test('Nachbarstand: anliegen und fluchten bei gedrehten Ständen; nicht parallele Nachbarn fangen nicht', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'n', cx: 0, cy: 0, w: 4, d: 3, rot: 20 }, { id: 's', cx: 10, cy: 10, w: 3, d: 3, rot: 20 }, { id: 'q', cx: 20, cy: -10, w: 3, d: 3, rot: 33 }] });
    const r = (20 * Math.PI) / 180;
    const ax = (u: number, v: number) => ({ x: u * Math.cos(r) - v * Math.sin(r), y: u * Math.sin(r) + v * Math.cos(r) });
    // Ziel: s rechts neben n, 0,5 m Lücke, um 0,4 m versetzt quer
    const target = ax(2 + 1.5 + 0.5, 0.4);
    await drag(page, { x: 10, y: 10 }, target, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="contact"]')).toHaveCount(1);
    await page.mouse.up();
    const s = await standById(page, 's');
    const u = s.cx * Math.cos(r) + s.cy * Math.sin(r);
    const v = -s.cx * Math.sin(r) + s.cy * Math.cos(r);
    expect(u).toBeCloseTo(3.5, 1); // anliegend
    expect(v).toBeCloseTo(0, 1); // fluchtend (Mitte/Kanten in Linie: Tiefe 3 = 3)
    expect(s.rot).toBe(20);
    // q (33°) neben n: kein Fang
    await drag(page, { x: 20, y: -10 }, ax(2 + 1.5 + 0.4, 0), { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"]')).toHaveCount(0);
    await page.mouse.up();
  });

  test('Raster fängt nur bei eingeblendetem Raster; Nachbar hat Vorrang vor dem näheren Raster', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'n', cx: 0, cy: 0, w: 3, d: 3 }, { id: 's', cx: 10.33, cy: 10.33, w: 3, d: 3 }] });
    await page.keyboard.press('Shift+R'); // Raster-Fang an
    // Raster ausblenden (neue Pages zeigen es an)
    if (await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].grid.visible)) await page.keyboard.press(`${MOD}+'`);
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].grid.visible)).toBe(false);
    // Raster ausgeblendet: kein Rasterfang
    await drag(page, { x: 10.33, y: 10.33 }, { x: 10.33 + 0.5, y: 10.33 + 0.5 }, { steps: 4 });
    expect(await standById(page, 's')).toMatchObject({ cx: 10.83, cy: 10.83 });
    // Raster einblenden
    await page.keyboard.press(`${MOD}+'`);
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].grid.visible)).toBe(true);
    const size = await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].grid.size);
    expect(size).toBe(1);
    await drag(page, { x: 10.83, y: 10.83 }, { x: 10.83 + 0.5, y: 10.83 + 0.5 }, { steps: 4 });
    // Rand oder Mitte an der nächsten Rasterlinie: Mitte 11,33 → 11,5 (Rand 9,83 → 10 bzw. 12,83 → 13)
    let s = await standById(page, 's');
    expect([s.cx % 0.5, s.cy % 0.5].map((v) => Math.min(v, 0.5 - v))).toEqual([0, 0]);
    // Nachbar vs. Raster: s so ziehen, dass seine linke Kante 0,6 m rechts von n liegt (Nachbar, 6 px)
    // und seine Mitte 0,2 m neben einer Rasterlinie (näher) → Nachbar gewinnt
    await drag(page, { x: s.cx, y: s.cy }, { x: 1.5 + 0.6 + 1.5, y: 0.2 }, { steps: 12 });
    s = await standById(page, 's');
    expect(s.cx).toBeCloseTo(3, 5);
  });

  test('Vorderkante hat Vorrang vor Nachbarstand', async ({ page }) => {
    await openApp(page);
    // Nachbar steht schräg vor der Vorderseite von G? Nein: Nachbar parallel, aber um 1 m nach hinten versetzt.
    await seed(page, { areas: [G], stands: [inG('n', 10, 13, 0.5, 3.5), inG('s', 20, 23, 5, 8)] });
    // s neben n schieben: Vorderseite 0,4 m von der Vorderseite von G, 0,1 m von der Flucht mit n
    await drag(page, { x: -3.5, y: -6.5 }, { x: -10.5, y: -1.5 - 0.4 }, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="front"]')).toHaveCount(1);
    await page.mouse.up();
    const s = await standById(page, 's');
    expect(s.cy).toBeCloseTo(-1.5, 5); // an der Vorderseite, nicht in der Flucht von n (−2)
  });

  test('Mehrfachauswahl: Fang am gegriffenen Stand, Gruppe nur parallel verschoben, nicht gedreht', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('a', 10, 13, 2, 5), inG('b', 20, 23, 3, 6)] });
    await clickAt(page, { x: -13.5, y: -3.5 });
    await page.keyboard.down('Shift');
    await clickAt(page, { x: -3.5, y: -4.5 });
    await page.keyboard.up('Shift');
    expect((await selIds(page)).toSorted()).toEqual(['a', 'b']);
    // a greifen, 1,6 m Richtung Vorderseite → Vorderseite von a 0,4 m entfernt → rastet ein
    await drag(page, { x: -13.5, y: -3.5 }, { x: -13.5, y: -1.9 });
    const a = await standById(page, 'a');
    const b = await standById(page, 'b');
    expect(a.cy).toBeCloseTo(-1.5, 5);
    expect(b.cy - a.cy).toBeCloseTo(-1, 5); // Abstand der Gruppe unverändert
    expect(b.cx - a.cx).toBeCloseTo(10, 5);
    // Gedrehte Gruppe rastet nicht an einer Vorderseite mit anderer Drehung ein (würde sonst drehen)
    await page.locator('#sb-rot').fill('10');
    await page.locator('#sb-rot').press('Enter');
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await clickAt(page, { x: -13.5, y: -1.5 });
    await page.keyboard.down('Shift');
    await clickAt(page, { x: -3.5, y: -4.5 });
    await page.keyboard.up('Shift');
    await drag(page, { x: -13.5, y: -1.5 }, { x: -13.5, y: -4 });
    expect((await stands(page)).map((x) => x.rot)).toEqual([10, 10]);
  });

  test('Cmd/Strg während des Ziehens schaltet den Fang sofort aus und beim Loslassen wieder an', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 's', cx: 0, cy: -7, w: 3, d: 3, rot: 17 }] });
    await drag(page, { x: 0, y: -7 }, { x: 0, y: -1.9 }, { keepDown: true });
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects?.s?.rot)).toBe(0);
    await page.keyboard.down(MOD);
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects?.s?.rot)).toBe(17);
    await expect(page.locator('[data-testid="snap-guides"]')).toHaveCount(0);
    await page.keyboard.up(MOD);
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects?.s?.rot)).toBe(0);
    await page.mouse.up();
    expect(await standById(page, 's')).toMatchObject({ cy: -1.5, rot: 0 });
  });

  test('Shift: eingerastet bleibt der Stand an der Vorderseite, nicht eingerastet nur 0°/45°/90°', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 's', cx: 0, cy: -7, w: 3, d: 3, rot: 17 }] });
    await drag(page, { x: 0, y: -7 }, { x: 0, y: -1.9 }, { keepDown: true });
    await page.keyboard.down('Shift');
    await moveTo(page, { x: 6, y: -8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await standById(page, 's')).toMatchObject({ cx: 6, cy: -1.5, rot: 0 });
    // ohne Einrasten (Fang aus per Umschalter): 45°
    await page.keyboard.press('Shift+F');
    await drag(page, { x: 6, y: -1.5 }, { x: 10, y: -5 }, { keepDown: true });
    await page.keyboard.down('Shift');
    await moveTo(page, { x: 10.2, y: -5.3 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const s = await standById(page, 's');
    expect(Math.abs(s.cx - 6)).toBeCloseTo(Math.abs(s.cy + 1.5), 1);
  });
});

// =============================================================================================
test.describe('QA M4-20/M3-21: Esc bricht jede Kombination ab', () => {
  const cases: { name: string; hold: string[]; during?: string[] }[] = [
    { name: 'ohne Taste', hold: [] },
    { name: 'Alt gehalten (Kopie sichtbar)', hold: ['Alt'] },
    { name: 'Cmd/Strg gehalten', hold: [MOD] },
    { name: 'Shift während des Ziehens', hold: [], during: ['Shift'] },
    { name: 'Alt + Cmd/Strg + Shift', hold: ['Alt', MOD], during: ['Shift'] },
  ];
  for (const c of cases) {
    test(`Verschieben: ${c.name}`, async ({ page }) => {
      await openApp(page);
      await seed(page, { areas: [G], stands: [inG('s1', 20, 28), inG('s2', 30, 33)] });
      const n0 = await pastLen(page);
      const before = JSON.stringify(await activePg(page));
      await drag(page, { x: -1, y: -1.5 }, { x: 4, y: -6 }, { hold: c.hold, keepDown: true });
      for (const k of c.during ?? []) await page.keyboard.down(k);
      await moveTo(page, { x: 5, y: -6 }, 3);
      expect(await hasPreview(page)).toBe(true);
      await page.keyboard.press('Escape');
      expect(await hasPreview(page)).toBe(false);
      await expect(page.locator('[data-testid="snap-guides"]')).toHaveCount(0);
      // Mausbewegung nach Esc bewegt nichts mehr, Loslassen übernimmt nichts
      await moveTo(page, { x: 8, y: -3 }, 3);
      expect(await hasPreview(page)).toBe(false);
      await page.mouse.up();
      for (const k of [...(c.during ?? []), ...c.hold]) await page.keyboard.up(k);
      expect(JSON.stringify(await activePg(page))).toBe(before);
      expect(await pastLen(page)).toBe(n0);
      await expect(page.locator('.stand')).toHaveCount(2);
      await expectConsistent(page);
      // Erst das zweite Esc hebt die Auswahl auf
      expect(await selIds(page)).toEqual(['s1']);
      await page.keyboard.press('Escape');
      expect(await selIds(page)).toEqual([]);
    });
  }

  test('Drehen mit Shift, Größe ändern, Auswahlrechteck, Aufziehen mit dem Geschäfts-Werkzeug', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    const n0 = await pastLen(page);
    const before = JSON.stringify(await activePg(page));
    // Drehen mit Shift
    await clickAt(page, { x: -1, y: -1.5 });
    const h = await page.getByTestId('rotate-handle').boundingBox();
    await page.mouse.move(h!.x + 5, h!.y + 5);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(h!.x + 80, h!.y + 60, { steps: 8 });
    expect(await hasPreview(page)).toBe(true);
    await expectConsistent(page);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    // Größe der Grundfläche
    await clickAt(page, { x: -20, y: -8 });
    const hb = await page.locator('.resize-handle[data-handle="1,0"]').boundingBox();
    await page.mouse.move(hb!.x + 4, hb!.y + 4);
    await page.mouse.down();
    await page.mouse.move(hb!.x + 100, hb!.y + 4, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    // Auswahlrechteck
    await page.keyboard.press('Escape');
    await drag(page, { x: -40, y: 20 }, { x: 40, y: -20 }, { keepDown: true });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await selIds(page)).toEqual([]);
    // Geschäfts-Werkzeug aufziehen
    await page.keyboard.press('g');
    await drag(page, { x: 10, y: 10 }, { x: 16, y: 14 }, { keepDown: true });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(JSON.stringify(await activePg(page))).toBe(before);
    expect(await pastLen(page)).toBe(n0 + 0);
    await expectConsistent(page);
  });
});

// =============================================================================================
test.describe('QA M4-09/10/13/18: Warnungen und Zähler', () => {
  test('Toleranz Überlappung: bündig und genau 0,01 m keine Warnung, 0,02 m rot', async ({ page }) => {
    // (behoben 2026-10-11, test.fail entfernt) QA-M4-01: e/f (20,37 und 23,36, Tiefe 3) dringen genau 0,01 m ein und gelten als Überlappung (0,010000000000001563)
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 'a', cx: 0, cy: 0, w: 3, d: 3 },
        { id: 'b', cx: 3, cy: 0, w: 3, d: 3 }, // bündig
        { id: 'c', cx: 0, cy: 10, w: 3, d: 3 },
        { id: 'd', cx: 2.99, cy: 10, w: 3, d: 3 }, // 0,01 m
        { id: 'e', cx: 0, cy: 20.37, w: 3, d: 3 },
        { id: 'f', cx: 0, cy: 23.36, w: 3, d: 3 }, // 0,01 m senkrecht, krumme Werte
        { id: 'g', cx: 10.1, cy: 30, w: 2.2, d: 3 },
        { id: 'h', cx: 12.19, cy: 30, w: 2, d: 3 }, // 0,01 m
      ],
    });
    // Warnung „außerhalb“ abschalten, damit nur Überlappung zählt
    await openSettings(page); // M6-07: Warnungsschalter in den Projekteinstellungen
    await page.getByLabel('Warnung, wenn ein Geschäft außerhalb der Grundflächen steht').uncheck();
    await backToPage(page);
    await expect(page.locator('.stand[data-warning]')).toHaveCount(0);
    await expectBadge(page, '');
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('t', (p: any) => void (p.pages[0].stands.find((x: any) => x.id === 'b').cx = 2.98));
    });
    await expect(page.locator('.stand[data-warning="overlap"]')).toHaveCount(2);
    await expectBadge(page, '2 rot');
  });

  test('Toleranz „außerhalb“: 0,01 m überstehend keine Warnung, 0,02 m orange; gedrehter Stand mit überstehender Ecke', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [G],
      stands: [inG('ok', 0, 3, 0, 3), { id: 'vorn1', cx: -10, cy: -1.5 + 0.01, w: 3, d: 3 }, { id: 'vorn2', cx: -5, cy: -1.5 + 0.02, w: 3, d: 3 }],
    });
    await expect(page.locator('.stand[data-id="ok"]')).not.toHaveAttribute('data-warning', /.+/);
    await expect(page.locator('.stand[data-id="vorn1"]')).not.toHaveAttribute('data-warning', /.+/);
    await expect(page.locator('.stand[data-id="vorn2"]')).toHaveAttribute('data-warning', 'outside');
  });

  test('Gedrehter Stand (45°), dessen Ecke 0,013 m über die Vorderseite ragt, ist „außerhalb“', async ({ page }) => {
    // (behoben 2026-10-11, test.fail entfernt) QA-M4-02: Die Toleranz wird entlang der Standachsen abgezogen; eine Ecke darf so bis 0,0141 m herausragen
    await openApp(page);
    const half = 1.5 * Math.SQRT2;
    await seed(page, { areas: [G], stands: [{ id: 'ecke', cx: 10, cy: -half + 0.013, w: 3, d: 3, rot: 45 }] });
    await expect(page.locator('.stand[data-id="ecke"]')).toHaveAttribute('data-warning', 'outside', { timeout: 2000 });
  });

  test('Zähler am Tab nach Ziehen, Undo, Redo, Löschen, Duplizieren, Einfügen, Pfeiltasten, Maßen, Ignorieren', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('a', 10, 13), inG('b', 20, 23)] });
    await expectBadge(page, '');
    // Ziehen in Überlappung (Fang aus)
    await drag(page, { x: -3.5, y: -1.5 }, { x: -11.5, y: -1.5 }, { hold: [MOD] });
    await expectBadge(page, '2 rot');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expectBadge(page, '2 rot');
    // b ist ausgewählt; löschen
    await page.keyboard.press('Delete');
    await expectBadge(page, '');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '2 rot');
    await page.keyboard.press(`${MOD}+z`); // Ziehen zurück
    await expectBadge(page, '');
    // Duplizieren (1 m versetzt, überlappt)
    await clickAt(page, { x: -3.5, y: -1.5 });
    await page.keyboard.press(`${MOD}+d`);
    await expectBadge(page, '2 rot'); // Kopie ragt 1 m vorn heraus und überlappt b (rot hat Vorrang)
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '');
    // Einfügen
    await clickAt(page, { x: -3.5, y: -1.5 });
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await expectBadge(page, '2 rot');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '');
    // Pfeiltasten: b 1 m nach vorn (außerhalb)
    await clickAt(page, { x: -3.5, y: -1.5 });
    await page.keyboard.press('Shift+ArrowDown');
    await expectBadge(page, '1');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '');
    // Maße: b 20 m breit (überlappt a? nein: b s 20…23 → Mitte bleibt, Breite 12 → s 15,5…27,5)
    await page.locator('#sb-w').fill('12');
    await page.locator('#sb-w').press('Enter');
    await expectBadge(page, '');
    await page.locator('#sb-w').fill('21');
    await page.locator('#sb-w').press('Enter');
    await expectBadge(page, '2 rot');
    // Ignorieren an b: Zähler 1 (a bleibt rot)
    await page.getByLabel('Überlappung ignorieren').check();
    await expectBadge(page, '1 rot');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '2 rot');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expectBadge(page, '1 rot');
    // Tooltip mit Aufschlüsselung
    const tab = page.locator('header.tabbar [role="tab"][aria-selected="true"] [data-testid="warn-badge"]');
    await tab.hover();
    await expect(page.locator('.tooltip[role="tooltip"]')).toContainText('1 Warnung');
  });

  test('Ignorieren bei Mehrfachauswahl: ein Undo-Schritt; projektweit aus: markiert ungespeichert und ist rückgängig machbar', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: 0, cy: 0, w: 3, d: 3 }, { id: 'b', cx: 10, cy: 0, w: 3, d: 3 }] });
    await expectBadge(page, '2');
    await drag(page, { x: -10, y: -10 }, { x: 20, y: 10 });
    expect((await selIds(page)).toSorted()).toEqual(['a', 'b']);
    const n0 = await pastLen(page);
    await page.getByLabel('„außerhalb“ ignorieren').check();
    expect(await pastLen(page)).toBe(n0 + 1);
    await expectBadge(page, '');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '2');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expectBadge(page, '');
    await page.keyboard.press(`${MOD}+z`);
    // projektweit
    await page.keyboard.press('Escape');
    await openSettings(page); // M6-07
    await page.getByLabel('Warnung, wenn ein Geschäft außerhalb der Grundflächen steht').uncheck();
    await backToPage(page);
    await expectBadge(page, '');
    expect(await lastLabel(page)).toContain('ausschalten');
    await page.keyboard.press(`${MOD}+z`);
    await expectBadge(page, '2');
    await openSettings(page);
    await expect(page.getByLabel('Warnung, wenn ein Geschäft außerhalb der Grundflächen steht')).toBeChecked();
  });

  test('Zähler bleibt nach Speichern und Öffnen gleich (Ignorieren und Abschalten werden gespeichert)', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('a', 10, 13), inG('b', 12, 15), inG('c', 30, 33, 0, 12)] });
    await clickAt(page, { x: -13.5, y: -1.5 });
    await page.getByLabel('Überlappung ignorieren').check();
    await expectBadge(page, '2 rot');
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const file = await (await download).path();
    await page.keyboard.press(`${MOD}+n`);
    await confirmNewProject(page); // seit #1: Wahl der Kategorieliste
    await expect.poll(() => badge(page)).toBe('');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles(file);
    await expect.poll(() => badge(page, 1)).toBe('2 rot');
  });
});

// =============================================================================================
test.describe('QA M4-22: Dateiformat', () => {
  test('Version-1-Datei (echte M3-Datei) öffnen: migriert, Warnungen aktiv; Speichern schreibt Version 2', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles('tests/fixtures/format-v1-m3.schelme');
    await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages.reduce((n: number, p: any) => n + p.stands.length, 0))).toBe(500);
    const p = await page.evaluate(() => (window as any).__marktplanerStore.getState().project);
    expect(p.settings.warnOverlap).toBe(true);
    expect(p.pages.flatMap((x: any) => x.stands).every((s: any) => s.suppressOverlapWarning === false)).toBe(true);
    // geöffnet = unverändert (Migration ist kein Undo-Schritt)
    expect(await pastLen(page)).toBe(0);
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const file = await (await download).path();
    const { readFileSync } = await import('node:fs');
    const { unzipSync, strFromU8 } = await import('fflate');
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(file)))['project.json']!));
    expect(json.schemaVersion).toBe(10); // seit #5 Version 10, angepasst vom Entwickler (vorher 9, davor 8)
    expect(errors).toEqual([]);
  });

  test('Datei einer neueren Version wird mit deutscher Meldung abgewiesen, das offene Projekt bleibt', async ({ page }, info) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'x', cx: 0, cy: 0, w: 3, d: 3 }] });
    const dl = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    await dl;
    const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
    const files = unzipSync(new Uint8Array(readFileSync('tests/fixtures/format-v1-m3.schelme')));
    const json = JSON.parse(strFromU8(files['project.json']!));
    // Version 10 ist seit #5 die aktuelle; „neuer“ ist jetzt 11 (angepasst vom Entwickler, vorher 10 bzw. 9, siehe qa/M4.md, E-38)
    json.schemaVersion = 11;
    files['project.json'] = strToU8(JSON.stringify(json));
    mkdirSync('test-artifacts/qa-m4', { recursive: true });
    const path = `test-artifacts/qa-m4/format-v4-${info.project.name}.schelme`;
    writeFileSync(path, zipSync(files));
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles(path);
    await expect(page.getByText(/neueren Version von Marktplaner/)).toBeVisible();
    expect((await stands(page)).map((s) => s.id)).toEqual(['x']);
  });
});

// =============================================================================================
test.describe('QA M4: weitere Grenzfälle', () => {
  test('Ausgeblendete Ebenen fangen nicht (Grundflächen: keine Vorderkante, Geschäfte: kein Nachbar)', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 's', cx: 0, cy: -7, w: 3, d: 3, rot: 17 }, { id: 'n', cx: 30, cy: 10, w: 3, d: 3 }, { id: 'm', cx: 40, cy: 10, w: 3, d: 3 }] });
    await page.getByRole('button', { name: 'Grundflächen ausblenden' }).click();
    await drag(page, { x: 0, y: -7 }, { x: 0, y: -1.9 });
    expect(await standById(page, 's')).toMatchObject({ cx: 0, cy: -1.9, rot: 17 });
    await page.getByRole('button', { name: 'Grundflächen einblenden' }).click();
    // Nachbar-Fang: m an n (0,4 m Lücke) → bündig; mit ausgeblendeten Geschäften wäre m nicht ziehbar,
    // deshalb nur prüfen, dass der Fang bei sichtbaren Ständen greift (Gegenprobe zu oben)
    await drag(page, { x: 40, y: 10 }, { x: 33.4, y: 10 });
    expect((await standById(page, 'm')).cx).toBeCloseTo(33, 5);
  });

  test('M4-19: Schlüssel einer Freifläche bleibt, solange dieselben Stände die Lücke begrenzen', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 10, 13), inG('s2', 20, 23)] });
    await expect(page.locator('.free-space[data-key="G|s1|s2"]')).toHaveCount(1);
    await expect(page.locator('.free-space[data-key="G|^|s1"]')).toHaveCount(1);
    await expect(page.locator('.free-space[data-key="G|s2|$"]')).toHaveCount(1);
    await drag(page, { x: -3.5, y: -1.5 }, { x: -1.5, y: -1.5 }, { hold: [MOD] });
    await expect(page.locator('.free-space[data-key="G|s1|s2"]')).toHaveCount(1);
    await expect(freeLabels(page)).toHaveText(['Frei 10 × 10 m', 'Frei 9 × 10 m', 'Frei 25 × 10 m']);
  });

  test('Esc bricht auch das Verschieben des Hintergrunds ab (spec Allgemein, QA-M3-01)', async ({ page }) => {
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+Shift+P`);
    await (await chooser).setFiles('tests/fixtures/raster-10m.png');
    await expect(page.getByTestId('bg-scale')).toBeVisible();
    const t0 = await page.evaluate(() => JSON.stringify((window as any).__marktplanerStore.getState().project.pages[0].background.transform));
    const n0 = await pastLen(page);
    const b0 = (await page.locator('.background-layer image').first().boundingBox())!;
    await page.mouse.move(b0.x + 200, b0.y + 200);
    await page.mouse.down();
    await page.mouse.move(b0.x + 260, b0.y + 230, { steps: 4 });
    expect(await page.evaluate(() => JSON.stringify((window as any).__marktplanerStore.getState().project.pages[0].background.transform))).not.toBe(t0);
    // (behoben 2026-10-11, test.fail entfernt) QA-M4-04: Esc wird nicht als Abbruch behandelt (useSelectTool.tsx: Geste „background“ gibt false zurück)
    await page.keyboard.press('Escape');
    await page.mouse.move(b0.x + 300, b0.y + 260, { steps: 3 });
    await page.mouse.up();
    expect(await page.evaluate(() => JSON.stringify((window as any).__marktplanerStore.getState().project.pages[0].background.transform))).toBe(t0);
    expect(await pastLen(page)).toBe(n0);
  });

  test('Esc bricht das Ziehen ab, auch wenn vorher ein Zahlenfeld den Fokus hatte', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    await clickAt(page, { x: -1, y: -1.5 });
    await page.locator('#sb-w').fill('8');
    await page.locator('#sb-w').press('Enter');
    const n0 = await pastLen(page);
    const before = JSON.stringify(await activePg(page));
    await drag(page, { x: -1, y: -1.5 }, { x: 6, y: -1.5 }, { keepDown: true });
    expect(await hasPreview(page)).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(JSON.stringify(await activePg(page))).toBe(before);
    expect(await pastLen(page)).toBe(n0);
  });

  test('Fang-Umschalter: Tooltips mit Shortcut, Zustand wird mitgespeichert', async ({ page }) => {
    await openApp(page);
    const toggles = page.locator('.toolbar .tool.toggle');
    await page.mouse.move(5, 790);
    await toggles.nth(0).hover();
    await expect(page.locator('.tooltip[role="tooltip"]')).toContainText(/⇧F|(Shift|Umschalt)\+F/);
    await expect(page.locator('.tooltip[role="tooltip"]')).toContainText('Vorderkante');
    await page.keyboard.press('Shift+F');
    await page.keyboard.press('Shift+R');
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const file = await (await download).path();
    const { readFileSync } = await import('node:fs');
    const { unzipSync, strFromU8 } = await import('fflate');
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(file)))['project.json']!));
    expect(json.project.settings.snap).toEqual({ front: false, grid: true, neighbors: true });
  });
});
