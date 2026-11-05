import { expect, test, type Page } from '@playwright/test';
import { artifact, canvasBox, collectErrors, MOD, openApp, origin, pageTabs, pointerOnCanvas, scale, tabbar } from './helpers';

/**
 * #17: Festplatz ohne Grundflächen (z. B. Obermarkt). Schalter „Grundflächen verwenden“ im Seitenleisten-Bereich
 * „Grundflächen“ (spec.md §2). Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px.
 * Grundfläche G: 50 × 10 m, Vorderseite bei y = 0 von x = −25 bis 25.
 */

type P = { x: number; y: number };
const G = { id: 'G', name: 'Brunnenseite', cx: 0, cy: -5, w: 50, d: 10, rot: 0 };

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const activePage = async (page: Page) => {
  const s = await st(page);
  return s.project.pages.find((p: any) => p.id === s.ui.activePage);
};
const badge = (page: Page) => pageTabs(page).nth(1).getByTestId('warn-badge');
const areasPanel = (page: Page) => page.getByRole('region', { name: 'Grundflächen' });
const useAreas = (page: Page) => areasPanel(page).getByTestId('use-areas');
const dialog = (page: Page) => page.getByRole('alertdialog', { name: 'Ohne Grundflächen planen' });
const areaTool = (page: Page) => page.getByRole('navigation', { name: 'Werkzeuge' }).getByRole('button', { name: 'Grundfläche erstellen' });
const layerNames = (page: Page) => page.getByRole('region', { name: 'Ebenen' }).locator('.layer-name');

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

async function drag(page: Page, a: P, b: P, opts: { keepDown?: boolean } = {}) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (!opts.keepDown) await page.mouse.up();
}

/** Grundfläche G, Stand s1 darin, Stand s2 weit außerhalb (Warnung „außerhalb“). */
async function seed(page: Page, stands: any[] = [{ id: 's1', cx: -20, cy: -1.5 }, { id: 's2', cx: 0, cy: 25 }]) {
  await page.evaluate(
    ({ area, list }) => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, rot: 0, w: 3, d: 3 };
      s.change('Testdaten', (p: any) => {
        const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
        pg.areas.push(area);
        for (const x of list) pg.stands.push({ ...base, ...x });
      });
      s.setUi({ selection: null });
    },
    { area: G, list: stands },
  );
}

test.describe('#17 Festplatz ohne Grundflächen', () => {
  test('Neue Page verwendet Grundflächen; Einschalten ohne Rückfrage; ohne Grundflächen keine Rückfrage beim Abschalten', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await expect(useAreas(page)).toBeChecked();
    expect((await activePage(page)).useAreas).toBe(true);
    const n0 = (await st(page)).history.past.length;
    await useAreas(page).uncheck();
    await expect(dialog(page)).toHaveCount(0);
    await expect(useAreas(page)).not.toBeChecked();
    await expect(areasPanel(page).getByTestId('use-areas-hint')).toContainText('keine Warnung „außerhalb“');
    expect((await st(page)).history.past.length).toBe(n0 + 1);
    await useAreas(page).check();
    await expect(useAreas(page)).toBeChecked();
    expect((await st(page)).history.past.length).toBe(n0 + 2);
    // Eine neue Page startet wieder mit Grundflächen
    await useAreas(page).uncheck();
    await tabbar(page).getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await expect(useAreas(page)).toBeChecked();
    expect(errors).toEqual([]);
  });

  test('Abschalten mit Grundflächen: Abbrechen, Behalten (ausgeblendet, wirken nicht) und Löschen, je ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await expect(page.locator('.area')).toHaveCount(1);
    await expect(page.locator('.free-space')).toHaveCount(2);
    await expect(badge(page)).toHaveText('1');
    await expect(page.getByTestId('legend')).toContainText('Grundfläche');
    await expect(layerNames(page)).toHaveText(['Grundflächen', 'Freiflächen', 'Geschäfte', 'Beschriftung', 'Blatt']);
    const n0 = (await st(page)).history.past.length;

    // Abbrechen: nichts ändert sich
    await useAreas(page).uncheck();
    await expect(dialog(page)).toContainText('„Festplatz 1“ hat eine Grundfläche');
    await dialog(page).getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(useAreas(page)).toBeChecked();
    expect((await st(page)).history.past.length).toBe(n0);

    // Behalten: Grundfläche gespeichert, aber ausgeblendet; keine Freiflächen, keine Warnung „außerhalb“
    await useAreas(page).uncheck();
    await dialog(page).getByRole('button', { name: 'Grundflächen behalten' }).click();
    await expect(useAreas(page)).not.toBeChecked();
    await expect(areasPanel(page).getByTestId('use-areas-hint')).toContainText('Eine Grundfläche ist ausgeblendet und wirkt nicht.');
    expect((await activePage(page)).areas.map((a: any) => a.id)).toEqual(['G']);
    expect((await st(page)).history.past.length).toBe(n0 + 1);
    await expect(page.locator('.area')).toHaveCount(0);
    await expect(page.locator('.free-space')).toHaveCount(0);
    await expect(page.locator('.free-label')).toHaveCount(0);
    await expect(badge(page)).toHaveCount(0);
    await expect(page.getByTestId('legend')).not.toContainText('Grundfläche');
    await expect(page.getByTestId('legend')).not.toContainText('Freifläche');
    await expect(layerNames(page)).toHaveText(['Geschäfte', 'Beschriftung', 'Blatt']);
    // Ausgeblendete Grundfläche ist nicht auswählbar (Klick auf ihre leere Fläche, Alles auswählen)
    // Mitten in der ausgeblendeten Grundfläche, abseits von Ständen und Papier-Elementen
    const empty = await w2s(page, { x: -10, y: -5 });
    await page.mouse.click(empty.x, empty.y);
    expect((await st(page)).ui.selection).toBeNull();
    await pointerOnCanvas(page, empty.x, empty.y);
    await page.keyboard.press(`${MOD}+a`);
    expect((await st(page)).ui.selection.ids.toSorted()).toEqual(['s1', 's2']);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: artifact('ohne-grundflaechen-behalten.png') });

    // Werkzeug „Grundfläche“ gesperrt, Tooltip nennt den Grund; die Taste F meldet ihn
    await expect(areaTool(page)).toBeDisabled();
    await expect(areaTool(page)).toHaveAttribute('data-tip-desc', /keine Grundflächen/);
    await pointerOnCanvas(page, empty.x, empty.y);
    await page.keyboard.press('f');
    await expect(page.locator('.toast')).toContainText('Dieser Festplatz verwendet keine Grundflächen');
    expect((await st(page)).ui.tool).toBe('select');

    // Undo: ein Schritt, alles wie vorher
    await page.keyboard.press(`${MOD}+z`);
    await expect(useAreas(page)).toBeChecked();
    await expect(page.locator('.area')).toHaveCount(1);
    await expect(page.locator('.free-space')).toHaveCount(2);
    await expect(badge(page)).toHaveText('1');
    await expect(areaTool(page)).toBeEnabled();

    // Löschen: Grundfläche entfernt, ein Undo-Schritt
    await useAreas(page).uncheck();
    await dialog(page).getByRole('button', { name: 'Grundflächen löschen' }).click();
    await expect(useAreas(page)).not.toBeChecked();
    expect((await activePage(page)).areas).toEqual([]);
    expect((await st(page)).history.past.length).toBe(n0 + 1);
    await expect(areasPanel(page).getByTestId('use-areas-hint')).not.toContainText('ausgeblendet');
    await page.keyboard.press(`${MOD}+z`);
    expect((await activePage(page)).areas.map((a: any) => a.id)).toEqual(['G']);
    await expect(useAreas(page)).toBeChecked();
    expect(errors).toEqual([]);
  });

  test('Aktives Werkzeug „Grundfläche“ wechselt beim Abschalten zur Auswahl', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await areaTool(page).click();
    expect((await st(page)).ui.tool).toBe('area');
    await useAreas(page).uncheck();
    await expect.poll(async () => (await st(page)).ui.tool).toBe('select');
    expect(errors).toEqual([]);
  });

  test('Start-Page: freie Frontmeter „–“, nicht in der Summe, Hinweis „ohne Grundflächen“', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    // Festplatz 1 mit Grundfläche (50 m, Stand 3 m → 47 m frei), Festplatz 2 ohne Grundflächen
    await seed(page);
    await tabbar(page).getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await seed(page, [{ id: 't1', cx: 0, cy: 0, w: 4 }]);
    await useAreas(page).uncheck();
    await dialog(page).getByRole('button', { name: 'Grundflächen behalten' }).click();
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();

    const cards = page.getByTestId('stat-page');
    await expect(cards.nth(0).getByTestId('stat-free')).toHaveText('47 m');
    await expect(cards.nth(0).getByTestId('stat-no-areas')).toHaveCount(0);
    await expect(cards.nth(1).getByTestId('stat-free')).toHaveText('–');
    await expect(cards.nth(1).getByTestId('stat-no-areas')).toHaveText('ohne Grundflächen');
    // Frontmeter bleiben die Standbreite
    await expect(cards.nth(1).getByTestId('stat-front')).toHaveText('4 m');
    await expect(page.getByTestId('stat-total').getByTestId('stat-free')).toHaveText('47 m');
    await page.screenshot({ path: artifact('ohne-grundflaechen-kennzahlen.png') });
    expect(errors).toEqual([]);
  });

  test('Fang: keine Vorderkante an (ausgeblendeten) Grundflächen; Nachbarstände rasten weiter ein', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, [
      { id: 'm', cx: -10, cy: -7, rot: 17 },
      { id: 'k', cx: -10, cy: 20 },
      { id: 'n', cx: 10, cy: 20 },
    ]);
    // Mit Grundflächen rastet m an der Vorderseite ein
    await drag(page, { x: -10, y: -7 }, { x: -10, y: -2 }, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="front"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await useAreas(page).uncheck();
    await dialog(page).getByRole('button', { name: 'Grundflächen behalten' }).click();
    await drag(page, { x: -10, y: -7 }, { x: -10, y: -2 }, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="front"]')).toHaveCount(0);
    await page.mouse.up();
    const m = (await activePage(page)).stands.find((x: any) => x.id === 'm');
    expect(m).toMatchObject({ cx: -10, cy: -2, rot: 17 });

    // Nachbar n (linke Kante bei 8,5 m) mit Fang-Abstand 0,3 m: k rastet mit der rechten Kante bei 8,2 m ein
    await drag(page, { x: -10, y: 20 }, { x: 6.4, y: 20 }, { keepDown: true });
    await expect(page.locator('[data-testid="snap-guides"] [data-kind="contact"]')).toHaveCount(1);
    await page.mouse.up();
    expect((await activePage(page)).stands.find((x: any) => x.id === 'k')).toMatchObject({ cx: 6.7, cy: 20 });
    expect(errors).toEqual([]);
  });
});
