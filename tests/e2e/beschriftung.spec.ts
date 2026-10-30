import { expect, test, type Page } from '@playwright/test';
import { artifact, collectErrors, MOD, openApp } from './helpers';

/** #9: Beschriftung umbrechen, sonst hinter dem Stand (dann davor, weiter weg) mit Führungslinie; von Hand verschiebbar. */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const label = (page: Page, id: string) => page.locator(`.layer-labels .stand-label[data-id="${id}"]`);
const leader = (page: Page, id: string) => page.locator(`.layer-labels .label-leader[data-leader="${id}"]`);

/** Grundfläche mit Vorderseite unten (y = 10); drei Stände an der Vorderseite, lange Kategorie. */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = {
      nrLocked: false, ware: '', connection: null, note: '', color: null, rot: 0, shape: 'rect', shapeTemplateId: null, labelOffset: null,
      suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, suppressDistanceWarning: false,
    };
    s.change('Testdaten', (p: any) => {
      p.settings.labelTemplate = '{nr}\n{name}\n{eigentuemer}\n{kategorie}\n{breite}×{tiefe} m\n{strom} kW';
      p.categories.push({ id: 'sp', name: 'Spielgeschäft – Wurf- und Geschicklichkeit', color: '#9b6fc0', minDistance: null, price: null }, { id: 'sw', name: 'Süßwaren – Waffeln', color: '#e07a9a', minDistance: null, price: null });
      p.pages[0].areas.push({ id: 'a1', name: 'Müllerwiese', cx: 15, cy: 0, w: 40, d: 20, rot: 0 });
      p.pages[0].stands.push(
        { ...base, id: 'big', nr: 'MW-3', name: 'Grillhaus', owner: 'Schmitt', powerKw: 11, w: 9, d: 14, cx: 0.5, cy: 3, categoryId: null },
        { ...base, id: 'lukas', nr: 'MW-4', name: 'Hau den Lukas', owner: 'Bootsma', powerKw: 3.5, w: 7, d: 5, cx: 9, cy: 7.5, categoryId: 'sp' },
        { ...base, id: 'corn', nr: 'MW-5', name: 'Corn Dogs', owner: 'J. Weinheimer', powerKw: 3.5, w: 4, d: 3.5, cx: 15, cy: 8.25, categoryId: 'sw' },
      );
    });
    s.setView(s.project.pages[0].id, { scale: 22, tx: 250, ty: 140 });
  });
}

test.describe('#9 Beschriftung', () => {
  test('passt → auf dem Stand; sonst hinter dem Stand mit Führungslinie, ohne Überschneidung', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await expect(label(page, 'big')).toHaveAttribute('data-mode', 'inside');
    await expect(leader(page, 'big')).toHaveCount(0);
    for (const id of ['lukas', 'corn']) {
      await expect(label(page, id)).not.toHaveAttribute('data-mode', 'inside');
      await expect(leader(page, id)).toHaveCount(1);
    }
    // hinter dem Stand = oberhalb (Vorderseite der Grundfläche unten); kein Text überdeckt einen anderen
    const box = async (id: string) => (await label(page, id).boundingBox())!;
    const lukas = await box('lukas');
    const corn = await box('corn');
    const stand = (await page.locator('.stand[data-id="lukas"]').boundingBox())!;
    expect(lukas.y + lukas.height).toBeLessThanOrEqual(stand.y + 1);
    expect(lukas.x + lukas.width <= corn.x || corn.x + corn.width <= lukas.x || lukas.y + lukas.height <= corn.y || corn.y + corn.height <= lukas.y).toBe(true);
    // umbrochen: die lange Kategorie steht auf mehreren Zeilen
    expect(await label(page, 'lukas').locator('tspan').count()).toBeGreaterThan(6);
    await page.screenshot({ path: artifact('beschriftung-ausgelagert.png') });
    expect(errors).toEqual([]);
  });

  test('ausgelagerte Beschriftung ziehen: Position gespeichert, ein Undo-Schritt; Klick wählt den Stand; zurücksetzen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    const b = (await label(page, 'lukas').boundingBox())!;
    const n0 = (await st(page)).history.past.length;

    // Klick ohne Ziehen: Stand ausgewählt, nichts geändert
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    expect((await st(page)).ui.selection).toEqual({ kind: 'objects', ids: ['lukas'] });
    expect((await st(page)).history.past.length).toBe(n0);

    // Ziehen: 110 px nach rechts = 5 m
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2 + 110, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    const s1 = (await st(page)).project.pages[0].stands.find((x: any) => x.id === 'lukas');
    expect(s1.cx).toBe(9); // der Stand bleibt stehen
    expect(s1.labelOffset).not.toBeNull();
    expect((await st(page)).history.past.length).toBe(n0 + 1);
    await expect(label(page, 'lukas')).toHaveAttribute('data-mode', 'manual');
    const moved = (await label(page, 'lukas').boundingBox())!;
    expect(moved.x - b.x).toBeGreaterThan(100);

    // Rückgängig und wiederherstellen
    await page.keyboard.press(`${MOD}+z`);
    await expect(label(page, 'lukas')).not.toHaveAttribute('data-mode', 'manual');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(label(page, 'lukas')).toHaveAttribute('data-mode', 'manual');

    // Seitenleiste: zurücksetzen
    await page.getByRole('button', { name: 'Beschriftung zurücksetzen' }).click();
    await expect(label(page, 'lukas')).not.toHaveAttribute('data-mode', 'manual');
    expect((await st(page)).project.pages[0].stands.find((x: any) => x.id === 'lukas').labelOffset).toBeNull();
    await expect(page.getByRole('button', { name: 'Beschriftung zurücksetzen' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('beim Ziehen eines Stands folgt seine Beschriftung starr; neu platziert wird beim Loslassen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    const l0 = (await label(page, 'corn').boundingBox())!;
    const s = (await page.locator('.stand[data-id="corn"]').boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 20, s.y + s.height / 2, { steps: 3 });
    await page.mouse.move(s.x + s.width / 2 + 220, s.y + s.height / 2, { steps: 8 });
    const during = (await label(page, 'corn').boundingBox())!;
    expect(during.x - l0.x).toBeCloseTo(220, -1);
    expect(during.y).toBeCloseTo(l0.y, 0);
    await page.mouse.up();
    // nach dem Loslassen: weit weg von den Nachbarn ist direkt hinter dem Stand frei
    await expect(label(page, 'corn')).toHaveAttribute('data-mode', 'behind');
    expect(errors).toEqual([]);
  });
});
