import { expect, test, type Page } from '@playwright/test';
import { backToPage, canvasBox, collectErrors, MOD, openApp, openSettings, origin, scale } from './helpers';

/** M10-04: Fang an Nachbarständen mit Abstand (#2) und Standardfarbe der Geschäfte (#3), Formatversion 6. */

type P = { x: number; y: number };
const settings = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().project.settings);
const standById = (page: Page, id: string) =>
  page.evaluate((sid) => (window as any).__marktplanerStore.getState().project.pages[0].stands.find((s: any) => s.id === sid), id);

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

async function drag(page: Page, a: P, b: P, hold: string[] = []) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  for (const k of hold) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const k of hold) await page.keyboard.up(k);
}

async function seed(page: Page, stands: object[], categories: object[] = []) {
  await page.evaluate(
    (o) => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, rot: 0 };
      s.change('Testdaten', (p: any) => {
        p.categories.push(...o.categories);
        p.pages[0].stands.push(...o.stands.map((st) => ({ ...base, ...st })));
      });
    },
    { stands, categories },
  );
}

test.describe('M10-04: Fang-Abstand und Standardfarbe', () => {
  test('#2: neuer Stand rastet mit 0,3 m Abstand ein; Einstellung mit Undo; 0 = bündig; Cmd/Strg schaltet ab', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    expect((await settings(page)).snapGap).toBe(0.3);
    await seed(page, [{ id: 'a', cx: -10, cy: 0, w: 3, d: 3 }, { id: 'b', cx: 0, cy: 0, w: 3, d: 3 }]);

    // b nach links bis 0,4 m neben a (rechte Kante a = −8,5) → rastet mit 0,3 m Abstand ein
    await drag(page, { x: 0, y: 0 }, { x: -6.6, y: 0.3 });
    let b = await standById(page, 'b');
    expect(b.cx).toBeCloseTo(-6.7, 5);
    expect(b.cy).toBeCloseTo(0, 5);

    // Einstellung auf der Start-Page: 0 m = bündig, Undo stellt 0,3 m wieder her
    await openSettings(page);
    const field = page.locator('#snap-gap');
    await expect(field).toHaveValue('0,3');
    await field.fill('0');
    await field.press('Enter');
    expect((await settings(page)).snapGap).toBe(0);
    await backToPage(page);
    await drag(page, { x: -6.7, y: 0 }, { x: -2, y: 0 });
    await drag(page, { x: -2, y: 0 }, { x: -6.6, y: 0.3 });
    b = await standById(page, 'b');
    expect(b.cx).toBeCloseTo(-7, 5);

    // Cmd/Strg beim Ziehen: kein Fang
    await drag(page, { x: -7, y: 0 }, { x: -2, y: 0 });
    await drag(page, { x: -2, y: 0 }, { x: -6.6, y: 0.3 }, [MOD]);
    b = await standById(page, 'b');
    expect(b.cx).toBeCloseTo(-6.6, 1);

    await openSettings(page);
    for (let i = 0; i < 5; i++) await page.keyboard.press(`${MOD}+z`);
    await expect(field).toHaveValue('0,3');
    expect(errors).toEqual([]);
  });

  test('#3: Standardfarbe wirkt auf Stände ohne Kategorie und eigene Farbe und in der Legende; Undo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(
      page,
      [
        { id: 'plain', cx: 0, cy: 0, w: 3, d: 3 },
        { id: 'cat', cx: 5, cy: 0, w: 3, d: 3, categoryId: 'c1' },
        { id: 'own', cx: 10, cy: 0, w: 3, d: 3, color: '#ffffff' },
      ],
      [{ id: 'c1', name: 'Imbiss', color: '#e57373' }],
    );
    const fill = (id: string) => page.locator(`.layer-objects polygon.stand[data-id="${id}"]`).getAttribute('fill');
    expect(await fill('plain')).toBe('#a7adb3');

    await openSettings(page);
    await page.getByRole('group', { name: 'Standardfarbe (Geschäfte ohne Kategorie)' }).getByRole('button', { name: 'Farbe #4db6ac' }).click();
    expect((await settings(page)).defaultStandColor).toBe('#4db6ac');
    await backToPage(page);
    expect(await fill('plain')).toBe('#4db6ac');
    expect(await fill('cat')).toBe('#e57373');
    expect(await fill('own')).toBe('#ffffff');
    expect(await page.getByTestId('legend').locator('[data-entry="nocat"] .sw-stand').getAttribute('style')).toContain('rgb(77, 182, 172)');

    await page.keyboard.press(`${MOD}+z`);
    expect(await fill('plain')).toBe('#a7adb3');
    expect(errors).toEqual([]);
  });
});
