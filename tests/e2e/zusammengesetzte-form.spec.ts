import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { backToPage, canvasBox, collectErrors, MOD, openApp, openSettings } from './helpers';

/**
 * #16: Stände mit zusammengesetzter Form, die auch in der Berechnung zählt (spec.md §3 „Form“, Entscheidung Laurin
 * 2026-11-06): „Zu einem Stand zusammenfassen“, eigene Form in der Seitenleiste und auf der Zeichenfläche, Frontmeter
 * von Hand, Formvorlage „belegt wie gezeichnet“, Formatversion 15.
 *
 * Beispiel B-06 „Hip-Hop Fly“: Hauptkörper 20 × 12 m (x 20 … 40, y 10 … 22), links und rechts je ein Ausleger
 * 2,5 × 7 m (y 12,5 … 19,5). Die vier Ecken (je 2,5 × 2,5 m) sind frei.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const stands = (page: Page) =>
  store(page, 's.project.pages[0].stands') as Promise<{ id: string; nr: string; name: string; w: number; d: number; cx: number; cy: number; parts: unknown[] | null; frontOverride: number | null }[]>;
const past = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const selection = (page: Page) => store(page, 's.ui.selection && s.ui.selection.ids') as Promise<string[] | null>;

const BASE = {
  nr: '',
  nrLocked: false,
  name: '',
  owner: '',
  ware: '',
  powerKw: 0,
  connection: null,
  note: '',
  categoryId: null,
  color: null,
  suppressOutsideWarning: false,
  suppressOverlapWarning: false,
  suppressDuplicateWarning: false,
  suppressInfraWarning: false,
  suppressDistanceWarning: false,
  rot: 0,
  shape: 'rect',
  shapeTemplateId: null,
  labelOffset: null,
  parts: null,
  frontOverride: null,
};

const B06_PARTS = [
  { kind: 'rect', x: 0.1, y: 0, w: 0.8, h: 1, rot: 0 },
  { kind: 'rect', x: 0, y: 2.5 / 12, w: 0.1, h: 7 / 12, rot: 0 },
  { kind: 'rect', x: 0.9, y: 2.5 / 12, w: 0.1, h: 7 / 12, rot: 0 },
];

/** Stände in die erste Page setzen (ohne Grundflächen), Ansicht 10 px/m mit Versatz (50, 100). */
async function seed(page: Page, list: Record<string, unknown>[]) {
  await page.evaluate(
    ([items, base]) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        for (const it of items as Record<string, unknown>[]) p.pages[0].stands.push({ ...(base as object), ...it });
      });
      s.setView(s.project.pages[0].id, { scale: 10, tx: 50, ty: 100 });
    },
    [list, BASE] as const,
  );
}

/** Importiertes B-06: Hauptkörper und zwei Ausleger als einzelne Stände. */
const IMPORTED = [
  { id: 'main', nr: 'B-06', name: 'Hip-Hop Fly', powerKw: 63, cx: 30, cy: 16, w: 20, d: 12 },
  { id: 'left', cx: 18.75, cy: 16, w: 2.5, d: 7 },
  { id: 'right', cx: 41.25, cy: 16, w: 2.5, d: 7 },
];

async function at(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  return { x: box.x + 50 + x * 10, y: box.y + 100 + y * 10 };
}
async function clickAt(page: Page, x: number, y: number, shift = false) {
  const p = await at(page, x, y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (shift) await page.keyboard.up('Shift');
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (b.x - a.x) / 2, a.y + (b.y - a.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test.describe('#16 Zusammengesetzte Form', () => {
  test('„Zu einem Stand zusammenfassen“: importiertes B-06 wird ein Stand, ein Undo-Schritt; freie Ecken treffen nicht', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, IMPORTED);
    await clickAt(page, 30, 16);
    await clickAt(page, 18.75, 16, true);
    await clickAt(page, 41.25, 16, true);
    expect(await selection(page)).toEqual(['main', 'left', 'right']);
    const n = await past(page);
    await page.getByTestId('merge-stands').click();
    expect(await past(page)).toBe(n + 1);
    const [s, ...rest] = await stands(page);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ id: 'main', nr: 'B-06', name: 'Hip-Hop Fly', w: 25, d: 12, cx: 30, cy: 16 });
    expect(s!.parts).toHaveLength(3);
    expect(await selection(page)).toEqual(['main']);
    // Seitenleiste: eigene Form mit drei Teilen, Frontmeter automatisch 20 m (nur der Hauptkörper liegt vorn)
    await expect(page.locator('#st-shape')).toHaveValue('own');
    await expect(page.getByTestId('stand-part')).toHaveCount(3);
    await expect(page.locator('#st-front')).toHaveAttribute('placeholder', 'automatisch 20');
    // Ausgewählt: Teile dünn umrandet, Hüllrechteck nur zur Orientierung
    await expect(page.locator('.stand-part')).toHaveCount(3);
    await expect(page.locator('.stand-hitbox.orientation')).toHaveCount(1);
    // Klick in eine freie Ecke (oben links) wählt nichts
    await clickAt(page, 18.75, 11.25);
    expect(await selection(page)).toBeNull();
    await clickAt(page, 18.75, 16);
    expect(await selection(page)).toEqual(['main']);
    // Rückgängig: wieder drei Stände
    await page.keyboard.press(`${MOD}+z`);
    expect((await stands(page)).map((x) => x.id)).toEqual(['main', 'left', 'right']);
    expect(errors).toEqual([]);
  });

  test('Teil auf der Zeichenfläche: anklicken, ziehen (ein Undo-Schritt), Esc verlässt den Teil', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, [{ id: 'b06', nr: 'B-06', cx: 30, cy: 16, w: 25, d: 12, parts: B06_PARTS }]);
    // erster Klick wählt den Stand, zweiter Klick macht den rechten Ausleger zum aktiven Teil
    await clickAt(page, 41.25, 16);
    expect(await selection(page)).toEqual(['b06']);
    await expect(page.getByTestId('part-handles')).toHaveCount(0);
    await clickAt(page, 41.25, 16);
    await expect(page.getByTestId('part-handles')).toHaveCount(1);
    await expect(page.getByTestId('part-handle')).toHaveCount(8);
    const n = await past(page);
    // Ausleger 2 m nach rechts: B × T wächst auf 27 m, der Hauptkörper bleibt, wo er ist
    await drag(page, [41.25, 16], [43.25, 16]);
    expect(await past(page)).toBe(n + 1);
    const [s] = await stands(page);
    expect(s).toMatchObject({ w: 27, d: 12, cx: 31, cy: 16 });
    // Ziehen am Hauptkörper (nicht aktiver Teil) verschiebt den ganzen Stand
    await drag(page, [30, 16], [30, 20]);
    expect((await stands(page))[0]).toMatchObject({ w: 27, cy: 20 });
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    expect((await stands(page))[0]).toMatchObject({ w: 25, cx: 30, cy: 16 });
    // Esc verlässt den aktiven Teil, die Auswahl bleibt
    await clickAt(page, 41.25, 16);
    await expect(page.getByTestId('part-handles')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('part-handles')).toHaveCount(0);
    expect(await selection(page)).toEqual(['b06']);
    expect(errors).toEqual([]);
  });

  test('Seitenleiste: „Eigene Form“, Teil hinzufügen und ändern, Frontmeter von Hand, Form auflösen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, [{ id: 's1', name: 'Imbiss', cx: 24, cy: 8, w: 8, d: 4 }]);
    await clickAt(page, 24, 8);
    await page.locator('#st-shape').selectOption({ label: 'Eigene Form' });
    expect((await stands(page))[0]!.parts).toHaveLength(1);
    await expect(page.getByTestId('stand-part')).toHaveCount(1);
    await expect(page.getByTestId('shape-hint')).toContainText('Belegt wie gezeichnet');
    // neuer Teil 3 × 3 m rechts oben: B × T wird 11 × 4 m
    await page.getByTestId('stand-part-add').click();
    await expect(page.getByTestId('stand-part')).toHaveCount(2);
    expect((await stands(page))[0]).toMatchObject({ w: 11, d: 4, cx: 25.5, cy: 8 });
    // Tiefe des neuen Teils 4 m: berührt jetzt die Vorderseite → automatisch 11 Frontmeter
    await page.locator('#sp-h-1').fill('4');
    await page.locator('#sp-h-1').press('Enter');
    await expect(page.locator('#st-front')).toHaveAttribute('placeholder', 'automatisch 11');
    // Drehung des neuen Teils um 90°
    await page.locator('#sp-rot-1').fill('90');
    await page.locator('#sp-rot-1').press('Enter');
    expect(((await stands(page))[0]!.parts as { rot: number }[])[1]!.rot).toBe(90);
    // Frontmeter von Hand; leer = wieder automatisch
    await page.locator('#st-front').fill('9,5');
    await page.locator('#st-front').press('Enter');
    expect((await stands(page))[0]!.frontOverride).toBe(9.5);
    await page.locator('#st-front').fill('');
    await page.locator('#st-front').press('Enter');
    expect((await stands(page))[0]!.frontOverride).toBeNull();
    // Form auflösen: zwei einzelne Stände, ein Undo-Schritt
    const n = await past(page);
    await page.getByTestId('dissolve-stand').click();
    expect(await past(page)).toBe(n + 1);
    const list = await stands(page);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 's1', name: 'Imbiss', w: 8, d: 4, parts: null });
    expect(await selection(page)).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test('Formvorlage „belegt wie gezeichnet“ (Schalter im Editor, Standard aus)', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await openSettings(page);
    const panel = page.getByRole('region', { name: 'Formvorlagen' });
    await panel.getByTestId('shape-add').click();
    const editor = page.getByTestId('shape-editor');
    const box = editor.getByTestId('shape-occupies').getByRole('checkbox');
    await expect(box).not.toBeChecked();
    await expect(editor).toContainText('Belegung, Warnungen und Fang rechnen mit dem Hüllrechteck.');
    await box.check();
    await expect(editor).toContainText('Belegung, Warnungen, Treffer, Fang und Frontmeter rechnen mit den Teilen.');
    await editor.getByRole('button', { name: 'Übernehmen' }).click();
    expect(await store(page, 's.project.shapeTemplates[0].occupies')).toBe(true);
    await expect(panel.getByTestId('shape-row')).toContainText('belegt wie gezeichnet');
    await backToPage(page);
    expect(errors).toEqual([]);
  });

  test('Speichern schreibt Formatversion 15 mit eigener Form und Frontmeter von Hand', async ({ page }) => {
    await openApp(page);
    await seed(page, [{ id: 'b06', cx: 30, cy: 16, w: 25, d: 12, parts: B06_PARTS, frontOverride: 24 }]);
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const bytes = readFileSync((await (await download).path())!);
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['project.json']!));
    expect(json.schemaVersion).toBe(15);
    expect(json.project.pages[0].stands[0]).toMatchObject({ parts: B06_PARTS, frontOverride: 24 });
  });
});
