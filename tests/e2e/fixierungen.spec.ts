import { expect, test, type Page } from '@playwright/test';
import { backToPage, collectErrors, MOD, openApp, tabbar } from './helpers';

/**
 * #14: „Alle Fixierungen lösen“ und „Alle Nummern fixieren“ (spec.md §5): Seitenleiste „Nummerierung“, Menü
 * „Fixierungen“ über der Geschäftstabelle und App-Menü. Ohne Nachfrage, ein Undo-Schritt, Hinweis mit Rückgängig;
 * die Nummern selbst bleiben.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const pastLen = (page: Page) => store(page, 's.history.past.length') as Promise<number>;
const lastLabel = (page: Page) => store(page, 's.history.past.at(-1)?.label ?? null') as Promise<string | null>;
/** IDs der fixierten Stände über alle Pages. */
const locked = (page: Page) => store(page, 's.project.pages.flatMap((p) => p.stands.filter((x) => x.nrLocked).map((x) => x.id))') as Promise<string[]>;
/** Nummern aller Stände über alle Pages (ID → Nummer). */
const nrs = (page: Page) => store(page, 'Object.fromEntries(s.project.pages.flatMap((p) => p.stands.map((x) => [x.id, x.nr])))') as Promise<Record<string, string>>;

/**
 * „Nord“ (aktiv, links → rechts): a „1“ fixiert, b „2“, c ohne Nummer fixiert. „Süd“ (manuell): d „7“ fixiert, e „8“.
 */
async function seed(page: Page, scope: 'perPage' | 'global' = 'perPage') {
  await page.evaluate((sc) => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, rot: 0, w: 2, d: 2, cy: -1.5 };
    s.change('Testdaten', (p: any) => {
      p.settings.numbering.scope = sc;
      const nord = p.pages[0];
      nord.name = 'Nord';
      nord.stands.push({ ...base, id: 'a', cx: -10, nr: '1', nrLocked: true }, { ...base, id: 'b', cx: 0, nr: '2' }, { ...base, id: 'c', cx: 10, nrLocked: true });
      p.pages.push({
        ...JSON.parse(JSON.stringify(nord)),
        id: 'p2',
        name: 'Süd',
        numberingMode: 'manual',
        stands: [{ ...base, id: 'd', cx: 0, nr: '7', nrLocked: true }, { ...base, id: 'e', cx: 5, nr: '8' }],
      });
    });
  }, scope);
}

const panel = (page: Page) => page.getByRole('region', { name: 'Nummerierung' });
const toast = (page: Page, text: string) => page.locator('.toast').filter({ hasText: text });

test.describe('#14: Alle Fixierungen lösen / alle Nummern fixieren', () => {
  test('Seitenleiste pro Festplatz: nur diese Page, ein Undo-Schritt, Hinweis mit Rückgängig, Nummern bleiben', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 1 ohne Nummer, 2 fixiert');
    const unlock = panel(page).getByRole('button', { name: 'Alle Fixierungen lösen' });
    const lock = panel(page).getByRole('button', { name: 'Alle Nummern fixieren' });
    await expect(unlock).toBeVisible();
    await expect(lock).toBeVisible();
    const before = await nrs(page);
    const n0 = await pastLen(page);

    // Lösen: ohne Nachfrage, nur „Nord“ (Süd behält d)
    await unlock.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toast(page, '2 Fixierungen gelöst')).toBeVisible();
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 1 ohne Nummer');
    await expect(unlock).toHaveCount(0);
    expect(await locked(page)).toEqual(['d']);
    expect(await nrs(page)).toEqual(before);
    expect(await pastLen(page)).toBe(n0 + 1);
    expect(await lastLabel(page)).toBe('Alle Fixierungen lösen');

    // Rückgängig im Hinweis nimmt genau diesen Schritt zurück
    await toast(page, '2 Fixierungen gelöst').getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toast(page, '2 Fixierungen gelöst')).toHaveCount(0);
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 1 ohne Nummer, 2 fixiert');
    expect(await locked(page)).toEqual(['a', 'c', 'd']);
    expect(await pastLen(page)).toBe(n0);

    // Fixieren: nur Stände mit Nummer (b); c bleibt wie es ist
    await lock.click();
    await expect(toast(page, '1 Nummer fixiert')).toBeVisible();
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 1 ohne Nummer, 3 fixiert');
    await expect(lock).toHaveCount(0);
    expect(await lastLabel(page)).toBe('Alle Nummern fixieren');
    expect(await nrs(page)).toEqual(before);
    // auch mit Strg/Cmd+Z ein einziger Schritt
    await page.keyboard.press(`${MOD}+Z`);
    await expect(panel(page).getByTestId('nr-status')).toHaveText('3 Stände, 1 ohne Nummer, 2 fixiert');
    expect(await locked(page)).toEqual(['a', 'c', 'd']);
    expect(errors).toEqual([]);
  });

  test('global: wirkt auf alle Pages, auch von einer Page im Modus „manuell“ aus', async ({ page }) => {
    await openApp(page);
    await seed(page, 'global');
    await backToPage(page, 2);
    await expect(panel(page).getByTestId('nr-status')).toHaveText('2 Stände, 1 fixiert');
    await panel(page).getByRole('button', { name: 'Alle Fixierungen lösen' }).click();
    await expect(toast(page, '3 Fixierungen gelöst')).toBeVisible();
    expect(await locked(page)).toEqual([]);
    await panel(page).getByRole('button', { name: 'Alle Nummern fixieren' }).click();
    // a, b, d, e; c hat keine Nummer
    await expect(toast(page, '4 Nummern fixiert')).toBeVisible();
    expect(await locked(page)).toEqual(['a', 'b', 'd', 'e']);
  });

  test('pro Festplatz auf einer manuellen Page: wirkt nur dort', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await backToPage(page, 2);
    await panel(page).getByRole('button', { name: 'Alle Fixierungen lösen' }).click();
    await expect(toast(page, '1 Fixierung gelöst')).toBeVisible();
    expect(await locked(page)).toEqual(['a', 'c']);
  });

  test('Start-Page: Menü „Fixierungen“ über der Geschäftstabelle und App-Menü wirken auf alle Pages', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    const before = await nrs(page);
    const n0 = await pastLen(page);

    await page.getByTestId('nr-locks').click();
    const box = page.getByRole('group', { name: 'Fixierungen' });
    await expect(box.getByTestId('nr-locks-status')).toHaveText('3 Stände fixiert');
    await box.getByRole('button', { name: 'Alle Fixierungen lösen' }).click();
    await expect(toast(page, '3 Fixierungen gelöst')).toBeVisible();
    await expect(box.getByTestId('nr-locks-status')).toHaveText('0 Stände fixiert');
    await expect(box.getByRole('button', { name: 'Alle Fixierungen lösen' })).toBeDisabled();
    expect(await locked(page)).toEqual([]);
    expect(await nrs(page)).toEqual(before);
    expect(await pastLen(page)).toBe(n0 + 1);
    // Das Schloss in der Tabelle zeigt den neuen Stand
    await expect(page.locator('[data-stand-id="a"] .nr-lock')).toHaveAttribute('aria-pressed', 'false');

    await toast(page, '3 Fixierungen gelöst').getByRole('button', { name: 'Rückgängig' }).click();
    expect(await locked(page)).toEqual(['a', 'c', 'd']);
    await page.keyboard.press('Escape');

    // App-Menü: auf der Start-Page für alle Pages
    await page.locator('.menu-btn').click();
    const item = page.getByRole('menu').getByRole('menuitem', { name: /^Alle Nummern fixieren/ });
    await expect(item).toContainText('alle Festplätze');
    await item.click();
    await expect(toast(page, '2 Nummern fixiert')).toBeVisible();
    expect(await locked(page)).toEqual(['a', 'b', 'c', 'd', 'e']);
    await page.locator('.menu-btn').click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Alle Nummern fixieren/ })).toBeDisabled();
    await page.getByRole('menu').getByRole('menuitem', { name: /^Alle Fixierungen lösen/ }).click();
    await expect(toast(page, '5 Fixierungen gelöst')).toBeVisible();
    expect(await locked(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('ohne Fixierungen und ohne Nummern: keine Knöpfe in der Seitenleiste, Menüeinträge gesperrt', async ({ page }) => {
    await openApp(page);
    await expect(panel(page).getByTestId('nr-status')).toBeVisible();
    await expect(panel(page).getByTestId('nr-lock-actions')).toHaveCount(0);
    await page.locator('.menu-btn').click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Alle Fixierungen lösen/ })).toBeDisabled();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /^Alle Nummern fixieren/ })).toBeDisabled();
  });

  test('„Rückgängig“ im Hinweis nach einer weiteren Änderung nimmt nichts zurück, sondern sagt es', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await panel(page).getByRole('button', { name: 'Alle Fixierungen lösen' }).click();
    const first = toast(page, '2 Fixierungen gelöst');
    await expect(first).toBeVisible();
    await panel(page).getByRole('button', { name: 'Alle Nummern fixieren' }).click();
    await expect(toast(page, '2 Nummern fixiert')).toBeVisible();
    const after = await locked(page);
    expect(after).toEqual(['a', 'b', 'd']);
    const n = await pastLen(page);
    await first.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(toast(page, 'Rückgängig hier nicht mehr möglich')).toBeVisible();
    expect(await locked(page)).toEqual(after);
    expect(await pastLen(page)).toBe(n);
  });

  test('Start-Page: Menü „Fixierungen“ wirkt unabhängig von Suche und Filter auf alle Stände', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.evaluate(() => (window as any).__marktplanerStore.getState().change('Name', (p: any) => {
        p.pages[0].stands.find((x: any) => x.id === 'a').name = 'Bratwurst';
      }));
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
    await page.getByLabel('Geschäfte suchen').fill('bratwurst');
    await expect(page.getByTestId('stand-row')).toHaveCount(1);
    await page.getByTestId('nr-locks').click();
    const box = page.getByRole('group', { name: 'Fixierungen' });
    await expect(box.getByTestId('nr-locks-status')).toHaveText('3 Stände fixiert');
    await box.getByRole('button', { name: 'Alle Fixierungen lösen' }).click();
    await expect(toast(page, '3 Fixierungen gelöst')).toBeVisible();
    expect(await locked(page)).toEqual([]);
  });

  test('App-Menü auf einer Festplatz-Page: Nummernkreis dieser Page', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await page.locator('.menu-btn').click();
    const item = page.getByRole('menu').getByRole('menuitem', { name: /^Alle Fixierungen lösen/ });
    await expect(item).toContainText('dieser Festplatz');
    await item.click();
    await expect(toast(page, '2 Fixierungen gelöst')).toBeVisible();
    expect(await locked(page)).toEqual(['d']);
  });
});
