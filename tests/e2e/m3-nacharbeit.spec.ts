import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, MOD, openApp, origin, scale } from './helpers';

/**
 * QA-Nacharbeit M3. Schwerpunkt QA-M3-01: Esc bricht eine laufende Interaktion immer zuerst ab,
 * unabhängig davon, wie oft zwischen Start-Page und Festplatz-Pages gewechselt wurde (die
 * Zeichenfläche wird dabei jedes Mal neu aufgebaut).
 */

type P = { x: number; y: number };
const pg = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    return s.project.pages.find((p: any) => p.id === s.ui.activePage);
  });
const pastLen = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
const selection = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().ui.selection);

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

/** Maus drücken, bewegen, Esc drücken, loslassen. */
async function dragWithEsc(page: Page, from: P, to: P) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false };
    s.change('Testdaten', (p: any) => {
      p.pages[0].stands.push({ ...base, id: 's1', cx: 0, cy: 0, w: 4, d: 3, rot: 0 });
      p.pages[0].areas.push({ id: 'a1', name: '', cx: 0, cy: 20, w: 20, d: 8, rot: 0 });
    });
  });
}

/** Mehrfach zwischen Start-Page, zweiter und erster Festplatz-Page wechseln (per Taste und per Tab). */
async function switchPagesRepeatedly(page: Page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Alt+0');
    await expect(page.locator('svg.canvas')).toHaveCount(0);
    await page.keyboard.press('Alt+2');
    await expect(page.locator('svg.canvas')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Start' }).click();
    await page.getByRole('tab', { name: 'Festplatz 1' }).click();
    await expect(page.locator('svg.canvas')).toHaveCount(1);
  }
  await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
}

test.describe('QA-M3-01: Esc nach Seitenwechseln bei allen Werkzeugen', () => {
  test('Ziehen, Drehen, Größe, Aufziehen (Grundfläche, Geschäft), Messen und Kalibrieren', async ({ page }) => {
    await openApp(page);
    // Hintergrund für das Kalibrieren
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+Shift+p`);
    await (await chooser).setFiles(join(process.cwd(), 'tests', 'fixtures', 'raster-10m.png'));
    await expect(page.getByTestId('bg-scale')).toBeVisible();
    await page.getByRole('button', { name: 'Hintergrund ausblenden' }).click();
    await seed(page);
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await switchPagesRepeatedly(page);
    const n0 = await pastLen(page);

    // Auswahlwerkzeug: Stand ziehen + Esc
    await dragWithEsc(page, await w2s(page, { x: 0, y: 0 }), await w2s(page, { x: 8, y: 4 }));
    expect((await pg(page)).stands[0]).toMatchObject({ cx: 0, cy: 0 });
    expect(await selection(page)).toEqual({ kind: 'objects', ids: ['s1'] }); // Esc hob nicht zugleich die Auswahl auf

    // Drehgriff + Esc
    const h = (await page.getByTestId('rotate-handle').boundingBox())!;
    const hc = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await dragWithEsc(page, hc, { x: hc.x + 60, y: hc.y + 40 });
    expect((await pg(page)).stands[0].rot).toBe(0);

    // Grundfläche: Größengriff + Esc
    const a = await w2s(page, { x: 0, y: 20 });
    await page.mouse.click(a.x, a.y);
    const rh = (await page.locator('.resize-handle[data-handle="1,1"]').boundingBox())!;
    await dragWithEsc(page, { x: rh.x + 4, y: rh.y + 4 }, { x: rh.x + 80, y: rh.y + 60 });
    expect((await pg(page)).areas[0]).toMatchObject({ w: 20, d: 8 });

    // Ein zweites Esc ohne laufende Geste hebt die Auswahl auf
    await page.keyboard.press('Escape');
    expect(await selection(page)).toBeNull();

    // Aufziehen mit beiden Werkzeugen + Esc
    for (const key of ['f', 'g']) {
      await page.keyboard.press(key);
      await dragWithEsc(page, await w2s(page, { x: -30, y: -20 }), await w2s(page, { x: -15, y: -10 }));
    }
    const p1 = await pg(page);
    expect([p1.areas.length, p1.stands.length]).toEqual([1, 1]);
    expect(await pastLen(page)).toBe(n0);

    // Messen: Esc löscht die Messung
    await page.keyboard.press('m');
    await page.mouse.click(...(Object.values(await w2s(page, { x: -30, y: 10 })) as [number, number]));
    await page.mouse.click(...(Object.values(await w2s(page, { x: -20, y: 10 })) as [number, number]));
    await expect(page.locator('.measure-label')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.measure-label')).toHaveCount(0);

    // Kalibrieren: Esc bricht ab
    await page.getByRole('button', { name: 'Hintergrund einblenden' }).click();
    await page.keyboard.press('k');
    await page.mouse.click(...(Object.values(await w2s(page, { x: 5, y: 5 })) as [number, number]));
    await expect(page.locator('.calibrate-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.calibrate-overlay')).toHaveCount(0);
  });
});

test.describe('QA-Nacharbeit M3: Griffe, Aufziehen, Einfügen', () => {
  test('QA-M3-03: Bewegung unter 3 px am Drehgriff und am Größengriff ändert nichts', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 20 })) as [number, number]));
    const n0 = await pastLen(page);
    for (const sel of ['[data-testid="rotate-handle"]', '.resize-handle[data-handle="1,1"]']) {
      const b = (await page.locator(sel).boundingBox())!;
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + 2, c.y + 1);
      await page.mouse.up();
    }
    expect((await pg(page)).areas[0]).toMatchObject({ cx: 0, cy: 20, w: 20, d: 8, rot: 0 });
    expect(await pastLen(page)).toBe(n0);
  });

  test('QA-M3-L2: flaches Aufziehen (< 0,5 m) legt einen Stand in Standardgröße an und ändert das Standardmaß nicht', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('g');
    const a = await w2s(page, { x: 0, y: 0 });
    const b = await w2s(page, { x: 10, y: 0.2 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    expect((await pg(page)).stands[0]).toMatchObject({ cx: 0, cy: 0, w: 3, d: 3 });
    const c = await w2s(page, { x: 20, y: 0 });
    await page.mouse.click(c.x, c.y);
    expect((await pg(page)).stands[1]).toMatchObject({ w: 3, d: 3 });
  });

  test('QA-M3-L3: Einfügen auf derselben Page 1 m versetzt, weiter versetzt; andere Page gleiche Position', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await page.keyboard.press(`${MOD}+v`);
    expect((await pg(page)).stands.map((s: any) => [s.cx, s.cy])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+v`);
    // Die Zwischenablage enthält den Stand bei (0, 0): auf der anderen Page an genau dieser Stelle
    expect((await pg(page)).stands.map((s: any) => [s.cx, s.cy])).toEqual([[0, 0]]);
  });
});
