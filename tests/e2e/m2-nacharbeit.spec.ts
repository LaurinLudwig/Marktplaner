import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, MOD, openApp, origin } from './helpers';

/**
 * Nacharbeit M2 (qa/M2.md) und offene M1-Befunde: Verhalten, das mit den Korrekturen neu
 * hinzugekommen ist. Die Befund-Tests der QA selbst stehen in m2-qa.spec.ts bzw. m1-recheck.spec.ts.
 */

const FX = join(process.cwd(), 'tests', 'fixtures');

async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles(typeof file === 'string' ? join(FX, file) : file);
}

async function importReady(page: Page, file: string) {
  await importFile(page, file);
  await expect(page.getByTestId('bg-scale')).toBeVisible();
}

/** Klickt zwei Quellpunkte des Testrasters (1000 × 800) mit dem Kalibrierwerkzeug an. */
async function startCalibration(page: Page, a: [number, number], b: [number, number]) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  const box = (await page.locator('.background-layer image').first().boundingBox())!;
  const at = ([u, v]: [number, number]) => ({ x: box.x + (u / 1000) * box.width, y: box.y + (v / 800) * box.height });
  await page.keyboard.press('k');
  await page.mouse.click(at(a).x, at(a).y);
  await page.mouse.click(at(b).x, at(b).y);
}

test.describe('Nacharbeit M2: Plausibilität des Maßstabs (QA-M2-07)', () => {
  test('unplausible Kalibrierung: Rückfrage, „Zurück“ lässt alles unverändert, „Trotzdem“ übernimmt', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await startCalibration(page, [100, 100], [600, 100]);
    await page.locator('#calibrate-meters').fill('0,5'); // Plan wäre 1 m breit
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('alertdialog', { name: 'Maßstab prüfen' });
    await expect(dlg).toContainText('1 m breit');
    await dlg.getByRole('button', { name: 'Zurück' }).click();
    await expect(page.getByTestId('bg-scale')).toContainText('Nicht kalibriert');
    await expect(page.locator('#calibrate-meters')).toBeVisible(); // Kalibrierung läuft weiter
    await page.getByRole('button', { name: 'Anwenden' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trotzdem übernehmen' }).click();
    await expect(page.getByTestId('bg-scale')).toContainText('Kalibriert: 1 px = 0,001 m');
  });

  test('Neukalibrierung mit mehr als Faktor 2 Abweichung fragt nach', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await startCalibration(page, [100, 100], [600, 100]);
    await page.locator('#calibrate-meters').fill('50');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('bg-scale')).toContainText('1 px = 0,1 m');
    await startCalibration(page, [100, 100], [600, 100]);
    await page.locator('#calibrate-meters').fill('150');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toContainText('Faktor 3 (größer)');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bg-scale')).toContainText('1 px = 0,1 m');
  });

  test('Planmaßstab außerhalb 1:50 bis 1:10.000 fragt nach', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-1zu1000.pdf');
    await page.locator('#bg-paper-scale').fill('5');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toContainText('1:5');
    await page.getByRole('button', { name: 'Zurück' }).click();
    await expect(page.getByTestId('bg-scale')).toContainText('Nicht kalibriert');
  });
});

test.describe('Nacharbeit M2: Sperre und Ansicht', () => {
  test('QA-M2-06: gesperrt sind Drehung und Planmaßstab deaktiviert, Kalibrieren bleibt möglich', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-1zu1000.pdf');
    await expect(page.locator('#bg-rot')).toBeEnabled();
    await page.getByLabel('Gesperrt (nicht verschiebbar)').check();
    await expect(page.locator('#bg-rot')).toBeDisabled();
    await expect(page.locator('#bg-paper-scale')).toBeDisabled();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Kalibrieren' })).toBeEnabled();
    await page.getByLabel('Gesperrt (nicht verschiebbar)').uncheck();
    await expect(page.locator('#bg-paper-scale')).toBeEnabled();
  });

  test('QA-M2-05: Raster ein/aus ist kein Undo-Schritt und markiert nicht als ungespeichert', async ({ page }) => {
    await openApp(page);
    const toggle = page.getByRole('button', { name: 'Raster ein/aus' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.file-state .dot')).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Nacharbeit M1: Wischrichtung (QA-M1-07)', () => {
  test('Menü „Wischrichtung umkehren“ dreht das Verschieben um und bleibt nach Neuladen erhalten', async ({ page }) => {
    await openApp(page);
    const swipe = async () => {
      const box = await canvasBox(page);
      const o0 = await origin(page);
      await page.evaluate(
        ({ x, y }) => {
          const e = new WheelEvent('wheel', { deltaX: 0, deltaY: 30, clientX: x, clientY: y, bubbles: true, cancelable: true });
          Object.defineProperty(e, 'wheelDeltaY', { value: -90 });
          document.querySelector('svg.canvas')!.dispatchEvent(e);
        },
        { x: box.x + 300, y: box.y + 300 },
      );
      return (await origin(page)).y - o0.y;
    };
    expect(await swipe()).toBeCloseTo(-30, 0); // wie das System (Inhalt wandert nach oben)
    await page.locator('.menu-btn').click();
    const item = page.getByRole('menuitemcheckbox', { name: /Wischrichtung umkehren/ });
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await item.click();
    expect(await swipe()).toBeCloseTo(30, 0);
    await page.reload();
    await expect(page.locator('header.tabbar')).toBeVisible();
    expect(await swipe()).toBeCloseTo(30, 0);
    await page.locator('.menu-btn').click();
    await expect(page.getByRole('menuitemcheckbox', { name: /Wischrichtung umkehren/ })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Nacharbeit M2: Dateien', () => {
  test('QA-M2-02: abgeschnittenes JPEG wird mit deutscher Meldung abgewiesen (auch in WebKit)', async ({ page }) => {
    await openApp(page);
    const jpg = readFileSync(join(FX, 'raster-10m.jpg')).subarray(0, 5000);
    await importFile(page, { name: 'kaputt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) });
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('beschädigt oder unvollständig');
    await dlg.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.background-layer')).toHaveCount(0);
  });

  test('QA-M2-03: große Rasterbilder werden als Übersicht plus Kacheln gezeichnet', async ({ page }) => {
    await openApp(page);
    // 5000 × 400 px (Seite > 4096 px) im Browser erzeugen
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 5000;
      c.height = 400;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 5000, 400);
      x.fillStyle = '#245';
      for (let i = 0; i < 5000; i += 100) x.fillRect(i, 0, 2, 400);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await importFile(page, { name: 'breit.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await expect(page.locator('.raster-overview')).toHaveCount(1);
    await expect(page.locator('.raster-tile')).toHaveCount(0);
    for (let i = 0; i < 12; i++) await page.keyboard.press(`${MOD}+Equal`);
    await expect.poll(() => page.locator('.raster-tile').count(), { timeout: 5000 }).toBeGreaterThan(0);
  });
});
