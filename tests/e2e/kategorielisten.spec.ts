import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { artifact, collectErrors, MOD, openApp, openSettings } from './helpers';

/** #1: Mitgelieferte Kategorielisten beim neuen Projekt und „Liste laden …“ in den Projekteinstellungen; #2: eigene Listen. */

const st = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState());
const catNames = async (page: Page) => (await st(page)).project.categories.map((c: any) => c.name);
const pastLen = async (page: Page) => (await st(page)).history.past.length;
const listDialog = (page: Page, name: string) => page.getByRole('dialog', { name });

async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', color: null, rot: 0, d: 3, w: 4, cy: 0 };
    s.change('Testdaten', (p: any) => {
      p.categories.push({ id: 'c1', name: 'Imbiss', color: '#111111', minDistance: null, price: null }, { id: 'c2', name: 'Eigene', color: '#222222', minDistance: null, price: null });
      p.pages[0].stands.push({ ...base, id: 's1', cx: 0, categoryId: 'c1' }, { ...base, id: 's2', cx: 10, categoryId: 'c2' });
    });
  });
}

test.describe('#1 Kategorielisten', () => {
  test('Neues Projekt fragt nach der Liste; Vorauswahl „Jahrmarkt klein“, danach die zuletzt gewählte; Esc bricht ab', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    const id0 = (await st(page)).project.id;
    await page.keyboard.press(`${MOD}+n`);
    const dlg = listDialog(page, 'Neues Projekt');
    await expect(dlg.getByLabel('Kategorieliste')).toHaveValue('jahrmarkt-klein');
    await expect(dlg.getByRole('list', { name: 'Kategorien der Liste' }).getByRole('listitem')).toHaveCount(11);
    await page.screenshot({ path: artifact('kategorielisten-neu.png') });
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    expect((await st(page)).project.id).toBe(id0);

    await page.keyboard.press(`${MOD}+n`);
    await dlg.getByLabel('Kategorieliste').selectOption('jahrmarkt-gross');
    await dlg.getByRole('button', { name: 'Anlegen' }).click();
    await expect(dlg).toHaveCount(0);
    expect(await catNames(page)).toContain('Süßwaren – Schokofrüchte');
    expect((await st(page)).project.categories.length).toBe(30);
    expect(await pastLen(page)).toBe(0);

    await page.keyboard.press(`${MOD}+n`);
    await expect(dlg.getByLabel('Kategorieliste')).toHaveValue('jahrmarkt-gross');
    await dlg.getByLabel('Kategorieliste').selectOption('leer');
    await page.keyboard.press('Enter');
    await expect.poll(() => catNames(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('Startbildschirm: Liste direkt neben „Neues Projekt“ wählen, ohne weitere Rückfrage', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ startScreen: true }));
    const start = page.getByRole('dialog', { name: 'Startbildschirm' });
    await expect(start.getByLabel('Kategorieliste für das neue Projekt')).toHaveValue('jahrmarkt-klein');
    await start.getByLabel('Kategorieliste für das neue Projekt').selectOption('jahrmarkt-gross');
    await start.getByRole('button', { name: /Neues Projekt/ }).click();
    await expect(start).toHaveCount(0);
    expect((await st(page)).project.categories.length).toBe(30);
  });

  test('Liste laden: ergänzen fügt nur fehlende Namen hinzu, ersetzen fragt bei verwendeten Kategorien nach; je ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await openSettings(page);
    const n0 = await pastLen(page);

    // Ergänzen: „Imbiss“ gibt es schon
    await page.getByRole('button', { name: 'Kategorieliste laden …' }).click();
    const dlg = listDialog(page, 'Kategorieliste laden');
    await expect(dlg.getByRole('radio', { name: /Ergänzen/ })).toBeChecked();
    await page.screenshot({ path: artifact('kategorielisten-laden.png') });
    await dlg.getByRole('button', { name: 'Laden' }).click();
    const merged = (await st(page)).project.categories;
    expect(merged).toHaveLength(12);
    expect(merged.slice(0, 2)).toEqual([
      { id: 'c1', name: 'Imbiss', color: '#111111', minDistance: null, price: null },
      { id: 'c2', name: 'Eigene', color: '#222222', minDistance: null, price: null },
    ]);
    await expect(page.getByTestId('category-row')).toHaveCount(12);
    expect(await pastLen(page)).toBe(n0 + 1);
    await page.keyboard.press(`${MOD}+z`);
    expect(await catNames(page)).toEqual(['Imbiss', 'Eigene']);

    // Ersetzen: „Eigene“ entfällt, Rückfrage; Abbrechen ändert nichts
    await page.getByRole('button', { name: 'Kategorieliste laden …' }).click();
    await dlg.getByRole('radio', { name: /Ersetzen/ }).check();
    await dlg.getByRole('button', { name: 'Laden' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('„Eigene“');
    await expect(confirm).toContainText('1 Geschäft');
    await confirm.getByRole('button', { name: 'Abbrechen' }).click();
    expect(await catNames(page)).toEqual(['Imbiss', 'Eigene']);

    await page.getByRole('button', { name: 'Kategorieliste laden …' }).click();
    await dlg.getByRole('radio', { name: /Ersetzen/ }).check();
    await dlg.getByRole('button', { name: 'Laden' }).click();
    await confirm.getByRole('button', { name: 'Ersetzen' }).click();
    const s = await st(page);
    expect(s.project.categories).toHaveLength(11);
    expect(s.project.categories.find((c: any) => c.name === 'Imbiss')).toEqual({ id: 'c1', name: 'Imbiss', color: '#f0a35e', minDistance: null, price: null });
    expect(s.project.pages[0].stands.map((x: any) => x.categoryId)).toEqual(['c1', null]);
    await page.keyboard.press(`${MOD}+z`);
    const back = await st(page);
    expect(back.project.categories.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(back.project.pages[0].stands.map((x: any) => x.categoryId)).toEqual(['c1', 'c2']);
    expect(errors).toEqual([]);
  });
});

test.describe('#2 Eigene Kategorielisten', () => {
  test('Kategorien als Liste speichern; erscheint beim Laden und beim neuen Projekt; bleibt nach Neuladen; umbenennen und löschen', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await openSettings(page);
    await page.getByRole('button', { name: 'Kategorien als Liste speichern, Listen verwalten …' }).click();
    const mgr = page.getByRole('dialog', { name: 'Kategorielisten' });
    await mgr.getByLabel('Kategorien dieses Projekts als Liste speichern').fill('Schelmenmarkt');
    await mgr.getByRole('button', { name: 'Speichern' }).click();
    await expect(mgr.getByRole('listitem', { name: 'Schelmenmarkt' })).toContainText('2 Kategorien');
    // Gleicher Name noch einmal → Nummer
    await mgr.getByRole('button', { name: 'Speichern' }).click();
    await expect(mgr.getByRole('listitem', { name: 'Schelmenmarkt (2)' })).toBeVisible();
    await page.screenshot({ path: artifact('kategorielisten-verwalten.png') });
    // Umbenennen, löschen mit Rückfrage
    await mgr.getByRole('listitem', { name: 'Schelmenmarkt (2)' }).getByLabel('Name').fill('Herbstmarkt');
    await page.keyboard.press('Enter');
    await expect(mgr.getByRole('listitem', { name: 'Herbstmarkt' })).toBeVisible();
    await mgr.getByRole('button', { name: '„Herbstmarkt“ löschen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(mgr.getByRole('listitem', { name: 'Herbstmarkt' })).toHaveCount(0);
    // Mitgelieferte lassen sich nicht löschen
    await expect(mgr.getByRole('button', { name: '„Jahrmarkt klein“ löschen' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(mgr).toHaveCount(0);

    // Nach dem Neuladen (pro Rechner gespeichert) in „Liste laden …“ und beim neuen Projekt
    await page.reload();
    await openSettings(page);
    await page.getByRole('button', { name: 'Kategorieliste laden …' }).click();
    const dlg = listDialog(page, 'Kategorieliste laden');
    const options = await dlg.getByLabel('Kategorieliste').locator('option').allInnerTexts();
    expect(options).toEqual(['Jahrmarkt klein (11)', 'Jahrmarkt groß (30)', 'Schelmenmarkt (2)']);
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${MOD}+n`);
    const neu = listDialog(page, 'Neues Projekt');
    await neu.getByLabel('Kategorieliste').selectOption({ label: 'Schelmenmarkt (2)' });
    await neu.getByRole('button', { name: 'Anlegen' }).click();
    await expect.poll(() => catNames(page)).toEqual(['Imbiss', 'Eigene']);
    expect((await st(page)).project.categories.map((c: any) => c.color)).toEqual(['#111111', '#222222']);
    expect(errors).toEqual([]);
  });

  test('Export und Import als Datei; ungültige Datei mit Meldung abgewiesen', async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    await page.getByRole('button', { name: 'Kategorien als Liste speichern, Listen verwalten …' }).click();
    const mgr = page.getByRole('dialog', { name: 'Kategorielisten' });
    const download = page.waitForEvent('download');
    await mgr.getByRole('button', { name: '„Jahrmarkt klein“ exportieren …' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Kategorien Jahrmarkt klein.json');
    const text = readFileSync((await file.path())!, 'utf8');
    expect(JSON.parse(text)).toMatchObject({ format: 'marktplaner-kategorien', version: 1, name: 'Jahrmarkt klein' });

    let chooser = page.waitForEvent('filechooser');
    await mgr.getByRole('button', { name: 'Importieren …' }).click();
    await (await chooser).setFiles({ name: 'liste.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(mgr.getByRole('listitem', { name: 'Jahrmarkt klein (2)' })).toContainText('11 Kategorien');

    chooser = page.waitForEvent('filechooser');
    await mgr.getByRole('button', { name: 'Importieren …' }).click();
    const newer = JSON.stringify({ ...JSON.parse(text), version: 99 });
    await (await chooser).setFiles({ name: 'neu.json', mimeType: 'application/json', buffer: Buffer.from(newer) });
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('neueren Version');
    await alert.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByTestId('category-list-row')).toHaveCount(3);
  });
});

test.describe('Kategorien umsortieren', () => {
  test('Am Griff ziehen und Pfeil ↑/↓ auf dem Griff; je ein Undo-Schritt', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await page.evaluate(() => {
      (window as any).__marktplanerStore.getState().change('Testdaten', (p: any) => {
        p.categories = p.categories.filter((c: any) => c.id === 'c1' || c.id === 'c2');
        p.categories.push({ id: 'c3', name: 'Dritte', color: '#333333', minDistance: null, price: null });
      });
    });
    await openSettings(page);
    expect(await catNames(page)).toEqual(['Imbiss', 'Eigene', 'Dritte']);

    // „Imbiss“ ans Ende ziehen
    const grips = page.getByTestId('category-grip');
    await page.getByTestId('category-row').nth(2).scrollIntoViewIfNeeded();
    const from = (await grips.nth(0).boundingBox())!;
    const last = (await page.getByTestId('category-row').nth(2).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, { steps: 3 });
    await page.mouse.move(from.x + from.width / 2, last.y + last.height - 2, { steps: 10 });
    await page.mouse.up();
    expect(await catNames(page)).toEqual(['Eigene', 'Dritte', 'Imbiss']);
    const n = await pastLen(page);

    // Tastatur: „Dritte“ eins nach oben
    await page.getByRole('button', { name: '„Dritte“ verschieben' }).focus();
    await page.keyboard.press('ArrowUp');
    expect(await catNames(page)).toEqual(['Dritte', 'Eigene', 'Imbiss']);
    await page.keyboard.press('ArrowUp'); // schon oben: nichts passiert
    expect(await pastLen(page)).toBe(n + 1);

    await page.keyboard.press(`${MOD}+z`);
    expect(await catNames(page)).toEqual(['Eigene', 'Dritte', 'Imbiss']);
    await page.keyboard.press(`${MOD}+z`);
    expect(await catNames(page)).toEqual(['Imbiss', 'Eigene', 'Dritte']);
    expect(errors).toEqual([]);
  });
});
