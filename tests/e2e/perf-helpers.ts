import { expect, type Page } from '@playwright/test';
import { MOD } from './helpers';

/**
 * Messhilfen für die Lasttests (spec.md NFA): In jedem Animation-Frame wird ein Eingabeereignis
 * ausgelöst; die Zeitstempel der Frames ergeben Bildrate und längstes Bild. Jede Messung läuft
 * RUNS-mal, gewertet wird der Median der Bildrate und das längste Bild aller Läufe.
 */

export const RUNS = 5;
export const FRAMES = 150;
export const MIN_FPS = 50;
export const MAX_FRAME_MS = 100;

export type Kind = 'zoom' | 'pan' | 'drag';

export interface Run {
  fps: number;
  maxFrameMs: number;
}

export interface Measured {
  /** Median der Bildrate über alle Läufe. */
  fps: number;
  /** Längstes Bild über alle Läufe. */
  maxFrameMs: number;
  runs: Run[];
}

/** Eine Messung über FRAMES Bilder; bei `drag` muss die Maus bereits gedrückt sein (Zeigerereignisse an `at`). */
export function measureOnce(page: Page, kind: Kind, at: { x: number; y: number }, dragPath: 'rows' | 'diagonal' = 'rows'): Promise<Run> {
  return page.evaluate(
    ({ mode, pos, frames, path }) =>
      new Promise<Run>((resolve) => {
        const svg = document.querySelector('svg.canvas')!;
        const times: number[] = [];
        let i = 0;
        const step = (t: number) => {
          times.push(t);
          if (i >= frames) {
            const gaps = times.slice(1).map((v, k) => v - times[k]!);
            resolve({ fps: ((times.length - 1) / (times.at(-1)! - times[0]!)) * 1000, maxFrameMs: Math.max(...gaps) });
            return;
          }
          if (mode === 'zoom') {
            const dy = (Math.floor(i / 15) % 2 ? 1 : -1) * 4;
            svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaY: dy, ctrlKey: true }));
          } else if (mode === 'pan') {
            const dx = (Math.floor(i / 30) % 2 ? 1 : -1) * 6;
            svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaX: dx, deltaY: 1 }));
          } else {
            // quer über die Reihen (6,6 m = 36 px bei 5,5 px/m), betritt und verlässt Grundflächen
            const off = (i % 60 < 30 ? i % 30 : 30 - (i % 30)) * 7;
            const dx = path === 'rows' ? off / 3 : off;
            svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pos.x + dx, clientY: pos.y - off, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
          }
          i++;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { mode: kind, pos: at, frames: FRAMES, path: dragPath },
  );
}

export function summarize(runs: Run[]): Measured {
  const sorted = runs.map((r) => r.fps).toSorted((a, b) => a - b);
  return { fps: sorted[Math.floor(sorted.length / 2)]!, maxFrameMs: Math.max(...runs.map((r) => r.maxFrameMs)), runs };
}

/**
 * Ansicht setzen (Mitte des Ursprungs, `scale` px/m) und warten, bis sie fertig gezeichnet ist (Neuzeichnen
 * der zwischengespeicherten Ebenen, Plankacheln). Gemessen wird danach die Bedienung, nicht der Sprung.
 */
export async function setScale(page: Page, scale: number) {
  await page.evaluate((k) => {
    const s = (window as any).__marktplanerStore.getState();
    s.setView(s.project.pages[0].id, { scale: k, tx: s.ui.viewport.w / 2, ty: s.ui.viewport.h / 2 });
  }, scale);
  await page.evaluate(() => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r())), 400)));
}

/** Hintergrundplan als PNG 8000 × 6000 px importieren (wie im QA-Lasttest M4). */
export async function importBigPlan(page: Page) {
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
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles({ name: 'grossplan.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.raster-overview')).toHaveCount(1, { timeout: 30_000 });
}

/** Prüft das Abnahmekriterium für eine Messung (weich, damit alle Werte im Bericht stehen). */
export function expectCriterion(name: string, m: Measured) {
  expect.soft(m.fps, `${name}: Median Bilder/s`).toBeGreaterThanOrEqual(MIN_FPS);
  expect.soft(m.maxFrameMs, `${name}: längstes Bild (ms)`).toBeLessThanOrEqual(MAX_FRAME_MS);
}
