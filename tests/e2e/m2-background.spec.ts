import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { collectErrors, MOD, openApp, scale } from './helpers';

/**
 * M2: Hintergrund-Import, Kalibrierung, Planmaßstab, Raster, Norden, Messen.
 * Grundlage sind die synthetischen Testdateien in tests/fixtures/ (siehe README dort).
 */

const FX = join(process.cwd(), 'tests', 'fixtures');
const MM = 72 / 25.4;
const parseDe = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function importFile(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles(join(FX, file));
}

async function importReady(page: Page, file: string) {
  await importFile(page, file);
  await expect(page.getByTestId('bg-scale')).toBeVisible();
}

/** Bildschirmpunkt zu einer Quellkoordinate des (ungedrehten) Plans, über das angezeigte Bild. */
async function sourceToScreen(page: Page, size: { w: number; h: number }) {
  // Nach Zoom/Neuzeichnen erst ein Bild abwarten, damit die Position stimmt
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  const box = (await page.locator('.background-layer image').first().boundingBox())!;
  return (u: number, v: number) => ({ x: box.x + (u / size.w) * box.width, y: box.y + (v / size.h) * box.height });
}

async function clickAt(page: Page, p: { x: number; y: number }) {
  await page.mouse.click(p.x, p.y);
}

/** Kalibriert das 1000×800-Testraster über die roten Kreuze (500 Einheiten = 50 m). */
async function calibrateRaster(page: Page) {
  const at = await sourceToScreen(page, { w: 1000, h: 800 });
  await page.keyboard.press('k');
  await clickAt(page, at(100, 100));
  await clickAt(page, at(600, 100));
  await page.locator('#calibrate-meters').fill('50');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('bg-scale')).toContainText('1 px = 0,1 m');
}

async function measureLabel(page: Page): Promise<number> {
  const text = (await page.locator('.measure-label').textContent()) ?? '';
  return parseDe(text.replace(' m', ''));
}

async function saveFile(page: Page): Promise<Uint8Array> {
  const download = page.waitForEvent('download');
  await page.keyboard.press(`${MOD}+s`);
  return new Uint8Array(readFileSync(await (await download).path()));
}

test.describe('M2 Hintergrund-Import', () => {
  for (const [file, kind, size] of [
    ['raster-10m.png', 'Bild', '1.000 × 800 px'],
    ['raster-10m.jpg', 'Bild', '1.000 × 800 px'],
    ['raster-10m.svg', 'SVG', '1.000 × 800 px'],
    ['raster-10m-viewbox.svg', 'SVG', '1.000 × 800 px'],
    ['plan-1zu1000.pdf', 'PDF', '842 × 595 pt'],
  ] as const) {
    test(`M2-01/02: ${file} wird importiert und angezeigt`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      await importReady(page, file);
      await expect(page.locator('.bg-file')).toContainText(file);
      await expect(page.locator('.bg-file')).toContainText(kind);
      await expect(page.locator('.bg-file')).toContainText(size);
      await expect(page.locator('.background-layer image').first()).toBeVisible();
      await expect(page.getByTestId('bg-scale')).toContainText('Nicht kalibriert');
      expect(errors).toEqual([]);
    });
  }

  test('M2-01: mehrseitiges PDF – Seitenauswahl, nur die gewählte Seite wird eingebettet', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'plan-2seiten.pdf');
    const picker = page.getByRole('dialog', { name: 'Seite wählen' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: /^Seite \d$/ })).toHaveCount(2);
    await picker.getByRole('button', { name: 'Seite 2' }).click();
    await expect(page.locator('.bg-file')).toContainText('Seite 2 von 2');
    await expect(page.locator('.bg-file')).toContainText('1.191 × 842 pt');

    const files = unzipSync(await saveFile(page));
    const pdfs = Object.keys(files).filter((k) => k.startsWith('assets/') && k.endsWith('.pdf'));
    expect(pdfs).toHaveLength(1);
    const embedded = await PDFDocument.load(files[pdfs[0]!]!);
    expect(embedded.getPageCount()).toBe(1);
    expect(embedded.getPage(0).getWidth()).toBeCloseTo(1191, 0);
  });

  test('M2-01: Seitenauswahl abbrechen importiert nichts', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'plan-2seiten.pdf');
    await page.getByRole('dialog', { name: 'Seite wählen' }).getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByRole('button', { name: /Hintergrund importieren/ })).toBeVisible();
    await expect(page.locator('.background-layer')).toHaveCount(0);
  });

  test('M2-01: nicht unterstütztes Format wird abgelehnt', async ({ page }) => {
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+Shift+P`);
    await (await chooser).setFiles({ name: 'notiz.png', mimeType: 'image/png', buffer: Buffer.from('kein Bild') });
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('nicht unterstützt');
    await dlg.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.background-layer')).toHaveCount(0);
  });

  test('Projektdatei: Plan eingebettet, nach Neuladen wieder da; Import ist rückgängig machbar', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await calibrateRaster(page);
    const bytes = await saveFile(page);
    const files = unzipSync(bytes);
    const json = JSON.parse(strFromU8(files['project.json']!));
    const bg = json.project.pages[0].background;
    expect(files[`assets/${bg.assetId}`]?.length).toBe(readFileSync(join(FX, 'raster-10m.png')).length);
    // Genauigkeit begrenzt durch Klicks auf ganze Bildschirmpixel
    expect(bg.transform.metersPerPx).toBeCloseTo(0.1, 4);
    expect(bg.calibration.meters).toBe(50);

    // Wieder öffnen
    await page.reload();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles({ name: 'm2.schelme', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
    await expect(page.getByTestId('bg-scale')).toContainText('Kalibriert: 1 px = 0,1 m');
    await expect(page.locator('.background-layer image').first()).toBeVisible();

    // Entfernen und Speichern: keine verwaiste Datei in der Projektdatei
    await page.getByRole('button', { name: 'Entfernen' }).click();
    const files2 = unzipSync(await saveFile(page));
    expect(Object.keys(files2).filter((k) => k.startsWith('assets/'))).toEqual([]);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.background-layer image').first()).toBeVisible();
  });
});

test.describe('M2 Kalibrierung und Maßstab', () => {
  test('M2-06: Kalibrieren über zwei Punkte ist exakt, sperrt den Plan und wechselt zur Auswahl', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await calibrateRaster(page);
    await expect(page.getByTestId('bg-scale')).toContainText('Plan 100 × 80 m');
    await expect(page.getByLabel('Gesperrt (nicht verschiebbar)')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Auswahl' })).toHaveAttribute('aria-pressed', 'true');

    // Messen rotes → blaues Kreuz: 600 Einheiten = 60 m
    await page.keyboard.press(`${MOD}+0`);
    const at = await sourceToScreen(page, { w: 1000, h: 800 });
    await page.keyboard.press('m');
    await clickAt(page, at(100, 100));
    await clickAt(page, at(100, 700));
    expect(await measureLabel(page)).toBeCloseTo(60, 0);
  });

  test('M2-06: erneute Kalibrierung skaliert nur den Hintergrund; Undo stellt den alten Maßstab her', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await calibrateRaster(page);
    const at = await sourceToScreen(page, { w: 1000, h: 800 });
    await page.keyboard.press('k');
    await clickAt(page, at(100, 100));
    await clickAt(page, at(600, 100));
    // 30 m statt 25 m: Faktor 2 würde wegen der Klickrundung die Rückfrage aus QA-M2-07 auslösen
    await page.locator('#calibrate-meters').fill('30');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('bg-scale')).toContainText('1 px = 0,06 m');
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId('bg-scale')).toContainText('1 px = 0,1 m');
  });

  test('M2-06: ungültige Abstände werden abgelehnt, Esc bricht ab', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    const at = await sourceToScreen(page, { w: 1000, h: 800 });
    await page.keyboard.press('k');
    await clickAt(page, at(100, 100));
    await clickAt(page, at(600, 100));
    for (const bad of ['0', '-5', 'abc', '']) {
      await page.locator('#calibrate-meters').fill(bad);
      await page.keyboard.press('Enter');
      await expect(page.locator('#calibrate-meters')).toHaveClass(/bad/);
    }
    await expect(page.getByTestId('bg-scale')).toContainText('Nicht kalibriert');
    await page.keyboard.press('Escape');
    await expect(page.locator('#calibrate-meters')).toHaveCount(0);
    await expect(page.locator('.calibrate-overlay')).toHaveCount(0);
  });

  test('M2-06: ohne Hintergrund ist Kalibrieren nicht möglich', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: 'Kalibrieren' })).toBeDisabled();
    await page.locator('svg.canvas').click({ position: { x: 300, y: 300 } });
    await page.keyboard.press('k');
    await expect(page.locator('.toast')).toContainText('Zuerst einen Hintergrund importieren');
  });

  test('Planmaßstab 1:1000 bei PDF: ein Kästchen (10 mm) misst 10 m', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-1zu1000.pdf');
    await page.locator('#bg-paper-scale').fill('1000');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('bg-scale')).toContainText('Maßstab 1:1.000');
    // Nur die 2-Punkt-Kalibrierung sperrt automatisch; der Planmaßstab bleibt nachjustierbar (QA-M2-06)
    await expect(page.getByLabel('Gesperrt (nicht verschiebbar)')).not.toBeChecked();
    await page.keyboard.press(`${MOD}+0`);
    const at = await sourceToScreen(page, { w: 842, h: 595 });
    const m = 20 * MM;
    await page.keyboard.press('m');
    await clickAt(page, at(m, m));
    await clickAt(page, at(m + 5 * 10 * MM, m));
    expect(Math.abs((await measureLabel(page)) - 50)).toBeLessThan(0.5);
  });
});

test.describe('M2 Hintergrund bearbeiten', () => {
  test('M2-03: Deckkraft einstellbar', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    const slider = page.locator('#bg-opacity');
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await expect(page.locator('output[for="bg-opacity"]')).toHaveText('80 %');
    await expect(page.locator('.background-layer > g').first()).toHaveAttribute('opacity', '0.8');
  });

  test('M2-04/07: nicht gesperrt lässt sich der Plan verschieben, gesperrt nicht', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    const img = page.locator('.background-layer image').first();
    const b0 = (await img.boundingBox())!;
    await page.mouse.move(b0.x + 200, b0.y + 200);
    await page.mouse.down();
    await page.mouse.move(b0.x + 260, b0.y + 230, { steps: 4 });
    await page.mouse.up();
    const b1 = (await img.boundingBox())!;
    expect(b1.x - b0.x).toBeCloseTo(60, 0);
    expect(b1.y - b0.y).toBeCloseTo(30, 0);
    // ein Ziehvorgang = ein Undo-Schritt
    await page.keyboard.press(`${MOD}+z`);
    expect((await img.boundingBox())!.x).toBeCloseTo(b0.x, 0);

    await page.getByLabel('Gesperrt (nicht verschiebbar)').check();
    await page.mouse.move(b0.x + 200, b0.y + 200);
    await page.mouse.down();
    await page.mouse.move(b0.x + 260, b0.y + 230, { steps: 4 });
    await page.mouse.up();
    expect((await img.boundingBox())!.x).toBeCloseTo(b0.x, 0);
  });

  test('M2-07: Drehung numerisch; Undo in einem Schritt', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await page.locator('#bg-rot').fill('90');
    await page.keyboard.press('Enter');
    const box = (await page.locator('.background-layer image').first().boundingBox())!;
    expect(box.height).toBeGreaterThan(box.width); // 1000 × 800 hochkant
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('#bg-rot')).toHaveValue('0');
  });

  test('M2-05: Ersetzen behält Position und Breite in Metern', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await calibrateRaster(page);
    await importFile(page, 'raster-10m.jpg');
    await expect(page.locator('.bg-file')).toContainText('raster-10m.jpg');
    await expect(page.getByTestId('bg-scale')).toContainText('Plan 100 × 80 m');
    await expect(page.locator('.toast').last()).toContainText('Kalibrierung prüfen');
  });

  test('PDF: beim Hineinzoomen wird ein scharfes Detailbild nachgeladen', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-1zu1000.pdf');
    await expect(page.locator('.background-layer image')).toHaveCount(1);
    for (let i = 0; i < 10; i++) await page.keyboard.press(`${MOD}+Equal`);
    await expect(page.locator('.background-layer image')).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('M2 Raster, Norden, Messen', () => {
  test('M2-09: Raster ein/aus über die Werkzeugleiste, Weite einstellbar', async ({ page }) => {
    await openApp(page);
    const minor = page.locator('svg.canvas path.grid-minor');
    const d1 = await minor.getAttribute('d');
    expect(d1).not.toBe('');
    await page.locator('#grid-size').fill('2');
    await page.keyboard.press('Enter');
    const d2 = await minor.getAttribute('d');
    expect(d2!.length).toBeLessThan(d1!.length);
    const toggle = page.getByRole('button', { name: 'Raster ein/aus' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(minor).toHaveAttribute('d', '');
    await expect(page.locator('svg.canvas path.grid-major')).toHaveAttribute('d', '');
  });

  test('M2-08: Nordrichtung dreht den Nordpfeil', async ({ page }) => {
    await openApp(page);
    await page.locator('#north-angle').fill('90');
    await page.keyboard.press('Enter');
    await expect(page.locator('.north-arrow g')).toHaveAttribute('transform', 'rotate(90)');
    await page.locator('#north-angle').fill('-30');
    await page.keyboard.press('Enter');
    await expect(page.locator('#north-angle')).toHaveValue('330');
  });

  test('M2-10: Messung bleibt bis zum Werkzeugwechsel; Esc löscht; Shift = 45°', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('m');
    await page.mouse.click(400, 300);
    await page.keyboard.down('Shift');
    await page.mouse.click(503, 309);
    await page.keyboard.up('Shift');
    await expect(page.locator('.measure-sub')).toHaveText('0°');
    expect(await measureLabel(page)).toBeCloseTo(Math.hypot(103, 9) / 10, 1);
    // Zoomen und Pan ändern nichts an der Messung
    await page.keyboard.press(`${MOD}+Equal`);
    await expect(page.locator('.measure-label')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.measure-label')).toHaveCount(0);
    await page.mouse.click(400, 300);
    await page.mouse.click(500, 300);
    // 100 Bildschirmpixel beim aktuellen Maßstab (nach dem Zoomen 12,5 px/m)
    expect(await measureLabel(page)).toBeCloseTo(100 / (await scale(page)), 1);
    await page.keyboard.press('v');
    await page.keyboard.press('m');
    await expect(page.locator('.measure-label')).toHaveCount(0);
  });
});
