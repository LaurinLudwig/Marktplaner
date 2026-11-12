import { expect, test } from '@playwright/test';
import { artifact, collectErrors, MOD, openApp } from './helpers';

/**
 * #33: Die Exportvorschau zeigt deutlich, dass sie lädt (alte Vorschau abgeblendet, Schritt, Fortschrittsbalken), und
 * ab der zweiten Vorschau die geschätzte Restzeit. Der Export-Worker wird künstlich verlangsamt: Sein Ergebnis kommt
 * erst 4 s später an.
 */

const DELAY_MS = 4000;

test('Exportvorschau: Ladeanzeige mit Schritt und Fortschritt, ab der zweiten Vorschau mit Restzeit', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript((delay) => {
    const W = window.Worker;
    window.Worker = class extends W {
      override addEventListener(type: string, fn: any, opts?: any) {
        if (type !== 'message') return super.addEventListener(type, fn, opts);
        // nur das fertige PDF des Export-Workers verzögern (pdf.js nutzt eigene Nachrichten)
        return super.addEventListener(type, (e: MessageEvent) => (e.data?.type === 'done' && e.data.bytes ? setTimeout(() => fn(e), delay) : fn(e)), opts);
      }
    } as typeof Worker;
  }, DELAY_MS);
  await openApp(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(`${MOD}+p`);
  const preview = page.getByTestId('export-preview');
  const progress = page.getByTestId('export-preview-progress');

  // erste Vorschau: Ladeanzeige mit Schritt und Fortschrittsbalken über der abgeblendeten Fläche
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('status')).toHaveText('Vorschau wird erzeugt …');
  await expect(progress.locator('.export-preview-step')).toContainText(/Page 1 von 1|PDF fertigstellen/);
  await expect(page.locator('.export-preview-box.busy canvas')).toHaveCSS('opacity', '0.3');
  await expect(preview).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(progress).toHaveCount(0);

  // zweite Vorschau (Projekt geändert): Restzeit aus der Dauer der ersten
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Umbenennen', (p: any) => {
      p.pages[0].name = 'Müllerwiese';
    });
  });
  await expect(page.getByTestId('export-preview-eta')).toHaveText(/^noch etwa [2-5] s$/);
  await page.screenshot({ path: artifact('vorschau-fortschritt.png') });
  await expect(preview).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(page.getByTestId('export-preview-eta')).toHaveCount(0);
  expect(errors).toEqual([]);
});
