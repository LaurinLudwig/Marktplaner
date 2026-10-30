import { expect, test, type Page } from '@playwright/test';
import { artifact, collectErrors, MOD, openApp, openSettings, backToPage } from './helpers';

/** #3: Abstandsprüfung für Stände gleicher Kategorie (Konkurrenzschutz), Warnung „Abstand“. */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const standEl = (page: Page, id: string) => page.locator(`.stand[data-id="${id}"]`);
async function clickStand(page: Page, id: string) {
  const box = (await standEl(page, id).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8);
}
const badge = (page: Page) => page.locator('header.tabbar [role="tab"]').nth(1).getByTestId('warn-badge');

async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nrLocked: false, owner: '', ware: '', powerKw: 0, connection: null, note: '', color: null, rot: 0, d: 3, w: 4, cy: 0, shape: 'rect', shapeTemplateId: null };
    s.change('Testdaten', (p: any) => {
      p.settings.warnOutside = false;
      p.categories.push({ id: 'suess', name: 'Süßwaren', color: '#f06292', minDistance: 50 }, { id: 'imbiss', name: 'Imbiss', color: '#f0a35e', minDistance: null });
      p.pages[0].stands.push(
        { ...base, id: 'a', nr: '1', name: 'Schokofrüchte Meier', cx: 0, categoryId: 'suess' },
        { ...base, id: 'b', nr: '2', name: 'Mandeln Kaya', cx: 27.4, categoryId: 'suess' },
        { ...base, id: 'c', nr: '3', name: 'Bratwurst', cx: 10, categoryId: 'imbiss' },
        { ...base, id: 'd', nr: '4', name: 'Bratwurst 2', cx: 15, categoryId: 'imbiss' },
      );
    });
    s.setView(s.project.pages[0].id, { scale: 10, tx: 200, ty: 300 });
  });
}

test.describe('#3 Warnung „Abstand“', () => {
  test('Zu nahe Stände gleicher Kategorie: Zähler, Seitenleiste mit Abstand, Umriss und Linie; ignorieren und abschalten mit Undo', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    // a und b: 27,4 − 4 = 23,40 m < 50 m; Imbiss ohne Mindestabstand
    await expect(badge(page)).toHaveText('2');
    await expect(standEl(page, 'a')).toHaveClass(/warn-outside/);
    await expect(standEl(page, 'c')).not.toHaveClass(/warn/);

    await clickStand(page, 'a');
    const chip = page.getByTestId('warn-chip-distance');
    await expect(chip).toHaveText('Zu nah an gleicher Kategorie: Mandeln Kaya, 23,40 m');
    await expect(page.getByTestId('distance-zone')).toHaveCount(1);
    await expect(page.getByTestId('distance-line')).toHaveCount(1);
    await page.screenshot({ path: artifact('abstand-auswahl.png') });

    // pro Stand ignorieren: nur a, b warnt weiter; Undo
    const n0 = (await st(page)).history.past.length;
    await page.getByLabel('Abstand ignorieren').check();
    await expect(badge(page)).toHaveText('1');
    expect((await st(page)).history.past.length).toBe(n0 + 1);
    await page.keyboard.press(`${MOD}+z`);
    await expect(badge(page)).toHaveText('2');

    // projektweit abschalten (Projekteinstellungen), Undo
    await openSettings(page);
    const toggle = page.getByLabel('Warnung, wenn Geschäfte gleicher Kategorie den Mindestabstand unterschreiten');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    expect((await st(page)).project.settings.warnDistance).toBe(false);
    await page.keyboard.press(`${MOD}+z`);
    await expect(toggle).toBeChecked();
    expect(errors).toEqual([]);
  });

  test('Live beim Ziehen; Mindestabstand je Kategorie in den Projekteinstellungen (leer = keine Prüfung); Tabelle und Filter', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await expect(badge(page)).toHaveText('2');

    // b nach rechts ziehen: bei 60 m Abstand keine Warnung mehr (schon während des Ziehens)
    const box = (await standEl(page, 'b').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 400, box.y + box.height / 2, { steps: 15 });
    await expect(standEl(page, 'a')).not.toHaveClass(/warn/);
    await page.mouse.up();
    await expect(badge(page)).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(badge(page)).toHaveText('2');

    // Imbiss bekommt 10 m: c und d (1 m Lücke) warnen; Süßwaren leer → keine Prüfung
    await openSettings(page);
    const rows = page.getByTestId('category-row');
    await rows.filter({ has: page.locator('input[value="Imbiss"]') }).getByLabel('Mindestabstand').fill('10');
    await page.keyboard.press('Enter');
    await rows.filter({ has: page.locator('input[value="Süßwaren"]') }).getByLabel('Mindestabstand').fill('');
    await page.keyboard.press('Enter');
    const cats = (await st(page)).project.categories;
    expect(cats.map((c: any) => [c.name, c.minDistance])).toEqual([['Süßwaren', null], ['Imbiss', 10]]);

    // Tabelle: Chip „Abstand“ mit Namen und Abstand, Filter „mit Warnung“
    await page.getByRole('tab', { name: /Geschäfte/ }).click();
    const warned = page.getByTestId('row-warnings').filter({ hasText: 'Abstand' });
    await expect(warned).toHaveCount(2);
    await expect(warned.first().locator('.chip')).toHaveAttribute('title', /Zu nah an: Bratwurst( 2)?, 1,00 m/);
    await backToPage(page);
    await expect(badge(page)).toHaveText('2');
    expect(errors).toEqual([]);
  });
});
