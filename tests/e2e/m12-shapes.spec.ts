import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { backToPage, canvasBox, collectErrors, MOD, openApp, openSettings } from './helpers';

/** M12 #9: Geschäftsformen – Kreis/Oval, Formvorlagen mit Editor, Hitbox = Rechteck B × T (spec.md §3 „Form“, §7, §10). */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const stand = (page: Page) => store(page, 's.project.pages[0].stands[0]') as Promise<{ shape: string; shapeTemplateId: string | null; w: number; d: number }>;

/** Grundfläche 50 × 10 m (y 0 … 10, Vorderseite unten), Stand 8 × 4 m bei x = 20 … 28, y = 6 … 10. */
async function seed(page: Page, extra: Record<string, unknown> = {}, templates: unknown[] = []) {
  await page.evaluate(
    ([fields, tpls]) => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, rot: 0, shape: 'rect', shapeTemplateId: null };
      s.change('Testdaten', (p: any) => {
        p.shapeTemplates.push(...(tpls as unknown[]));
        const nord = p.pages[0];
        nord.areas.push({ id: 'g1', name: 'Hauptstraße', cx: 25, cy: 5, w: 50, d: 10, rot: 0 });
        nord.stands.push({ ...base, id: 's1', name: 'Karussell', cx: 24, cy: 8, w: 8, d: 4, ...(fields as object) });
      });
      s.setView(s.project.pages[0].id, { scale: 10, tx: 50, ty: 100 });
    },
    [extra, templates] as const,
  );
}

/** Bildschirmpunkt eines Weltpunkts bei Ansicht 10 px/m, Versatz (50, 100). */
async function at(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  return { x: box.x + 50 + x * 10, y: box.y + 100 + y * 10 };
}

async function clickAt(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const freeLabels = (page: Page) => page.locator('.free-label').allTextContents();
/** Element des Stands: Rechteck als polygon, Kreis/Oval als Pfad aus Bögen. */
const standTag = (page: Page) => page.locator('.stand[data-id="s1"]').evaluate((e) => e.tagName + (e.getAttribute('d')?.includes('A') ? ':arc' : ''));

const KARUSSELL = { id: 'k', name: 'Karussell mit Kasse', w: 10, d: 12, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 10 / 12 }, { kind: 'rect', x: 0.35, y: 0.75, w: 0.3, h: 0.25 }] };

test.describe('M12 #9: Geschäftsformen', () => {
  test('Seitenleiste: Kreis/Oval, Hitbox nur bei Auswahl, Freiflächen unverändert, Undo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    const before = await freeLabels(page);
    await clickAt(page, 24, 8);
    await expect(page.locator('#st-shape')).toHaveValue('rect');
    await expect(page.locator('.stand-hitbox')).toHaveCount(0);
    await page.locator('#st-shape').selectOption({ label: 'Kreis/Oval' });
    expect(await stand(page)).toMatchObject({ shape: 'ellipse', shapeTemplateId: null, w: 8, d: 4 });
    expect(await standTag(page)).toBe('path:arc');
    await expect(page.locator('.stand-hitbox')).toHaveCount(1);
    await expect(page.getByText('Belegung, Warnungen und Fang rechnen mit dem Rechteck B × T.')).toBeVisible();
    // Freiflächen rechnen mit dem Rechteck
    expect(await freeLabels(page)).toEqual(before);
    // Auswahl aufheben: Hitbox verschwindet
    await clickAt(page, 5, 25);
    await expect(page.locator('.stand-hitbox')).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    expect((await stand(page)).shape).toBe('rect');
    expect(await standTag(page)).toBe('polygon');
    expect(errors).toEqual([]);
  });

  test('Klick in eine Ecke außerhalb des Ovals wählt den Stand (Hitbox)', async ({ page }) => {
    await openApp(page);
    await seed(page, { shape: 'ellipse' });
    // Ecke links oben (20,2 / 6,2): außerhalb der Ellipse, innerhalb von B × T
    await clickAt(page, 20.2, 6.2);
    expect(await store(page, 's.ui.selection && s.ui.selection.ids')).toEqual(['s1']);
  });

  test('Formvorlage anlegen, zuweisen (Vorschlagsmaß), löschen mit Rückfrage', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await openSettings(page);
    const panel = page.getByRole('region', { name: 'Formvorlagen' });
    await panel.getByTestId('shape-add').click();
    const editor = page.getByTestId('shape-editor');
    await expect(editor).toBeVisible();
    await editor.locator('#se-name').fill('Kinderkarussell');
    // erstes Teil: Kreis 6 × 6 m → 10 × 10 m
    for (const id of ['#se-w-0', '#se-h-0']) {
      await editor.locator(id).fill('10');
      await editor.locator(id).press('Enter');
    }
    await editor.getByTestId('shape-part-add').click();
    await expect(editor.getByTestId('shape-part')).toHaveCount(2);
    // zweites Teil: Kasse 3 × 2 m mittig unter dem Kreis
    for (const [id, v] of [['#se-x-1', '3,5'], ['#se-y-1', '10'], ['#se-w-1', '3'], ['#se-h-1', '2']] as const) {
      await editor.locator(id).fill(v);
      await editor.locator(id).press('Enter');
    }
    await expect(editor.getByTestId('shape-size')).toHaveText('Vorschlagsmaß 10 × 12 m');
    const steps = (await store(page, 's.history.past.length')) as number;
    await editor.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(editor).toHaveCount(0);
    expect(await store(page, 's.history.past.length')).toBe(steps + 1);
    await expect(panel.getByTestId('shape-row')).toHaveCount(1);
    await expect(panel.getByTestId('shape-row')).toContainText('Kinderkarussell');

    await backToPage(page);
    await clickAt(page, 24, 8);
    await page.locator('#st-shape').selectOption({ label: 'Kinderkarussell (10 × 12 m)' });
    const s = await stand(page);
    expect(s).toMatchObject({ w: 10, d: 12 });
    expect(s.shapeTemplateId).toBeTruthy();
    await expect(page.locator('.stand-group[data-id="s1"]')).toHaveCount(1);
    await expect(page.locator('.stand-group[data-id="s1"] .stand-fill')).toHaveCount(1);
    await expect(page.locator('.stand-group[data-id="s1"] .stand-outline')).toHaveCount(1);

    await openSettings(page);
    await expect(panel.getByTestId('shape-usage')).toHaveText('1');
    await panel.getByRole('button', { name: /Formvorlage „Kinderkarussell“ löschen/ }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('von 1 Geschäft verwendet');
    await dlg.getByRole('button', { name: 'Löschen' }).click();
    await expect(panel.getByTestId('shape-row')).toHaveCount(0);
    expect(await stand(page)).toMatchObject({ shape: 'rect', shapeTemplateId: null, w: 10, d: 12 });
    await page.keyboard.press(`${MOD}+z`);
    await expect(panel.getByTestId('shape-row')).toHaveCount(1);
    expect((await stand(page)).shapeTemplateId).toBe(s.shapeTemplateId);
    expect(errors).toEqual([]);
  });

  test('Speichern und Öffnen behält Form und Formvorlagen (Formatversion 8)', async ({ page }) => {
    await openApp(page);
    await seed(page, { shapeTemplateId: 'k', shape: 'ellipse' }, [KARUSSELL]);
    await expect(page.locator('.stand-group[data-id="s1"]')).toHaveCount(1);
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const bytes = readFileSync((await (await download).path())!);
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['project.json']!));
    expect(json.schemaVersion).toBe(10); // seit #5 Version 10, angepasst vom Entwickler (vorher 9, davor 8)
    expect(json.project.shapeTemplates).toEqual([KARUSSELL]);
    expect(json.project.pages[0].stands[0]).toMatchObject({ shape: 'ellipse', shapeTemplateId: 'k' });
    // Neues Projekt laden, dann die Datei öffnen
    await store(page, `s.loadBundle({ project: { ...s.project, shapeTemplates: [], pages: s.project.pages.map((p) => ({ ...p, stands: [] })) }, assets: {} }, { path: null, name: null })`);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles({ name: 'm12.mplan', mimeType: 'application/zip', buffer: bytes });
    await expect.poll(() => store(page, 's.project.shapeTemplates.length')).toBe(1);
    expect(await stand(page)).toMatchObject({ shape: 'ellipse', shapeTemplateId: 'k' });
    await expect(page.locator('.stand-group[data-id="s1"]')).toHaveCount(1);
  });

  test('Echte v7-Datei öffnet: alle Stände Rechtecke, keine Formvorlagen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles('tests/fixtures/format-v7-m11.mplan');
    await expect.poll(() => store(page, 's.project.name')).toBe('Formatversion 7 (M11)');
    expect(await store(page, 's.project.shapeTemplates')).toEqual([]);
    expect(await store(page, 's.project.pages.every((p) => p.stands.every((x) => x.shape === "rect" && x.shapeTemplateId === null))')).toBe(true);
    expect(errors).toEqual([]);
  });
});
