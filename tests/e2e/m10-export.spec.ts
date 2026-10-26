import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { collectErrors, MOD, openApp } from './helpers';

/** M10-05 (#5): Vermerk „Marktplaner, Version …, Urheber, Link“ in PDF und CSV, Version aus package.json. */

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const NOTE = `Marktplaner, Version ${version}, Laurin Ludwig, https://github.com/LaurinLudwig`;

test('M10-05: PDF trägt den Vermerk auf jeder Seite und in den Metadaten; CSV in der letzten Zeile', async ({ page }) => {
  // Vorschau und Export eines mehrseitigen Projekts brauchen in der CI unter Last mehr als die üblichen 30 s
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+o`);
  await (await chooser).setFiles('tests/fixtures/format-v4-m7.schelme');
  await expect(page.locator('.file-state')).toContainText('format-v4-m7');

  await page.keyboard.press(`${MOD}+p`);
  const dialog = page.getByRole('dialog', { name: 'Als PDF exportieren' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 60_000 });
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Exportieren' }).click();
  const pdf = await readPdf(new Uint8Array(readFileSync((await (await download).path())!)));
  expect(pdf.pages.length).toBeGreaterThan(4);
  for (const p of pdf.pages) expect(p.text).toContain(NOTE);
  expect(pdf.info.Creator).toBe(`Marktplaner ${version} – Laurin Ludwig, https://github.com/LaurinLudwig`);

  // CSV der Geschäftstabelle: Tabelle, Leerzeile, Vermerk
  await page.getByRole('tab', { name: 'Start-Page' }).click();
  const csvDownload = page.waitForEvent('download');
  await page.keyboard.press(`${MOD}+Shift+E`);
  const text = readFileSync((await (await csvDownload).path())!, 'utf8');
  expect(text.endsWith(`\r\n\r\n${NOTE}\r\n`)).toBe(true);
  expect(errors).toEqual([]);
});
