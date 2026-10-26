import { expect, test, type Page } from '@playwright/test';
import { canvasBox, collectErrors, hoverTooltip, MOD, openApp, origin, scale } from './helpers';

/**
 * M7: Infrastruktur-Objekte (spec.md §11, §3, §4, §6, §7). Standardansicht: Ursprung in der Mitte, 1 m = 10 px.
 */

type P = { x: number; y: number };
const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const activePg = (page: Page) => store(page, 's.project.pages.find((p) => p.id === s.ui.activePage)') as Promise<any>;
const infra = async (page: Page) => (await activePg(page)).infra as any[];
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;

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
async function drag(page: Page, a: P, b: P, hold: string[] = []) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  for (const k of hold) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const k of hold) await page.keyboard.up(k);
}

const BASE = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false };
const IBASE = { label: '', note: '', powerKw: 0, connection: null, suppressWidthWarning: false, rot: 0 };
async function seed(page: Page, objs: { areas?: any[]; stands?: any[]; infra?: any[] }) {
  await page.evaluate(
    ({ o, base, ibase }) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
        for (const a of o.areas ?? []) pg.areas.push({ name: '', rot: 0, ...a });
        for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, ...st });
        for (const i of o.infra ?? []) pg.infra.push({ ...ibase, ...i });
      });
    },
    { o: objs, base: BASE, ibase: IBASE },
  );
}
/** Blatt, Schriftfeld und Legende ausblenden, damit sie keine Klicks auf Objekte abfangen. */
const hideSheet = (page: Page) => page.getByRole('button', { name: 'Blatt ausblenden' }).click();

test.describe('M7: Infrastruktur anlegen und bearbeiten', () => {
  test('Werkzeuggruppe: Typ im Flyout wählen, Klick legt Toilettenwagen 6 × 2,5 m an; Undo entfernt ihn', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.getByTestId('infra-flyout-toggle').click();
    const list = page.getByRole('menu', { name: 'Infrastruktur-Typ' });
    await expect(list.getByRole('menuitemradio')).toHaveCount(8);
    await list.getByRole('menuitemradio', { name: /Toilette/ }).click();
    await expect(list).toHaveCount(0);
    expect(await store(page, 's.ui.tool')).toBe('infra');
    const n0 = await pastLen(page);
    await clickAt(page, { x: 10, y: 5 });
    const objs = await infra(page);
    expect(objs).toHaveLength(1);
    expect(objs[0]).toMatchObject({ typeId: 'toilet', cx: 10, cy: 5, w: 6, d: 2.5, rot: 0 });
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'objects', ids: [objs[0].id] });
    await expect(page.locator('.cb-kind')).toHaveText('Toilette');
    // Werkzeugknopf zeigt den zuletzt genutzten Typ
    await expect(page.getByTestId('infra-tool')).toHaveAttribute('data-type', 'toilet');
    expect(await pastLen(page)).toBe(n0 + 1);
    await page.keyboard.press(`${MOD}+z`);
    expect(await infra(page)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test('I aktiviert das Werkzeug, Shift+I wechselt zyklisch zum nächsten Typ', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('i');
    expect(await store(page, '[s.ui.tool, s.ui.infraTypeId]')).toEqual(['infra', 'barrierMobile']);
    await page.keyboard.press('Shift+I');
    expect(await store(page, 's.ui.infraTypeId')).toBe('barrierFixed');
    for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+I');
    expect(await store(page, 's.ui.infraTypeId')).toBe('barrierMobile');
    await expect(page.locator('.tool-hint')).toContainText('Mobile Sperre');
  });

  test('Linie von A nach B ziehen: Durchfahrt 3,2 m → Warnung „zu eng“ am Page-Tab; Mindestbreite 3 m → keine', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ tool: 'infra', infraTypeId: 'narrowPassage' }));
    await drag(page, { x: 0, y: 0 }, { x: 3.2, y: 0 });
    const [o] = await infra(page);
    expect(o).toMatchObject({ typeId: 'narrowPassage', w: 3.2, d: 0, rot: 0, cx: 1.6 });
    const badge = page.getByTestId('warn-badge');
    await expect(badge).toHaveText('1');
    await expect(badge).toHaveClass(/overlap/);
    expect(await hoverTooltip(page, badge)).toContain('1 Durchfahrt zu eng');
    await expect(page.locator('.infra-label')).toHaveText('3,2 m');
    await expect(page.getByTestId('warn-chip-narrow')).toContainText('Mindestbreite 3,5 m');
    // Breite ignorieren
    await page.getByLabel('Breite ignorieren').check();
    await expect(badge).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(badge).toHaveText('1');
    // projektweite Mindestbreite
    await page.evaluate(() => (window as any).__marktplanerStore.getState().change('t', (p: any) => void (p.settings.minPassageWidth = 3)));
    await expect(badge).toHaveCount(0);
  });

  test('Endpunkt-Griff ändert die lichte Breite; Fang an der Kante eines Stands', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's', cx: 10, cy: 0, w: 4, d: 4 }], infra: [{ id: 'p', typeId: 'narrowPassage', cx: 2, cy: 0, w: 4, d: 0 }] });
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: ['p'] } }));
    await hideSheet(page);
    const end = page.getByTestId('end-handle-1');
    await expect(end).toBeVisible();
    // rechter Endpunkt von x = 4 nach x = 7,7: fängt an der linken Kante des Stands (x = 8)
    await drag(page, { x: 4, y: 0 }, { x: 7.7, y: 0.2 });
    const [o] = await infra(page);
    expect(o.w).toBeCloseTo(8, 2);
    expect(o.cx).toBeCloseTo(4, 2);
    expect(await store(page, 's.history.past.at(-1).label')).toBe('Länge ändern');
  });

  test('Stand auf einem RTW-Platz: rote Warnung „Infrastruktur“, ignorierbar; Typ ohne „freihalten“ warnt nicht', async ({ page }) => {
    await openApp(page);
    // Toilette ohne „freihalten“ (Standard ist an, Entscheidung 2026-10-12)
    await page.evaluate(() =>
      (window as any).__marktplanerStore.getState().change('t', (p: any) => void (p.infraTypes.find((t: any) => t.id === 'toilet').keepClear = false)),
    );
    await seed(page, {
      areas: [{ id: 'G', cx: 15, cy: 0, w: 60, d: 20 }],
      stands: [{ id: 's', cx: 0, cy: 0, w: 3, d: 3 }, { id: 't', cx: 30, cy: 0, w: 3, d: 3 }],
      infra: [{ id: 'r', typeId: 'ambulance', label: 'Nord', cx: 4, cy: 0, w: 8, d: 3.5 }, { id: 'w', typeId: 'toilet', cx: 30, cy: 0, w: 6, d: 2.5 }],
    });
    const badge = page.getByTestId('warn-badge');
    await expect(badge).toHaveText('1');
    await expect(badge).toHaveClass(/overlap/);
    await expect(page.locator('.stand[data-id="s"]')).toHaveAttribute('data-warning', 'overlap');
    await expect(page.locator('.stand[data-id="t"]')).not.toHaveAttribute('data-warning', /./);
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: ['s'] } }));
    await expect(page.getByTestId('warn-chip-infra')).toHaveText('Steht in: RTW-Platz „Nord“');
    await page.getByLabel('Infrastruktur ignorieren').check();
    await expect(badge).toHaveCount(0);
  });

  test('Toilettenwagen in einer Grundfläche belegt sie wie ein Stand; Sperre belegt nicht', async ({ page }) => {
    await openApp(page);
    await seed(page, { areas: [{ id: 'G', cx: 0, cy: -5, w: 50, d: 10 }], infra: [{ id: 'w', typeId: 'toilet', cx: -5, cy: -1.25, w: 6, d: 2.5 }, { id: 'b', typeId: 'barrierMobile', cx: 15, cy: -5, w: 3.5, d: 0.3 }] });
    await expect(page.locator('.free-label')).toHaveText(['Frei 17 × 10 m', 'Frei 27 × 10 m']);
  });

  test('Strom eines Infrastruktur-Objekts zählt ins Limit; Blockieren weist eine Erhöhung ab', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's', cx: 0, cy: 0, w: 3, d: 3, powerKw: 8 }], infra: [{ id: 'm', typeId: 'medical', cx: 20, cy: 0, w: 6, d: 3 }] });
    await page.evaluate(() =>
      (window as any).__marktplanerStore.getState().change('t', (p: any) => {
        p.pages[0].powerLimitKw = 10;
        p.pages[0].blockOverLimit = true;
      }),
    );
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: ['m'] } }));
    const field = page.locator('#in-power');
    await field.fill('1,5');
    await field.press('Enter');
    await expect(page.getByTestId('power-sum')).toHaveText('9,5 / 10 kW');
    await expect(page.getByTestId('power-infra')).toHaveText('davon Infrastruktur 1,5 kW');
    await field.fill('5');
    await field.press('Enter');
    await expect(page.getByRole('alertdialog')).toContainText('Stromlimit überschritten');
    await page.getByRole('alertdialog').getByRole('button').first().click();
    expect((await infra(page))[0].powerKw).toBe(1.5);
  });

  test('Kopieren und Einfügen, Verschieben per Ziehen; Marker mit Text', async ({ page }) => {
    await openApp(page);
    await seed(page, { infra: [{ id: 'k', typeId: 'marker', label: 'Treffpunkt', cx: 0, cy: 0, w: 0, d: 0 }] });
    await hideSheet(page);
    await expect(page.locator('.infra-label')).toHaveText('Treffpunkt');
    // Marker-Symbol steht über dem Punkt: knapp darüber greifen und ziehen
    await drag(page, { x: 0, y: -0.6 }, { x: 5, y: -0.6 });
    expect((await infra(page))[0]).toMatchObject({ cx: 5, cy: 0, w: 0, d: 0 });
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    const all = await infra(page);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ label: 'Treffpunkt', cx: 6, cy: 1 });
    expect(all[1].id).not.toBe(all[0].id);
  });
});
