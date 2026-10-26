import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { activeTabName, artifact, collectErrors, MOD, openApp, pageTabs, tabNames } from './helpers';

/** M1-02, M1-18, M1-19, M1-20: Datenmodell, Speichern/Laden (Browser: Download/Upload), Autosave, Undo. */

async function renameActive(page: Page, name: string) {
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Name des Festplatzes' });
  await input.fill(name);
  await input.press('Enter');
}

async function saveViaShortcut(page: Page): Promise<Uint8Array> {
  const download = page.waitForEvent('download');
  await page.keyboard.press(`${MOD}+s`);
  const d = await download;
  const path = await d.path();
  expect(d.suggestedFilename()).toMatch(/\.mplan$/);
  return new Uint8Array(readFileSync(path));
}

async function openFile(page: Page, name: string, bytes: Uint8Array) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+o`);
  const fc = await chooser;
  await fc.setFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
}

test.describe('M1 Datei: Speichern, Laden, Autosave', () => {
  test('M1-18/M1-02: Speichern erzeugt ZIP mit project.json, Formatkennung und Schema-Version', async ({ page }) => {
    await openApp(page);
    await renameActive(page, 'Obermarkt');
    await page.locator('.tab-add').click();
    await expect(page.locator('.file-state .dot')).toBeVisible();
    const bytes = await saveViaShortcut(page);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('project.json');
    const json = JSON.parse(strFromU8(files['project.json']!));
    expect(json.format).toBe('schelmeplaner');
    // Seit M12 Formatversion 8 (Migrationen 1 → … → 8), angepasst vom Entwickler (vorher 7), siehe qa/M1.md
    expect(json.schemaVersion).toBe(8);
    expect(json.project.pages.map((p: { name: string }) => p.name)).toEqual(['Obermarkt', 'Festplatz 2']);
    // Nach dem Speichern ist der Änderungspunkt weg, Dateiname wird angezeigt
    await expect(page.locator('.file-state .dot')).toHaveCount(0);
    await expect(page.locator('.file-state')).toContainText('.mplan');
    await expect(page).toHaveTitle(/\.mplan – Marktplaner/);
  });

  test('M1-18: Speichern und wieder Öffnen stellt Pages, Reihenfolge und Ansicht wieder her', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await renameActive(page, 'Ä Ö Ü ß – „Sonderzeichen“');
    await page.locator('.tab-add').click();
    await page.keyboard.press(`${MOD}+=`);
    await page.keyboard.press(`${MOD}+=`);
    const bytes = await saveViaShortcut(page);

    // Neues Projekt, dann Datei öffnen
    await page.keyboard.press(`${MOD}+Shift+n`); // Page anlegen → wieder ungespeichert
    await page.locator('.menu-btn').click();
    await page.getByRole('menuitem', { name: /^Neues Projekt/ }).click();
    await page.getByRole('button', { name: 'Nicht speichern' }).click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);

    await openFile(page, 'markt.schelme', bytes);
    await expect.poll(() => tabNames(page)).toEqual(['Start-Page', 'Ä Ö Ü ß – „Sonderzeichen“', 'Festplatz 2']);
    await pageTabs(page).nth(2).click();
    await expect(page.locator('.statusbar')).toContainText('15,6');
    await expect(page.locator('.file-state')).toContainText('markt.schelme');
    await expect(page.locator('.file-state .dot')).toHaveCount(0);
    // Undo-Historie beginnt nach dem Öffnen leer
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  test('M1-18: Beschädigte Datei → verständliche Fehlermeldung, Projekt bleibt erhalten', async ({ page }) => {
    await openApp(page);
    await renameActive(page, 'Bleibt');
    await saveViaShortcut(page);
    await openFile(page, 'kaputt.schelme', new Uint8Array([1, 2, 3, 4]));
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('beschädigt');
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Bleibt']);
  });

  test('M1-02: Datei aus neuerer Formatversion wird abgelehnt', async ({ page }) => {
    await openApp(page);
    const future = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'schelmeplaner', schemaVersion: 99, project: { id: 'x', pages: [] } })) });
    await openFile(page, 'zukunft.schelme', future);
    await expect(page.getByRole('alertdialog')).toContainText('neueren Version');
  });

  test('M1-02: Fehlende Felder werden mit Standardwerten ergänzt; ZIP ohne project.json abgelehnt', async ({ page }) => {
    await openApp(page);
    const minimal = zipSync({
      'project.json': strToU8(JSON.stringify({ format: 'schelmeplaner', schemaVersion: 1, project: { id: 'p1', pages: [{ id: 'a' }, { id: 'b', name: 'Zwei' }] } })),
    });
    await openFile(page, 'minimal.schelme', minimal);
    await expect.poll(() => tabNames(page)).toEqual(['Start-Page', 'Festplatz 1', 'Zwei']);
    const noJson = zipSync({ 'foo.txt': strToU8('x') });
    await openFile(page, 'leer.schelme', noJson);
    await expect(page.getByRole('alertdialog')).toContainText('project.json');
  });

  test('M1-18: Öffnen bei ungespeicherten Änderungen fragt nach; Abbrechen behält alles', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.keyboard.press(`${MOD}+o`);
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('Ungespeicherte Änderungen');
    await dlg.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dlg).toHaveCount(0);
    expect(await tabNames(page)).toHaveLength(3);
    // Esc = Abbrechen
    await page.keyboard.press(`${MOD}+o`);
    await page.keyboard.press('Escape');
    expect(await tabNames(page)).toHaveLength(3);
  });

  test('M1-18: Neues Projekt fragt nach und „Speichern“ im Dialog lädt die Datei herunter', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.locator('.menu-btn').click();
    await page.getByRole('menuitem', { name: /^Neues Projekt/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Speichern', exact: true }).click();
    await download;
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });

  test('M1-20: Dirty-Markierung folgt Undo/Redo zurück zum gespeicherten Stand', async ({ page }) => {
    await openApp(page);
    const dot = page.locator('.file-state .dot');
    await expect(dot).toHaveCount(0);
    await page.locator('.tab-add').click();
    await expect(dot).toBeVisible();
    await page.keyboard.press(`${MOD}+z`);
    await expect(dot).toHaveCount(0);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(dot).toBeVisible();
    await page.keyboard.press(`${MOD}+y`);
    await page.keyboard.press(`${MOD}+z`);
    await expect(dot).toHaveCount(0);
  });

  test('M1-20: Undo/Redo projektweit über mehrere Pages; neue Aktion verwirft Redo', async ({ page }) => {
    await openApp(page);
    await renameActive(page, 'A');
    await page.locator('.tab-add').click();
    await renameActive(page, 'B');
    await pageTabs(page).nth(1).click();
    // Undo wirkt auch auf Page B, obwohl Page A aktiv ist
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'A', 'Festplatz 2']);
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'A']);
    expect(await activeTabName(page)).toBe('A');
    await page.keyboard.press(`${MOD}+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
    await page.keyboard.press(`${MOD}+z`); // nichts mehr
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect(await tabNames(page)).toEqual(['Start-Page', 'A']);
    await page.locator('.tab-add').click();
    await page.keyboard.press(`${MOD}+Shift+z`); // Redo-Stapel ist leer
    expect(await tabNames(page)).toEqual(['Start-Page', 'A', 'Festplatz 2']);
  });

  test('M1-20: Undo im Umbenennen-Feld gehört dem Feld, nicht dem Projekt', async ({ page }) => {
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.keyboard.press('F2');
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByRole('textbox', { name: 'Name des Festplatzes' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await tabNames(page)).toHaveLength(3);
  });

  test('M1-19: Autosave nach 30 s, Wiederherstellung beim nächsten Start', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await renameActive(page, 'Gesichert');
    await page.locator('.tab-add').click();
    expect(await page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).toBeNull();
    await page.clock.runFor(31_000);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).not.toBeNull();

    await page.reload();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('Sicherung gefunden');
    await page.screenshot({ path: artifact('m1-recovery-dialog.png') });
    await dlg.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect.poll(() => tabNames(page)).toEqual(['Start-Page', 'Gesichert', 'Festplatz 2']);
    // Wiederhergestelltes Projekt gilt als ungespeichert
    await expect(page.locator('.file-state .dot')).toBeVisible();
  });

  test('M1-19: Sicherung verwerfen löscht sie; ohne Änderungen wird nicht gesichert', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.clock.runFor(31_000);
    expect(await page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).toBeNull();
    await page.locator('.tab-add').click();
    await page.clock.runFor(31_000);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).not.toBeNull();
    await page.reload();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwerfen' }).click();
    expect(await page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).toBeNull();
    expect(await tabNames(page)).toEqual(['Start-Page', 'Festplatz 1']);
  });

  test('M1-19: Nach dem Speichern wird die Sicherung entfernt', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.clock.runFor(31_000);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).not.toBeNull();
    await saveViaShortcut(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).toBeNull();
    await page.reload();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('M1-19: Zurück-Undo auf den gespeicherten Stand hinterlässt keine veraltete Sicherung', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.locator('.tab-add').click();
    await page.clock.runFor(31_000);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('marktplaner.autosave'))).not.toBeNull();
    await page.keyboard.press(`${MOD}+z`); // Projekt wieder unverändert
    await page.clock.runFor(31_000);
    await page.reload();
    // Erwartet: keine Wiederherstellung eines Standes, den der Nutzer bewusst verworfen hat
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
