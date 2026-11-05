import { expect, test, type Page } from '@playwright/test';
import { canvasBox, collectErrors, MOD, openApp, origin, scale } from './helpers';

/**
 * #12: Nummerierung in weiteren Richtungen, gegen den Uhrzeigersinn und in eigener Richtung über zwei Punkte
 * (spec.md §5). Standardansicht: Ursprung in der Mitte der Zeichenfläche, 1 m = 10 px, y nach unten.
 */

type P = { x: number; y: number };

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const lastLabel = (page: Page) => store(page, 's.history.past.at(-1)?.label ?? null') as Promise<string | null>;
const direction = (page: Page) => store(page, 's.project.pages[0].direction ?? null') as Promise<{ from: P; to: P } | null>;
/** IDs der Stände der aktiven Page, sortiert nach ihrer Nummer. */
const orderByNr = async (page: Page) => {
  const m = (await store(page, 'Object.fromEntries(s.project.pages.find((p) => p.id === s.ui.activePage).stands.map((x) => [x.id, x.nr]))')) as Record<string, string>;
  return Object.entries(m)
    .toSorted((a, b) => Number(a[1]) - Number(b[1]))
    .map(([id]) => id);
};

const BASE = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, suppressDistanceWarning: false, shape: 'rect', shapeTemplateId: null, labelOffset: null };

/** Stände (2 × 2 m) auf die aktive Page legen, ein Undo-Schritt „Testdaten“. */
async function seed(page: Page, stands: { id: string; cx: number; cy: number }[]) {
  await page.evaluate(
    ({ list, base }) => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
        for (const st of list) pg.stands.push({ ...base, rot: 0, w: 2, d: 2, ...st });
      });
    },
    { list: stands, base: BASE },
  );
}

async function w2s(page: Page, p: P) {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

const panel = (page: Page) => page.getByRole('region', { name: 'Nummerierung' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Neu nummerieren' });
const marker = (page: Page) => page.getByTestId('direction-marker');

async function fillIn(label: string, value: string, page: Page) {
  const f = panel(page).getByLabel(label, { exact: true });
  await f.fill(value);
  await f.press('Enter');
}

/** „Neu nummerieren“ in der Seitenleiste, „Alle neu nummerieren“, übernehmen. */
async function renumber(page: Page) {
  await panel(page).getByRole('button', { name: /Neu nummerieren/ }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('radio', { name: /^Alle neu nummerieren/ }).check();
  await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog(page)).toHaveCount(0);
}

const near = (p: P, q: P) => Math.abs(p.x - q.x) < 0.15 && Math.abs(p.y - q.y) < 0.15;

test.describe('#12: Nummerierung in weiteren Richtungen', () => {
  // Gitter 3 × 2: Spalten x = −10, 0, 10; Zeilen y = −5 (oben) und 5 (unten)
  const GRID = [
    { id: 'lo', cx: -10, cy: -5 },
    { id: 'mo', cx: 0, cy: -5 },
    { id: 'ro', cx: 10, cy: -5 },
    { id: 'lu', cx: -10, cy: 5 },
    { id: 'mu', cx: 0, cy: 5 },
    { id: 'ru', cx: 10, cy: 5 },
  ];

  test('Modus in zwei Stufen: Linear + Richtung (→ ← ↓ ↑), Kreis + Drehsinn; Neu nummerieren folgt dem Modus', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, GRID);
    const richtung = panel(page).getByRole('group', { name: 'Richtung' });
    // Standard: Linear, links → rechts
    await expect(panel(page).getByLabel('Modus')).toHaveValue('frontLtr');
    await expect(richtung.getByRole('button', { name: 'Links → rechts', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await richtung.getByRole('button', { name: 'Rechts → links', exact: true }).click();
    expect(await store(page, 's.project.pages[0].numberingMode')).toBe('rightToLeft');
    expect(await lastLabel(page)).toBe('Nummerierungsmodus ändern');
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['ro', 'ru', 'mo', 'mu', 'lo', 'lu']);

    await richtung.getByRole('button', { name: 'Oben → unten', exact: true }).click();
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['lo', 'mo', 'ro', 'lu', 'mu', 'ru']);

    await richtung.getByRole('button', { name: 'Unten → oben', exact: true }).click();
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['lu', 'mu', 'ru', 'lo', 'mo', 'ro']);

    // Kreis: im Uhrzeigersinn (Vorgabe), dann gegen den Uhrzeigersinn; Fadenkreuz mit Drehpfeil im Drehsinn
    await panel(page).getByLabel('Modus').selectOption({ label: 'Kreis um einen Mittelpunkt' });
    expect(await store(page, 's.project.pages[0].numberingMode')).toBe('clockwise');
    await expect(richtung).toHaveCount(0);
    await expect(page.getByTestId('clockwise-marker')).toHaveAttribute('data-sense', 'cw');
    await panel(page).getByLabel('Drehsinn').selectOption('counterClockwise');
    expect(await store(page, 's.project.pages[0].numberingMode')).toBe('counterClockwise');
    await expect(page.getByTestId('clockwise-marker')).toHaveAttribute('data-sense', 'ccw');
    // Mittelpunkt (0, 0), Start Norden: mo liegt genau im Norden, dann gegen den Uhrzeigersinn
    expect(await store(page, 's.project.pages[0].clockwise')).toEqual({ center: { x: 0, y: 0 }, startAngle: 0 });
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['mo', 'lo', 'lu', 'mu', 'ru', 'ro']);

    // Zurück auf Linear: links → rechts
    await panel(page).getByLabel('Modus').selectOption({ label: 'Linear in einer Richtung' });
    expect(await store(page, 's.project.pages[0].numberingMode')).toBe('frontLtr');
    await expect(page.getByTestId('clockwise-marker')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Eigene Richtung: Vorgabe wie links → rechts, Pfeil A → B, Richtung per Werkzeug setzen (ein Undo-Schritt), Neu nummerieren', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, [
      { id: 's1', cx: -20, cy: -10 },
      { id: 's2', cx: 0, cy: 0 },
      { id: 's3', cx: 20, cy: 10 },
      { id: 'quer', cx: 10, cy: -10 },
    ]);
    await expect(marker(page)).toHaveCount(0);
    await panel(page).getByRole('group', { name: 'Richtung' }).getByRole('button', { name: 'Eigene Richtung', exact: true }).click();
    expect(await store(page, 's.project.pages[0].numberingMode')).toBe('direction');
    // Erstes Umschalten: waagrecht durch die Mitte aller Stände (Hülle x −21 … 21, y −11 … 11)
    expect(await direction(page)).toEqual({ from: { x: -21, y: 0 }, to: { x: 21, y: 0 } });
    await expect(panel(page).getByLabel('A X', { exact: true })).toHaveValue('-21');
    await expect(panel(page).getByLabel('B X', { exact: true })).toHaveValue('21');
    await expect(marker(page)).toBeVisible();
    await expect(marker(page).locator('text')).toHaveText(['1', '→']);

    // Werkzeug: A an der Mitte von s3, B an der Mitte von s1 (beide knapp daneben geklickt, Fang an der Standmitte)
    await panel(page).getByRole('button', { name: /Richtung auf dem Plan setzen/ }).click();
    expect(await store(page, 's.ui.tool')).toBe('numberDirection');
    await expect(page.locator('.tool-hint')).toContainText('Startpunkt A');
    const n0 = await pastLen(page);
    const a = await w2s(page, { x: 20.3, y: 10.2 });
    await page.mouse.click(a.x, a.y);
    await expect(page.locator('.tool-hint')).toContainText('Zielpunkt B');
    expect(await pastLen(page)).toBe(n0);
    const b = await w2s(page, { x: -19.7, y: -10.3 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.click(b.x, b.y);
    expect(await direction(page)).toEqual({ from: { x: 20, y: 10 }, to: { x: -20, y: -10 } });
    expect(await store(page, 's.ui.tool')).toBe('select');
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Richtung setzen');
    await expect(panel(page).getByLabel('A Y', { exact: true })).toHaveValue('10');

    // Richtung (−40, −20): quer (10, −10) liegt entlang der Richtung zwischen s3 und s2
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['s3', 'quer', 's2', 's1']);

    // Undo stellt die Vorgabe wieder her
    await page.keyboard.press(`${MOD}+Z`);
    await page.keyboard.press(`${MOD}+Z`);
    expect(await direction(page)).toEqual({ from: { x: -21, y: 0 }, to: { x: 21, y: 0 } });

    // Esc bricht das Werkzeug ab, auch nach dem ersten Klick
    await panel(page).getByRole('button', { name: /Richtung auf dem Plan setzen/ }).click();
    const n1 = await pastLen(page);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press('Escape');
    expect(await store(page, 's.ui.tool')).toBe('select');
    expect(await pastLen(page)).toBe(n1);
    expect(await direction(page)).toEqual({ from: { x: -21, y: 0 }, to: { x: 21, y: 0 } });
    expect(errors).toEqual([]);
  });

  test('Eigene Richtung: A und B mit dem Auswahlwerkzeug ziehen (ein Undo-Schritt), Felder A/B', async ({ page }) => {
    await openApp(page);
    await seed(page, [
      { id: 'w', cx: -10, cy: 0 },
      { id: 'o', cx: 10, cy: 0 },
      { id: 'n', cx: 0, cy: -15 },
    ]);
    await panel(page).getByRole('group', { name: 'Richtung' }).getByRole('button', { name: 'Eigene Richtung', exact: true }).click();
    // Felder: A (0, 20) → B (0, −20) = von unten nach oben
    await fillIn('A X', '0', page);
    await fillIn('A Y', '20', page);
    await fillIn('B X', '0', page);
    await fillIn('B Y', '-20', page);
    expect(await direction(page)).toEqual({ from: { x: 0, y: 20 }, to: { x: 0, y: -20 } });
    await renumber(page);
    // w und o gleichauf: links vom Pfeil (nach oben gesehen) liegt w
    expect(await orderByNr(page)).toEqual(['w', 'o', 'n']);

    // B mit dem Auswahlwerkzeug nach rechts ziehen: Richtung nach rechts oben (A bleibt)
    const n0 = await pastLen(page);
    const from = await w2s(page, { x: 0, y: -20 });
    const to = await w2s(page, { x: 30, y: 15 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const d = (await direction(page))!;
    expect(d.from).toEqual({ x: 0, y: 20 });
    expect(near(d.to, { x: 30, y: 15 })).toBe(true);
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Richtung verschieben');
    // Keine Auswahl und kein verschobener Stand
    expect(await store(page, 's.ui.selection')).toBeNull();
    expect(await store(page, 's.project.pages[0].stands.map((x) => [x.cx, x.cy])')).toEqual([
      [-10, 0],
      [10, 0],
      [0, -15],
    ]);
    // Richtung (30, −5): w, n, o
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['w', 'n', 'o']);

    // Esc während des Ziehens bricht ab, ohne Undo-Schritt
    const n1 = await pastLen(page);
    const b = await w2s(page, d.to);
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x - 100, b.y, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await direction(page)).toEqual(d);
    expect(await pastLen(page)).toBe(n1);
  });

  test('Eigene Richtung mit A = B: Hinweis, Neu nummerieren gesperrt (Knopf und Kurzbefehl)', async ({ page }) => {
    await openApp(page);
    await seed(page, [
      { id: 'a', cx: -5, cy: 0 },
      { id: 'b', cx: 5, cy: 0 },
    ]);
    await panel(page).getByRole('group', { name: 'Richtung' }).getByRole('button', { name: 'Eigene Richtung', exact: true }).click();
    await expect(panel(page).getByTestId('nr-issue')).toHaveCount(0);
    await fillIn('B X', '-6', page);
    await fillIn('B Y', '0', page);
    expect(await direction(page)).toEqual({ from: { x: -6, y: 0 }, to: { x: -6, y: 0 } });
    await expect(panel(page).getByTestId('nr-issue')).toContainText('Start- und Zielpunkt der Richtung liegen aufeinander');
    await expect(panel(page).getByRole('button', { name: /Neu nummerieren/ })).toBeDisabled();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(`${MOD}+Alt+N`);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.toast').last()).toContainText('Start- und Zielpunkt');
    // Wieder zwei verschiedene Punkte: Hinweis weg, Nummerieren möglich
    await fillIn('B X', '6', page);
    await expect(panel(page).getByTestId('nr-issue')).toHaveCount(0);
    await renumber(page);
    expect(await orderByNr(page)).toEqual(['a', 'b']);
  });
});
