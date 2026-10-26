import { expect, test, type Page } from '@playwright/test';
import { canvasBox, collectErrors, MOD, openApp, origin, scale } from './helpers';

/**
 * M7-QA: ergänzende Tests zu Infrastruktur, Blatt, Schriftfeld, Legende (spec.md §7, §8, §11),
 * die in m7-infra.spec.ts / m7-sheet.spec.ts noch keine Abdeckung hatten.
 */

type P = { x: number; y: number };
const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const activePg = (page: Page) => store(page, 's.project.pages.find((p) => p.id === s.ui.activePage)') as Promise<any>;
const infra = async (page: Page) => (await activePg(page)).infra as any[];

const BASE = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false };
async function seed(page: Page, objs: { stands?: any[]; infra?: any[]; categories?: any[] }) {
  await page.evaluate(
    ({ o, base }) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
        p.categories.push(...(o.categories ?? []));
        for (const st of o.stands ?? []) pg.stands.push({ ...base, rot: 0, ...st });
        for (const i of o.infra ?? []) pg.infra.push({ label: '', note: '', powerKw: 0, connection: null, suppressWidthWarning: false, rot: 0, ...i });
      });
    },
    { o: objs, base: BASE },
  );
}

const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
/** Blatt ausblenden, damit sein Rahmen keine Klicks auf Objekte abfängt. */
const hideSheet = (page: Page) => page.getByRole('button', { name: 'Blatt ausblenden' }).click();
async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}
async function drag(page: Page, a: P, b: P) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test.describe('M7-QA: Rechteck-Infrastruktur verschieben und drehen', () => {
  test('Ziehen verschiebt den RTW-Platz; Drehgriff dreht ihn; je ein Undo- und Redo-Schritt', async ({ page }) => {
    await openApp(page);
    await seed(page, { infra: [{ id: 'r', typeId: 'ambulance', cx: 0, cy: 0, w: 8, d: 3.5 }] });
    await hideSheet(page);
    const n0 = await pastLen(page);
    await drag(page, { x: 0, y: 0 }, { x: 10, y: 5 });
    expect((await infra(page))[0]).toMatchObject({ cx: 10, cy: 5 });
    expect(await pastLen(page)).toBe(n0 + 1);

    const handleBox = (await page.getByTestId('rotate-handle').boundingBox())!;
    const c = await w2s(page, { x: 10, y: 5 });
    const r = Math.hypot(handleBox.x + handleBox.width / 2 - c.x, handleBox.y + handleBox.height / 2 - c.y);
    const a = (-90 + 30) * (Math.PI / 180);
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a), { steps: 15 });
    await page.mouse.up();
    const rotAfter = (await infra(page))[0].rot;
    expect(rotAfter).not.toBe(0);
    expect(await pastLen(page)).toBe(n0 + 2);

    await page.keyboard.press(`${MOD}+z`);
    expect((await infra(page))[0].rot).toBe(0);
    await page.keyboard.press(`${MOD}+z`);
    expect((await infra(page))[0]).toMatchObject({ cx: 0, cy: 0 });
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect((await infra(page))[0]).toMatchObject({ cx: 10, cy: 5 });
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect((await infra(page))[0].rot).toBe(rotAfter);
  });
});

test.describe('M7-QA: Eigene Typen löschen während benutzt', () => {
  test('Löschen eines benutzten eigenen Typs fragt nach, löscht Objekte mit; Undo stellt Typ und Objekte wieder her', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    // Eigenen Typ anlegen
    await page.keyboard.press('Alt+0');
    await page.keyboard.press(`${MOD}+4`);
    await page.getByRole('button', { name: 'Eigenen Typ anlegen' }).click();
    const row = page.getByTestId('infra-type-row').last();
    const typeId: string = (await row.getAttribute('data-type'))!;
    const name = row.getByLabel('Name');
    await name.fill('Bühne');
    await name.press('Enter');

    // Ein Objekt dieses Typs anlegen
    await page.keyboard.press('Alt+1');
    await seed(page, { infra: [{ id: 'buehne-1', typeId, cx: 5, cy: 5, w: 3, d: 3 }] });
    expect(await infra(page)).toHaveLength(1);

    await page.keyboard.press('Alt+0');
    await page.keyboard.press(`${MOD}+4`);
    // Löschen-Button in der Zeile dieses Typs
    const typeRow = page.locator(`[data-testid="infra-type-row"][data-type="${typeId}"]`);
    await typeRow.getByRole('button', { name: /löschen/ }).click();

    const dlg = page.getByRole('alertdialog', { name: 'Infrastruktur-Typ löschen' });
    await expect(dlg).toContainText('1 Objekt');
    await dlg.getByRole('button', { name: 'Löschen' }).click();
    await expect(dlg).toHaveCount(0);

    expect(await store(page, 's.project.infraTypes.find((t) => t.id === ' + JSON.stringify(typeId) + ')')).toBeUndefined();
    await page.keyboard.press('Alt+1');
    expect(await infra(page)).toHaveLength(0);

    // Undo: ein Schritt stellt Typ UND Objekt wieder her
    await page.keyboard.press(`${MOD}+z`);
    expect(await store(page, 's.project.infraTypes.find((t) => t.id === ' + JSON.stringify(typeId) + ')')).toMatchObject({ label: 'Bühne' });
    expect(await infra(page)).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

test.describe('M7-QA: Kurzbefehle in Textfeldern', () => {
  test('I, Shift+I, T, Shift+L greifen nicht, solange ein Textfeld den Fokus hat', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's', cx: 0, cy: 0, w: 3, d: 3 }] });
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: ['s'] } }));
    const note = page.getByLabel('Notiz');
    await note.focus();
    await page.keyboard.type('itl');
    await expect(note).toHaveValue('itl');
    expect(await store(page, 's.ui.tool')).toBe('select');
    const legendBefore = await store(page, 's.project.pages.find((p) => p.id === s.ui.activePage).legend.visible');
    await page.keyboard.press('Shift+L');
    expect(await store(page, 's.project.pages.find((p) => p.id === s.ui.activePage).legend.visible')).toBe(legendBefore);
  });
});

test.describe('M7-QA: Legende aktualisiert sich live', () => {
  test('Neue Kategorie mit Stand ergänzt die Legende; Löschen des Stands entfernt den Eintrag wieder', async ({ page }) => {
    await openApp(page);
    const legend = page.getByTestId('legend');
    await seed(page, { categories: [{ id: 'c1', name: 'Imbiss', color: '#e57373' }], stands: [{ id: 's1', cx: 0, cy: 0, w: 3, d: 3, categoryId: 'c1' }] });
    await expect(legend).toContainText('Imbiss');
    // Ohne Stände und ohne Grundfläche hat die Legende keine Einträge mehr und wird nicht gezeichnet (spec.md §8)
    await page.evaluate(() => (window as any).__marktplanerStore.getState().change('t', (p: any) => void (p.pages[0].stands = [])));
    await expect(legend).toHaveCount(0);
  });
});

test.describe('M7-QA: Papier-Elemente sind nicht kopierbar und nicht Teil der Mehrfachauswahl', () => {
  test('Ausgewähltes Schriftfeld: Cmd/Strg+C erzeugt keinen Zwischenablage-Inhalt (Einfügen bleibt wirkungslos)', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 's', cx: 0, cy: 0, w: 3, d: 3 }] });
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'paper', element: 'titleBlock' } }));
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    const pg = await activePg(page);
    expect(pg.stands).toHaveLength(1);
    expect(pg.infra).toHaveLength(0);
  });
});
