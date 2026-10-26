import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { collectErrors, MOD, openApp } from './helpers';

/**
 * QA M2: zusätzliche Prüfungen zu Hintergrund, Kalibrierung, Planmaßstab, Raster, Messen.
 * Siehe qa/M2.md. Tests mit `test.fail` dokumentieren offene Befunde (QA-M2-xx); sie werden
 * „grün“, solange der Fehler besteht, und schlagen an, sobald er behoben ist.
 */

const FX = join(process.cwd(), 'tests', 'fixtures');
const MM = 72 / 25.4;
const parseDe = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

type Size = { w: number; h: number };

async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles(typeof file === 'string' ? join(FX, file) : file);
}

async function importReady(page: Page, file: string, pdfPage?: number) {
  await importFile(page, file);
  if (pdfPage) await page.getByRole('dialog', { name: 'Seite wählen' }).getByRole('button', { name: `Seite ${pdfPage}` }).click();
  await expect(page.getByTestId('bg-scale')).toBeVisible();
}

async function at(page: Page, size: Size) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  const box = (await page.locator('.background-layer image').first().boundingBox())!;
  // Auf 1/1000 px gerundet (Entwickler, M4-Nacharbeit, siehe qa/M4.md): Playwright-WebKit schneidet Mauskoordinaten
  // auf ganze Pixel ab; Rauschen von 1e-5 px in boundingBox() ließ denselben Punkt mal auf Pixel 200, mal auf 201 fallen.
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return (u: number, v: number) => ({ x: r(box.x + (u / size.w) * box.width), y: r(box.y + (v / size.h) * box.height) });
}

async function bg(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const pg = s.project.pages.find((p: any) => p.id === s.ui.activePage);
    return pg.background as { transform: { metersPerPx: number; rot: number }; opacity: number; locked: boolean; calibration?: { meters: number }; paperScale?: number; fileName: string } | null;
  });
}

async function calibrate(page: Page, size: Size, a: [number, number], b: [number, number], meters: string) {
  await page.keyboard.press(`${MOD}+0`);
  const p = await at(page, size);
  await page.keyboard.press('k');
  await page.mouse.click(p(...a).x, p(...a).y);
  await page.mouse.click(p(...b).x, p(...b).y);
  await page.locator('#calibrate-meters').fill(meters);
  await page.getByRole('button', { name: 'Anwenden' }).click();
}

async function measure(page: Page, size: Size, a: [number, number], b: [number, number]): Promise<number> {
  await page.keyboard.press(`${MOD}+0`);
  const p = await at(page, size);
  await page.keyboard.press('m');
  await page.mouse.click(p(...a).x, p(...a).y);
  await page.mouse.click(p(...b).x, p(...b).y);
  const v = parseDe(((await page.locator('.measure-label').textContent()) ?? '').replace(' m', ''));
  await page.keyboard.press('v');
  return v;
}

const RASTER: Size = { w: 1000, h: 800 };

test.describe('QA M2: Kalibrierung mit den Testdateien', () => {
  for (const [file, pdfPage, size, cal, check] of [
    ['raster-10m.png', 0, RASTER, { a: [100, 100], b: [600, 100], m: 50 }, { a: [100, 100], b: [100, 700], m: 60 }],
    ['raster-10m.jpg', 0, RASTER, { a: [100, 100], b: [600, 100], m: 50 }, { a: [100, 100], b: [100, 700], m: 60 }],
    ['raster-10m.svg', 0, RASTER, { a: [100, 100], b: [600, 100], m: 50 }, { a: [600, 100], b: [100, 700], m: Math.hypot(50, 60) }],
    ['plan-1zu1000.pdf', 0, { w: 842, h: 595 }, { a: [20 * MM, 20 * MM], b: [70 * MM, 20 * MM], m: 50 }, { a: [20 * MM, 20 * MM], b: [20 * MM, 170 * MM], m: 150 }],
    ['plan-2seiten.pdf', 2, { w: 1191, h: 842 }, { a: [20 * MM, 20 * MM], b: [220 * MM, 20 * MM], m: 100 }, { a: [20 * MM, 20 * MM], b: [20 * MM, 140 * MM], m: 60 }],
  ] as const) {
    test(`M2-06: ${file} – Kalibrieren, Nachmessen, Neukalibrieren (Abweichung < 0,6 m)`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      await importReady(page, file, pdfPage || undefined);
      await calibrate(page, size, cal.a as [number, number], cal.b as [number, number], String(cal.m));
      await expect(page.getByTestId('bg-scale')).toContainText('Kalibriert');
      const m1 = await measure(page, size, check.a as [number, number], check.b as [number, number]);
      test.info().annotations.push({ type: 'Messung 1', description: `soll ${check.m.toFixed(2)} m, ist ${m1} m` });
      expect(Math.abs(m1 - check.m)).toBeLessThan(0.6);

      // Zweite Kalibrierung am bereits kalibrierten (gesperrten) Plan über die Prüfstrecke
      await calibrate(page, size, check.a as [number, number], check.b as [number, number], String(check.m).replace('.', ','));
      const m2 = await measure(page, size, cal.a as [number, number], cal.b as [number, number]);
      test.info().annotations.push({ type: 'Messung 2', description: `soll ${cal.m} m, ist ${m2} m` });
      expect(Math.abs(m2 - cal.m)).toBeLessThan(0.6);
      const b = (await bg(page))!;
      expect(b.locked).toBe(true);
      expect(b.calibration?.meters).toBeCloseTo(check.m, 2);
      expect(errors).toEqual([]);
    });
  }

  test('M2-06/07: Kalibrieren eines gedrehten Plans', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await page.locator('#bg-rot').fill('30');
    await page.keyboard.press('Enter');
    await page.keyboard.press(`${MOD}+0`);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    // Quellpunkte über die Store-Transformation in Bildschirmpunkte umrechnen
    const toScreen = async (u: number, v: number) =>
      page.evaluate(
        (src) => {
          const s = (window as any).__marktplanerStore.getState();
          const pg = s.project.pages.find((p: any) => p.id === s.ui.activePage);
          const t = pg.background.transform;
          const r = (t.rot * Math.PI) / 180;
          const x = t.x + (src.u * Math.cos(r) - src.v * Math.sin(r)) * t.metersPerPx;
          const y = t.y + (src.u * Math.sin(r) + src.v * Math.cos(r)) * t.metersPerPx;
          const view = s.views[pg.id];
          const box = document.querySelector('svg.canvas')!.getBoundingClientRect();
          return { x: box.left + view.tx + x * view.scale, y: box.top + view.ty + y * view.scale };
        },
        { u, v },
      );
    await page.keyboard.press('k');
    for (const [u, v] of [[100, 100], [600, 100]]) {
      const p = await toScreen(u!, v!);
      await page.mouse.click(p.x, p.y);
    }
    await page.locator('#calibrate-meters').fill('50');
    await page.getByRole('button', { name: 'Anwenden' }).click();
    expect((await bg(page))!.transform.rot).toBe(30);
    expect((await bg(page))!.transform.metersPerPx).toBeCloseTo(0.1, 2);
    await page.keyboard.press('m');
    for (const [u, v] of [[100, 100], [100, 700]]) {
      const p = await toScreen(u!, v!);
      await page.mouse.click(p.x, p.y);
    }
    const shown = parseDe(((await page.locator('.measure-label').textContent()) ?? '').replace(' m', ''));
    expect(Math.abs(shown - 60)).toBeLessThan(0.6);
  });

  test('M2-06: Undo/Redo der Kalibrierung stellt Maßstab und Sperre wieder her', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    const before = (await bg(page))!;
    await calibrate(page, RASTER, [100, 100], [600, 100], '50');
    expect((await bg(page))!.locked).toBe(true);
    await page.keyboard.press(`${MOD}+z`);
    let b = (await bg(page))!;
    expect(b.locked).toBe(false);
    expect(b.calibration).toBeUndefined();
    expect(b.transform.metersPerPx).toBeCloseTo(before.transform.metersPerPx, 9);
    await page.keyboard.press(`${MOD}+Shift+z`);
    b = (await bg(page))!;
    expect(b.locked).toBe(true);
    expect(b.transform.metersPerPx).toBeCloseTo(0.1, 2);
  });
});

test.describe('QA M2: Zahleneingaben mit Tausenderpunkt (QA-M2-01)', () => {
  test('QA-M2-01: Planmaßstab 1:1000 bleibt nach bloßem Hinein- und Herausklicken erhalten', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-1zu1000.pdf');
    await page.locator('#bg-paper-scale').fill('1000');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('bg-scale')).toContainText('Maßstab 1:1.000');
    // Feld zeigt „1.000“; nur fokussieren und verlassen
    await page.locator('#bg-paper-scale').click();
    await page.locator('#north-angle').click();
    await expect(page.getByTestId('bg-scale')).toContainText('Maßstab 1:1.000', { timeout: 1000 });
  });

  test('QA-M2-01: Pfeiltaste im Planmaßstab 1:1.200 erhöht um 50 auf 1:1.250', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-1zu1000.pdf');
    await page.locator('#bg-paper-scale').fill('1200');
    await page.keyboard.press('Enter');
    await page.locator('#bg-paper-scale').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('bg-scale')).toContainText('Maßstab 1:1.250', { timeout: 1000 });
  });

  test('QA-M2-01: Rasterweite 1000 m bleibt nach Fokus/Tab erhalten', async ({ page }) => {
    await openApp(page);
    await page.locator('#grid-size').fill('1000');
    await page.keyboard.press('Enter');
    await page.locator('#grid-size').click();
    await page.keyboard.press('Tab');
    const size = await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].grid.size);
    expect(size).toBe(1000);
  });

  test('QA-M2-01: Vorbelegter Abstand ≥ 1000 m wird beim Anwenden nicht durch 1000 geteilt', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await calibrate(page, RASTER, [100, 100], [600, 100], '1500');
    await page.keyboard.press(`${MOD}+0`);
    const p = await at(page, RASTER);
    await page.keyboard.press('k');
    await page.mouse.click(p(100, 100).x, p(100, 100).y);
    await page.mouse.click(p(600, 100).x, p(600, 100).y);
    await expect(page.locator('#calibrate-meters')).toHaveValue(/1[.]?500/);
    await page.getByRole('button', { name: 'Anwenden' }).click();
    expect((await bg(page))!.transform.metersPerPx).toBeCloseTo(3, 1);
  });
});

test.describe('QA M2: ungültige und leere Dateien', () => {
  for (const [name, mime, content, text] of [
    ['leer.pdf', 'application/pdf', '', 'nicht unterstützt'],
    ['leer.png', 'image/png', '', 'nicht unterstützt'],
    ['leer.svg', 'image/svg+xml', '', 'SVG-Datei ist ungültig'],
    ['kaputt.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="10"', 'SVG-Datei ist ungültig'],
    ['ohne-groesse.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', 'weder Breite/Höhe'],
  ] as const) {
    test(`M2-01/02: ${name} → verständliche Meldung, App läuft weiter`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      await importFile(page, { name, mimeType: mime, buffer: Buffer.from(content) });
      const dlg = page.getByRole('alertdialog');
      await expect(dlg).toContainText(text);
      await dlg.getByRole('button', { name: 'OK' }).click();
      await expect(page.locator('.background-layer')).toHaveCount(0);
      // App bedienbar: danach gültige Datei importieren
      await importReady(page, 'raster-10m.png');
      expect(errors).toEqual([]);
    });
  }

  test('QA-M2-02: beschädigtes PDF → Meldung auf Deutsch (nicht „Invalid PDF structure.“)', async ({ page }) => {
    await openApp(page);
    await importFile(page, { name: 'kaputt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nkaputt\n%%EOF\n') });
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).not.toContainText('Invalid PDF structure');
  });

  test('QA-M2-02: abgeschnittenes PNG → Meldung auf Deutsch (nicht „The source image could not be decoded.“)', async ({ page, browserName }) => {
    // WebKit dekodiert abgeschnittene Bilder teilweise und importiert sie ohne Meldung (kein Fehlerfall).
    test.skip(browserName === 'webkit', 'WebKit importiert das Teilbild');
    await openApp(page);
    const png = readFileSync(join(FX, 'raster-10m.png')).subarray(0, 3000);
    await importFile(page, { name: 'kaputt.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).not.toContainText('could not be decoded');
  });
});

test.describe('QA M2: Speichern, Neuladen, Dateigröße', () => {
  for (const [file, pdfPage] of [
    ['raster-10m.png', 0],
    ['raster-10m.svg', 0],
    ['plan-2seiten.pdf', 2],
  ] as const) {
    test(`Speichern/Öffnen ${file}: Maßstab, Drehung, Deckkraft, Sperre, Raster, Norden bleiben`, async ({ page }) => {
      await openApp(page);
      await importReady(page, file, pdfPage || undefined);
      const size = (await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].background.pxSize)) as Size;
      await calibrate(page, size, [size.w * 0.1, size.h * 0.1], [size.w * 0.6, size.h * 0.1], '50');
      await page.getByLabel('Gesperrt (nicht verschiebbar)').uncheck();
      await page.locator('#bg-opacity').focus();
      for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowLeft'); // 35 %
      await page.locator('#bg-rot').fill('30');
      await page.keyboard.press('Enter');
      await page.getByLabel('Gesperrt (nicht verschiebbar)').check();
      await page.locator('#grid-size').fill('5');
      await page.keyboard.press('Enter');
      await page.locator('#north-angle').fill('45');
      await page.keyboard.press('Enter');
      const before = await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0]);

      const dl = page.waitForEvent('download');
      await page.keyboard.press(`${MOD}+s`);
      const bytes = new Uint8Array(readFileSync(await (await dl).path()));
      const assets = Object.entries(unzipSync(bytes)).filter(([k]) => k.startsWith('assets/'));
      expect(assets).toHaveLength(1);
      // Projektdatei ≈ eingebettete Datei + wenige KB project.json
      const overhead = bytes.length - assets[0]![1].length;
      test.info().annotations.push({ type: 'Dateigröße', description: `${bytes.length} B gesamt, Asset ${assets[0]![1].length} B, Quelle ${readFileSync(join(FX, file)).length} B` });
      expect(overhead).toBeLessThan(5000);

      await page.reload();
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press(`${MOD}+o`);
      await (await chooser).setFiles({ name: 'qa.schelme', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
      await expect(page.getByTestId('bg-scale')).toContainText('Kalibriert');
      await expect(page.locator('.background-layer image').first()).toBeVisible();
      const after = await page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0]);
      expect(after.background).toEqual(before.background);
      expect(after.grid).toEqual({ size: 5, visible: true });
      expect(after.northAngle).toBe(45);
      await expect(page.locator('output[for="bg-opacity"]')).toHaveText('35 %');
      await expect(page.locator('.background-layer > g').first()).toHaveAttribute('opacity', '0.35');
      await expect(page.getByLabel('Gesperrt (nicht verschiebbar)')).toBeChecked();
      await expect(page.locator('#bg-rot')).toHaveValue('30');
    });
  }

  test('Autosave (Browser) sichert den Plan mit und stellt ihn wieder her', async ({ page, context }) => {
    test.setTimeout(90_000);
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    await page.locator('#bg-rot').fill('20');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(32_000);
    const p2 = await context.newPage();
    await p2.goto('/');
    const dlg = p2.getByRole('alertdialog');
    await expect(dlg).toContainText('Sicherung');
    await dlg.getByRole('button', { name: /Wiederherstellen/ }).click();
    await expect(p2.getByTestId('bg-scale')).toBeVisible();
    await expect(p2.locator('.background-layer image').first()).toBeVisible();
    await expect(p2.locator('#bg-rot')).toHaveValue('20');
  });

  test('QA-M2-04: dieselbe PDF-Seite auf zwei Festplätzen wird nur einmal eingebettet', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'plan-2seiten.pdf', 2);
    await page.getByRole('button', { name: 'Festplatz-Tab hinzufügen' }).click();
    await page.keyboard.press('Escape');
    // pdf-lib schreibt ein sekundengenaues Erstelldatum in die herausgelöste Seite
    await page.waitForTimeout(1100);
    await importReady(page, 'plan-2seiten.pdf', 2);
    const dl = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const files = unzipSync(new Uint8Array(readFileSync(await (await dl).path())));
    expect(Object.keys(files).filter((k) => k.startsWith('assets/'))).toHaveLength(1);
  });
});

test.describe('QA M2: Ersetzen, Sperre, Undo', () => {
  test('M2-05: Ersetzen lässt gezeichnete Objekte unverändert; Undo stellt den alten Plan her', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    // Objekt direkt im Store anlegen (Werkzeuge folgen in M3)
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('QA Objekt', (p: any) => {
        p.pages[0].areas.push({ id: 'qa-area', name: 'A', cx: 10, cy: 20, w: 50, d: 10, rot: 15, front: 2 });
      });
    });
    const area0 = await page.evaluate(() => JSON.stringify((window as any).__marktplanerStore.getState().project.pages[0].areas));
    await importFile(page, 'plan-1zu1000.pdf');
    await expect(page.locator('.bg-file')).toContainText('plan-1zu1000.pdf');
    expect(await page.evaluate(() => JSON.stringify((window as any).__marktplanerStore.getState().project.pages[0].areas))).toBe(area0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.bg-file')).toContainText('raster-10m.png');
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(page.locator('.bg-file')).toContainText('plan-1zu1000.pdf');
    // Gespeichert wird nur der aktuelle Plan
    const dl = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const files = unzipSync(new Uint8Array(readFileSync(await (await dl).path())));
    expect(Object.keys(files).filter((k) => k.startsWith('assets/'))).toEqual([expect.stringMatching(/\.pdf$/)]);
  });

  test('M2-03: Deckkraft per Maus ziehen ist genau ein Undo-Schritt, auch beim Loslassen außerhalb', async ({ page }) => {
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    const past = () => page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
    const n0 = await past();
    const sl = (await page.locator('#bg-opacity').boundingBox())!;
    await page.mouse.move(sl.x + sl.width - 3, sl.y + sl.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sl.x + sl.width - 3 - i * 10, sl.y + sl.height / 2 + i * 12);
    await page.mouse.up();
    expect((await bg(page))!.opacity).toBeLessThan(1);
    expect(await past()).toBe(n0 + 1);
    await page.keyboard.press('Escape');
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+z`);
    expect((await bg(page))!.opacity).toBe(1);
  });

  test('M2-09: Raster per Cmd/Strg+# und Werkzeugleiste umschalten', async ({ page }) => {
    await openApp(page);
    const visible = () => page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages[0].grid.visible);
    await page.locator('svg.canvas').click({ position: { x: 300, y: 300 } });
    await page.keyboard.press(`${MOD}+#`);
    expect(await visible()).toBe(false);
    await page.getByRole('button', { name: 'Raster ein/aus' }).click();
    expect(await visible()).toBe(true);
  });

  test('M2-06: Undo während einer laufenden Kalibrierung entfernt den Plan ohne Absturz', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await importReady(page, 'raster-10m.png');
    const p = await at(page, RASTER);
    await page.keyboard.press('k');
    await page.mouse.click(p(100, 100).x, p(100, 100).y);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('.background-layer')).toHaveCount(0);
    await page.mouse.click(p(600, 100).x, p(600, 100).y);
    await expect(page.locator('.tool-panel-host')).toContainText('Zuerst einen Hintergrund importieren');
    expect(errors).toEqual([]);
  });
});
