import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { MOD, openApp } from './helpers';

/**
 * QA M2: Leistung mit großem Plan (aus m2-qa.spec.ts herausgelöst). Läuft als Lasttest über `npm run test:perf`
 * seriell, nicht in `test:e2e`: Parallel laufende Browser verfälschen die Bildrate (QA-M3-L1); in der CI
 * lieferte der Test dort 22–35 statt 60 Bilder/s.
 */

const FX = join(process.cwd(), 'tests', 'fixtures');

async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles(typeof file === 'string' ? join(FX, file) : file);
}

test.describe('QA M2: Leistung mit großem Plan', () => {
  test('A0-PDF (15.000 Linien, 3.000 Texte): Zoom und Pan ≥ 40 Bilder/s, Detailbild < 2 s', async ({ page }) => {
    test.setTimeout(120_000);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const W = 3370;
    const H = 2384;
    const pg = doc.addPage([W, H]);
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 15000; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      pg.drawLine({ start: { x, y }, end: { x: x + (rnd() - 0.5) * 200, y: y + (rnd() - 0.5) * 200 }, thickness: 0.5, color: rgb(0.2, 0.3, 0.4) });
    }
    for (let i = 0; i < 3000; i++) pg.drawText(`Stand ${i}`, { x: rnd() * W, y: rnd() * H, size: 6, font });
    const buffer = Buffer.from(await doc.save());

    await openApp(page);
    await importFile(page, { name: 'a0.pdf', mimeType: 'application/pdf', buffer });
    await expect(page.getByTestId('bg-scale')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.background-layer image').first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press(`${MOD}+0`);
    await page.waitForTimeout(1000);

    const run = (mode: 'zoom' | 'pan') =>
      page.evaluate(async (m) => {
        const el = document.querySelector('svg.canvas')!;
        const r = el.getBoundingClientRect();
        const times: number[] = [];
        for (let i = 0; i < 120; i++) {
          times.push(await new Promise<number>((res) => requestAnimationFrame(res)));
          const init =
            m === 'zoom'
              ? { deltaY: i < 60 ? -8 : 8, ctrlKey: true }
              : { deltaX: i < 60 ? 12 : -12, deltaY: i < 60 ? 3 : -3, ctrlKey: false };
          el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, ...init }));
        }
        const d = times.slice(1).map((t, i) => t - times[i]!);
        return { fps: (1000 * d.length) / (times.at(-1)! - times[0]!), max: Math.max(...d) };
      }, mode);
    const zoom = await run('zoom');
    const pan = await run('pan');
    test.info().annotations.push({ type: 'Leistung', description: `Zoom ${zoom.fps.toFixed(1)} fps (max ${zoom.max.toFixed(0)} ms), Pan ${pan.fps.toFixed(1)} fps (max ${pan.max.toFixed(0)} ms)` });
    expect(zoom.fps).toBeGreaterThan(40);
    expect(pan.fps).toBeGreaterThan(40);

    await page.keyboard.press(`${MOD}+0`);
    for (let i = 0; i < 12; i++) await page.keyboard.press(`${MOD}+Equal`);
    const t0 = Date.now();
    await expect(page.locator('.background-layer image')).toHaveCount(2, { timeout: 5000 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
