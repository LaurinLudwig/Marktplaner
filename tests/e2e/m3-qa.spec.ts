import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { artifact, canvasBox, collectErrors, MOD, openApp, origin, scale, openSettings, backToPage, confirmNewProject } from './helpers';

/**
 * QA M3: unabhängige Prüfung von Grundflächen, Geschäften, Seiten-/Steuerungsleiste, Beschriftung,
 * Mehrfachauswahl, Undo/Redo, Rundung, Kategorien und Speichern/Neuladen. Schwerpunkt Grenzfälle.
 * Tests mit `test.fail` dokumentieren offene Befunde aus `qa/M3.md`; sie schlagen erwartungsgemäß fehl,
 * solange der Befund besteht. Nach der Behebung `test.fail` entfernen.
 */

type P = { x: number; y: number };
const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const pg = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    return s.project.pages.find((p: any) => p.id === s.ui.activePage);
  });
const pastLen = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
const selIds = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState().ui.selection;
    return s?.kind === 'objects' ? s.ids : [];
  });

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}
async function click(page: Page, p: P) {
  const s = await w2s(page, p);
  await page.mouse.click(s.x, s.y);
}
async function drag(page: Page, from: P, to: P, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

// suppressOverlapWarning (M4, Formatversion 2), suppressDuplicateWarning (M5, Formatversion 3), suppressInfraWarning (M7, Version 4) sowie shape und
// shapeTemplateId (M12, Version 8): Teil des Modells,
// nachgetragen vom Entwickler, siehe qa/M3.md
const BASE = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, shape: 'rect', shapeTemplateId: null };
async function seed(page: Page, objs: { areas?: any[]; stands?: any[]; categories?: any[] }) {
  await page.evaluate(
    ({ o, base }) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        const target = p.pages.find((x: any) => x.id === s.ui.activePage);
        for (const a of o.areas ?? []) target.areas.push({ name: '', rot: 0, ...a });
        for (const x of o.stands ?? []) target.stands.push({ ...base, rot: 0, ...x });
        for (const c of o.categories ?? []) p.categories.push(c);
      });
    },
    { o: objs, base: BASE },
  );
}

/** Weltkoordinaten der vier Ecken (wie src/core/geometry/rect.ts), sortiert, auf 1 mm gerundet. */
function corners(r: { cx: number; cy: number; w: number; d: number; rot: number }): string[] {
  const a = (r.rot * Math.PI) / 180;
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  )
    .map(([sx, sy]) => {
      const x = (sx * r.w) / 2;
      const y = (sy * r.d) / 2;
      return `${(r.cx + x * Math.cos(a) - y * Math.sin(a)).toFixed(3)},${(r.cy + x * Math.sin(a) + y * Math.cos(a)).toFixed(3)}`;
    })
    .toSorted();
}
/** Weltpunkt im lokalen System eines Rechtecks (lx, ly) → Weltkoordinate. */
function local(r: { cx: number; cy: number; rot: number }, lx: number, ly: number): P {
  const a = (r.rot * Math.PI) / 180;
  return { x: r.cx + lx * Math.cos(a) - ly * Math.sin(a), y: r.cy + lx * Math.sin(a) + ly * Math.cos(a) };
}

async function fill(page: Page, id: string, value: string) {
  await page.locator(`#${id}`).fill(value);
  await page.locator(`#${id}`).press('Enter');
}
const val = (page: Page, id: string) => page.locator(`#${id}`).inputValue();

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-03: Vorderseite wechseln bei gedrehten Flächen', () => {
  for (const rot of [33.3, 90, 147.5, 271.2]) {
    test(`Kantenklick (Kantenmitte und außerhalb der Mitte) bei ${rot}°: Ecken bleiben, Markierung wandert`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      const a0 = { id: 'a1', cx: 3.21, cy: -1.07, w: 32.45, d: 12.34, rot };
      await seed(page, { areas: [a0] });
      const ref = corners(a0);
      await click(page, { x: a0.cx, y: a0.cy });
      expect(await selIds(page)).toEqual(['a1']);
      const n0 = await pastLen(page);
      // 1) Klick auf die Mitte der rechten Kante (Griff)
      await click(page, local(a0, a0.w / 2, 0));
      let a = (await pg(page)).areas[0];
      expect(corners(a)).toEqual(ref);
      expect(a.w).toBeCloseTo(a0.d, 5);
      expect(a.d).toBeCloseTo(a0.w, 5);
      expect(await pastLen(page)).toBe(n0 + 1);
      // 2) Klick auf eine Kante außerhalb der Mitte (lokal: alte Oberkante, 1/4 vom Ende)
      const p2 = local(a0, -a0.w / 4, -a0.d / 2);
      await click(page, p2);
      a = (await pg(page)).areas[0];
      expect(corners(a)).toEqual(ref);
      expect(await pastLen(page)).toBe(n0 + 2);
      // 3) Gezeichnete Ecken (SVG) entsprechen den Ecken im Modell
      const pts = ((await page.locator('.area[data-id="a1"] .area-body').getAttribute('points')) ?? '')
        .split(' ')
        .map((s) => s.split(',').map((n) => Number(n).toFixed(3)).join(','))
        .toSorted();
      expect(pts).toEqual(ref);
      // Vorderseiten-Linie liegt jetzt auf der alten Oberkante (Mitte = lokal (0, -d/2) der Ausgangsfläche)
      const fl = await page.locator('.area[data-id="a1"] .area-front').evaluate((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k))));
      const mid = local(a0, 0, -a0.d / 2);
      expect((fl[0]! + fl[2]!) / 2).toBeCloseTo(mid.x, 2);
      expect((fl[1]! + fl[3]!) / 2).toBeCloseTo(mid.y, 2);
      // 4) Kantenwähler in der Seitenleiste: alle vier Knöpfe, Ecken unverändert
      for (let i = 0; i < 4; i++) {
        await page.getByRole('group', { name: 'Vorderseite wählen' }).getByRole('button').nth(i).click();
        expect(corners((await pg(page)).areas[0])).toEqual(ref);
      }
      // 5) Undo bis zum Anfang, Redo bis zum Ende: Ecken immer gleich
      await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
      const steps = (await pastLen(page)) - n0;
      expect(steps).toBe(5); // 2 Kantenklicks + 3 Kantenwähler (der aktuelle Vorderseiten-Knopf ändert nichts)
      for (let i = 0; i < steps; i++) await page.keyboard.press(`${MOD}+z`);
      a = (await pg(page)).areas[0];
      expect(a).toMatchObject({ w: a0.w, d: a0.d, rot: a0.rot });
      for (let i = 0; i < steps; i++) await page.keyboard.press(`${MOD}+Shift+z`);
      expect(corners((await pg(page)).areas[0])).toEqual(ref);
      expect(errors).toEqual([]);
    });
  }

  test('Ziehen an der Kantenmitte einer gedrehten Fläche ändert die Größe, gegenüberliegende Kante bleibt fest', async ({ page }) => {
    await openApp(page);
    const a0 = { id: 'a1', cx: 0, cy: 0, w: 30, d: 10, rot: 33.3 };
    await seed(page, { areas: [a0] });
    await click(page, { x: a0.cx, y: a0.cy });
    const n0 = await pastLen(page);
    // Rechte Kantenmitte 5 m weiter nach außen ziehen (entlang der lokalen x-Achse)
    await drag(page, await w2s(page, local(a0, 15, 0)), await w2s(page, local(a0, 20, 0)));
    const a = (await pg(page)).areas[0];
    expect(Math.abs(a.w - 35)).toBeLessThanOrEqual(0.1); // Maus auf ganze Pixel, 1 px = 0,1 m
    expect(a.d).toBe(10);
    expect(a.rot).toBeCloseTo(33.3, 9);
    // Linke Kante (lokal x = -15) unverändert (Toleranz 1 cm wegen Rundung)
    const left0 = local(a0, -15, 0);
    const left1 = local(a, -a.w / 2, 0);
    expect(Math.hypot(left1.x - left0.x, left1.y - left0.y)).toBeLessThanOrEqual(0.01);
    expect(await pastLen(page)).toBe(n0 + 1);
    // Die Vorderseite hat sich dabei NICHT geändert
    expect(a.w).toBeGreaterThan(a.d);
  });

  test('Größe per Griff bleibt in den Grenzen der Zahlenfelder (Grundfläche höchstens 2000 m)', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 1500, d: 100 }] });
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.setView(s.ui.activePage, { scale: 0.25, tx: 300, ty: 400 });
    });
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 300, box.y + 400);
    const h = (await page.locator('.resize-handle[data-handle="1,0"]').boundingBox())!;
    await drag(page, { x: h.x + 4, y: h.y + 4 }, { x: h.x + 600, y: h.y + 4 }, 10);
    expect((await pg(page)).areas[0].w).toBeLessThanOrEqual(2000);
  });

  test('Kante hat einen Tooltip „Als Vorderseite festlegen“; Vorderseite deutlich markiert (Screenshot)', async ({ page }) => {
    await openApp(page);
    const a0 = { id: 'a1', cx: 0, cy: 0, w: 30, d: 12, rot: 25, name: 'Obermarkt' };
    await seed(page, { areas: [a0] });
    await click(page, { x: a0.cx, y: a0.cy });
    const p = await w2s(page, local(a0, -8, -6));
    await page.mouse.move(p.x, p.y);
    const tip = page.locator('.tooltip[role="tooltip"]');
    await expect(tip).toContainText('Als Vorderseite festlegen', { timeout: 3000 });
    await page.screenshot({ path: artifact('m3-qa-front-hover.png') });
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-21: Undo/Redo pro Geste und Esc', () => {
  test('Esc während des Ziehens ändert nichts – auch nach einem Besuch der Start-Page', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    // Start-Page und zurück (die Zeichenfläche wird dabei neu aufgebaut)
    await page.keyboard.press('Alt+0');
    await expect(page.locator('svg.canvas')).toHaveCount(0);
    await page.keyboard.press('Alt+1');
    await expect(page.locator('svg.canvas')).toHaveCount(1);
    const n0 = await pastLen(page);
    const from = await w2s(page, { x: 0, y: 0 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + 40, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await pg(page)).stands[0]).toMatchObject({ cx: 0, cy: 0 });
    expect(await pastLen(page)).toBe(n0);
  });

  test('Esc nach einem Besuch der Start-Page: Aufziehen abbrechen und Messung löschen (M2-Regression)', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Alt+0');
    await page.keyboard.press('Alt+1');
    await expect(page.locator('svg.canvas')).toHaveCount(1);
    // Messung: Esc löscht sie (M2-10)
    await page.keyboard.press('m');
    await click(page, { x: 0, y: 0 });
    await click(page, { x: 10, y: 0 });
    await expect(page.locator('.measure-label')).toHaveCount(1);
    await page.keyboard.press('Escape');
    const measureGone = (await page.locator('.measure-label').count()) === 0;
    // Aufziehen mit dem Geschäfts-Werkzeug
    await page.keyboard.press('g');
    const a = await w2s(page, { x: -30, y: -20 });
    const b = await w2s(page, { x: -20, y: -10 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const created = (await pg(page)).stands.length;
    expect({ measureGone, created }).toEqual({ measureGone: true, created: 0 });
  });

  test('Esc nach einem Besuch der Start-Page bricht die Kalibrierung ab (M2-Regression)', async ({ page }) => {
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+Shift+p`);
    await (await chooser).setFiles(join(process.cwd(), 'tests', 'fixtures', 'raster-10m.png'));
    await expect(page.locator('[data-kind="background"]')).toHaveCount(1, { timeout: 10_000 });
    await page.keyboard.press('Alt+0');
    await page.keyboard.press('Alt+1');
    await page.keyboard.press('k');
    await click(page, { x: 0, y: 0 });
    await expect(page.locator('.calibrate-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.calibrate-overlay')).toHaveCount(0, { timeout: 1000 });
  });

  test('Esc während des Ziehens ändert nichts (ohne Seitenwechsel), auch Drehen, Größe, Aufziehen', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 20, w: 20, d: 8 }], stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    const n0 = await pastLen(page);
    const esc = async (from: P, to: P) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
    };
    // Verschieben
    await esc(await w2s(page, { x: 0, y: 0 }), await w2s(page, { x: 8, y: 4 }));
    // Drehen
    await click(page, { x: 0, y: 0 });
    const h = (await page.getByTestId('rotate-handle').boundingBox())!;
    await esc({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, await w2s(page, { x: 6, y: -3 }));
    // Größe (Grundfläche)
    await click(page, { x: 0, y: 20 });
    const g = (await page.locator('.resize-handle[data-handle="1,1"]').boundingBox())!;
    await esc({ x: g.x + 4, y: g.y + 4 }, await w2s(page, { x: 15, y: 30 }));
    // Aufziehen mit dem Geschäfts-Werkzeug
    await page.keyboard.press('g');
    await esc(await w2s(page, { x: -30, y: -20 }), await w2s(page, { x: -20, y: -10 }));
    const p = await pg(page);
    expect(p.stands).toHaveLength(1);
    expect(p.stands[0]).toMatchObject({ cx: 0, cy: 0, rot: 0 });
    expect(p.areas[0]).toMatchObject({ cx: 0, cy: 20, w: 20, d: 8 });
    expect(await pastLen(page)).toBe(n0);
  });

  test('Ziehen, Drehen, Aufziehen, Größe: je genau ein Schritt; Undo/Redo stellt exakt her', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 20, w: 20, d: 8, rot: 10 }], stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    const snap0 = JSON.stringify(await pg(page));
    const n0 = await pastLen(page);
    // Ziehen (viele Zwischenschritte)
    await drag(page, await w2s(page, { x: 0, y: 0 }), await w2s(page, { x: 7.3, y: 2.1 }), 40);
    expect(await pastLen(page)).toBe(n0 + 1);
    // Drehen
    const h = (await page.getByTestId('rotate-handle').boundingBox())!;
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, await w2s(page, { x: 15, y: -5 }), 40);
    expect(await pastLen(page)).toBe(n0 + 2);
    // Größe
    await click(page, { x: 0, y: 20 });
    const g = (await page.locator('.resize-handle[data-handle="-1,-1"]').boundingBox())!;
    await drag(page, { x: g.x + 4, y: g.y + 4 }, { x: g.x - 30, y: g.y - 20 }, 40);
    expect(await pastLen(page)).toBe(n0 + 3);
    // Aufziehen
    await page.keyboard.press('f');
    await drag(page, await w2s(page, { x: -40, y: -30 }), await w2s(page, { x: -20, y: -20 }), 40);
    expect(await pastLen(page)).toBe(n0 + 4);
    const snap4 = JSON.stringify(await pg(page));
    await page.keyboard.press('v');
    for (let i = 0; i < 4; i++) await page.keyboard.press(`${MOD}+z`);
    expect(JSON.stringify(await pg(page))).toBe(snap0);
    for (let i = 0; i < 4; i++) await page.keyboard.press(`${MOD}+Shift+z`);
    expect(JSON.stringify(await pg(page))).toBe(snap4);
  });

  test('Gedrückt gehaltene Pfeiltaste (Autorepeat) = ein Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await click(page, { x: 0, y: 0 });
    const n0 = await pastLen(page);
    // 25 keydown-Ereignisse (das erste ohne, die weiteren mit repeat = true), dann keyup
    for (let i = 0; i < 25; i++) await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    expect((await pg(page)).stands[0].cx).toBeCloseTo(2.5, 6);
    expect(await pastLen(page)).toBe(n0 + 1);
    await page.keyboard.press(`${MOD}+z`);
    expect((await pg(page)).stands[0].cx).toBe(0);
  });

  test('Zwei einzelne Pfeiltasten-Drücke (losgelassen) sind zwei Undo-Schritte', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await click(page, { x: 0, y: 0 });
    const n0 = await pastLen(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    expect(await pastLen(page)).toBe(n0 + 2);
  });

  test('Seitenleisten- und Steuerungsleisten-Eingabe bei Mehrfachauswahl = ein Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3 },
        { id: 's2', cx: 10, cy: 0, w: 5, d: 3 },
        { id: 's3', cx: 20, cy: 0, w: 6, d: 3 },
      ],
    });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    const n0 = await pastLen(page);
    await fill(page, 'cb-w', '3,5');
    expect(await pastLen(page)).toBe(n0 + 1);
    await fill(page, 'sb-rot', '30');
    expect(await pastLen(page)).toBe(n0 + 2);
    await fill(page, 'st-owner', 'Müller');
    expect(await pastLen(page)).toBe(n0 + 3);
    await page.locator('#st-conn').selectOption('CEE16');
    expect(await pastLen(page)).toBe(n0 + 4);
    // Pfeiltasten im Zahlenfeld: jeder Druck ein Schritt (Feld), nicht pro Objekt
    await page.locator('#cb-d').focus();
    await page.keyboard.press('ArrowUp');
    expect(await pastLen(page)).toBe(n0 + 5);
    const s = (await pg(page)).stands;
    expect(s.map((x: any) => [x.w, x.d, x.rot, x.owner, x.connection])).toEqual([
      [3.5, 3.1, 30, 'Müller', 'CEE16'],
      [3.5, 3.1, 30, 'Müller', 'CEE16'],
      [3.5, 3.1, 30, 'Müller', 'CEE16'],
    ]);
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 5; i++) await page.keyboard.press(`${MOD}+z`);
    expect((await pg(page)).stands.map((x: any) => x.w)).toEqual([4, 5, 6]);
  });

  test('Klick auf den Drehgriff mit minimaler Mausbewegung ändert die Drehung nicht', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 6, d: 4, rot: 33.3 }] });
    await click(page, { x: 0, y: 0 });
    const n0 = await pastLen(page);
    const h = (await page.getByTestId('rotate-handle').boundingBox())!;
    const c = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 1, c.y);
    await page.mouse.up();
    expect((await pg(page)).stands[0].rot).toBe(33.3);
    expect(await pastLen(page)).toBe(n0);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-22: Rundung ohne aufsummierte Fehler', () => {
  test('Stand 20× hin- und zurückziehen (gleiche Pixel) landet wieder exakt am Ausgangspunkt', async ({ page }) => {
    await openApp(page);
    // Krummer Maßstab, damit Pixel keine glatten Meter sind
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.setView(s.ui.activePage, { scale: 13.37, tx: 400.3, ty: 300.7 });
    });
    await seed(page, { stands: [{ id: 's1', cx: 1.23, cy: 4.56, w: 3, d: 3, rot: 12.3 }] });
    const box = await canvasBox(page);
    const at = (p: P) => ({ x: box.x + 400.3 + p.x * 13.37, y: box.y + 300.7 + p.y * 13.37 });
    const start = at({ x: 1.23, y: 4.56 });
    const startPx = { x: Math.round(start.x), y: Math.round(start.y) };
    const log: string[] = [];
    for (let i = 0; i < 20; i++) {
      const dx = 17 + ((i * 7) % 23);
      const dy = 11 + ((i * 5) % 19);
      await drag(page, startPx, { x: startPx.x + dx, y: startPx.y + dy }, 6);
      await drag(page, { x: startPx.x + dx, y: startPx.y + dy }, startPx, 6);
      const s = (await pg(page)).stands[0];
      log.push(`${s.cx},${s.cy}`);
    }
    const s = (await pg(page)).stands[0];
    expect({ cx: s.cx, cy: s.cy, w: s.w, d: s.d }, log.join(' | ')).toEqual({ cx: 1.23, cy: 4.56, w: 3, d: 3 });
    expect(s.rot).toBeCloseTo(12.3, 9);
  });

  test('Gruppe 10× um +37° und −37° drehen: Mittelpunkte driften nicht', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3 },
        { id: 's2', cx: 13.37, cy: 2.71, w: 5, d: 3, rot: 10 },
      ],
    });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    const before = (await pg(page)).stands.map((x: any) => [x.cx, x.cy, x.rot]);
    // Drehung um +37 bzw. −37 Grad über die Steuerungsleiste geht pro Objekt; deshalb Drehgriff
    for (let i = 0; i < 10; i++) {
      for (const deg of [37, -37]) {
        const h = (await page.getByTestId('rotate-handle').boundingBox())!;
        const hc = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
        const pivot = await page.evaluate(() => {
          const s = (window as any).__marktplanerStore.getState();
          const p = s.project.pages.find((x: any) => x.id === s.ui.activePage);
          const xs: number[] = [];
          const ys: number[] = [];
          for (const r of p.stands) {
            const a = (r.rot * Math.PI) / 180;
            for (const [sx, sy] of [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ]) {
              const x = (sx! * r.w) / 2;
              const y = (sy! * r.d) / 2;
              xs.push(r.cx + x * Math.cos(a) - y * Math.sin(a));
              ys.push(r.cy + x * Math.sin(a) + y * Math.cos(a));
            }
          }
          return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        });
        const pc = await w2s(page, pivot);
        const r = Math.hypot(hc.x - pc.x, hc.y - pc.y);
        const a0 = Math.atan2(hc.y - pc.y, hc.x - pc.x);
        const a1 = a0 + (deg * Math.PI) / 180;
        await drag(page, hc, { x: pc.x + r * Math.cos(a1), y: pc.y + r * Math.sin(a1) }, 10);
      }
    }
    const after = (await pg(page)).stands.map((x: any) => [x.cx, x.cy, x.rot]);
    // Hinweis: Der Drehpunkt (Mitte des Hüllrechtecks) wandert mit der Drehung; exakte Rückkehr ist
    // nicht garantiert. Geprüft wird, dass sich keine Rundungsfehler über 1 cm aufsummieren.
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(after[i]![2] - before[i]![2])).toBeLessThanOrEqual(0.05);
    }
    test.info().annotations.push({ type: 'Gruppe drehen', description: `vorher ${JSON.stringify(before)} nachher ${JSON.stringify(after)}` });
  });

  test('Größe 10× per Griff ändern und zurück: feste Kante einer gedrehten Fläche driftet nicht', async ({ page }) => {
    await openApp(page);
    const a0 = { id: 'a1', cx: 0, cy: 0, w: 30, d: 10, rot: 33.3 };
    await seed(page, { areas: [a0] });
    await click(page, { x: a0.cx, y: a0.cy });
    const fixed0 = local(a0, -15, 0);
    for (let i = 0; i < 10; i++) {
      const a = (await pg(page)).areas[0];
      await drag(page, await w2s(page, local(a, a.w / 2, 0)), await w2s(page, local(a, a.w / 2 + 3.37, 0)), 5);
      const b = (await pg(page)).areas[0];
      await drag(page, await w2s(page, local(b, b.w / 2, 0)), await w2s(page, local(b, b.w / 2 - 3.37, 0)), 5);
    }
    const a = (await pg(page)).areas[0];
    const fixed = local(a, -a.w / 2, 0);
    expect(Math.hypot(fixed.x - fixed0.x, fixed.y - fixed0.y)).toBeLessThanOrEqual(0.01);
  });

  test('Übernommene Drehung ist exakt auf 0,1° gerundet (kein Gleitkomma-Rest)', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await click(page, { x: 0, y: 0 });
    await fill(page, 'cb-rot', '12,3');
    const rot = (await pg(page)).stands[0].rot;
    expect(rot).toBe(12.3);
  });

  test('Eingaben werden auf 0,01 m bzw. 0,1° gerundet; Drehung wird auf 0–360 normiert', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await click(page, { x: 0, y: 0 });
    await fill(page, 'cb-x', '1,23456');
    await fill(page, 'cb-w', '3,14159');
    await fill(page, 'cb-rot', '-45,06');
    const s = (await pg(page)).stands[0];
    expect(s).toMatchObject({ cx: 1.23, w: 3.14 });
    expect(s.rot).toBeCloseTo(314.9, 9);
    await expect(page.locator('#cb-rot')).toHaveValue('314,9');
  });

  test('Ungültige Maße (0, negativ, zu groß, Text) werden abgewiesen und nicht übernommen', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await click(page, { x: 0, y: 0 });
    const n0 = await pastLen(page);
    for (const v of ['0', '-2', '1000', 'abc', '']) {
      await fill(page, 'sb-w', v);
      await expect(page.locator('#sb-w')).toHaveAttribute('aria-invalid', 'true');
      await page.locator('#sb-w').press('Escape');
    }
    expect((await pg(page)).stands[0].w).toBe(4);
    expect(await pastLen(page)).toBe(n0);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-12/M3-13: Mehrfachauswahl', () => {
  test('Gemischte Werte leer (Steuerungs- und Seitenleiste, Auswahlfelder), gleiche Werte gefüllt', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      categories: [
        { id: 'c1', name: 'Imbiss', color: '#e57373' },
        { id: 'c2', name: 'Süß', color: '#4fc3f7' },
      ],
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3, rot: 10, name: 'A', owner: 'X', ware: 'W', powerKw: 3, connection: 'CEE16', categoryId: 'c1', note: 'n' },
        { id: 's2', cx: 10, cy: 5, w: 5, d: 3, rot: 20, name: 'B', owner: 'X', ware: 'W', powerKw: 5, connection: 'CEE32', categoryId: 'c2', note: 'n', color: '#ffffff' },
      ],
    });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    for (const id of ['cb-w', 'cb-rot', 'sb-w', 'sb-rot', 'st-name', 'st-power']) expect(await val(page, id), id).toBe('');
    for (const [id, v] of [
      ['cb-d', '3'],
      ['sb-d', '3'],
      ['st-owner', 'X'],
      ['st-ware', 'W'],
      ['st-note', 'n'],
    ]) expect(await val(page, id!), id).toBe(v);
    // Auswahlfelder: nichts Bestimmtes ausgewählt
    expect(await page.locator('#st-conn').evaluate((e: HTMLSelectElement) => e.selectedOptions[0]?.textContent ?? '')).toBe('');
    expect(await page.locator('#st-cat').evaluate((e: HTMLSelectElement) => e.selectedOptions[0]?.textContent ?? '')).toBe('');
    // Platznummer erscheint bei mehreren Ständen nicht (Abweichung dokumentiert)
    await expect(page.locator('#st-nr')).toHaveCount(0);
    // Eine Eingabe gilt für alle
    await page.locator('#st-cat').selectOption('c2');
    await fill(page, 'st-power', '7,5');
    await fill(page, 'sb-rot', '90');
    const s = (await pg(page)).stands;
    expect(s.map((x: any) => [x.categoryId, x.powerKw, x.rot])).toEqual([
      ['c2', 7.5, 90],
      ['c2', 7.5, 90],
    ]);
    // Jetzt gleich → Felder gefüllt
    await expect(page.locator('#sb-rot')).toHaveValue('90');
    await expect(page.locator('#st-power')).toHaveValue('7,5');
    await page.screenshot({ path: artifact('m3-qa-multi.png') });
  });

  test('Gemischte Auswahl (Grundfläche + Geschäft): Breite für alle, Stände auf 100 m begrenzt', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 20, w: 30, d: 8 }], stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    await expect(page.locator('.panel-badge').first()).toContainText('2 ausgewählt');
    await fill(page, 'cb-d', '8');
    const p = await pg(page);
    expect(p.areas[0].d).toBe(8);
    expect(p.stands[0].d).toBe(8);
    await fill(page, 'cb-w', '150');
    const q = await pg(page);
    expect(q.areas[0].w).toBe(150);
    expect(q.stands[0].w).toBe(100);
  });

  test('Steuerungsleiste X bei Mehrfachauswahl mit verschiedenen X-Werten', async ({ page }) => {
    // Spec: „unterschiedliche Werte erscheinen als leeres Feld; eine Eingabe gilt für alle“.
    // Umgesetzt ist X/Y = Mitte der Auswahl (Illustrator-Verhalten). Siehe QA-M3-07 (Klärung).
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3 },
        { id: 's2', cx: 10, cy: 0, w: 4, d: 3 },
      ],
    });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    expect(await val(page, 'cb-x')).toBe('5');
    await fill(page, 'cb-x', '20');
    expect((await pg(page)).stands.map((s: any) => s.cx)).toEqual([15, 25]);
  });

  test('Drehgriff dreht eine Mehrfachauswahl um die gemeinsame Mitte', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      stands: [
        { id: 's1', cx: -10, cy: 0, w: 4, d: 2 },
        { id: 's2', cx: 10, cy: 0, w: 4, d: 2 },
      ],
    });
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    const h = (await page.getByTestId('rotate-handle').boundingBox())!;
    const hc = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    const c = await w2s(page, { x: 0, y: 0 });
    const r = Math.hypot(hc.x - c.x, hc.y - c.y);
    await page.keyboard.down('Shift');
    await drag(page, hc, { x: c.x + r, y: c.y }, 15); // 90° im Uhrzeigersinn
    await page.keyboard.up('Shift');
    const s = (await pg(page)).stands;
    expect(s.map((x: any) => [x.cx, x.cy, x.rot])).toEqual([
      [0, -10, 90],
      [0, 10, 90],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-08: Kategorien löschen und rückgängig', () => {
  test('Verwendete Kategorie auf zwei Pages löschen: Rückfrage mit Anzahl, Abbrechen ändert nichts, Undo/Redo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, {
      categories: [
        { id: 'c1', name: 'Imbiss & <Grill>', color: '#e57373' },
        { id: 'c2', name: 'Andere', color: '#4fc3f7' },
      ],
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3, categoryId: 'c1' },
        { id: 's2', cx: 10, cy: 0, w: 4, d: 3, categoryId: 'c1', color: '#ffffff' },
        { id: 's3', cx: 20, cy: 0, w: 4, d: 3, categoryId: 'c2' },
      ],
    });
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await seed(page, { stands: [{ id: 's4', cx: 0, cy: 0, w: 4, d: 3, categoryId: 'c1' }] });
    await page.keyboard.press('Alt+1');
    const fillOf = (id: string) => page.locator(`.stand[data-id="${id}"]`).getAttribute('fill');
    expect(await fillOf('s1')).toBe('#e57373');
    const n0 = await pastLen(page);
    await openSettings(page); // M6-07: Kategorien in den Projekteinstellungen
    const del = page.getByRole('button', { name: 'Kategorie „Imbiss & <Grill>“ löschen' });
    await del.click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('3 Geschäften');
    await page.screenshot({ path: artifact('m3-qa-category-delete.png') });
    await dlg.getByRole('button', { name: 'Abbrechen' }).click();
    expect((await st(page)).project.categories).toHaveLength(2);
    expect(await pastLen(page)).toBe(n0);
    await del.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    let p = (await st(page)).project;
    expect(p.categories.map((c: any) => c.id)).toEqual(['c2']);
    expect(p.pages.flatMap((x: any) => x.stands).map((s: any) => s.categoryId)).toEqual([null, null, 'c2', null]);
    await backToPage(page);
    expect(await fillOf('s1')).toBe('#a7adb3');
    expect(await fillOf('s2')).toBe('#ffffff');
    expect(await pastLen(page)).toBe(n0 + 1);
    await page.keyboard.press(`${MOD}+z`);
    p = (await st(page)).project;
    expect(p.categories.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(p.pages.flatMap((x: any) => x.stands).map((s: any) => s.categoryId)).toEqual(['c1', 'c1', 'c2', 'c1']);
    expect(await fillOf('s1')).toBe('#e57373');
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect((await st(page)).project.categories).toHaveLength(1);
    // Unbenutzte Kategorie: ohne Rückfrage
    await openSettings(page);
    await page.getByRole('button', { name: 'Kategorie „Andere“ löschen' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Kategorie umbenennen auf leeren Namen: Feld zeigt danach wieder den gültigen Namen', async ({ page }) => {
    await openApp(page);
    await seed(page, { categories: [{ id: 'c1', name: 'Imbiss', color: '#e57373' }] });
    await openSettings(page); // M6-07
    await fill(page, 'cat-name-c1', '   ');
    expect((await st(page)).project.categories[0].name).toBe('Imbiss');
    await expect(page.locator('#cat-name-c1')).toHaveValue('Imbiss');
  });

  test('Kategoriefarbe ändern wirkt auf alle Stände der Kategorie, eigene Farbe bleibt', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      categories: [{ id: 'c1', name: 'Imbiss', color: '#e57373' }],
      stands: [
        { id: 's1', cx: 0, cy: 0, w: 4, d: 3, categoryId: 'c1' },
        { id: 's2', cx: 10, cy: 0, w: 4, d: 3, categoryId: 'c1', color: '#ffffff' },
      ],
    });
    await openSettings(page); // M6-07
    await page.evaluate(() => {
      const el = document.querySelector('#cat-color-c1') as HTMLInputElement;
      el.value = '#123456';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await backToPage(page);
    await expect(page.locator('.stand[data-id="s1"]')).toHaveAttribute('fill', '#123456');
    await expect(page.locator('.stand[data-id="s2"]')).toHaveAttribute('fill', '#ffffff');
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-09: Beschriftungsvorlage – Grenzfälle', () => {
  // M6-07: Vorlage in den Projekteinstellungen, danach zurück auf die Page
  const setTemplate = async (page: Page, t: string) => {
    await openSettings(page);
    await page.locator('#label-template').fill(t);
    await page.locator('#label-template').press(`${MOD}+Enter`);
    await backToPage(page);
  };
  const lines = (page: Page, id: string) => page.locator(`.stand-label[data-id="${id}"] tspan`).allTextContents();

  test('Leere Platzhalter, Zeilen mit Text, Sonderzeichen, unbekannte Platzhalter, lange Namen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, {
      categories: [{ id: 'c1', name: 'Süßwaren & Co', color: '#e57373' }],
      stands: [
        { id: 'leer', cx: 0, cy: 0, w: 3, d: 3 },
        {
          id: 'voll',
          cx: 20,
          cy: 0,
          w: 3.5,
          d: 2.25,
          nr: 'A-12',
          name: '<b>Bäckerei</b> „Wenz“ & Söhne {nr} $& 😀',
          owner: "O'Neill",
          ware: 'Brot/Brötchen',
          powerKw: 0.5,
          connection: 'CEE32',
          categoryId: 'c1',
        },
        { id: 'lang', cx: 40, cy: 0, w: 2, d: 2, name: 'Allerlängster Geschäftsname der Welt mit Überlänge GmbH & Co. KG Gelnhausen' },
      ],
    });
    await setTemplate(page, '{nr}\n{name}\nStrom: {strom} kW\n{anschluss} / {kategorie}\n\n{unbekannt}\n   \n{breite}×{tiefe} m\n{eigentuemer} – {ware}');
    expect(await lines(page, 'leer')).toEqual(['{unbekannt}', '3×3 m']);
    expect(await lines(page, 'voll')).toEqual([
      'A-12',
      '<b>Bäckerei</b> „Wenz“ & Söhne {nr} $& 😀',
      'Strom: 0,5 kW',
      'CEE 32 A / Süßwaren & Co',
      '{unbekannt}',
      '3,5×2,25 m',
      "O'Neill – Brot/Brötchen",
    ]);
    // Kein HTML wird interpretiert
    await expect(page.locator('.stand-label b')).toHaveCount(0);
    // Langer Name wird nicht gekürzt und ragt über den Stand hinaus
    const long = await lines(page, 'lang');
    expect(long).toContain('Allerlängster Geschäftsname der Welt mit Überlänge GmbH & Co. KG Gelnhausen');
    const w = await page.locator('.stand-label[data-id="lang"]').evaluate((e) => e.getBoundingClientRect().width);
    expect(w).toBeGreaterThan(2 * (await scale(page)) * 3);
    // Leere Vorlage: keine Beschriftung, keine Fehler
    await setTemplate(page, '');
    await expect(page.locator('.stand-label')).toHaveCount(0);
    // Nur Text ohne Platzhalter bleibt stehen
    await setTemplate(page, 'Stand');
    await expect(page.locator('.stand-label')).toHaveCount(3);
    // Windows-Zeilenumbrüche
    await setTemplate(page, '{nr}\r\n{breite}');
    expect(await lines(page, 'voll')).toEqual(['A-12', '3,5']);
    await page.screenshot({ path: artifact('m3-qa-labels.png') });
    expect(errors).toEqual([]);
  });

  test('Schriftgröße: Grenzen, Beschriftung skaliert mit; Undo', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 3, d: 3, nr: '1' }] });
    const n0 = await pastLen(page);
    await openSettings(page); // M6-07
    for (const v of ['0', '-1', '100', 'x']) {
      await fill(page, 'label-size', v);
      await expect(page.locator('#label-size')).toHaveAttribute('aria-invalid', 'true');
      await page.locator('#label-size').press('Escape');
    }
    expect(await pastLen(page)).toBe(n0);
    await fill(page, 'label-size', '2');
    expect((await st(page)).project.settings.labelFontSize).toBe(2);
    await backToPage(page);
    await expect(page.locator('.layer-labels')).toHaveAttribute('font-size', '200');
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+z`);
    expect((await st(page)).project.settings.labelFontSize).not.toBe(2);
  });

  test('Beschriftung der Grundfläche: gedreht und mit langem Namen außerhalb der Fläche', async ({ page }) => {
    await openApp(page);
    const areas = [0, 30, 90, 135, 180, 250].map((rot, i) => ({
      id: `a${i}`,
      cx: (i % 3) * 70 - 70,
      cy: Math.floor(i / 3) * 70 - 35,
      w: 40,
      d: 10,
      rot,
      name: i % 2 ? 'Grundfläche Obermarkt Nord-Ost Erweiterung' : 'Nord',
    }));
    await seed(page, { areas });
    await page.keyboard.press(`${MOD}+0`);
    await page.screenshot({ path: artifact('m3-qa-area-labels.png') });
    for (const a of areas) {
      const lb = await page.locator(`.area-label[data-id="${a.id}"]`).evaluate((e) => e.getBoundingClientRect().toJSON());
      // Ecken der Textbox in Welt → muss außerhalb des Rechtecks liegen (Schnitt-Test über Abtastpunkte)
      const k = await scale(page);
      const box = await canvasBox(page);
      const o = await origin(page);
      const toW = (x: number, y: number) => ({ x: (x - box.x - o.x) / k, y: (y - box.y - o.y) / k });
      let inside = 0;
      for (let i = 0; i <= 10; i++)
        for (let j = 0; j <= 4; j++) {
          const p = toW(lb.x + (lb.width * i) / 10, lb.y + (lb.height * j) / 4);
          const r = (a.rot * Math.PI) / 180;
          const dx = p.x - a.cx;
          const dy = p.y - a.cy;
          const lx = dx * Math.cos(-r) - dy * Math.sin(-r);
          const ly = dx * Math.sin(-r) + dy * Math.cos(-r);
          if (Math.abs(lx) < a.w / 2 && Math.abs(ly) < a.d / 2) inside++;
        }
      expect(inside, `${a.id} (${a.rot}°)`).toBe(0);
      // Text horizontal
      expect(await page.locator(`.area-label[data-id="${a.id}"]`).getAttribute('transform')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-01/M3-18: Speichern und Neuladen', () => {
  test('Grundflächen, Stände (alle Attribute) und Kategorien überstehen Speichern und Öffnen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, {
      categories: [
        { id: 'c1', name: 'Imbiss', color: '#e57373' },
        { id: 'c2', name: 'Süß „&“', color: '#4fc3f7' },
      ],
      areas: [
        { id: 'a1', cx: 1.23, cy: -4.56, w: 50, d: 10, rot: 33.3, name: 'Nord · Ost' },
        { id: 'a2', cx: -40, cy: 30, w: 12.34, d: 7.89, rot: 271.2 },
      ],
      stands: [
        { id: 's1', cx: 0.01, cy: 0.02, w: 3.33, d: 2.71, rot: 359.9, nr: 'A-1', name: 'Bäckerei', owner: 'Müller', ware: 'Brot', powerKw: 11.5, connection: 'CEE16', note: 'Zeile 1\nZeile 2', categoryId: 'c1' },
        { id: 's2', cx: 10, cy: 0, w: 4, d: 3, color: '#123456', categoryId: 'c2', connection: '230V' },
      ],
    });
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await seed(page, { stands: [{ id: 's3', cx: 5, cy: 5, w: 2, d: 2, rot: 45 }] });
    await openSettings(page); // M6-07
    await page.locator('#label-template').fill('{nr} {name}\n{kategorie}');
    await page.locator('#label-template').press(`${MOD}+Enter`);
    await page.keyboard.press('Alt+1');
    const before = (await st(page)).project;
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const dl = await download;
    const file = await dl.path();
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(file)))['project.json']!)).project;
    expect(json.categories).toEqual(before.categories);
    // Neues Projekt (seit #1 mit Wahl der Kategorieliste: leer), dann die Datei öffnen
    await page.keyboard.press(`${MOD}+n`);
    await confirmNewProject(page);
    await expect.poll(async () => (await st(page)).project.categories.length).toBe(0);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles(file);
    await expect.poll(async () => (await st(page)).project.pages.length).toBe(2);
    const after = (await st(page)).project;
    // Drehung auf 0,1° vergleichen (Gleitkomma-Rest der Normierung siehe QA-M3-04)
    const r1 = (o: any) => ({ ...o, rot: Math.round(o.rot * 10) / 10 });
    const strip = (p: any) => ({ ...p, pages: p.pages.map((x: any) => ({ ...x, view: undefined, areas: x.areas.map(r1), stands: x.stands.map(r1) })) });
    expect(strip(after)).toEqual(strip(before));
    // Gezeichnet: Farben aus Kategorie bzw. eigener Farbe, Beschriftung nach Vorlage
    await expect(page.locator('.stand[data-id="s1"]')).toHaveAttribute('fill', '#e57373');
    await expect(page.locator('.stand[data-id="s2"]')).toHaveAttribute('fill', '#123456');
    await expect(page.locator('.stand-label[data-id="s1"] tspan')).toHaveText(['A-1 Bäckerei', 'Imbiss']);
    await expect(page.locator('.area-label[data-id="a1"]')).toHaveText('Nord · Ost · 50 × 10 m');
    // Geladen = unverändert, kein Undo-Schritt
    expect((await st(page)).history.past).toHaveLength(0);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('QA M3-14/M3-15/M3-16/M3-18: Auswahl, Ebenen, Kopieren', () => {
  test('Gesperrte Ebene: Auswahlrechteck und Cmd+A wählen nichts davon; ausgeblendete Ebene fängt beim Messen nicht', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 30, d: 10 }], stands: [{ id: 's1', cx: 20, cy: 20, w: 4, d: 4 }] });
    await page.getByRole('button', { name: 'Grundflächen sperren' }).click();
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    expect(await selIds(page)).toEqual(['s1']);
    await page.keyboard.press('Escape');
    await drag(page, await w2s(page, { x: -20, y: -8 }), await w2s(page, { x: 25, y: 25 }));
    expect(await selIds(page)).toEqual(['s1']);
    // Messen: Ecke des Stands fängt, nach Ausblenden nicht mehr
    await page.keyboard.press('m');
    const c = await w2s(page, { x: 22, y: 22 });
    await page.mouse.click(c.x - 3, c.y - 3);
    await page.mouse.click(c.x + 60, c.y);
    const fromSnap = await page.locator('.measure-label').textContent();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Geschäfte ausblenden' }).click();
    await page.mouse.click(c.x - 3, c.y - 3);
    await page.mouse.click(c.x + 60, c.y);
    const noSnap = await page.locator('.measure-label').textContent();
    expect(fromSnap).not.toBe(noSnap);
  });

  test('Shift+Klick auf Grundfläche ergänzt/entfernt; Klick ohne Ziehen auf ein Objekt der Gruppe wählt nur dieses', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'a1', cx: 0, cy: 0, w: 30, d: 10 }], stands: [{ id: 's1', cx: 30, cy: 20, w: 4, d: 4 }] });
    await click(page, { x: 30, y: 20 });
    await page.keyboard.down('Shift');
    await click(page, { x: 5, y: 2 });
    await page.keyboard.up('Shift');
    expect((await selIds(page)).toSorted()).toEqual(['a1', 's1']);
    await page.keyboard.down('Shift');
    await click(page, { x: 5, y: 2 });
    await page.keyboard.up('Shift');
    expect(await selIds(page)).toEqual(['s1']);
  });

  test('Ausschneiden + Einfügen auf anderer Page; Kopie mit leerer Nummer; Undo des Einfügens', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 3, cy: 4, w: 4, d: 3, nr: '17', nrLocked: true, name: 'X' }] });
    await click(page, { x: 3, y: 4 });
    await page.keyboard.press(`${MOD}+x`);
    expect((await pg(page)).stands).toHaveLength(0);
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+v`);
    let s = (await pg(page)).stands;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cx: 3, cy: 4, nr: '', nrLocked: false, name: 'X' });
    await page.keyboard.press(`${MOD}+v`);
    s = (await pg(page)).stands;
    expect(s[1]).toMatchObject({ cx: 4, cy: 5 });
    await page.keyboard.press(`${MOD}+z`);
    expect((await pg(page)).stands).toHaveLength(1);
  });

  test('Steuerungsleiste zeigt Werte live während des Ziehens', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 4, d: 3 }] });
    const from = await w2s(page, { x: 0, y: 0 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 50, from.y, { steps: 5 });
    await expect(page.locator('#cb-x')).toHaveValue('5');
    await page.mouse.up();
  });
});
