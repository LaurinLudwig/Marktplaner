import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MOD, openApp } from './helpers';

/**
 * Lasttest PDF-Export (M8-10, Abnahmekriterium spec.md §9): 8 Pages A1 quer mit je einem JPEG-Hintergrund
 * 8000 × 6000 px, 500 Stände, Profil „Intern“ mit Anhang, 300 dpi. Median aus 3 Läufen höchstens 60 s, während des
 * Exports kein Bild der Oberfläche über 200 ms, Datei höchstens 200 MB. Dazu (M8-Nacharbeit) ein Lauf mit Qualität
 * „E-Mail“: Datei unter 20 MB; die im Dialog geschätzte Größe liegt jeweils zwischen der Hälfte und dem Doppelten der
 * echten.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);

async function setup(page: Page) {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+o`);
  await (await chooser).setFiles('tests/fixtures/last-500-staende.schelme');
  await expect.poll(() => store(page, 's.project.pages.reduce((n, p) => n + p.stands.length, 0)')).toBe(500);
  // 4 weitere Festplätze ohne Stände (Kopien der Grundflächen), damit es 8 Pages mit 500 Ständen sind
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Testdaten', (p: any) => {
      for (let i = 0; i < 4; i++) {
        const src = p.pages[i];
        p.pages.push({ ...JSON.parse(JSON.stringify(src)), id: `extra-${i}`, name: `${src.name} (leer)`, stands: [], infra: [], areas: src.areas.map((a: any) => ({ ...a, id: `${a.id}-x${i}` })) });
      }
    });
  });
  // Großer JPEG-Hintergrund auf der ersten Page importieren, dann auf allen 8 Pages über das Blatt legen
  await page.keyboard.press('Alt+1');
  const jpg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 8000;
    c.height = 6000;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f4f1ea';
    x.fillRect(0, 0, 8000, 6000);
    x.strokeStyle = '#345';
    x.lineWidth = 3;
    for (let i = 0; i < 8000; i += 37) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(8000 - i, 6000);
      x.stroke();
    }
    x.font = '40px sans-serif';
    x.fillStyle = '#933';
    for (let i = 0; i < 400; i++) x.fillText(`Haus ${i}`, (i * 397) % 7800, (i * 211) % 5900);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]!;
  });
  const bgChooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await bgChooser).setFiles({ name: 'grossplan.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await expect.poll(() => store(page, 's.project.pages[0].background?.kind'), { timeout: 30_000 }).toBe('image');
  await page.evaluate(async () => {
    const { pagePaper } = await import('/src/core/paper.ts' as string);
    const s = (window as any).__marktplanerStore.getState();
    s.change('Testdaten', (p: any) => {
      const bg = p.pages[0].background;
      for (const pg of p.pages) {
        pg.sheet = { format: 'A1', orientation: 'landscape', scale: null, cx: 0, cy: 0 };
        const f = pagePaper(pg, p).frame.bounds;
        const w = (f.maxX - f.minX) * 1.05;
        const mpp = w / 8000;
        pg.background = { ...bg, transform: { x: (f.minX + f.maxX) / 2 - (8000 * mpp) / 2, y: (f.minY + f.maxY) / 2 - (6000 * mpp) / 2, metersPerPx: mpp, rot: 0 }, opacity: 1, locked: true };
      }
    });
  });
}

/** Bildzeiten der Oberfläche während `action` (requestAnimationFrame). */
async function withFrames<T>(page: Page, action: () => Promise<T>): Promise<{ result: T; maxFrame: number }> {
  await page.evaluate(() => {
    const w = window as any;
    w.m8Frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.m8Frames.push(t - last);
      last = t;
      if (w.m8FramesOn) requestAnimationFrame(tick);
    };
    w.m8FramesOn = true;
    requestAnimationFrame(tick);
  });
  const result = await action();
  const frames = (await page.evaluate(() => {
    const w = window as any;
    w.m8FramesOn = false;
    return w.m8Frames as number[];
  })) as number[];
  return { result, maxFrame: Math.max(...frames.slice(1)) };
}

test('PDF-Export: 8 × A1 mit großen Hintergründen, 500 Stände, „Intern“ mit Anhang, 300 dpi', async ({ page }, info) => {
  test.setTimeout(600_000);
  await setup(page);
  const runs: { ms: number; maxFrame: number; bytes: number; estimate: number }[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(`${MOD}+p`);
    const dlg = page.getByRole('dialog', { name: 'Als PDF exportieren' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Auflösung der Rasterhintergründe').selectOption('300');
    const estimate = Number(await page.getByTestId('export-size-estimate').getAttribute('data-bytes'));
    const { result, maxFrame } = await withFrames(page, async () => {
      const t0 = Date.now();
      const download = page.waitForEvent('download', { timeout: 300_000 });
      await dlg.getByRole('button', { name: 'Exportieren' }).click();
      const d = await download;
      const ms = Date.now() - t0;
      const path = (await d.path())!;
      return { ms, bytes: statSync(path).size, path };
    });
    if (i === 0) {
      const head = readFileSync(result.path).subarray(0, 5).toString();
      expect(head).toBe('%PDF-');
    }
    runs.push({ ms: result.ms, maxFrame, bytes: result.bytes, estimate });
  }
  // Qualität „E-Mail“
  await page.keyboard.press(`${MOD}+p`);
  const dlg = page.getByRole('dialog', { name: 'Als PDF exportieren' });
  await dlg.getByLabel('Auflösung der Rasterhintergründe').selectOption('email');
  const emailEstimate = Number(await page.getByTestId('export-size-estimate').getAttribute('data-bytes'));
  const download = page.waitForEvent('download', { timeout: 300_000 });
  await dlg.getByRole('button', { name: 'Exportieren' }).click();
  const emailBytes = statSync((await (await download).path())!).size;
  const median = runs.map((r) => r.ms).toSorted((a, b) => a - b)[1]!;
  const worstFrame = Math.max(...runs.map((r) => r.maxFrame));
  const mb = runs[0]!.bytes / 1e6;
  const emailMb = emailBytes / 1e6;
  const report =
    `${info.project.name}: Median ${(median / 1000).toFixed(1)} s (${runs.map((r) => (r.ms / 1000).toFixed(1)).join(' / ')}), längstes Bild ${worstFrame.toFixed(0)} ms, ` +
    `Datei ${mb.toFixed(1)} MB (geschätzt ${(runs[0]!.estimate / 1e6).toFixed(1)} MB); E-Mail ${emailMb.toFixed(1)} MB (geschätzt ${(emailEstimate / 1e6).toFixed(1)} MB)`;
  info.annotations.push({ type: 'Messung', description: report });
  mkdirSync('test-artifacts/logs', { recursive: true });
  writeFileSync(`test-artifacts/logs/perf-m8-export-${info.project.name}.txt`, report);
  expect.soft(median, 'Exportdauer (Median) ≤ 60 s').toBeLessThanOrEqual(60_000);
  expect.soft(worstFrame, 'längstes Bild während des Exports ≤ 200 ms').toBeLessThanOrEqual(200);
  expect.soft(mb, 'Dateigröße ≤ 200 MB').toBeLessThanOrEqual(200);
  expect.soft(emailMb, 'Dateigröße „E-Mail“ < 20 MB').toBeLessThan(20);
  for (const [est, real, name] of [
    [runs[0]!.estimate, runs[0]!.bytes, '300 dpi'],
    [emailEstimate, emailBytes, 'E-Mail'],
  ] as const) {
    expect.soft(est / real, `Schätzung ${name} zwischen 50 % und 200 % der echten Größe`).toBeGreaterThan(0.5);
    expect.soft(est / real, `Schätzung ${name} zwischen 50 % und 200 % der echten Größe`).toBeLessThan(2);
  }
});
