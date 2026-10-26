import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { artifact, MOD, openApp, tabbar } from './helpers';

/**
 * M6-10: Geschäftstabelle mit 500 Ständen (tests/fixtures/last-500-staende.schelme, 4 Festplätze) flüssig.
 * - Start-Page mit Tabelle öffnen: unter 300 ms bis zum nächsten Bild.
 * - Durch die ganze Tabelle scrollen: Median ≥ 50 Bilder/s, kein Bild über 100 ms (wie NFA der Zeichenfläche).
 * - Eine Zelländerung bis zur Anzeige: unter 100 ms.
 */

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'last-500-staende.schelme');

async function open500(page: Page) {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+o`);
  await (await chooser).setFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages.reduce((n: number, p: any) => n + p.stands.length, 0))).toBeGreaterThanOrEqual(500);
}

/** Zeit vom Auslösen bis zum nächsten gemalten Bild. */
function timeToPaint(page: Page, action: string) {
  return page.evaluate(
    (code) =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        new Function(code)();
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t0), 0));
      }),
    action,
  );
}

test.describe('M6-10: Geschäftstabelle mit 500 Ständen', () => {
  test('öffnen, scrollen, Zelle ändern', async ({ page }) => {
    await open500(page);
    const total = await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages.reduce((n: number, p: any) => n + p.stands.length, 0));

    const openMs = await timeToPaint(page, `window.__marktplanerStore.getState().setUi({ activePage: 'start' })`);
    await expect(page.getByTestId('stand-count')).toHaveText(`${total} Geschäfte`);
    await page.screenshot({ path: artifact('m6-startpage-500.png') });

    // Scrollen: jedes Bild 40 px weiter, bis zum Ende
    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const el = document.querySelector<HTMLElement>('[data-testid="stand-grid"]')!;
          const times: number[] = [];
          let last = performance.now();
          const step = () => {
            const now = performance.now();
            times.push(now - last);
            last = now;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return resolve(times.slice(1));
            el.scrollTop += 40;
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
    );
    const sorted = frames.toSorted((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const fps = 1000 / median;
    const worst = sorted[sorted.length - 1]!;
    console.warn(`M6-10 Tabelle: öffnen ${openMs.toFixed(0)} ms, scrollen ${frames.length} Bilder, Median ${fps.toFixed(1)} Bilder/s, längstes ${worst.toFixed(0)} ms`);
    await page.screenshot({ path: artifact('m6-startpage-500-end.png') });

    // Zelländerung: Name der ersten sichtbaren Zeile
    await page.getByTestId('stand-grid').evaluate((el) => (el.scrollTop = 0));
    const first = page.getByTestId('stand-row').first().locator('[data-col="name"]');
    await first.click();
    await page.keyboard.type('Geändert');
    const editMs = await timeToPaint(page, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await expect(first).toHaveText('Geändert');
    console.warn(`M6-10 Zelländerung bis zur Anzeige: ${editMs.toFixed(0)} ms`);

    // Freiflächen und Einstellungen zum Ansehen
    await page.keyboard.press(`${MOD}+2`);
    await page.screenshot({ path: artifact('m6-freespaces-500.png') });
    await page.keyboard.press(`${MOD}+3`);
    await page.screenshot({ path: artifact('m6-settings.png') });
    await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();

    expect(openMs).toBeLessThan(300);
    expect(fps).toBeGreaterThanOrEqual(50);
    expect(worst).toBeLessThanOrEqual(100);
    expect(editMs).toBeLessThan(100);
  });
});
