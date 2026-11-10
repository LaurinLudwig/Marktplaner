import { expect, test, type Page } from '@playwright/test';
import { artifact, collectErrors, MOD, openApp, openSettings, tabbar } from './helpers';

/**
 * #27: Jeder Festplatz behält im Verbund sein eigenes Koordinatensystem, der Verbund speichert nur die Lage
 * (welt = R(rot) · lokal + (x, y)). Ziegelturm (Grundfläche x 0–50, y −10–0) und Seestraße (Grundfläche x 45–95, SE-02 bei
 * x 46–49) im Verbund „Unterstadt“, beide anfangs mit der Lage „keine Verschiebung, keine Drehung“.
 */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const VIEW = { scale: 6, tx: 300, ty: 350 };
const REF = 'verbund:u';

async function seed(page: Page) {
  await page.evaluate(
    ({ view, ref }) => {
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
        sp.areas = [{ id: 'GS', name: 'Seestraße', cx: 70, cy: -5, w: 50, d: 10, rot: 0 }];
        sp.stands = [{ ...base, id: 'se2', nr: 'SE-02', name: 'Crêpes', cx: 47.5 }];
        p.pages.push(sp);
        p.groups.push({
          id: 'u',
          name: 'Unterstadt',
          pageIds: [z.id, 'S'],
          placements: { [z.id]: { x: 0, y: 0, rot: 0 }, S: { x: 0, y: 0, rot: 0 } },
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
      for (const id of [s.project.pages[0].id, 'S', ref]) s.setView(id, view);
    },
    { view: VIEW, ref: REF },
  );
}

/** Weltpunkt → Bildschirmpunkt (Ansicht `VIEW`, in allen Tabs gleich). */
async function w2s(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  return { x: box.x + VIEW.tx + p.x * VIEW.scale, y: box.y + VIEW.ty + p.y * VIEW.scale };
}

/** Bildschirm-Mitte des Stands SE-02 auf der Zeichenfläche. */
async function se2Center(page: Page) {
  const b = (await page.locator('.layer-stands [data-id="se2"]').first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const expectNear = (a: { x: number; y: number }, b: { x: number; y: number }, px = 1) => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(px);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(px);
};

test.describe('#27 Lage im Verbund', () => {
  test('Platz im Verbund drehen: Einzelansicht bleibt ungedreht (Stand an derselben Bildschirmstelle), Gesamtansicht zeigt ihn gedreht', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await tabbar(page).getByRole('tab', { name: 'Seestraße' }).click();
    const before = await se2Center(page);
    expectNear(before, await w2s(page, { x: 47.5, y: -1.5 }));

    // Lage der Seestraße: 90° um ihre Mitte (70|−5)
    await openSettings(page);
    const row = page.getByTestId('verbund-panel').getByTestId('verbund-row');
    await row.getByTestId('verbund-member').nth(1).getByTestId('verbund-lage').click();
    const rot = row.getByTestId('verbund-lage-editor').getByLabel('Drehung');
    await rot.fill('90');
    await rot.press('Enter');
    const s = await st(page);
    expect(s.project.groups[0].placements.S.rot).toBe(90);
    const sp = s.project.pages.find((p: any) => p.id === 'S');
    expect(sp.stands[0]).toMatchObject({ cx: 47.5, cy: -1.5, rot: 0 });
    expect(sp.northAngle).toBe(0);

    // Einzelansicht: unverändert, auch die Ansicht
    await tabbar(page).getByRole('tab', { name: 'Seestraße' }).click();
    expectNear(await se2Center(page), before);
    expect((await st(page)).views.S).toEqual(VIEW);
    await page.screenshot({ path: artifact('verbund-lage-einzelansicht.png') });

    // Gesamtansicht: SE-02 gedreht an (66,5|−27,5) = R(90°) · (47,5|−1,5) + (65|−75)
    await tabbar(page).getByTestId('verbund-tab').click();
    expectNear(await se2Center(page), await w2s(page, { x: 66.5, y: -27.5 }));
    await page.screenshot({ path: artifact('verbund-lage-gesamtansicht.png') });
    expect(errors).toEqual([]);
  });

  test('„Platz in der Einzelansicht drehen“: dreht nur die Einzelansicht, die Gesamtansicht bleibt; ein Undo-Schritt; „Wie in der Gesamtansicht“ stellt zurück', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await tabbar(page).getByTestId('verbund-tab').click();
    const overviewBefore = await se2Center(page);

    await tabbar(page).getByRole('tab', { name: 'Seestraße' }).click();
    await page.getByTestId('rotate-in-place-open').click();
    const panel = page.getByTestId('rotate-in-place');
    const n0 = (await st(page)).history.past.length;
    await panel.getByLabel('Einzelansicht drehen um').fill('30');
    await panel.getByTestId('rotate-in-place-apply').click();
    let s = await st(page);
    expect(s.history.past.length).toBe(n0 + 1);
    let sp = s.project.pages.find((p: any) => p.id === 'S');
    // Inhalt um die Mitte des Platzes (70|−5) gedreht, die Lage gleicht aus
    expect(sp.areas[0]).toMatchObject({ cx: 70, cy: -5, rot: 30 });
    expect(sp.stands[0].rot).toBe(30);
    expect(sp.northAngle).toBe(30);
    expect(s.project.groups[0].placements.S.rot).toBe(330);
    // Die Ansicht folgt: die Mitte des Platzes bleibt an ihrer Bildschirmstelle
    const v = s.views.S;
    expect(70 * v.scale + v.tx).toBeCloseTo(70 * VIEW.scale + VIEW.tx, 6);
    expect(-5 * v.scale + v.ty).toBeCloseTo(-5 * VIEW.scale + VIEW.ty, 6);

    // Gesamtansicht: SE-02 an derselben Stelle wie vorher
    await tabbar(page).getByTestId('verbund-tab').click();
    expectNear(await se2Center(page), overviewBefore);

    // Zurück: „Wie in der Gesamtansicht“ dreht um die Drehung der Lage (−30°)
    await tabbar(page).getByRole('tab', { name: 'Seestraße' }).click();
    await page.getByTestId('rotate-in-place-open').click();
    await expect(page.getByTestId('rotate-in-place-overview')).toContainText('-30');
    await page.getByTestId('rotate-in-place-overview').click();
    s = await st(page);
    sp = s.project.pages.find((p: any) => p.id === 'S');
    expect(sp.areas[0]).toMatchObject({ cx: 70, cy: -5, rot: 0 });
    expect(s.project.groups[0].placements.S).toEqual({ x: 0, y: 0, rot: 0 });
    await expect(page.getByTestId('rotate-in-place-overview')).toHaveCount(0);

    // Undo: wieder um 30° gedreht, noch einmal Undo: Ausgangslage
    await page.locator('.panel-head').first().click();
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(s.project.pages.find((p: any) => p.id === 'S').areas[0].rot).toBe(30);
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(s.project.pages.find((p: any) => p.id === 'S').areas[0].rot).toBe(0);
    expect(s.project.groups[0].placements.S).toEqual({ x: 0, y: 0, rot: 0 });
    expect(s.views.S).toEqual(VIEW);
    expect(errors).toEqual([]);
  });

  test('Gesamtansicht bei gedrehter Lage: Ziehen eines Stands landet in den Koordinaten seines Platzes', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    // Seestraße um 90° gedreht: welt = R(90°) · lokal + (65|−75), SE-02 in der Welt bei (66,5|−27,5)
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Lage', (p: any) => {
        p.groups[0].placements.S = { x: 65, y: -75, rot: 90 };
      });
    });
    await tabbar(page).getByTestId('verbund-tab').click();
    const from = await w2s(page, { x: 66.5, y: -27.5 });
    const to = await w2s(page, { x: 66.5, y: -22.5 });
    await page.mouse.click(from.x, from.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    // Welt +5 m nach unten = lokal +5 m in x
    const sp = (await st(page)).project.pages.find((p: any) => p.id === 'S');
    expect(sp.stands[0]).toMatchObject({ cx: 52.5, cy: -1.5, rot: 0 });
    expect(errors).toEqual([]);
  });
});
