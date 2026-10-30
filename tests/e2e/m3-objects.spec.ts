import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { canvasBox, collectErrors, MOD, openApp, origin, scale, openSettings, backToPage } from './helpers';

/**
 * M3: Grundflächen, Geschäfte, Seitenleiste, Steuerungsleiste, Beschriftung, Mehrfachauswahl,
 * Kopieren/Einfügen, Pfeiltasten, Ebenen, Kategorien, Messfang.
 * Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px.
 */

type P = { x: number; y: number };
const store = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const activePage = async (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    return s.project.pages.find((p: any) => p.id === s.ui.activePage);
  });
const pastLen = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
const selection = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().ui.selection);

/** Weltpunkt (m) → Seitenkoordinate (px). */
async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

async function drag(page: Page, from: P, to: P, opts: { shift?: boolean; steps?: number } = {}) {
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 12 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

/** Legt Objekte direkt im Store an (ein Undo-Schritt) und gibt ihre IDs zurück. */
async function seed(page: Page, objs: { areas?: any[]; stands?: any[]; categories?: any[] }) {
  await page.evaluate((o) => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false };
    s.change('Testdaten', (p: any) => {
      const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
      for (const a of o.areas ?? []) pg.areas.push({ name: '', rot: 0, ...a });
      for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, ...st });
      for (const c of o.categories ?? []) p.categories.push(c);
    });
  }, objs);
}

const fieldValue = (page: Page, id: string) => page.locator(`#${id}`).inputValue();
async function fillField(page: Page, id: string, value: string) {
  await page.locator(`#${id}`).fill(value);
  await page.locator(`#${id}`).press('Enter');
}

test.describe('M3: Anlegen', () => {
  test('M3-02: Grundfläche aufziehen; Klick legt 20 × 8 m an; je ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.keyboard.press('f');
    await drag(page, await w2s(page, { x: -10, y: -5 }), await w2s(page, { x: 20, y: 5 }));
    let pg = await activePage(page);
    expect(pg.areas).toHaveLength(1);
    expect(pg.areas[0]).toMatchObject({ cx: 5, cy: 0, w: 30, d: 10, rot: 0 });
    // Werkzeug bleibt aktiv, neue Fläche ist ausgewählt
    expect((await store(page)).ui.tool).toBe('area');
    expect(await selection(page)).toEqual({ kind: 'objects', ids: [pg.areas[0].id] });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 30 })) as [number, number]));
    pg = await activePage(page);
    expect(pg.areas[1]).toMatchObject({ cx: 0, cy: 30, w: 20, d: 8 });
    expect(await pastLen(page)).toBe(2);
    await page.keyboard.press(`${MOD}+z`);
    expect((await activePage(page)).areas).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('M3-05: Geschäft per Klick 3 × 3 m, danach im zuletzt angelegten Maß', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('g');
    const p = await w2s(page, { x: 0, y: 0 });
    await page.mouse.click(p.x, p.y);
    expect((await activePage(page)).stands[0]).toMatchObject({ cx: 0, cy: 0, w: 3, d: 3, nr: '' });
    await drag(page, await w2s(page, { x: 10, y: 0 }), await w2s(page, { x: 14, y: 2.5 }));
    expect((await activePage(page)).stands[1]).toMatchObject({ w: 4, d: 2.5 });
    const q = await w2s(page, { x: -20, y: 10 });
    await page.mouse.click(q.x, q.y);
    expect((await activePage(page)).stands[2]).toMatchObject({ cx: -20, cy: 10, w: 4, d: 2.5 });
  });
});

test.describe('M3: Verschieben, Drehen, Undo', () => {
  test('M3-21: Ziehen eines Stands ist genau ein Undo-Schritt; Esc bricht ab', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    const n0 = await pastLen(page);
    await drag(page, await w2s(page, { x: 0, y: 0 }), await w2s(page, { x: 10, y: 5 }), { steps: 30 });
    expect((await activePage(page)).stands[0]).toMatchObject({ cx: 10, cy: 5 });
    expect(await pastLen(page)).toBe(n0 + 1);
    // Esc während des Ziehens
    const from = await w2s(page, { x: 10, y: 5 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + 40, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await activePage(page)).stands[0]).toMatchObject({ cx: 10, cy: 5 });
    expect(await pastLen(page)).toBe(n0 + 1);
    await page.keyboard.press(`${MOD}+z`);
    expect((await activePage(page)).stands[0]).toMatchObject({ cx: 0, cy: 0 });
  });

  test('M3-06: Drehgriff dreht; Shift rastet in 15°-Schritten ein; ein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 6, d: 4 }] });
    const c = await w2s(page, { x: 0, y: 0 });
    await page.mouse.click(c.x, c.y);
    const handle = (await page.getByTestId('rotate-handle').boundingBox())!;
    const h = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    const n0 = await pastLen(page);
    // Griff auf ca. 40° rechts herum führen, mit Shift → 45°
    const r = Math.hypot(h.x - c.x, h.y - c.y);
    const a = (-90 + 40) * (Math.PI / 180);
    await drag(page, h, { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }, { shift: true, steps: 20 });
    expect((await activePage(page)).stands[0].rot).toBe(45);
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await fieldValue(page, 'cb-rot')).toBe('45');
    // Ohne Shift: ganze Grad
    const handle2 = (await page.getByTestId('rotate-handle').boundingBox())!;
    const h2 = { x: handle2.x + handle2.width / 2, y: handle2.y + handle2.height / 2 };
    const b = (-90 + 45 + 22) * (Math.PI / 180);
    await drag(page, h2, { x: c.x + r * Math.cos(b), y: c.y + r * Math.sin(b) });
    const rot = (await activePage(page)).stands[0].rot;
    expect(Number.isInteger(rot)).toBe(true);
    expect(rot % 15).not.toBe(0);
  });

  test('M3-11/M3-10: Beschriftung bleibt bei 37° horizontal, feste Schriftgröße, nichts gekürzt', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 2, d: 2, rot: 37, nr: '12', name: 'Sehr lange Bäckerei Wenz' }] });
    const label = page.locator('.stand-label[data-id="s1"]');
    // Seit #9 umbrochen und neben dem Stand: Inhalt vollständig, verglichen unabhängig vom Umbruch (angepasst vom Entwickler)
    expect((await label.locator('tspan').allTextContents()).join(' ')).toBe('12 Sehr lange Bäckerei Wenz 2×2 m');
    expect(await label.getAttribute('transform')).toBeNull();
    const ys = await label.locator('tspan').evaluateAll((els) => els.map((e) => e.getAttribute('y')));
    const xs = await label.locator('tspan').evaluateAll((els) => els.map((e) => e.getAttribute('x')));
    expect(new Set(xs).size).toBe(1); // alle Zeilen mittig übereinander
    expect(ys.length).toBeGreaterThanOrEqual(3);
    // Text ragt über den 2-m-Stand hinaus (nicht gekürzt)
    const lb = (await label.boundingBox())!;
    expect(lb.width).toBeGreaterThan(2 * (await scale(page)));
    // Schriftgröße skaliert mit dem Zoom
    const h1 = lb.height;
    await page.keyboard.press(`${MOD}+Equal`);
    const h2 = (await label.boundingBox())!.height;
    expect(h2 / h1).toBeCloseTo(1.25, 1);
  });
});

test.describe('M3: Grundfläche', () => {
  test('M3-03: Vorderseite per Kantenklick; die Fläche bleibt optisch exakt an derselben Stelle', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 30, d: 10, rot: 20 }] });
    const poly = page.locator('.area[data-id="a1"] .area-body');
    const pointsSet = async () =>
      ((await poly.getAttribute('points')) ?? '')
        .split(' ')
        .map((p) => p.split(',').map((n) => Math.round(Number(n) * 100) / 100).join(','))
        .toSorted();
    const front = async () => page.locator('.area[data-id="a1"] .area-front').evaluate((l) => ['x1', 'y1', 'x2', 'y2'].map((a) => Number(l.getAttribute(a))));
    const before = await pointsSet();
    const front0 = await front();
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    const box0 = (await poly.boundingBox())!; // nach dem Auswählen (Auswahl ändert die Linienbreite)
    // Rechte Kante (lokal x = +15) anklicken
    const rightMid = await w2s(page, { x: 15 * Math.cos((20 * Math.PI) / 180), y: 15 * Math.sin((20 * Math.PI) / 180) });
    await page.mouse.move(rightMid.x, rightMid.y);
    await page.mouse.click(rightMid.x, rightMid.y);
    const a = (await activePage(page)).areas[0];
    expect(a).toMatchObject({ cx: 0, cy: 0, w: 10, d: 30 });
    expect(await pointsSet()).toEqual(before);
    const box1 = (await poly.boundingBox())!;
    expect(box1.x).toBeCloseTo(box0.x, 0);
    expect(box1.width).toBeCloseTo(box0.width, 0);
    expect(await front()).not.toEqual(front0);
    expect(await fieldValue(page, 'cb-w')).toBe('10');
    // Kantenwähler in der Seitenleiste
    await page.getByRole('group', { name: 'Vorderseite wählen' }).getByRole('button').first().click();
    expect(await pointsSet()).toEqual(before);
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    expect((await activePage(page)).areas[0]).toMatchObject({ w: 30, d: 10, rot: 20 });
  });

  test('M3-04: Beschriftung „Name · B × T m“ horizontal außerhalb vor der Vorderseite', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 30, d: 10, rot: 0, name: 'Nord' }], stands: [{ id: 's1', cx: 0, cy: 3, w: 4, d: 4 }] });
    const label = page.locator('.area-label[data-id="a1"]');
    await expect(label).toHaveText('Nord · 30 × 10 m');
    // getBoundingClientRect statt boundingBox(): Playwright-WebKit meldet für SVG-Text unter scale() eine falsche Lage
    const lb = await label.evaluate((el) => el.getBoundingClientRect().toJSON());
    const frontY = (await w2s(page, { x: 0, y: 5 })).y;
    expect(lb.y).toBeGreaterThan(frontY); // ganz unterhalb der Vorderkante, also außerhalb
  });

  test('M3-20: Größe per Griff, gegenüberliegende Ecke bleibt fest; ein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 20, d: 10 }] });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    const h = (await page.locator('.resize-handle[data-handle="1,1"]').boundingBox())!;
    const n0 = await pastLen(page);
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, await w2s(page, { x: 15, y: 10 }));
    expect((await activePage(page)).areas[0]).toMatchObject({ cx: 2.5, cy: 2.5, w: 25, d: 15 });
    expect(await pastLen(page)).toBe(n0 + 1);
  });

  test('M3-15: Ziehen auf nicht ausgewählter Grundfläche zieht ein Auswahlrechteck auf; ausgewählt verschiebt es sie', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [{ id: 'a1', cx: 0, cy: 0, w: 40, d: 20 }],
      stands: [
        { id: 's1', cx: -10, cy: 0, w: 3, d: 3 },
        { id: 's2', cx: -4, cy: 0, w: 3, d: 3 },
        { id: 's3', cx: 10, cy: 0, w: 3, d: 3 },
      ],
    });
    await drag(page, await w2s(page, { x: -14, y: -5 }), await w2s(page, { x: 0, y: 5 }));
    expect((await activePage(page)).areas[0]).toMatchObject({ cx: 0, cy: 0 });
    expect((await selection(page)).ids.toSorted()).toEqual(['s1', 's2']);
    // Auswählen, dann verschieben
    await page.keyboard.press('Escape');
    const inside = await w2s(page, { x: 3, y: 7 });
    await page.mouse.click(inside.x, inside.y);
    expect(await selection(page)).toEqual({ kind: 'objects', ids: ['a1'] });
    await drag(page, inside, await w2s(page, { x: 8, y: 7 }));
    expect((await activePage(page)).areas[0]).toMatchObject({ cx: 5, cy: 0 });
  });
});

test.describe('M3: Steuerungs- und Seitenleiste', () => {
  test('M3-12: X/Y/Breite in der Steuerungsleiste; je ein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    expect(await fieldValue(page, 'cb-x')).toBe('0');
    const n0 = await pastLen(page);
    await fillField(page, 'cb-x', '12,5');
    await fillField(page, 'cb-w', '6.25');
    expect((await activePage(page)).stands[0]).toMatchObject({ cx: 12.5, w: 6.25 });
    expect(await pastLen(page)).toBe(n0 + 2);
  });

  test('M3-12/M3-13: Mehrfachauswahl – unterschiedliche Werte leer, Eingabe gilt für alle', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3, ware: 'Imbiss' },
        { id: 's2', cx: 10, cy: 0, w: 5, d: 3, ware: 'Süßwaren' },
      ],
    });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    await page.keyboard.down('Shift');
    await page.mouse.click(...(Object.values(await w2s(page, { x: 10, y: 0 })) as [number, number]));
    await page.keyboard.up('Shift');
    expect((await selection(page)).ids).toEqual(['s1', 's2']);
    expect(await fieldValue(page, 'cb-w')).toBe('');
    expect(await fieldValue(page, 'cb-d')).toBe('3');
    expect(await fieldValue(page, 'sb-w')).toBe('');
    expect(await fieldValue(page, 'st-ware')).toBe('');
    await fillField(page, 'cb-w', '6');
    await fillField(page, 'st-ware', 'Kunsthandwerk');
    const st = (await activePage(page)).stands;
    expect(st.map((s: any) => [s.w, s.ware])).toEqual([
      [6, 'Kunsthandwerk'],
      [6, 'Kunsthandwerk'],
    ]);
    await expect(page.locator('#cb-w')).toHaveValue('6');
  });

  test('M3-07: Attribute in der Seitenleiste; Name ist ein Undo-Schritt und erscheint in der Beschriftung', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    const n0 = await pastLen(page);
    await page.locator('#st-name').fill('Bäckerei Wenz');
    expect(await pastLen(page)).toBe(n0); // kein Schritt pro Taste
    await page.locator('#st-name').press('Enter');
    await fillField(page, 'st-nr', '7');
    await fillField(page, 'st-owner', 'Jonas Wenz');
    await fillField(page, 'st-power', '11');
    await page.locator('#st-conn').selectOption('CEE32');
    await page.locator('#st-note').fill('Zugang hinten');
    await page.locator('#st-note').blur();
    expect((await activePage(page)).stands[0]).toMatchObject({ name: 'Bäckerei Wenz', nr: '7', owner: 'Jonas Wenz', powerKw: 11, connection: 'CEE32', note: 'Zugang hinten' });
    expect(await pastLen(page)).toBe(n0 + 6);
    // Seit #9 auf die Standbreite umbrochen: verglichen unabhängig vom Umbruch (angepasst vom Entwickler)
    await expect.poll(async () => (await page.locator('.stand-label[data-id="s1"] tspan').allTextContents()).join(' ')).toBe('7 Bäckerei Wenz 4×3 m');
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 6; i++) await page.keyboard.press(`${MOD}+z`);
    expect((await activePage(page)).stands[0]).toMatchObject({ name: '', nr: '', powerKw: 0, connection: null });
  });

  test('M3-09: Beschriftungsvorlage und Schriftgröße sind projektweit', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3, nr: '3', name: 'X', powerKw: 16 }] });
    await openSettings(page); // M6-07: Beschriftung in den Projekteinstellungen
    await page.locator('#label-template').fill('{nr} · {name}\n{strom} kW\n{anschluss}');
    await page.locator('#label-template').press(`${MOD}+Enter`);
    await fillField(page, 'label-size', '1,2');
    await backToPage(page);
    await expect(page.locator('.stand-label[data-id="s1"] tspan')).toHaveText(['3 · X', '16 kW']);
    expect((await store(page)).project.settings.labelFontSize).toBe(1.2);
  });

  test('M3-08/M3-19: Kategorie anlegen, zuordnen, eigene Farbe; Löschen mit Rückfrage', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    const fill = () => page.locator('.stand[data-id="s1"]').getAttribute('fill');
    expect(await fill()).toBe('#a7adb3');
    await openSettings(page); // M6-07: Kategorien in den Projekteinstellungen
    await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
    const cat = (await store(page)).project.categories[0];
    await page.locator(`#cat-name-${cat.id}`).fill('Imbiss');
    await page.locator(`#cat-name-${cat.id}`).press('Enter');
    await backToPage(page);
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    await page.locator('#st-cat').selectOption({ label: 'Imbiss' });
    expect(await fill()).toBe(cat.color);
    await page.getByRole('group', { name: 'Eigene Farbe' }).getByRole('button', { name: 'Farbe #ffffff' }).click();
    expect(await fill()).toBe('#ffffff');
    await page.getByRole('button', { name: /Eigene Farbe entfernen/ }).click();
    expect(await fill()).toBe(cat.color);
    // Löschen: Rückfrage, Stand verliert die Kategorie
    await page.keyboard.press('Escape');
    await openSettings(page);
    await page.getByRole('button', { name: 'Kategorie „Imbiss“ löschen' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('1 Geschäft');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await backToPage(page);
    expect(await fill()).toBe('#a7adb3');
    expect((await activePage(page)).stands[0].categoryId).toBeNull();
    await page.keyboard.press(`${MOD}+z`);
    expect(await fill()).toBe(cat.color);
  });
});

test.describe('M3: Auswahl, Kopieren, Tastatur', () => {
  test('M3-16/M3-17: Duplizieren, Kopieren/Einfügen über Pages, Pfeiltasten, Entf', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3, nr: '5', name: 'A' }] });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    await page.keyboard.press(`${MOD}+d`);
    let st = (await activePage(page)).stands;
    expect(st[1]).toMatchObject({ cx: 1, cy: 1, nr: '', name: 'A' });
    // Pfeiltasten: 0,1 m bzw. 1 m; jeder Druck ein Undo-Schritt (QA-M3-05), gehalten einer
    const n0 = await pastLen(page);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    st = (await activePage(page)).stands;
    expect(st[1]).toMatchObject({ cx: 1.5, cy: 2 });
    expect(await pastLen(page)).toBe(n0 + 6);
    // Kopieren und auf neuer Page einfügen: gleiche Position
    await page.keyboard.press(`${MOD}+c`);
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+v`);
    st = (await activePage(page)).stands;
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ cx: 1.5, cy: 2, nr: '' });
    await page.keyboard.press('Delete');
    expect((await activePage(page)).stands).toHaveLength(0);
    await page.keyboard.press(`${MOD}+z`);
    expect((await activePage(page)).stands).toHaveLength(1);
    await page.mouse.click(...(Object.values(await w2s(page, { x: 1.5, y: 2 })) as [number, number]));
    await page.keyboard.press('Backspace');
    expect((await activePage(page)).stands).toHaveLength(0);
  });

  test('M3-15: Cmd/Strg+A wählt alles; Shift+Auswahlrechteck ergänzt; Esc hebt auf', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 's1', cx: -10, cy: 0, w: 3, d: 3 },
        { id: 's2', cx: 0, cy: 0, w: 3, d: 3 },
        { id: 's3', cx: 10, cy: 0, w: 3, d: 3 },
      ],
    });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    expect((await selection(page)).ids).toHaveLength(3);
    await page.keyboard.press('Escape');
    expect(await selection(page)).toBeNull();
    await page.mouse.click(...(Object.values(await w2s(page, { x: -10, y: 0 })) as [number, number]));
    await drag(page, await w2s(page, { x: 7, y: -3 }), await w2s(page, { x: 13, y: 3 }), { shift: true });
    expect((await selection(page)).ids.toSorted()).toEqual(['s1', 's3']);
    // Mehrfachauswahl gemeinsam ziehen
    await drag(page, await w2s(page, { x: -10, y: 0 }), await w2s(page, { x: -10, y: 5 }));
    expect((await activePage(page)).stands.map((s: any) => s.cy)).toEqual([5, 0, 5]);
  });

  test('Kopieren/Einfügen in Textfeldern gehört dem Feld', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    await page.locator('#st-name').fill('Abc');
    await page.locator('#st-name').press(`${MOD}+a`);
    await page.locator('#st-name').press('Backspace');
    expect(await page.locator('#st-name').inputValue()).toBe('');
    await page.locator('#st-name').press(`${MOD}+d`);
    expect((await activePage(page)).stands).toHaveLength(1);
  });
});

test.describe('M3: Ebenen, Messen, Speichern', () => {
  test('M3-14: Ebenen erscheinen mit Objekten; gesperrt nicht auswählbar, ausgeblendet unsichtbar; kein Undo-Schritt', async ({ page }) => {
    await openApp(page);
    const layers = page.getByRole('region', { name: 'Ebenen' });
    await expect(layers).toContainText('Ebenen erscheinen, sobald es Objekte gibt.');
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 30, d: 10 }], stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    // Seit M4 erscheint mit den Grundflächen auch die Ebene Freiflächen (M4-02); seit M7 die Ebene Blatt (angepasst vom Entwickler)
    await expect(layers.locator('.layer-name')).toHaveText(['Grundflächen', 'Freiflächen', 'Geschäfte', 'Beschriftung', 'Blatt']);
    const n0 = await pastLen(page);
    await page.getByRole('button', { name: 'Geschäfte sperren' }).click();
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    expect(await selection(page)).toEqual({ kind: 'objects', ids: ['a1'] });
    await page.getByRole('button', { name: 'Beschriftung ausblenden' }).click();
    await expect(page.locator('.stand-label')).toHaveCount(0);
    await page.getByRole('button', { name: 'Grundflächen ausblenden' }).click();
    await expect(page.locator('.area')).toHaveCount(0);
    expect(await selection(page)).toBeNull();
    expect(await pastLen(page)).toBe(n0);
  });

  test('M3-18: Messwerkzeug fängt an Ecken eines gedrehten Stands (genau 8 m)', async ({ page }) => {
    await openApp(page);
    const rot = 30;
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 8, d: 3, rot }] });
    const r = (rot * Math.PI) / 180;
    const corner = (sx: number, sy: number) => ({ x: sx * 4 * Math.cos(r) - sy * 1.5 * Math.sin(r), y: sx * 4 * Math.sin(r) + sy * 1.5 * Math.cos(r) });
    await page.keyboard.press('m');
    const a = await w2s(page, corner(-1, 1));
    const b = await w2s(page, corner(1, 1));
    await page.mouse.click(a.x + 3, a.y - 2);
    await page.mouse.move(b.x - 2, b.y + 3);
    await page.mouse.click(b.x - 2, b.y + 3);
    await expect(page.locator('.measure-label')).toHaveText('8 m');
  });

  test('M3-01: Speichern enthält Grundflächen, Geschäfte und Kategorien mit gerundeten Werten', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('g');
    await drag(page, await w2s(page, { x: 0.04, y: 0.02 }), await w2s(page, { x: 3.33, y: 2.71 }));
    await page.keyboard.press('v');
    await openSettings(page); // M6-07
    await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const files = unzipSync(new Uint8Array(readFileSync(await (await download).path())));
    const project = JSON.parse(strFromU8(files['project.json']!)).project;
    const st = project.pages[0].stands[0];
    for (const v of [st.cx, st.cy, st.w, st.d]) expect(Math.round(v * 100) / 100).toBe(v);
    expect(project.categories).toHaveLength(1);
    expect(st).toHaveProperty('color', null);
  });
});
