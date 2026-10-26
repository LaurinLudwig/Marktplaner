import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { MOD, openApp } from './helpers';

/**
 * QA M8-09 (spec.md §9 „Bedienung“): „Der Export läuft im Hintergrund auf einem Stand des Projekts zum Zeitpunkt
 * des Starts; die Oberfläche bleibt bedienbar.“ Ergänzt `m8-export.spec.ts` (Page wechseln, Abbrechen) um eine echte
 * Dateninhaltsänderung während des laufenden Exports: Der Standname wird geändert, während der Export noch läuft;
 * das heruntergeladene PDF muss den alten Namen zeigen, nicht den neuen.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);

async function importBigJpeg(page: Page) {
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 8000;
    c.height = 6000;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f4f1ea';
    x.fillRect(0, 0, 8000, 6000);
    x.strokeStyle = '#345';
    x.lineWidth = 3;
    for (let i = 0; i < 8000; i += 41) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(8000 - i, 6000);
      x.stroke();
    }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]!;
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles({ name: 'grossplan.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await expect.poll(() => store(page, 's.project.pages[0].background?.kind'), { timeout: 30_000 }).toBe('image');
}

test('Standname während des laufenden Exports geändert: PDF zeigt den Stand der Vorlage zum Startzeitpunkt', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Testdaten', (p: any) => {
      p.pages[0].stands.push({
        id: 'qa1',
        cx: 5,
        cy: 5,
        w: 4,
        d: 4,
        rot: 0,
        name: 'Vor-dem-Export-Name',
        nr: 'A-1',
        nrLocked: false,
        owner: '',
        ware: '',
        powerKw: 0,
        connection: null,
        note: '',
        categoryId: null,
        color: null,
        suppressOutsideWarning: false,
        suppressOverlapWarning: false,
        suppressDuplicateWarning: false,
        suppressInfraWarning: false,
      });
    });
  });
  await importBigJpeg(page);
  await page.keyboard.press(`${MOD}+p`);
  await expect(page.getByRole('dialog', { name: 'Als PDF exportieren' })).toBeVisible();
  await page.getByLabel('Auflösung der Rasterhintergründe').selectOption('original');
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('dialog', { name: 'Als PDF exportieren' }).getByRole('button', { name: 'Exportieren' }).click();
  await expect(page.getByTestId('export-progress')).toBeVisible();
  // Während der Export noch läuft: Standname ändern
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Name ändern', (p: any) => {
      p.pages[0].stands.find((st: any) => st.id === 'qa1').name = 'Nach-dem-Start-geaendert';
    });
  });
  const d = await download;
  const bytes = new Uint8Array(readFileSync((await d.path())!));
  const pdf = await readPdf(bytes);
  const text = pdf.pages.map((p) => p.text).join('\n');
  expect(text).toContain('Vor-dem-Export-Name');
  expect(text).not.toContain('Nach-dem-Start-geaendert');
});
