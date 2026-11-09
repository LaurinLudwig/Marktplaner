import { expect, test, type Page } from '@playwright/test';
import { artifact, collectErrors, hoverTooltip, MOD, openApp, tabbar } from './helpers';

/**
 * #15 Teil b: Gesamtansicht eines Verbunds mit Bearbeiten und Werkzeug „Ausrichten“. Ziegelturm (Grundfläche x 0–50,
 * y −10–0, Vorderseite y = 0, Stand Z-01 bei x 10) und Seestraße (Grundfläche x 45–95, SE-02 bei x 46–49) im Verbund
 * „Unterstadt“; die Grundflächen überschneiden sich bei x 45–50. Für „Ausrichten“ liegt die Seestraße anfangs 100 m
 * weiter rechts.
 */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const VIEW = { scale: 8, tx: 100, ty: 300 };
/**
 * Für „Ausrichten“ liegt die Seestraße 100 m weiter rechts (x 145–195): Bei 8 px/m läge sie außerhalb der Zeichenfläche
 * (rund 980 px breit), deshalb dort 4 px/m. Gilt für den laufenden Test (jeder Test ruft zuerst `seed`).
 */
const VIEW_FAR = { scale: 4, tx: 100, ty: 300 };
let view = VIEW;
const REF = 'verbund:u';

async function seed(page: Page, { shift = 0 } = {}) {
  view = shift ? VIEW_FAR : VIEW;
  await page.evaluate(
    ({ dx, v, ref }) => {
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
      for (const id of [s.project.pages[0].id, 'S', ref]) s.setView(id, v);
    },
    { dx: shift, v: view, ref: REF },
  );
}

/** Weltpunkt → Bildschirmpunkt (Ansicht des laufenden Tests, `seed`). */
async function w2s(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  return { x: box.x + view.tx + p.x * view.scale, y: box.y + view.ty + p.y * view.scale };
}

async function dragWorld(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await w2s(page, from);
  const b = await w2s(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function clickWorld(page: Page, p: { x: number; y: number }) {
  const a = await w2s(page, p);
  await page.mouse.click(a.x, a.y);
}

/** Fokus aus Auswahllisten und Feldern nehmen, damit Kurzbefehle greifen (in Feldern sind sie gesperrt). */
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const overviewTab = (page: Page) => tabbar(page).getByTestId('verbund-tab');
const past = async (page: Page) => (await st(page)).history.past.length;
const standsOf = async (page: Page, id: string) => ((await st(page)).project.pages.find((p: any) => p.id === id)?.stands ?? []).map((s: any) => s.id);
const firstId = async (page: Page) => (await st(page)).project.pages[0].id as string;

test.describe('#15 Gesamtansicht (Teil b)', () => {
  test('Tab „Unterstadt (gesamt)“ vor den Mitgliedern; Stand im Überschneidungsbereich zeichnen: in beiden Einzelansichten, nur eine Statistik', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    const names = await tabbar(page).locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(names.slice(1, 4)).toEqual(['Unterstadt (gesamt)', expect.stringContaining('Ziegelturm'), expect.stringContaining('Seestraße')]);
    await overviewTab(page).click();
    expect((await st(page)).ui.activePage).toBe(REF);
    await expect(page.locator('.controlbar .title')).toHaveText('Unterstadt (gesamt)');
    // Objekte beider Plätze, keine Nachbarn
    await expect(page.locator('.layer-stands [data-id="z1"]')).toHaveCount(1);
    await expect(page.locator('.layer-stands [data-id="se2"]')).toHaveCount(1);
    await expect(page.locator('.layer-neighbours [data-neighbour]')).toHaveCount(0);

    // Überschneidungsbereich (x 45–50): steht auf beiden Grundflächen → „Neue Objekte auf: …“ entscheidet
    await page.getByTestId('new-objects-on').selectOption({ label: 'Seestraße' });
    await blur(page);
    await page.keyboard.press('g');
    const n0 = await past(page);
    await dragWorld(page, { x: 46, y: -9 }, { x: 48.5, y: -6.5 });
    expect(await past(page)).toBe(n0 + 1);
    const s = await st(page);
    const id = s.ui.selection.ids[0] as string;
    expect(await standsOf(page, 'S')).toContain(id);
    expect(await standsOf(page, await firstId(page))).not.toContain(id);
    await page.screenshot({ path: artifact('verbund-gesamtansicht.png') });

    // Seestraße: eigener Stand; Ziegelturm: Nachbar
    await tabbar(page).getByRole('tab', { name: 'Seestraße' }).click();
    await expect(page.locator(`.layer-stands [data-id="${id}"]`)).toHaveCount(1);
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    await expect(page.locator(`.layer-neighbours [data-neighbour="${id}"]`)).toHaveCount(1);
    await expect(page.locator(`.layer-stands [data-id="${id}"]`)).toHaveCount(0);

    // Statistik: nur bei der Seestraße
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    const card = (n: string) => page.locator(`[data-testid="stat-page"][aria-label="${n}"]`);
    await expect(card('Ziegelturm').getByTestId('stat-stands')).toHaveText('1');
    await expect(card('Seestraße').getByTestId('stat-stands')).toHaveText('2');
    await expect(page.getByTestId('stat-total').getByTestId('stat-stands')).toHaveText('3');

    // Auf nur einer Grundfläche (Ziegelturm, x 20): automatisch dort, trotz „Neue Objekte auf: Seestraße“
    await overviewTab(page).click();
    await page.keyboard.press('g');
    await dragWorld(page, { x: 20, y: -9 }, { x: 23, y: -6 });
    const id2 = (await st(page)).ui.selection.ids[0] as string;
    expect(await standsOf(page, await firstId(page))).toContain(id2);
    expect(errors).toEqual([]);
  });

  test('Verschieben und Löschen über beide Plätze je ein Undo-Schritt, Besitz bleibt; Undo/Redo über alle Schritte', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await overviewTab(page).click();
    await page.keyboard.press('v');
    const z = await firstId(page);
    // Auswahl über die Platzgrenze: Z-01 und SE-02 mit Shift
    await clickWorld(page, { x: 10, y: -1.5 });
    const se = await w2s(page, { x: 47.5, y: -1.5 });
    await page.keyboard.down('Shift');
    await page.mouse.click(se.x, se.y);
    await page.keyboard.up('Shift');
    expect((await st(page)).ui.selection.ids.toSorted()).toEqual(['se2', 'z1']);
    const n0 = await past(page);
    // Ziehen: beide 5 m nach rechts; SE-02 steht danach nur noch auf der Seestraße, Z-01 nur auf dem Ziegelturm
    await dragWorld(page, { x: 10, y: -1.5 }, { x: 15, y: -1.5 });
    expect(await past(page)).toBe(n0 + 1);
    let s = await st(page);
    const stand = (id: string) => s.project.pages.flatMap((p: any) => p.stands).find((x: any) => x.id === id);
    expect(stand('z1').cx).toBeCloseTo(15, 1);
    expect(stand('se2').cx).toBeCloseTo(52.5, 1);
    expect(await standsOf(page, z)).toEqual(['z1']);
    expect(await standsOf(page, 'S')).toEqual(['se2']);
    // Löschen beider: ein Schritt
    await page.keyboard.press('Delete');
    expect(await past(page)).toBe(n0 + 2);
    expect(await standsOf(page, z)).toEqual([]);
    expect(await standsOf(page, 'S')).toEqual([]);
    // Undo über alle Schritte, dann Redo
    await page.keyboard.press(`${MOD}+z`);
    expect(await standsOf(page, z)).toEqual(['z1']);
    expect(await standsOf(page, 'S')).toEqual(['se2']);
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(stand('z1').cx).toBe(10);
    expect(stand('se2').cx).toBe(47.5);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect(await standsOf(page, 'S')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('Umhängen per Feld „Festplatz“: ein Undo-Schritt, Statistik folgt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await overviewTab(page).click();
    await page.keyboard.press('v');
    await clickWorld(page, { x: 47.5, y: -1.5 });
    const owner = page.getByTestId('obj-owner');
    await expect(owner).toHaveValue('S');
    const n0 = await past(page);
    await owner.selectOption({ label: 'Ziegelturm' });
    expect(await past(page)).toBe(n0 + 1);
    const z = await firstId(page);
    expect(await standsOf(page, z)).toEqual(['z1', 'se2']);
    expect(await standsOf(page, 'S')).toEqual([]);
    await expect(owner).toHaveValue(z);
    // Verschieben ändert die Zuordnung nicht
    await dragWorld(page, { x: 47.5, y: -1.5 }, { x: 70, y: -1.5 });
    expect(await standsOf(page, z)).toEqual(['z1', 'se2']);
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    expect(await standsOf(page, 'S')).toEqual(['se2']);
    expect(errors).toEqual([]);
  });

  test('Nummerieren, Hintergrund und Kalibrieren in der Gesamtansicht gesperrt; Seitenleiste zeigt den Verbund', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await overviewTab(page).click();
    // Seitenleiste ohne Auswahl: Bereich „Verbund“ statt der Page-Einstellungen
    await expect(page.getByTestId('overview-verbund')).toBeVisible();
    await expect(page.getByTestId('overview-verbund').getByTestId('verbund-member')).toHaveText(['Ziegelturm', 'Seestraße']);
    await expect(page.getByTestId('overview-locked')).toContainText('Nummerierung');
    await expect(page.getByRole('region', { name: 'Nummerierung' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Strom' })).toHaveCount(0);
    // Neu nummerieren per Taste: kein Dialog, Hinweis
    const n0 = await past(page);
    await blur(page);
    await page.keyboard.press(`${MOD}+Alt+n`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.toast').last()).toContainText('Gesamtansicht');
    expect(await past(page)).toBe(n0);
    // Kalibrieren ausgegraut, mit Begründung
    const calibrate = page.getByRole('button', { name: /Kalibrieren/ });
    await expect(calibrate).toBeDisabled();
    expect(await hoverTooltip(page, calibrate)).toContain('In der Gesamtansicht gesperrt');
    // Ausrichten gibt es nur hier
    await expect(page.getByRole('button', { name: /Ausrichten/ }).first()).toBeEnabled();
    await tabbar(page).getByRole('tab', { name: 'Ziegelturm' }).click();
    await expect(page.locator('nav.toolbar').getByRole('button', { name: /Ausrichten/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Nummerierung' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Verbund über das Tab-Menü anlegen und umbenennen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Seite', (p: any) => {
        p.pages[0].name = 'Bleiche';
        p.pages.push({ ...JSON.parse(JSON.stringify(p.pages[0])), id: 'S', name: 'Schifftor' });
      });
    });
    await tabbar(page).getByRole('tab', { name: 'Bleiche' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Neuer Verbund mit „Bleiche“/ }).click();
    await expect(overviewTab(page)).toHaveText('Verbund (gesamt)');
    await tabbar(page).getByRole('tab', { name: 'Schifftor' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'In Verbund aufnehmen' }).hover();
    await page.getByRole('menuitem', { name: /^Verbund/ }).last().click();
    expect((await st(page)).project.groups[0].pageIds).toHaveLength(2);
    await overviewTab(page).dblclick();
    const input = tabbar(page).getByLabel('Name des Festplatzes');
    await input.fill('Unterstadt');
    await input.press('Enter');
    await expect(overviewTab(page)).toHaveText('Unterstadt (gesamt)');
    // Erstes Öffnen ohne gespeicherte Ansicht: automatisch „An Fenster anpassen“ (danach gilt diese Ansicht)
    const s = await st(page);
    expect(s.ui.activePage).toBe(`verbund:${s.project.groups[0].id}`);
    expect(s.views[`verbund:${s.project.groups[0].id}`]).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('Ausrichten per Ziehen: ganze Page samt Hintergrund, ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await overviewTab(page).click();
    await page.keyboard.press('a');
    await expect(page.getByTestId('align-panel')).toBeVisible();
    const n0 = await past(page);
    // Klick auf SE-02 wählt die Seestraße, Ziehen um 100 m nach links
    await dragWorld(page, { x: 147.5, y: -1.5 }, { x: 47.5, y: -1.5 });
    expect(await past(page)).toBe(n0 + 1);
    await expect(page.getByTestId('align-member')).toHaveValue('S');
    let s = await st(page);
    const sp = () => s.project.pages.find((p: any) => p.id === 'S');
    expect(sp().areas[0]).toMatchObject({ cx: 70, cy: -5 });
    expect(sp().stands[0]).toMatchObject({ cx: 47.5, cy: -1.5 });
    expect(s.project.pages[0].areas[0]).toMatchObject({ cx: 25 });
    // Drehung als Zahl: 90° um die Mitte des Platzes, ein Schritt
    await page.getByTestId('align-rot').fill('90');
    await page.getByTestId('align-rot').press('Enter');
    s = await st(page);
    expect(sp().areas[0].rot).toBe(90);
    expect(s.history.past.length).toBe(n0 + 2);
    await blur(page);
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(sp().areas[0]).toMatchObject({ cx: 170, rot: 0 });
    await page.keyboard.press(`${MOD}+Shift+z`);
    s = await st(page);
    expect(sp().areas[0]).toMatchObject({ cx: 70, rot: 0 });
    expect(errors).toEqual([]);
  });

  test('Ausrichten per 2 Punkten: Abweichungshinweis, Esc bricht ab, „Anwenden“ ist ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await overviewTab(page).click();
    await page.keyboard.press('a');
    await page.getByTestId('align-member').selectOption({ label: 'Seestraße' });
    await page.getByTestId('align-two-point').click();
    // Abstände 50 m und 50,5 m: Hinweis mit Abweichung (Punkte ohne Fang mit Cmd/Strg)
    await clickWorld(page, { x: 145, y: -10 });
    await page.keyboard.down(MOD);
    await clickWorld(page, { x: 45, y: -10 });
    await page.keyboard.up(MOD);
    await clickWorld(page, { x: 195, y: -10 });
    await page.keyboard.down(MOD);
    await clickWorld(page, { x: 95.5, y: -10 });
    await page.keyboard.up(MOD);
    await expect(page.getByTestId('align-deviation')).toContainText('Abweichung 0,5 m');
    const n0 = await past(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('align-result')).toHaveCount(0);
    expect(await past(page)).toBe(n0);
    expect((await st(page)).project.pages.find((p: any) => p.id === 'S').areas[0].cx).toBe(170);

    // Passende Punkte: Ecken der Seestraße auf ihre echte Lage
    await page.getByTestId('align-two-point').click();
    await clickWorld(page, { x: 145, y: -10 });
    await page.keyboard.down(MOD);
    await clickWorld(page, { x: 45, y: -10 });
    await page.keyboard.up(MOD);
    await clickWorld(page, { x: 195, y: -10 });
    await page.keyboard.down(MOD);
    await clickWorld(page, { x: 95, y: -10 });
    await page.keyboard.up(MOD);
    await expect(page.getByTestId('align-result')).toContainText('Drehung 0');
    await expect(page.getByTestId('align-deviation')).toHaveCount(0);
    await page.getByTestId('align-apply').click();
    expect(await past(page)).toBe(n0 + 1);
    let s = await st(page);
    const sp = () => s.project.pages.find((p: any) => p.id === 'S');
    expect(sp().areas[0]).toMatchObject({ cx: 70, cy: -5, rot: 0 });
    expect(sp().stands[0]).toMatchObject({ cx: 47.5 });
    await page.screenshot({ path: artifact('verbund-ausrichten.png') });
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(sp().areas[0].cx).toBe(170);
    expect(errors).toEqual([]);
  });
});
