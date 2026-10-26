import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, MOD, openApp } from './helpers';

/**
 * QA M3-23: eigener Lasttest mit dem Testprojekt tests/fixtures/last-500-staende.schelme.
 * Aufbau wie in der Anleitung (tests/fixtures/README.md, Punkt 4) über die Oberfläche: Datei öffnen,
 * auf den Festplätzen 2–4 Cmd/Strg+A, Cmd/Strg+C, auf dem Obermarkt Cmd/Strg+V → 500 Stände und
 * 24 Grundflächen auf einer Page.
 *
 * Zwei Messmethoden:
 *  - „echt“: Playwright sendet echte Eingaben (Strg+Mausrad, Leertaste+Ziehen, Stand ziehen), unabhängig
 *    davon zählt eine requestAnimationFrame-Schleife die Bilder (Bilder/s, längstes Bild, 95.-Perzentil)
 *    und ein Store-Abo, wie viele Ansichts-/Vorschauänderungen tatsächlich gerendert wurden.
 *  - „pro Frame“: wie im Entwicklertest ein synthetisches Ereignis pro Bild (Rad bzw. pointermove).
 * Gemessen in drei Zoomstufen: an Fenster angepasst, Beschriftung sichtbar (1 m = 6 px), Lesegröße mit
 * hellem Rand (1 m = 20 px). Ergebnisse: test-artifacts/logs/m3-qa-perf-<browser>.json.
 * Laufen lassen allein, ohne parallele Tests: npx playwright test m3-qa-perf --workers=1
 */

const MIN_FPS = 50;
const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'last-500-staende.schelme');

async function build500(page: Page) {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+o`);
  await (await chooser).setFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => (window as any).__marktplanerStore.getState().project.pages.length)).toBe(4);
  for (const n of [2, 3, 4]) {
    await page.keyboard.press(`Alt+${n}`);
    await page.locator('svg.canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press('Alt+1');
    await page.keyboard.press(`${MOD}+0`);
    await page.keyboard.press(`${MOD}+v`);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${MOD}+0`);
  const counts = await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const p = s.project.pages[0];
    return { stands: p.stands.length, areas: p.areas.length, active: s.ui.activePage === p.id };
  });
  expect(counts).toEqual({ stands: 500, areas: 24, active: true });
  await expect(page.locator('.stand')).toHaveCount(500);
}

async function setScale(page: Page, scale: number | 'fit') {
  if (scale === 'fit') await page.keyboard.press(`${MOD}+0`);
  else
    await page.evaluate((k) => {
      const s = (window as any).__marktplanerStore.getState();
      // Mitte des Obermarkts (Stände bei x ≈ -83…62, y ≈ 3…100) in die Bildmitte
      s.setView(s.ui.activePage, { scale: k, tx: s.ui.viewport.w / 2 + 10 * k, ty: s.ui.viewport.h / 2 - 50 * k });
    }, scale);
  await page.waitForTimeout(300);
}

interface Stats {
  fps: number;
  maxMs: number;
  p95Ms: number;
  frames: number;
  updates: number;
}

/** Startet die Bildzählung im Browser. */
async function startMeter(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.qaMeter = { times: [] as number[], updates: 0, run: true };
    const s = w.__marktplanerStore;
    w.qaMeter.unsub = s.subscribe((a: any, b: any) => {
      if (a.views !== b.views || a.preview !== b.preview) w.qaMeter.updates++;
    });
    const loop = (t: number) => {
      if (!w.qaMeter.run) return;
      w.qaMeter.times.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
async function stopMeter(page: Page): Promise<Stats> {
  return page.evaluate(() => {
    const m = (window as any).qaMeter;
    m.run = false;
    m.unsub();
    const t: number[] = m.times;
    const gaps = t.slice(1).map((v, i) => v - t[i]!);
    const sorted = gaps.toSorted((a, b) => a - b);
    return {
      fps: ((t.length - 1) / (t.at(-1)! - t[0]!)) * 1000,
      maxMs: Math.max(...gaps),
      p95Ms: sorted[Math.floor(sorted.length * 0.95)]!,
      frames: t.length,
      updates: m.updates,
    };
  });
}

/** Echte Eingaben über Playwright. */
async function realZoom(page: Page, c: { x: number; y: number }) {
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 120; i++) await page.mouse.wheel(0, (Math.floor(i / 20) % 2 ? 1 : -1) * 6);
  await page.keyboard.up('Control');
}
async function realPan(page: Page, c: { x: number; y: number }) {
  await page.keyboard.down('Space');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(c.x + 200, c.y + 80, { steps: 30 });
    await page.mouse.move(c.x, c.y, { steps: 30 });
  }
  await page.mouse.up();
  await page.keyboard.up('Space');
}
async function realDrag(page: Page, grab: { x: number; y: number }) {
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(grab.x + 150, grab.y + 60, { steps: 30 });
    await page.mouse.move(grab.x, grab.y, { steps: 30 });
  }
  // Am Ende versetzt loslassen, damit das Ziehen einen Undo-Schritt ergibt
  await page.mouse.move(grab.x + 40, grab.y + 20, { steps: 5 });
  await page.mouse.up();
}

/** Entwickler-Methode: ein synthetisches Ereignis pro Animation-Frame. */
function perFrame(page: Page, kind: 'zoom' | 'pan' | 'drag', at: { x: number; y: number }): Promise<Stats> {
  return page.evaluate(
    ({ mode, pos }) =>
      new Promise<Stats>((resolve) => {
        const svg = document.querySelector('svg.canvas')!;
        const times: number[] = [];
        let i = 0;
        const step = (t: number) => {
          times.push(t);
          if (i >= 150) {
            const gaps = times.slice(1).map((v, k) => v - times[k]!);
            const sorted = gaps.toSorted((a, b) => a - b);
            resolve({ fps: ((times.length - 1) / (times.at(-1)! - times[0]!)) * 1000, maxMs: Math.max(...gaps), p95Ms: sorted[Math.floor(sorted.length * 0.95)]!, frames: times.length, updates: i });
            return;
          }
          if (mode === 'zoom') svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaY: (Math.floor(i / 15) % 2 ? 1 : -1) * 4, ctrlKey: true }));
          else if (mode === 'pan') svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaX: (Math.floor(i / 30) % 2 ? 1 : -1) * 6, deltaY: 1 }));
          else {
            const off = (i % 60 < 30 ? i % 30 : 30 - (i % 30)) * 4;
            svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pos.x + off, clientY: pos.y + off / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
          }
          i++;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { mode: kind, pos: at },
  );
}

/** Bildschirmposition (Seite) eines Stands nahe der Bildmitte. */
async function standNearCenter(page: Page) {
  const box = await canvasBox(page);
  const p = await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    const v = s.views[s.ui.activePage];
    const { w, h } = s.ui.viewport;
    const pg = s.project.pages.find((x: any) => x.id === s.ui.activePage);
    let best: any = null;
    for (const st of pg.stands) {
      const x = v.tx + st.cx * v.scale;
      const y = v.ty + st.cy * v.scale;
      const d = Math.hypot(x - w / 2, y - h / 2);
      if (!best || d < best.d) best = { x, y, d, id: st.id };
    }
    return best;
  });
  return { x: box.x + p.x, y: box.y + p.y, id: p.id as string };
}

test.describe('QA M3-23: eigener Lasttest mit last-500-staende.schelme', () => {
  test('500 Stände auf einer Page: Zoomen, Ansicht verschieben, Stand ziehen ≥ 50 Bilder/s', async ({ page }, info) => {
    test.setTimeout(240_000);
    await build500(page);
    const box = await canvasBox(page);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const results: Record<string, Record<string, Stats>> = {};
    for (const z of ['fit', 6, 20] as const) {
      const key = z === 'fit' ? 'angepasst' : `${z}px_m`;
      results[key] = {};
      const r = results[key]!;
      await setScale(page, z);
      if (key === 'angepasst') {
        const k = await page.evaluate(() => {
          const s = (window as any).__marktplanerStore.getState();
          return s.views[s.ui.activePage].scale;
        });
        info.annotations.push({ type: 'Maßstab angepasst', description: `${k} px/m` });
      }
      await startMeter(page);
      await realZoom(page, center);
      r.zoomEcht = await stopMeter(page);
      await setScale(page, z);
      await startMeter(page);
      await realPan(page, center);
      r.panEcht = await stopMeter(page);
      await setScale(page, z);
      const grab = await standNearCenter(page);
      const n0 = await page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
      await startMeter(page);
      await realDrag(page, grab);
      r.dragEcht = await stopMeter(page);
      expect(await page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length)).toBe(n0 + 1);
      await page.keyboard.press(`${MOD}+z`);
      // Entwickler-Methode
      await setScale(page, z);
      r.zoomProFrame = await perFrame(page, 'zoom', center);
      await setScale(page, z);
      r.panProFrame = await perFrame(page, 'pan', center);
      await setScale(page, z);
      const g2 = await standNearCenter(page);
      await page.mouse.move(g2.x, g2.y);
      await page.mouse.down();
      await page.mouse.move(g2.x + 5, g2.y + 5, { steps: 3 });
      r.dragProFrame = await perFrame(page, 'drag', g2);
      await page.mouse.up();
      await page.keyboard.press(`${MOD}+z`);
    }
    mkdirSync('test-artifacts/logs', { recursive: true });
    writeFileSync(`test-artifacts/logs/m3-qa-perf-${info.project.name}.json`, JSON.stringify(results, null, 2));
    console.warn(`QA-Lasttest ${info.project.name}: ${JSON.stringify(results)}`);
    for (const [zoom, r] of Object.entries(results))
      for (const [m, s] of Object.entries(r)) expect.soft(s.fps, `${zoom} ${m}`).toBeGreaterThanOrEqual(MIN_FPS);
  });
});
