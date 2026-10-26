import { expect, test, type Page } from '@playwright/test';
import { hoverTooltip, MOD, openApp } from './helpers';

/** M5: Stromlimit (spec.md §6). */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const powers = (page: Page) => store(page, 's.project.pages[0].stands.map((x) => x.powerKw)') as Promise<number[]>;

async function seed(page: Page, stands: any[]) {
  await page.evaluate((list) => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false };
    s.change('Testdaten', (p: any) => {
      const pg = p.pages.find((x: any) => x.id === s.ui.activePage);
      list.forEach((st: any, i: number) => pg.stands.push({ ...base, cx: i * 4, cy: 0, w: 3, d: 3, rot: 0, ...st }));
    });
  }, stands);
}

const select = (page: Page, ids: string[]) => page.evaluate((sel) => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: sel } }), ids);
const panel = (page: Page) => page.getByRole('region', { name: 'Strom' });

async function setLimit(page: Page, value: string) {
  const f = panel(page).getByLabel('Limit', { exact: true });
  await f.fill(value);
  await f.press('Enter');
}

async function setStandPower(page: Page, value: string) {
  const f = page.getByRole('region', { name: 'Eigenschaften' }).getByLabel('Strom');
  await f.fill(value);
  await f.press('Enter');
}

test.describe('M5: Strom', () => {
  test('M5-07/08/11: Summe aller Stände, Balken grün/gelb/rot, Summen je Anschlussart; auch bei Auswahl sichtbar', async ({ page }) => {
    await openApp(page);
    await seed(page, [
      { id: 'a', powerKw: 3, connection: '230V' },
      { id: 'b', powerKw: 11, connection: 'CEE16' },
      { id: 'c', powerKw: 16, connection: 'CEE32', cx: 500 }, // weit außerhalb jeder Grundfläche: zählt mit
      { id: 'd' },
    ]);
    await expect(panel(page).getByTestId('power-sum')).toHaveText('30 kW');
    await expect(panel(page).getByTestId('power-meter')).toHaveCount(0);
    await expect(panel(page).getByTestId('power-table').locator('tr')).toHaveText([/230 V\s*1 Stand\s*3 kW/, /CEE 16 A\s*1 Stand\s*11 kW/, /CEE 32 A\s*1 Stand\s*16 kW/, /ohne Angabe\s*1 Stand\s*0 kW/]);

    await setLimit(page, '100');
    const meter = panel(page).getByTestId('power-meter');
    await expect(meter).toHaveAttribute('data-level', 'ok');
    await expect(meter).toContainText('30 / 100 kW (30 %)');
    await setLimit(page, '33');
    await expect(meter).toHaveAttribute('data-level', 'warn');
    await setLimit(page, '29,5');
    await expect(meter).toHaveAttribute('data-level', 'over');
    await expect(page.getByTestId('power-badge')).toHaveCount(1);
    expect(await hoverTooltip(page, page.getByTestId('power-badge'))).toContain('Stromlimit überschritten: 30 / 29,5 kW');

    // bei Auswahl weiterhin sichtbar
    await select(page, ['a']);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByTestId('power-meter')).toHaveAttribute('data-level', 'over');

    // leeres Limit = kein Limit (Undo-Schritt)
    await page.keyboard.press('Escape');
    await setLimit(page, '');
    expect(await store(page, 's.project.pages[0].powerLimitKw')).toBeNull();
    await expect(page.getByTestId('power-badge')).toHaveCount(0);
    expect(await store(page, 's.history.past.at(-1).label')).toBe('Stromlimit entfernen');
  });

  test('M5-09: ohne Blockieren erscheint beim Überschreiten ein Hinweis, die Änderung gilt', async ({ page }) => {
    await openApp(page);
    await seed(page, [{ id: 'a', powerKw: 5 }, { id: 'b', powerKw: 3 }]);
    await setLimit(page, '10');
    await select(page, ['a']);
    await setStandPower(page, '8');
    expect(await powers(page)).toEqual([8, 3]);
    await expect(page.locator('.toast')).toContainText('Stromlimit überschritten: Festplatz 1 hat 11 von 10 kW.');
    await expect(page.getByTestId('power-badge')).toHaveCount(1);
  });

  test('M5-09: Blockieren weist Erhöhungen über das Limit ab (Feld, Einfügen, Duplizieren), Senkungen gehen', async ({ page }) => {
    await openApp(page);
    await seed(page, [{ id: 'a', powerKw: 5 }, { id: 'b', powerKw: 3 }]);
    await setLimit(page, '10');
    await panel(page).getByLabel('Überschreitung blockieren').check();
    await select(page, ['a']);
    const n0 = await pastLen(page);

    await setStandPower(page, '8');
    const dlg = page.getByRole('alertdialog', { name: 'Stromlimit überschritten' });
    await expect(dlg).toContainText('Festplatz 1 hätte 11 kW bei einem Limit von 10 kW');
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await powers(page)).toEqual([5, 3]);
    expect(await pastLen(page)).toBe(n0);
    await expect(page.getByRole('region', { name: 'Eigenschaften' }).getByLabel('Strom')).toHaveValue('5');

    // bis genau zum Limit geht
    await setStandPower(page, '7');
    expect(await powers(page)).toEqual([7, 3]);

    // Duplizieren und Einfügen würden erhöhen
    await page.keyboard.press(`${MOD}+D`);
    await dlg.getByRole('button', { name: 'OK' }).click();
    await page.keyboard.press(`${MOD}+C`);
    await page.keyboard.press(`${MOD}+V`);
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await powers(page)).toEqual([7, 3]);

    // Limit unter die Summe senken ist erlaubt; danach sind Senkungen erlaubt, Erhöhungen nicht
    await page.keyboard.press('Escape');
    await setLimit(page, '5');
    await expect(panel(page).getByTestId('power-meter')).toHaveAttribute('data-level', 'over');
    await select(page, ['a']);
    await setStandPower(page, '6');
    expect(await powers(page)).toEqual([6, 3]);
    await expect(dlg).toHaveCount(0);
  });
});
