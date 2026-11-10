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

/** 1×1-PNG als Hintergrund (für die Deckkraft beim Ausrichten, #26). */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seed(page: Page, { shift = 0, backgrounds = false } = {}) {
  view = shift ? VIEW_FAR : VIEW;
  await page.evaluate(
    ({ dx, v, ref, png }) => {
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
        if (png) {
          const bg = (x: number) => ({ assetId: 'bg-1px.png', fileName: 'plan.png', kind: 'image', pxSize: { w: 1, h: 1 }, transform: { x, y: -30, rot: 0, metersPerPx: 50 }, opacity: 1, locked: true });
          z.background = bg(0);
          sp.background = bg(45 + dx);
        }
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
      if (png) s.addAsset('bg-1px.png', Uint8Array.from(atob(png), (c) => c.charCodeAt(0)));
      for (const id of [s.project.pages[0].id, 'S', ref]) s.setView(id, v);
    },
    { dx: shift, v: view, ref: REF, png: backgrounds ? PNG_1PX : '' },
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
/**
 * Seestraße in der Gesamtansicht (#27, Entscheidung 2026-11-10): Ausrichten ändert nur die Lage im Verbund
 * (`groups[0].placements.S`, welt = R(rot) · lokal + (x, y)), der Inhalt der Page bleibt in ihren eigenen Koordinaten.
 * Die Prüfungen der Ausrichten-Tests rechnen deshalb mit der Lage. Angepasst vom Entwickler.
 */
function worldS(s: any) {
  const pg = s.project.pages.find((p: any) => p.id === 'S');
  const pl = s.project.groups[0].placements?.S ?? { x: 0, y: 0, rot: 0 };
  const a = (pl.rot * Math.PI) / 180;
  const [c, n] = [Math.cos(a), Math.sin(a)];
  const map = (o: any) => ({ ...o, cx: c * o.cx - n * o.cy + pl.x, cy: n * o.cx + c * o.cy + pl.y, rot: (((o.rot + pl.rot) % 360) + 360) % 360 });
  return { ...pg, areas: pg.areas.map(map), stands: pg.stands.map(map) };
}
const near = (o: any, e: { cx?: number; cy?: number; rot?: number }) => {
  for (const [k, v] of Object.entries(e)) expect(o[k], k).toBeCloseTo(v, 6);
};
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

  // #26: Die beiden früheren Tests („Ausrichten per Ziehen“ mit je einem Undo-Schritt pro Ziehen und pro Drehung,
  // „Ausrichten per 2 Punkten“ mit dem Knopf „2 Punkte …“) sind durch die gewünschte Bedienung überholt: Ziehen und
  // Drehen sammeln sich in einer Sitzung bis „Fertig“, der Modus „Punkte“ mit beliebig vielen Paaren ersetzt „2 Punkte“.
  // Ihre Prüfungen (ganze Page samt Objekten, Lage nach dem Übernehmen, Undo/Redo, Esc verwirft) stecken in den Tests unten.

  test('Ausrichten manuell: Ziehen und Drehen sammeln sich, „Fertig“ ist ein Undo-Schritt, Undo/Redo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await overviewTab(page).click();
    await page.keyboard.press('a');
    await expect(page.getByTestId('align-panel')).toBeVisible();
    await expect(page.getByTestId('align-mode-manual')).toHaveAttribute('aria-pressed', 'true');
    const n0 = await past(page);
    // Klick auf SE-02 wählt die Seestraße, Ziehen um 100 m nach links: nur Vorschau
    await dragWorld(page, { x: 147.5, y: -1.5 }, { x: 47.5, y: -1.5 });
    await expect(page.getByTestId('align-member')).toHaveValue('S');
    expect(await past(page)).toBe(n0);
    await expect(page.getByTestId('align-dx')).toHaveValue('-100');
    await expect(page.getByTestId('align-dy')).toHaveValue('0');
    let s = await st(page);
    const sp = () => worldS(s);
    expect(sp().areas[0]).toMatchObject({ cx: 170, cy: -5 });
    // Vorschau der Objekte: SE-02 steht schon an der neuen Stelle
    expect(s.preview.rects.se2.cx).toBeCloseTo(47.5, 6);
    // Weiteres Ziehen (von überall, der Platz bleibt fest) sammelt sich
    await dragWorld(page, { x: 20, y: -30 }, { x: 25, y: -30 });
    await expect(page.getByTestId('align-dx')).toHaveValue('-95');
    await dragWorld(page, { x: 25, y: -30 }, { x: 20, y: -30 });
    await expect(page.getByTestId('align-dx')).toHaveValue('-100');
    // Drehung im Gradfeld (Vorschau), Enter = „Fertig“: ein Undo-Schritt für Verschiebung und Drehung
    await page.getByTestId('align-rot').fill('90');
    expect(await past(page)).toBe(n0);
    await page.getByTestId('align-rot').press('Enter');
    expect(await past(page)).toBe(n0 + 1);
    s = await st(page);
    // Drehung um die Mitte des Platzes (170|−5), danach verschoben: Grundfläche bei (70|−5), SE-02 bei (66,5|−27,5)
    near(sp().areas[0], { cx: 70, cy: -5, rot: 90 });
    expect(sp().stands[0].cx).toBeCloseTo(66.5, 6);
    expect(sp().stands[0].cy).toBeCloseTo(-27.5, 6);
    expect(s.project.pages[0].areas[0]).toMatchObject({ cx: 25 });
    // #27: die Seestraße selbst bleibt in ihren eigenen Koordinaten (Einzelansicht ungedreht)
    expect(s.project.pages.find((p: any) => p.id === 'S').areas[0]).toMatchObject({ cx: 170, cy: -5, rot: 0 });
    await expect(page.getByTestId('align-done')).toBeDisabled();
    await blur(page);
    await expect(page.getByTestId('align-rot')).toHaveValue('0');
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(sp().areas[0]).toMatchObject({ cx: 170, rot: 0 });
    expect(s.history.past.length).toBe(n0);
    await page.keyboard.press(`${MOD}+Shift+z`);
    s = await st(page);
    near(sp().areas[0], { cx: 70, rot: 90 });
    expect(errors).toEqual([]);
  });

  test('Ausrichten manuell: Drehgriff mit Shift, „Abbrechen“ und Esc verwerfen, Platzwechsel verwirft mit Hinweis', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await overviewTab(page).click();
    await page.keyboard.press('a');
    await page.getByTestId('align-member').selectOption({ label: 'Seestraße' });
    await blur(page);
    const n0 = await past(page);
    // Drehgriff über der Mitte des oberen Rands; Ziehen nach rechts neben die Mitte (170|−5) = 90° im Uhrzeigersinn
    const handle = page.getByTestId('align-rotate-handle');
    await expect(handle).toHaveCount(1);
    const hb = (await handle.boundingBox())!;
    const center = await w2s(page, { x: 170, y: -5 });
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 3, { steps: 10 });
    await page.mouse.move(center.x + 60, center.y + 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('align-rot')).toHaveValue('90');
    expect(await past(page)).toBe(n0);
    let s = await st(page);
    expect(s.preview.rects.GS.rot).toBe(90);
    // „Abbrechen“: nichts geändert, keine Vorschau
    await page.getByTestId('align-cancel').click();
    await expect(page.getByTestId('align-rot')).toHaveValue('0');
    s = await st(page);
    expect(s.preview).toBeNull();
    expect(worldS(s).areas[0]).toMatchObject({ cx: 170, rot: 0 });
    expect(s.history.past.length).toBe(n0);
    // Esc verwirft ebenso
    await dragWorld(page, { x: 147.5, y: -1.5 }, { x: 140, y: -1.5 });
    await expect(page.getByTestId('align-dx')).toHaveValue('-7,5');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('align-dx')).toHaveValue('0');
    expect((await st(page)).preview).toBeNull();
    // Platzwechsel in der Auswahl bei offenen Änderungen: verworfen, mit Hinweis
    await dragWorld(page, { x: 147.5, y: -1.5 }, { x: 140, y: -1.5 });
    await page.getByTestId('align-member').selectOption({ label: 'Ziegelturm' });
    await expect(page.locator('.toast').last()).toContainText('Änderungen an „Seestraße“ verworfen');
    await expect(page.getByTestId('align-dx')).toHaveValue('0');
    s = await st(page);
    expect(worldS(s).areas[0].cx).toBe(170);
    expect(s.history.past.length).toBe(n0);
    expect(errors).toEqual([]);
  });

  test('Ausrichten: Deckkraft-Regler wirkt nur auf den Hintergrund des gewählten Platzes, der dabei oben liegt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { backgrounds: true });
    await overviewTab(page).click();
    const bgImage = (id: string) => page.locator(`.layer-plan .background-layer[data-page="${id}"] > g.background-image`);
    const z = await firstId(page);
    await expect(bgImage('S')).toHaveAttribute('opacity', '1');
    await page.keyboard.press('a');
    await page.getByTestId('align-member').selectOption({ label: 'Ziegelturm' });
    // Vorgabe 50 %; die Seestraße bleibt deckend; der Ziegelturm liegt jetzt oben (sonst läge er unter der Seestraße)
    await expect(page.getByTestId('align-opacity')).toHaveValue('50');
    await expect(bgImage(z)).toHaveAttribute('opacity', '0.5');
    await expect(bgImage('S')).toHaveAttribute('opacity', '1');
    await expect(page.locator('.layer-plan .background-layer').last()).toHaveAttribute('data-page', z);
    await page.getByTestId('align-opacity').fill('20');
    await expect(page.getByTestId('align-panel')).toContainText('20 %');
    await expect(bgImage(z)).toHaveAttribute('opacity', '0.2');
    // Nur Anzeige: nicht in der Page
    const s = await st(page);
    expect(s.project.pages[0].background.opacity).toBe(1);
    // Anderes Werkzeug: wieder deckend und in der Reihenfolge des Verbunds
    await blur(page);
    await page.keyboard.press('v');
    await expect(bgImage(z)).toHaveAttribute('opacity', '1');
    await expect(page.locator('.layer-plan .background-layer').last()).toHaveAttribute('data-page', 'S');
    // Die gewählte Deckkraft bleibt für die Sitzung
    await page.keyboard.press('a');
    await expect(page.getByTestId('align-opacity')).toHaveValue('20');
    expect(errors).toEqual([]);
  });

  test('Ausrichten per Punkten: der Plan, auf dem der nächste Punkt gefragt ist, ist deckend, der andere blass', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { backgrounds: true });
    await overviewTab(page).click();
    const bgImage = (id: string) => page.locator(`.layer-plan .background-layer[data-page="${id}"] > g.background-image`);
    const z = await firstId(page);
    await page.keyboard.press('a');
    await page.getByTestId('align-member').selectOption({ label: 'Ziegelturm' });
    await expect(bgImage(z)).toHaveAttribute('opacity', '0.5');
    await page.getByTestId('align-mode-points').click();
    await blur(page);
    // A gesucht: der gewählte Plan deckend (und oben), die Referenz blass; der Regler zeigt die Referenz
    await expect(page.getByTestId('align-step')).toContainText('A1 auf „Ziegelturm“');
    await expect(bgImage(z)).toHaveAttribute('opacity', '1');
    await expect(bgImage('S')).toHaveAttribute('opacity', '0.25');
    await expect(page.locator('.layer-plan .background-layer').last()).toHaveAttribute('data-page', z);
    await expect(page.getByTestId('align-opacity')).toHaveValue('25');
    // B gesucht: umgekehrt, der gewählte Plan bleibt oben
    await page.keyboard.down(MOD);
    await clickWorld(page, { x: 10, y: 10 });
    await page.keyboard.up(MOD);
    await expect(page.getByTestId('align-step')).toContainText('B1 auf Referenzplan');
    await expect(bgImage(z)).toHaveAttribute('opacity', '0.25');
    await expect(bgImage('S')).toHaveAttribute('opacity', '1');
    await expect(page.locator('.layer-plan .background-layer').last()).toHaveAttribute('data-page', z);
    // Der Regler stellt den gerade nicht gefragten Plan ein
    await page.getByTestId('align-opacity').fill('40');
    await expect(bgImage(z)).toHaveAttribute('opacity', '0.4');
    await page.keyboard.down(MOD);
    await clickWorld(page, { x: 20, y: 10 });
    await page.keyboard.up(MOD);
    await expect(page.getByTestId('align-step')).toContainText('A2 auf „Ziegelturm“');
    await expect(bgImage(z)).toHaveAttribute('opacity', '1');
    await expect(bgImage('S')).toHaveAttribute('opacity', '0.4');
    // Zurück zu „Manuell“: wieder der eigene Wert für den gewählten Plan, die anderen deckend
    await page.getByTestId('align-mode-manual').click();
    await expect(bgImage(z)).toHaveAttribute('opacity', '0.5');
    await expect(bgImage('S')).toHaveAttribute('opacity', '1');
    expect(errors).toEqual([]);
  });

  test('Ausrichten per Punkten: 3 Paare mit Restabweichungen, Paar entfernen, Esc verwirft, „Anwenden“ ist ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await overviewTab(page).click();
    await page.keyboard.press('a');
    await page.getByTestId('align-member').selectOption({ label: 'Seestraße' });
    await page.getByTestId('align-mode-points').click();
    await blur(page);
    await expect(page.getByTestId('align-step')).toContainText('A1 auf „Seestraße“');
    /** A mit Fang (Ecke der Grundfläche, wie angezeigt), B ohne Fang (Cmd/Strg). */
    const pair = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      await clickWorld(page, a);
      await page.keyboard.down(MOD);
      await clickWorld(page, b);
      await page.keyboard.up(MOD);
    };
    await pair({ x: 145, y: -10 }, { x: 45, y: -10 });
    await expect(page.getByTestId('align-pair')).toHaveCount(1);
    await expect(page.getByTestId('align-apply')).toBeDisabled();
    await pair({ x: 195, y: -10 }, { x: 95, y: -10 });
    await expect(page.getByTestId('align-residual')).toHaveText(['0 m', '0 m']);
    // Ab 2 Paaren Vorschau: Die Seestraße liegt schon an ihrer echten Stelle, A3 wird auf ihr gesetzt (95|0 statt 195|0)
    expect((await st(page)).preview.rects.GS.cx).toBeCloseTo(70, 6);
    await pair({ x: 95, y: 0 }, { x: 95.5, y: 0 });
    await expect(page.getByTestId('align-pair')).toHaveCount(3);
    await expect(page.getByTestId('align-residual')).toHaveText(['0,173 m', '0,163 m', '0,322 m']);
    await expect(page.getByTestId('align-result')).toContainText('Mittel 0,231 m · max 0,322 m');
    await expect(page.getByTestId('align-mark')).toHaveCount(3);
    await page.screenshot({ path: artifact('verbund-ausrichten-punkte.png') });
    const n0 = await past(page);
    // Paar 3 entfernen: wieder exakt
    await page.getByTestId('align-pair-remove').nth(2).click();
    await expect(page.getByTestId('align-residual')).toHaveText(['0 m', '0 m']);
    // Esc verwirft alle Paare
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('align-pairs')).toHaveCount(0);
    let s = await st(page);
    expect(s.preview).toBeNull();
    expect(worldS(s).areas[0].cx).toBe(170);
    expect(s.history.past.length).toBe(n0);

    // Drei exakte Paare (das dritte auf dem verschobenen Plan), „Anwenden“ = ein Undo-Schritt
    await pair({ x: 145, y: -10 }, { x: 45, y: -10 });
    await pair({ x: 195, y: -10 }, { x: 95, y: -10 });
    await pair({ x: 95, y: 0 }, { x: 95, y: 0 });
    await expect(page.getByTestId('align-result')).toContainText('Drehung 0');
    await expect(page.getByTestId('align-outlier')).toHaveCount(0);
    await page.getByTestId('align-apply').click();
    expect(await past(page)).toBe(n0 + 1);
    await expect(page.getByTestId('align-pairs')).toHaveCount(0);
    s = await st(page);
    const sp = () => worldS(s);
    expect(sp().areas[0].cx).toBeCloseTo(70, 6);
    expect(sp().areas[0].cy).toBeCloseTo(-5, 6);
    expect(sp().areas[0].rot).toBe(0);
    expect(sp().stands[0].cx).toBeCloseTo(47.5, 6);
    await blur(page);
    await page.keyboard.press(`${MOD}+z`);
    s = await st(page);
    expect(sp().areas[0].cx).toBe(170);
    await page.keyboard.press(`${MOD}+Shift+z`);
    s = await st(page);
    expect(sp().areas[0].cx).toBeCloseTo(70, 6);
    expect(errors).toEqual([]);
  });

  test('Ausrichten: Leertaste (Hand) behält offene Änderungen, Esc beim Ziehen bricht nur das Ziehen ab, Werkzeugwechsel verwirft', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { shift: 100 });
    await overviewTab(page).click();
    await page.keyboard.press('a');
    await page.getByTestId('align-member').selectOption({ label: 'Seestraße' });
    await blur(page);
    const n0 = await past(page);
    await dragWorld(page, { x: 147.5, y: -1.5 }, { x: 140, y: -1.5 });
    await expect(page.getByTestId('align-dx')).toHaveValue('-7,5');
    // Esc während eines zweiten Ziehens: nur dieses Ziehen fällt weg, die Sitzung bleibt
    const a = await w2s(page, { x: 140, y: -1.5 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x - 40, a.y, { steps: 6 });
    await expect(page.getByTestId('align-dx')).toHaveValue('-17,5');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('align-dx')).toHaveValue('-7,5');
    await page.mouse.move(a.x - 60, a.y, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId('align-dx')).toHaveValue('-7,5');
    // Leertaste gedrückt halten und die Ansicht verschieben: die Sitzung bleibt offen, Panel und Vorschau bleiben
    await page.keyboard.down('Space');
    await page.mouse.move(a.x, a.y + 80);
    await page.mouse.down();
    await page.mouse.move(a.x - 50, a.y + 80, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await expect(page.getByTestId('align-dx')).toHaveValue('-7,5');
    expect((await st(page)).preview.rects.se2.cx).toBeCloseTo(140, 6);
    // Modus „Punkte“: ein gesetzter A-Punkt bleibt über die Leertaste erhalten
    await page.getByTestId('align-mode-points').click();
    await blur(page);
    const c = (await page.locator('svg.canvas').boundingBox())!;
    await page.mouse.click(c.x + 300, c.y + 200);
    await expect(page.getByTestId('align-step')).toContainText('B1 auf Referenzplan');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect(page.getByTestId('align-step')).toContainText('B1 auf Referenzplan');
    await expect(page.getByTestId('align-mark')).toHaveCount(1);
    // Werkzeugwechsel verwirft: keine Vorschau im Store, zurück im Werkzeug ist nichts offen
    await page.getByTestId('align-mode-manual').click();
    await blur(page);
    await page.getByTestId('align-dx').fill('3');
    await blur(page);
    expect((await st(page)).preview).not.toBeNull();
    await page.keyboard.press('v');
    expect((await st(page)).preview).toBeNull();
    await page.keyboard.press('a');
    await expect(page.getByTestId('align-dx')).toHaveValue('0');
    const s = await st(page);
    expect(s.preview).toBeNull();
    expect(worldS(s).areas[0].cx).toBe(170);
    expect(s.history.past.length).toBe(n0);
    expect(errors).toEqual([]);
  });
});
