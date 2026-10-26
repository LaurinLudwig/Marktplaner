import { expect, test, type Page } from '@playwright/test';
import { canvasBox, MOD, openApp, origin, scale, openSettings, backToPage } from './helpers';

/**
 * M4: Freiflächen, Fang, Warnungen, Tasten beim Ziehen (spec.md §3, §4, Allgemein).
 * Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px.
 * Grundfläche G: 50 × 10 m, Vorderseite bei y = 0 von x = −25 bis 25 (Achse s = x + 25).
 */

type P = { x: number; y: number };
const G = { id: 'G', cx: 0, cy: -5, w: 50, d: 10 };

const pastLen = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
const lastLabel = (page: Page) =>
  page.evaluate(() => {
    const h = (window as any).__marktplanerStore.getState().history;
    return h.past.at(-1)?.label ?? null;
  });
const stands = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    return s.project.pages.find((p: any) => p.id === s.ui.activePage).stands as any[];
  });
const standById = async (page: Page, id: string) => (await stands(page)).find((s) => s.id === id);
const isDirty = (page: Page) => page.locator('.file-state .dot').count();

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

/** Ziehen von Weltpunkt a nach b; `hold` = Tasten, die während des Ziehens gedrückt sind. */
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

async function seed(page: Page, objs: { areas?: any[]; stands?: any[] }) {
  await page.evaluate((o) => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false };
    s.change('Testdaten', (p: any) => {
      // M4 prüft bündiges Anliegen; seit M10 (#2) ist das Abstand 0 (Standard neuer Projekte 0,3 m), angepasst vom Entwickler
      p.settings.snapGap = 0;
      const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
      for (const a of o.areas ?? []) pg.areas.push({ name: '', rot: 0, ...a });
      for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, ...st });
    });
  }, objs);
}

/** Stand in G: s von a bis b, t von t0 bis t1 (aligned). */
const inG = (id: string, a: number, b: number, t0 = 0, t1 = 3, extra: object = {}) => ({ id, cx: (a + b) / 2 - 25, cy: -(t0 + t1) / 2, w: b - a, d: t1 - t0, ...extra });

const freeLabels = (page: Page) => page.locator('.free-label');

test.describe('M4: Freiflächen', () => {
  test('M4-01/02/05: Freiflächen werden berechnet und beschriftet; Ebene ein-/ausblendbar ohne Undo', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28)] });
    await expect(page.locator('.free-space')).toHaveCount(2);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    // nie gespeichert
    const json = await page.evaluate(() => JSON.stringify((window as any).__marktplanerStore.getState().project));
    expect(json).not.toContain('Frei 20');
    const layers = page.getByRole('region', { name: 'Ebenen' });
    // seit M7 zusätzlich die Ebene Blatt (angepasst vom Entwickler)
    await expect(layers.locator('.layer-name')).toHaveText(['Grundflächen', 'Freiflächen', 'Geschäfte', 'Beschriftung', 'Blatt']);
    const n0 = await pastLen(page);
    await page.getByRole('button', { name: 'Freiflächen ausblenden' }).click();
    await expect(page.locator('.free-space')).toHaveCount(0);
    await expect(freeLabels(page)).toHaveCount(0);
    expect(await pastLen(page)).toBe(n0);
    await expect(layers.getByRole('button', { name: 'Freiflächen sperren' })).toHaveCount(0);
  });

  test('M4-04: live während des Ziehens, Esc stellt wieder her; Löschen rechnet neu', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28, 4, 7)] });
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    // Fang aus (Cmd/Strg), damit die Lage genau der Maus folgt
    await drag(page, { x: -1, y: -5.5 }, { x: 9, y: -5.5 }, { hold: [MOD], keepDown: true });
    await expect(freeLabels(page)).toHaveText(['Frei 30 × 10 m', 'Frei 12 × 10 m']);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up(MOD);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    await page.mouse.click(...(Object.values(await w2s(page, { x: -1, y: -5.5 })) as [number, number]));
    await page.keyboard.press('Delete');
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m']);
  });

  test('M4-03: Mindestbreite einstellbar, Undo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [inG('s1', 20, 28), inG('s2', 28.3, 31)] });
    await expect(page.locator('.free-space')).toHaveCount(2);
    await openSettings(page); // M6-07: Mindestbreite in den Projekteinstellungen
    const field = page.locator('#free-min-width');
    await expect(field).toHaveValue('0,5');
    await field.fill('0,2');
    await field.press('Enter');
    await backToPage(page);
    await expect(freeLabels(page)).toHaveText(['Frei 20 × 10 m', 'Frei 0,3 × 10 m', 'Frei 19 × 10 m']);
    expect(await lastLabel(page)).toBe('Mindestbreite ändern');
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.free-space')).toHaveCount(2);
  });

  test('M4-14: überlappende Grundflächen – die frühere gewinnt', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G, { id: 'H', cx: 40, cy: -5, w: 50, d: 10 }] });
    await expect(freeLabels(page)).toHaveText(['Frei 50 × 10 m', 'Frei 40 × 10 m']);
  });
});

test.describe('M4: Fang', () => {
  test('M4-06: Vorderkante – rastet ein, übernimmt die Drehung, gleitet, löst sich; Hilfslinie', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 's1', cx: 0, cy: -7, w: 3, d: 3, rot: 17 }] });
    await drag(page, { x: 0, y: -7 }, { x: 0, y: -2 }, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="front"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="snap-guides"] text')).toHaveText('Vorderseite · Grundfläche');
    await page.mouse.up();
    await expect(page.locator('[data-testid="snap-guides"]')).toHaveCount(0);
    expect(await standById(page, 's1')).toMatchObject({ cx: 0, cy: -1.5, rot: 0 });
    // Gleiten: 1,4 m von der Vorderseite weg bleibt er eingerastet (Lösen erst bei 16 px = 1,6 m)
    await drag(page, { x: 0, y: -1.5 }, { x: 8, y: -2.9 }, { steps: 20 });
    expect(await standById(page, 's1')).toMatchObject({ cx: 8, cy: -1.5, rot: 0 });
    // Weit weg: gelöst
    await drag(page, { x: 8, y: -1.5 }, { x: 8, y: -6 }, { steps: 20 });
    expect(await standById(page, 's1')).toMatchObject({ cx: 8, cy: -6 });
  });

  test('M4-08: Cmd/Strg beim Ziehen schaltet den Fang aus', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [G], stands: [{ id: 's1', cx: 0, cy: -7, w: 3, d: 3, rot: 17 }] });
    await drag(page, { x: 0, y: -7 }, { x: 0, y: -2 }, { hold: [MOD] });
    expect(await standById(page, 's1')).toMatchObject({ cx: 0, cy: -2, rot: 17 });
  });

  test('M4-07: Umschalter in der Werkzeugleiste sind Ansichtseinstellungen (kein Undo, nicht ungespeichert)', async ({ page }) => {
    await openApp(page);
    const front = page.locator('.toolbar .tool.toggle').nth(0);
    const grid = page.locator('.toolbar .tool.toggle').nth(1);
    const neighbors = page.locator('.toolbar .tool.toggle').nth(2);
    await expect(front).toBeEnabled();
    await expect(front).toHaveAttribute('aria-pressed', 'true');
    await expect(grid).toHaveAttribute('aria-pressed', 'false');
    await expect(neighbors).toHaveAttribute('aria-pressed', 'true');
    await seed(page, { areas: [G], stands: [{ id: 's1', cx: 0, cy: -7, w: 3, d: 3, rot: 17 }] });
    const n0 = await pastLen(page);
    const dirty0 = await isDirty(page);
    await page.keyboard.press('Shift+F');
    await expect(front).toHaveAttribute('aria-pressed', 'false');
    await grid.click();
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+N');
    await expect(neighbors).toHaveAttribute('aria-pressed', 'false');
    expect(await pastLen(page)).toBe(n0);
    expect(await isDirty(page)).toBe(dirty0);
    // Vorderkante aus: kein Einrasten an der Vorderseite (das Raster rastet die Kanten bei ganzen Metern ein)
    await drag(page, { x: 0, y: -7 }, { x: 0.2, y: -2.2 });
    const s1 = await standById(page, 's1');
    expect(s1.rot).toBe(17);
  });

  test('M4-15: Nachbarstände – bündig anliegen', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'a', cx: -10, cy: 0, w: 3, d: 3 }, { id: 'b', cx: 0, cy: 0, w: 3, d: 3 }] });
    // b nach links, bis seine linke Kante 0,4 m neben der rechten Kante von a liegt (−8,5 + 0,4)
    await drag(page, { x: 0, y: 0 }, { x: -6.6, y: 0.3 });
    const b = await standById(page, 'b');
    expect(b.cx).toBeCloseTo(-7, 5);
    expect(b.cy).toBeCloseTo(0, 5);
  });

  test('M4-16: Raster – Grundfläche rastet mit ihrem Rand an ganzen Metern ein', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'A', cx: 0, cy: 0, w: 20, d: 8 }] });
    await page.keyboard.press('Shift+R');
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 0 })) as [number, number]));
    await drag(page, { x: 0, y: 0 }, { x: 3.3, y: 2.2 });
    const a = await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      return s.project.pages[0].areas[0];
    });
    expect(a.cx - a.w / 2).toBeCloseTo(Math.round(a.cx - a.w / 2), 5);
    expect(a.cy - a.d / 2).toBeCloseTo(Math.round(a.cy - a.d / 2), 5);
    expect(a.cx).toBeCloseTo(3, 5);
    expect(a.cy).toBeCloseTo(2, 5);
  });
});

test.describe('M4: Tasten beim Ziehen', () => {
  test('M4-11: Shift beschränkt auf waagerecht', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 3, d: 3 }] });
    // Shift erst während des Ziehens (Shift beim Mausdruck schaltet die Auswahl um, wie in Illustrator)
    await drag(page, { x: 0, y: 0 }, { x: 10, y: 2.5 }, { keepDown: true });
    await page.keyboard.down('Shift');
    await expect.poll(async () => page.evaluate(() => (window as any).__marktplanerStore.getState().preview?.rects.s1?.cy)).toBe(0);
    const to = await w2s(page, { x: 12, y: 3 });
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await standById(page, 's1')).toMatchObject({ cx: 12, cy: 0 });
  });

  test('M4-12: Alt+Ziehen dupliziert (ein Undo-Schritt, Kopie ausgewählt, leere Nummer); Alt vor dem Loslassen lösen verschiebt nur', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 3, d: 3, nr: '7', name: 'Crêpes' }] });
    const n0 = await pastLen(page);
    await drag(page, { x: 0, y: 0 }, { x: 10, y: 0 }, { hold: ['Alt'] });
    const list = await stands(page);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 's1', cx: 0, cy: 0, nr: '7' });
    expect(list[1]).toMatchObject({ cx: 10, cy: 0, nr: '', name: 'Crêpes' });
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Duplizieren');
    const sel = await page.evaluate(() => (window as any).__marktplanerStore.getState().ui.selection);
    expect(sel).toEqual({ kind: 'objects', ids: [list[1].id] });
    await page.keyboard.press(`${MOD}+z`);
    expect(await stands(page)).toHaveLength(1);
    // Alt gedrückt, dann vor dem Loslassen gelöst: nur verschieben
    await drag(page, { x: 0, y: 0 }, { x: 0, y: 8 }, { hold: ['Alt'], keepDown: true });
    await expect(page.locator('.stand')).toHaveCount(2);
    await page.keyboard.up('Alt');
    await expect(page.locator('.stand')).toHaveCount(1);
    await page.mouse.up();
    const after = await stands(page);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: 's1', cx: 0, cy: 8 });
  });

  test('M4-20: Kurzbefehle wirken während des Ziehens nicht', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's1', cx: 0, cy: 0, w: 3, d: 3 }] });
    const n0 = await pastLen(page);
    await drag(page, { x: 0, y: 0 }, { x: 5, y: 0 }, { keepDown: true });
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press('Delete');
    await page.keyboard.press(`${MOD}+d`);
    await page.mouse.up();
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await stands(page)).toHaveLength(1);
    expect(await standById(page, 's1')).toMatchObject({ cx: 5 });
  });

  test('Übersicht (?) nennt die Tasten beim Ziehen', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Tastaturkürzel' });
    await expect(dlg).toContainText('Beim Ziehen');
    await expect(dlg).toContainText('Fang vorübergehend aus');
    await expect(dlg).toContainText('Duplizieren (Alt beim Loslassen)');
  });
});

test.describe('M4: Warnungen', () => {
  test('M4-09/10: außerhalb orange, Überlappung rot; ignorieren pro Stand und global, jeweils mit Undo', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [G],
      stands: [inG('a', 10, 18), inG('b', 17, 20), { id: 'c', cx: 0, cy: 10, w: 3, d: 3 }, inG('d', 30, 33, 0, 14)],
    });
    await expect(page.locator('.stand[data-warning="overlap"]')).toHaveCount(2);
    await expect(page.locator('.stand[data-warning="outside"]')).toHaveCount(2); // c ganz außerhalb, d ragt hinten heraus (A5)
    await expect(page.locator('.overlap-region')).toHaveCount(1);
    const badge = page.locator('[role="tab"][aria-selected="true"] [data-testid="warn-badge"]');
    await expect(badge).toHaveText('4');
    await expect(badge).toHaveClass(/overlap/);

    // pro Stand: c auswählen, „außerhalb“ ignorieren
    await page.mouse.click(...(Object.values(await w2s(page, { x: 0, y: 10 })) as [number, number]));
    await expect(page.getByTestId('warn-chip-outside')).toHaveText('Außerhalb jeder Grundfläche');
    await page.getByLabel('„außerhalb“ ignorieren').check();
    await expect(page.locator('.stand[data-id="c"]')).not.toHaveAttribute('data-warning', /.+/);
    await expect(badge).toHaveText('3');
    expect(await lastLabel(page)).toBe('Warnung ignorieren');
    await page.keyboard.press(`${MOD}+z`);
    await expect(badge).toHaveText('4');

    // Überlappung ignorieren wirkt nur auf den eigenen Stand
    await page.mouse.click(...(Object.values(await w2s(page, { x: -11, y: -1.5 })) as [number, number]));
    await expect(page.getByTestId('warn-chip-overlap')).toContainText('Überlappt mit');
    await page.getByLabel('Überlappung ignorieren').check();
    await expect(page.locator('.stand[data-id="a"]')).not.toHaveAttribute('data-warning', /.+/);
    await expect(page.locator('.stand[data-id="b"]')).toHaveAttribute('data-warning', 'overlap');

    // global: beide Arten aus, mit Undo
    await page.keyboard.press('Escape');
    await openSettings(page); // M6-07: Warnungsschalter in den Projekteinstellungen
    await page.getByLabel('Warnung, wenn sich Geschäfte überlappen').uncheck();
    await page.getByLabel('Warnung, wenn ein Geschäft außerhalb der Grundflächen steht').uncheck();
    await backToPage(page);
    await expect(page.locator('.stand[data-warning]')).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.stand[data-warning="outside"]')).toHaveCount(2);
  });

  test('M4-18: Warnzähler am Tab zeigt Probleme auf anderen Pages', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      if (s.project.pages.length < 2) {
        s.change('Page', (p: any) => {
          const pg = JSON.parse(JSON.stringify(p.pages[0]));
          pg.id = 'p2';
          pg.name = 'Festplatz 2';
          p.pages.push(pg);
        });
      }
    });
    const tabs = page.locator('header.tabbar [role="tab"]');
    await tabs.nth(2).click();
    await seed(page, { stands: [{ id: 'x', cx: 0, cy: 0, w: 3, d: 3 }, { id: 'y', cx: 1, cy: 0, w: 3, d: 3 }] });
    await tabs.nth(1).click();
    await expect(tabs.nth(2).locator('[data-testid="warn-badge"]')).toHaveText('2');
    await expect(tabs.nth(2).locator('[data-testid="warn-badge"]')).toHaveClass(/overlap/);
    await expect(tabs.nth(1).locator('[data-testid="warn-badge"]')).toHaveCount(0);
  });
});
