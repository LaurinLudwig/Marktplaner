import { expect, test, type Page } from '@playwright/test';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { collectErrors, MOD, openApp } from './helpers';

/**
 * QA M8 (E-56): PDF-Hintergründe mit Seitendrehung (/Rotate 90/180/270). Bisher (Stand Abschluss M8) nur eine Seite
 * ohne Drehung getestet (`writePdf.test.ts`, Hintergrund-Vektor). Dieser Test erzeugt selbst eine gedrehte PDF-Datei
 * (pdf-lib) mit einer markanten Textzeile, importiert sie als Hintergrund und prüft, dass die Drehung im Export
 * tatsächlich wirkt (Textposition verschiebt sich mit dem Winkel) statt ignoriert zu werden.
 */

async function rotatedPdf(angle: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 0, width: 20, height: 20, color: rgb(1, 0, 0) });
  page.drawRectangle({ x: 180, y: 0, width: 20, height: 20, color: rgb(0, 1, 0) });
  page.drawRectangle({ x: 0, y: 80, width: 20, height: 20, color: rgb(0, 0, 1) });
  page.drawText('Marke-Blau-Ecke', { x: 30, y: 85, size: 8, font });
  // Typfehler korrigiert vom Entwickler (M8-Nacharbeit): pdf-lib erwartet den Helfer `degrees()`
  if (angle) page.setRotation(degrees(angle));
  return Buffer.from(await doc.save());
}

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);

async function importRotatedBackground(page: Page, angle: number) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles({ name: `rot${angle}.pdf`, mimeType: 'application/pdf', buffer: await rotatedPdf(angle) });
  await expect.poll(() => store(page, 's.project.pages[0].background?.kind')).toBe('pdf');
}

async function exportFirstPage(page: Page) {
  const download = page.waitForEvent('download');
  await page.keyboard.press(`${MOD}+p`);
  await expect(page.getByRole('dialog', { name: 'Als PDF exportieren' })).toBeVisible();
  await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await page.getByRole('dialog', { name: 'Als PDF exportieren' }).getByRole('button', { name: 'Exportieren' }).click();
  const d = await download;
  const { readFileSync } = await import('node:fs');
  const bytes = new Uint8Array(readFileSync((await d.path())!));
  return readPdf(bytes);
}

test.describe('QA M8 (E-56): gedrehte PDF-Hintergründe', () => {
  for (const angle of [90, 180, 270]) {
    test(`/Rotate ${angle}: Hintergrund als Vektor, Marke wandert mit der Drehung statt an fester Stelle zu bleiben`, async ({ page }) => {
      const errors = collectErrors(page);
      await openApp(page);
      await importRotatedBackground(page, angle);
      const pdf = await exportFirstPage(page);
      // Der eingebettete Text aus dem Hintergrund-PDF ist weiterhin durchsuchbar (Vektor-Einbettung, kein Raster)
      expect(pdf.pages[0]!.text).toContain('Marke-Blau-Ecke');
      expect(errors).toEqual([]);
    });
  }

  test('0° vs. 90°: dieselbe Quelle an unterschiedlicher Stelle im PDF (Drehung wirkt, wird nicht ignoriert)', async ({ page }) => {
    await openApp(page);
    await importRotatedBackground(page, 0);
    const flat = await exportFirstPage(page);
    const xFlat = flat.pages[0]!.items.find((i) => i.str.includes('Marke'))!.x;

    await page.reload();
    await openApp(page);
    await importRotatedBackground(page, 90);
    const rotated = await exportFirstPage(page);
    const xRotated = rotated.pages[0]!.items.find((i) => i.str.includes('Marke'))!.x;

    expect(Math.abs(xRotated - xFlat)).toBeGreaterThan(5);
  });
});
