import { expect, test, type Page } from '@playwright/test';
import { collectErrors, MOD, openApp } from './helpers';

/**
 * #11: „Zuletzt geöffnet“ im Menü und auf dem Startbildschirm. Im Browser gibt es keine Dateipfade: Die Liste wird
 * über localStorage vorbelegt, alle Einträge gelten als „nicht gefunden“, und der Startbildschirm erscheint nicht von
 * selbst (nur in der Desktop-App), deshalb öffnen die Tests ihn über den Store.
 */

const RECENT = [
  { path: '/Users/laurin/Märkte/Schelmenmarkt 2026.mplan', name: 'Schelmenmarkt 2026.mplan', openedAt: '2026-10-22T09:30:00.000Z' },
  { path: 'C:\\Pläne\\Weinfest.schelme', name: 'Weinfest.schelme', openedAt: '2026-10-20T16:05:00.000Z' },
];

async function seedRecent(page: Page, list: object[] = RECENT) {
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('recent-init')) return;
    sessionStorage.setItem('recent-init', '1');
    localStorage.setItem('marktplaner.recent-projects', json);
  }, JSON.stringify(list));
}

const showStartScreen = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ startScreen: true }));
const startScreen = (page: Page) => page.getByRole('dialog', { name: 'Startbildschirm' });

test.describe('#11: Zuletzt geöffnet', () => {
  test('Untermenü zeigt die Projekte; „Liste leeren“ leert es dauerhaft', async ({ page }) => {
    const errors = collectErrors(page);
    await seedRecent(page);
    await openApp(page);
    // Im Browser erscheint der Startbildschirm nicht von selbst
    await expect(startScreen(page)).toHaveCount(0);

    await page.locator('.menu-btn').click();
    await page.getByRole('menuitem', { name: 'Zuletzt geöffnet' }).hover();
    const sub = page.locator('.menu.submenu');
    await expect(sub.getByRole('menuitem')).toHaveText([/Schelmenmarkt 2026\.mplan/, /Weinfest\.schelme/, 'Liste leeren']);
    await sub.getByRole('menuitem', { name: 'Liste leeren' }).click();
    await expect(sub).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('marktplaner.recent-projects'))).toBe('[]');

    await page.locator('.menu-btn').click();
    await expect(page.getByRole('menuitem', { name: 'Zuletzt geöffnet' })).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('Startbildschirm: Liste, Tastatur, fehlende Datei wird gemeldet und entfernt', async ({ page }) => {
    const errors = collectErrors(page);
    await seedRecent(page);
    await openApp(page);
    await showStartScreen(page);
    const items = startScreen(page).getByTestId('recent-item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('Schelmenmarkt 2026.mplan');
    // Im Browser gibt es die Dateien nicht: ausgegraut mit Hinweis
    await expect(items.first()).toContainText('Datei nicht gefunden');
    await expect(items.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Werkzeug-Kurzbefehle greifen auf dem Startbildschirm nicht
    await page.keyboard.press('r');
    expect(await page.evaluate(() => (window as any).__marktplanerStore.getState().ui.tool)).toBe('select');

    await page.keyboard.press('Enter');
    const dialog = page.locator('.dialog').filter({ hasText: 'Datei nicht gefunden' });
    await expect(dialog).toContainText('Weinfest.schelme');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(items).toHaveCount(1);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('marktplaner.recent-projects')))!)).toHaveLength(1);
    // Die Meldung hat Enter/Esc bekommen, nicht der Startbildschirm
    await expect(startScreen(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(startScreen(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Startbildschirm: „Neues Projekt“ und Cmd/Strg+O schließen ihn; leere Liste mit Hinweis', async ({ page }) => {
    await openApp(page);
    await showStartScreen(page);
    await expect(startScreen(page)).toContainText('Noch keine Projekte geöffnet');
    await startScreen(page).getByRole('button', { name: /Neues Projekt/ }).click();
    await expect(startScreen(page)).toHaveCount(0);

    await showStartScreen(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles('tests/fixtures/format-v5-m8.schelme');
    await expect(startScreen(page)).toHaveCount(0);
    await expect(page.locator('.file-state')).toContainText('format-v5-m8.schelme');
  });
});
