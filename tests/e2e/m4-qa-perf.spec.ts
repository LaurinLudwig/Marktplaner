import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, MOD, openApp } from './helpers';

/**
 * QA M4-21 (eigener Lasttest, spec.md NFA): 500 Stände auf einer Page mit vielen Freiflächen, darunter
 * angeschnittene (L-förmige) aus überlappenden Grundflächen, gedrehten Ständen, Warnungen, allen
 * Fang-Optionen inkl. eingeblendetem Raster UND einem großen Hintergrundplan (PNG 8000 × 6000 px).
 * Gemessen: Zoomen, Ansicht verschieben (Übersicht und Lesegröße), Ziehen eines Stands quer über
 * mehrere (auch überlappende) Grundflächen und Gleiten entlang einer Vorderseite.
 * Läuft nur in `npm run test:perf` (seriell, ein Worker).
 */

const FRAMES = 150;
const MIN_FPS = 50;

async function importBigPlan(page: Page) {
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 8000;
    c.height = 6000;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 8000, 6000);
    x.strokeStyle = '#345';
    x.lineWidth = 2;
    for (let i = 0; i < 8000; i += 37) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(8000 - i, 6000);
      x.stroke();
    }
    x.font = '40px sans-serif';
    x.fillStyle = '#933';
    for (let i = 0; i < 400; i++) x.fillText(`Haus ${i}`, (i * 397) % 7800, (i * 211) % 5900);
    // Als Base64 übergeben: ein Zahlen-Array dieser Größe sprengt den Speicher des Test-Prozesses
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles({ name: 'grossplan.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.raster-overview')).toHaveCount(1, { timeout: 30_000 });
}

/**
 * 10 Reihen 200 × 5 m mit je 50 Ständen (jeder fünfte um 20° gedreht, jeder elfte überlappend, jeder
 * siebte vorn heraus) und 5 spätere, senkrecht stehende Grundflächen 2,5 × 70 m, die alle Reihen
 * schneiden (angeschnittene Freiflächen aus vielen Stücken). Zusammen 500 Stände.
 */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nrLocked: false, owner: 'Muster', ware: 'Ware', powerKw: 3, connection: 'CEE16', note: '', categoryId: null, suppressOutsideWarning: false, suppressOverlapWarning: false };
    s.change('Lasttest', (p: any) => {
      const pg = p.pages[0];
      let n = 1;
      for (let row = 0; row < 10; row++) {
        const y = row * 6.6 - 30;
        pg.areas.push({ id: `a${row}`, name: `Reihe ${row + 1}`, cx: 0, cy: y, w: 200, d: 5, rot: 0 });
        for (let i = 0; i < 50; i++) {
          pg.stands.push({
            ...base,
            id: `s${n}`,
            nr: String(n),
            name: `Geschäft Nummer ${n}`,
            color: i % 3 === 0 ? '#e57373' : null,
            cx: -98 + i * 4 + (i % 11 === 10 ? -2 : 0),
            cy: y + 1 + (i % 7 === 3 ? 1 : 0),
            w: 3,
            d: 3,
            rot: i % 5 === 4 ? 20 : 0,
          });
          n++;
        }
      }
      // Spätere, senkrecht stehende Grundflächen quer über alle Reihen: ihre Freifläche zerfällt in
      // viele Stücke (Teile zwischen den Reihen, Schlüssel mit #k)
      for (let k = 0; k < 5; k++) {
        const x = -80 + k * 40 + 1.5;
        pg.areas.push({ id: `q${k}`, name: `Quer ${k + 1}`, cx: x, cy: 0, w: 2.5, d: 70, rot: 0 });
      }
      p.settings.snap = { front: true, grid: true, neighbors: true };
      pg.grid.visible = true;
    });
    const { w, h } = s.ui.viewport;
    s.setView(s.project.pages[0].id, { scale: 5.5, tx: w / 2, ty: h / 2 });
  });
  await expect(page.locator('.stand')).toHaveCount(500);
  const free = await page.locator('.free-space').count();
  expect(free).toBeGreaterThan(400);
  return free;
}

interface Result {
  fps: number;
  maxFrameMs: number;
  p95Ms: number;
}

function measure(page: Page, kind: 'zoom' | 'pan' | 'drag' | 'glide', at: { x: number; y: number }): Promise<Result> {
  return page.evaluate(
    ({ mode, pos, frames }) =>
      new Promise<Result>((resolve) => {
        const svg = document.querySelector('svg.canvas')!;
        const times: number[] = [];
        let i = 0;
        const step = (t: number) => {
          times.push(t);
          if (i >= frames) {
            const gaps = times
              .slice(1)
              .map((v, k) => v - times[k]!)
              .toSorted((a, b) => a - b);
            resolve({ fps: ((times.length - 1) / (times.at(-1)! - times[0]!)) * 1000, maxFrameMs: gaps.at(-1)!, p95Ms: gaps[Math.floor(gaps.length * 0.95)]! });
            return;
          }
          if (mode === 'zoom') {
            const dy = (Math.floor(i / 15) % 2 ? 1 : -1) * 4;
            svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaY: dy, ctrlKey: true }));
          } else if (mode === 'pan') {
            const dx = (Math.floor(i / 30) % 2 ? 1 : -1) * 6;
            svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaX: dx, deltaY: 1 }));
          } else if (mode === 'drag') {
            // quer über Reihen und Querflächen (diagonal)
            const off = (i % 60 < 30 ? i % 30 : 30 - (i % 30)) * 7;
            svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pos.x + off, clientY: pos.y - off, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
          } else {
            // entlang der Vorderseite gleiten (eingerastet), über Nachbarn und Querflächen
            const off = (i % 100 < 50 ? i % 50 : 50 - (i % 50)) * 6;
            svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pos.x + off, clientY: pos.y + (i % 2), pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
          }
          i++;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { mode: kind, pos: at, frames: FRAMES },
  );
}

const screenOf = (page: Page, id: string) =>
  page.evaluate((sid) => {
    const s = (window as any).__marktplanerStore.getState();
    const st = s.project.pages[0].stands.find((x: any) => x.id === sid);
    const v = s.views[s.project.pages[0].id];
    return { x: v.tx + st.cx * v.scale, y: v.ty + st.cy * v.scale };
  }, id);

test.describe('QA M4-21: eigener Lasttest mit großem Plan und angeschnittenen Freiflächen', () => {
  test('500 Stände, > 400 Freiflächen-Stücke, Plan 8000 × 6000 px: ≥ 50 Bilder/s', async ({ page }, info) => {
    test.setTimeout(180_000);
    await openApp(page);
    // QA_NO_PLAN=1: Vergleichsmessung ohne Hintergrund (Ursache eingrenzen)
    if (!process.env.QA_NO_PLAN) await importBigPlan(page);
    const free = await seed(page);
    const box = await canvasBox(page);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const setScale = (k: number) =>
      page.evaluate((kk) => {
        const s = (window as any).__marktplanerStore.getState();
        s.setView(s.project.pages[0].id, { scale: kk, tx: s.ui.viewport.w / 2, ty: s.ui.viewport.h / 2 });
      }, k);

    // Je drei Messungen, gewertet wird der Median (robuster gegen einzelne Ausreißer)
    const median3 = async (scale: number, kind: 'zoom' | 'pan') => {
      const runs: Result[] = [];
      for (let k = 0; k < 3; k++) {
        await setScale(scale);
        runs.push(await measure(page, kind, center));
      }
      return { ...runs.toSorted((a, b) => a.fps - b.fps)[1]!, runs: runs.map((r) => Math.round(r.fps * 10) / 10) };
    };
    const zoom = await median3(5.5, 'zoom');
    const pan = await median3(5.5, 'pan');
    await setScale(20);
    expect(await page.locator('.free-label').count()).toBeGreaterThan(10);
    const panReadable = await median3(20, 'pan');
    await setScale(5.5);

    // Stand aus Reihe 9 diagonal über Reihen und Querflächen ziehen
    let t = await screenOf(page, 's321');
    let grab = { x: box.x + t.x, y: box.y + t.y };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 5, grab.y - 5, { steps: 3 });
    const drag = await measure(page, 'drag', grab);
    expect(await page.evaluate(() => !!(window as any).__marktplanerStore.getState().preview)).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // Gleiten entlang der Vorderseite von Reihe 5 (eingerastet) bei Lesegröße
    await setScale(12);
    t = await screenOf(page, 's161');
    grab = { x: box.x + t.x, y: box.y + t.y };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 5, grab.y + 1, { steps: 3 });
    const glide = await measure(page, 'glide', grab);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const result = { browser: info.project.name, free, zoom, pan, panReadable, drag, glide };
    mkdirSync('test-artifacts/logs', { recursive: true });
    writeFileSync(`test-artifacts/logs/m4-qa-perf-${info.project.name}.json`, JSON.stringify(result, null, 2));
    console.warn(`QA-Lasttest M4 ${info.project.name}: ${JSON.stringify(result)}`);
    expect.soft(zoom.fps).toBeGreaterThanOrEqual(MIN_FPS);
    expect.soft(pan.fps).toBeGreaterThanOrEqual(MIN_FPS);
    expect.soft(panReadable.fps).toBeGreaterThanOrEqual(MIN_FPS);
    expect.soft(drag.fps).toBeGreaterThanOrEqual(MIN_FPS);
    expect.soft(glide.fps).toBeGreaterThanOrEqual(MIN_FPS);
  });
});
