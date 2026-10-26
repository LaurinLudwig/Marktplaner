import { expect, test, type Page } from '@playwright/test';
import { MOD, openApp } from './helpers';

/**
 * QA M8-07: Eigenes Export-Profil löschen (mit Rückfrage), bleibt nach dem Löschen nicht mehr in der Liste und auch
 * nicht nach einem Neuladen (pro Rechner, `src/platform/readAppSetting`/`writeAppSetting`). Ergänzt
 * `m8-export.spec.ts` („Profile verwalten …“), das nur Kopieren/Umbenennen und die mitgelieferten Profile prüft.
 */

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Als PDF exportieren' });

test('eigenes Profil löschen: Rückfrage, danach weg, bleibt auch nach Neuladen weg', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(`${MOD}+p`);
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Profile verwalten …' }).click();
  const editor = page.getByTestId('profile-editor');
  await editor.getByRole('button', { name: 'Als neues Profil kopieren' }).click();
  await editor.getByLabel('Profilname').fill('Zum Löschen');
  await editor.getByLabel('Profilname').press('Enter');
  await expect(dialog(page).getByLabel('Profil', { exact: true }).locator('option:checked')).toHaveText('Zum Löschen');

  // Löschen fragt nach (Rückfrage) und bricht bei „Abbrechen“ nichts ab
  await editor.getByRole('button', { name: 'Profil löschen' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Zum Löschen');
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog(page).getByLabel('Profil', { exact: true }).locator('option:checked')).toHaveText('Zum Löschen');

  await editor.getByRole('button', { name: 'Profil löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
  // Profil ist weg, Dialog wählt wieder ein mitgeliefertes Profil
  await expect(dialog(page).getByLabel('Profil', { exact: true }).locator('option', { hasText: 'Zum Löschen' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.reload();
  await page.keyboard.press(`${MOD}+p`);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Profil', { exact: true }).locator('option', { hasText: 'Zum Löschen' })).toHaveCount(0);
});
