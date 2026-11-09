import { expect, test, type Page } from '@playwright/test';
import { artifact, collectErrors, MOD, openApp, openSettings, tabbar } from './helpers';

/**
 * #15 Teil a: Festplatz-Verbund. Ziegelturm (Grundfläche x 0–50, Vorderseite y = 0) und Seestraße (Grundfläche x 45–95,
 * SE-02 im Überschneidungsbereich x 46–49). Für den Test „Lage“ liegt die Seestraße anfangs 100 m weiter rechts.
 */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const VIEW = { scale: 10, tx: 100, ty: 300 };

/** Zwei Festplätze anlegen; `shift` = Versatz der Seestraße in x, `verbund` = gleich als Verbund „Unterstadt“. */
async function seed(page: Page, { shift = 0, verbund = false } = {}) {
  await page.evaluate(
    ({ dx, asGroup, view }) => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nrLocked: false, owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, suppressDistanceWarning: false, shape: 'rect', shapeTemplateId: null, labelOffset: null, parts: null, frontOverride: null, rot: 0, w: 3, d: 3, cy: -1.5 };
      s.change('Testdaten', (p: any) => {
        const z = p.pages[0];
        z.name = 'Ziegelturm';
        z.areas.push({ id: 'GZ', name: 'Ziegelturm', cx: 25, cy: -5, w: 50, d: 10, rot: 0 });
        z.stands.push({ ...base, id: 'z1', nr: 'Z-01', name: 'Waffeln', cx: 10 });
        const sp = JSON.parse(JSON.stringify(z));
        sp.id = 'S';
        sp.name = 'Seestraße';
        sp.areas = [{ id: 'GS', name: 'Seestraße', cx: 70 + dx, cy: -5, w: 50, d: 10, rot: 0 }];
        sp.stands = [{ ...base, id: 'se2', nr: 'SE-02', name: 'Crêpes', cx: 47.5 + dx }];
        p.pages.push(sp);
        if (asGroup)
          p.groups.push({
            id: 'u',
            name: 'Unterstadt',
            pageIds: [z.id, 'S'],
            sheet: JSON.parse(JSON.stringify(z.sheet)),
            titleBlock: { ...z.titleBlock },
            titleBlockText: '',
            legend: { ...z.legend },
            scaleBar: { ...z.scaleBar },
            northArrow: { ...z.northArrow },
            layers: JSON.parse(JSON.stringify(z.layers)),
            view: null,
          });
      });
      s.setView(s.project.pages[0].id, view);
      s.setView('S', view);
    },
    { dx: shift, asGroup: verbund, view: VIEW },
  );
}

/** Weltpunkt → Bildschirmpunkt (Ansicht `VIEW`). */
async function w2s(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  return { x: box.x + VIEW.tx + p.x * VIEW.scale, y: box.y + VIEW.ty + p.y * VIEW.scale };
}

// Nach Namen statt nach Position: Seit Teil b steht vor dem ersten Mitglied der Tab der Gesamtansicht (#15)
const badge = (page: Page, name: string) => tabbar(page).getByRole('tab', { name }).getByTestId('warn-badge');

test.describe('#15 Festplatz-Verbund (Teil a)', () => {
  test('Verbund aus zwei Pages anlegen und die Lage der Seestraße per Zahlenfeld verschieben, mit Undo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await openSettings(page);
    const panel = page.getByTestId('verbund-panel');
    await panel.getByTestId('verbund-add').click();
    const row = panel.getByTestId('verbund-row');
    await expect(row).toHaveCount(1);
    const name = row.getByLabel('Name');
    await name.fill('Unterstadt');
    await name.press('Enter');
    await row.getByTestId('verbund-member-add').selectOption({ label: 'Ziegelturm' });
    await row.getByTestId('verbund-member-add').selectOption({ label: 'Seestraße' });
    await expect(row.getByTestId('verbund-member')).toHaveText(['Ziegelturm', 'Seestraße']);
    expect((await st(page)).project.groups).toMatchObject([{ name: 'Unterstadt', pageIds: [expect.any(String), 'S'] }]);

    // Lage der Seestraße: 100 m nach links, ein Undo-Schritt
    await row.getByTestId('verbund-member').nth(1).getByTestId('verbund-lage').click();
    const editor = row.getByTestId('verbund-lage-editor');
    await expect(editor).toContainText('ganze Page samt');
    const dx = editor.getByLabel('Verschieben X');
    await dx.fill('-100');
    await dx.press('Enter');
    const n0 = (await st(page)).history.past.length;
    await editor.getByTestId('verbund-lage-apply').click();
    let s = await st(page);
    expect(s.history.past.length).toBe(n0 + 1);
    const sp = () => s.project.pages.find((p: any) => p.id === 'S');
    expect(sp().areas[0]).toMatchObject({ cx: 70, cy: -5 });
    expect(sp().stands[0]).toMatchObject({ cx: 47.5, cy: -1.5 });

    await panel.locator('.panel-head').click();
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(sp().stands[0].cx).toBe(147.5);
    await page.keyboard.press(`${MOD}+Shift+z`);
    s = await st(page);
    expect(sp().stands[0].cx).toBe(47.5);
    await page.screenshot({ path: artifact('verbund-einstellungen.png') });
    expect(errors).toEqual([]);
  });

  test('Lage: Drehen per Zahlenfeld ohne Enter, „Anwenden“ dreht die ganze Page um ihre Mitte, ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { verbund: true });
    await openSettings(page);
    const row = page.getByTestId('verbund-panel').getByTestId('verbund-row');
    await row.getByTestId('verbund-member').nth(1).getByTestId('verbund-lage').click();
    const editor = row.getByTestId('verbund-lage-editor');
    // Drehpunkt: Mitte von Grundfläche (x 45–95, y −10–0) und SE-02
    await expect(editor).toContainText('70 / -5 m');
    await editor.getByLabel('Drehen').fill('90');
    const n0 = (await st(page)).history.past.length;
    // direkt klicken: Das Feld übernimmt beim Verlassen, „Anwenden“ sieht schon den neuen Wert
    await editor.getByTestId('verbund-lage-apply').click();
    let s = await st(page);
    expect(s.history.past.length).toBe(n0 + 1);
    const sp = () => s.project.pages.find((p: any) => p.id === 'S');
    expect(sp().areas[0]).toMatchObject({ cx: 70, cy: -5, rot: 90 });
    expect(sp().stands[0]).toMatchObject({ rot: 90 });
    expect(Math.hypot(sp().stands[0].cx - 70, sp().stands[0].cy + 5)).toBeCloseTo(Math.hypot(22.5, 3.5), 6);
    expect(sp().northAngle).toBe(90);
    // Felder zurückgesetzt; der Ziegelturm bleibt, wie er war
    await expect(editor.getByLabel('Drehen')).toHaveValue('0');
    expect(s.project.pages[0].areas[0]).toMatchObject({ cx: 25, cy: -5, rot: 0 });
    await page.getByTestId('verbund-panel').locator('.panel-head').click();
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(sp().areas[0]).toMatchObject({ cx: 70, cy: -5, rot: 0 });
    expect(sp().stands[0]).toMatchObject({ cx: 47.5, cy: -1.5, rot: 0 });
    expect(sp().northAngle).toBe(0);
    expect(errors).toEqual([]);
  });

  test('Stand im Überschneidungsbereich: blass beim Nachbarn, belegt dort die Freifläche, zählt nur in einer Statistik; Doppelklick springt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { verbund: true });
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    const nb = page.locator('.layer-neighbours [data-neighbour="se2"]');
    await expect(nb).toHaveCount(1);
    await expect(page.locator('.neighbour-label[data-neighbour="se2"]')).toHaveText('SE-02 · Seestraße');
    // nicht als eigener Stand
    await expect(page.locator('.layer-stands [data-id="se2"]')).toHaveCount(0);
    // Freiflächen des Ziegelturms: 0–8,5, 11,5–46 und 49–50 m
    await expect(page.locator('.layer-free .free-space')).toHaveCount(3);
    await expect(page.getByTestId('page-verbund')).toHaveText('Unterstadt · mit Seestraße');
    await page.screenshot({ path: artifact('verbund-nachbarn.png') });

    // Ein Klick wählt den Nachbarn nicht aus (getroffen wird die eigene Grundfläche darunter)
    const c = await w2s(page, { x: 47.5, y: -1.5 });
    await page.mouse.click(c.x, c.y);
    expect((await st(page)).ui.selection).toEqual({ kind: 'objects', ids: ['GZ'] });

    // Statistik: SE-02 zählt nur bei der Seestraße
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    const card = (n: string) => page.locator(`[data-testid="stat-page"][aria-label="${n}"]`);
    await expect(card('Ziegelturm').getByTestId('stat-stands')).toHaveText('1');
    await expect(card('Seestraße').getByTestId('stat-stands')).toHaveText('1');
    await expect(page.getByTestId('stat-total').getByTestId('stat-stands')).toHaveText('2');

    // Doppelklick springt zum Besitzer und wählt den Stand dort aus
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    const d = await w2s(page, { x: 47.5, y: -1.5 });
    await page.mouse.dblclick(d.x, d.y);
    await expect.poll(async () => (await st(page)).ui.activePage).toBe('S');
    expect((await st(page)).ui.selection).toEqual({ kind: 'objects', ids: ['se2'] });
    expect(errors).toEqual([]);
  });

  test('Überlappung mit einem Nachbarstand warnt am eigenen Stand, auf beiden Plätzen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { verbund: true });
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Stand', (p: any) => {
        p.pages[0].stands.push({ ...p.pages[0].stands[0], id: 'z2', nr: 'Z-02', name: 'Mandeln', cx: 48.5 });
      });
    });
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    await expect(badge(page, 'Ziegelturm')).toHaveText('1');
    await expect(badge(page, 'Ziegelturm')).toHaveClass(/overlap/);
    await expect(badge(page, 'Seestraße')).toHaveText('1');
    await expect(page.locator('.layer-stands [data-id="z2"]')).toHaveAttribute('data-warning', 'overlap');
    await expect(page.locator('.layer-stands [data-id="z1"]')).not.toHaveAttribute('data-warning', /./);
    const c = await w2s(page, { x: 49.5, y: -0.5 });
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId('warn-chip-overlap')).toHaveText('Überlappt mit Nr. SE-02 · Crêpes (Seestraße)');
    expect(errors).toEqual([]);
  });

  test('Nachbarstände sind Fangziele: bündig mit Fang-Abstand an den Nachbarplatz anschließen', async ({ page }) => {
    await openApp(page);
    await seed(page, { verbund: true });
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    const from = await w2s(page, { x: 10, y: -1.5 });
    // links neben SE-02 (Kante bei x = 46), knapp außerhalb des Fang-Abstands 0,3 m
    const to = await w2s(page, { x: 44.4, y: -1.5 });
    await page.mouse.click(from.x, from.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
    const z1 = (await st(page)).project.pages[0].stands.find((x: any) => x.id === 'z1');
    expect(z1.cx).toBe(44.2);
  });
});
