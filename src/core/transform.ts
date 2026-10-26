/**
 * Verschieben und Drehen mehrerer Objekte (M3). Arbeitet auf einer Abbildung ID → Rechteck,
 * damit Vorschau (während des Ziehens) und Übernahme dieselbe Rechnung nutzen.
 *
 * Der Fang beim Ziehen (M4) liegt in moveSnap.ts; `constrainDelta` setzt die Shift-Beschränkung um.
 */
import { boundsOfRects, normAngle, rotateAround } from './geometry/rect';
import type { Id, Rect, Vec } from './model/types';

export type RectMap = Record<Id, Rect>;

export function moveRects(rects: RectMap, delta: Vec): RectMap {
  const out: RectMap = {};
  for (const [id, r] of Object.entries(rects)) out[id] = { ...r, cx: r.cx + delta.x, cy: r.cy + delta.y };
  return out;
}

/** Shift beim Verschieben: Bewegung auf waagerecht, senkrecht oder 45° beschränken (Illustrator). */
export function constrainDelta(delta: Vec): Vec {
  const l = Math.hypot(delta.x, delta.y);
  if (l === 0) return delta;
  const a = Math.round(Math.atan2(delta.y, delta.x) / (Math.PI / 4)) * (Math.PI / 4);
  const ux = Math.round(Math.cos(a) * 1e12) / 1e12;
  const uy = Math.round(Math.sin(a) * 1e12) / 1e12;
  const k = delta.x * ux + delta.y * uy;
  return { x: ux * k, y: uy * k };
}

/** Dreht alle Rechtecke um `pivot`: Mittelpunkte wandern mit, jede Drehung wächst um `delta`. */
export function rotateRects(rects: RectMap, pivot: Vec, delta: number): RectMap {
  const out: RectMap = {};
  for (const [id, r] of Object.entries(rects)) {
    const c = rotateAround({ x: r.cx, y: r.cy }, pivot, delta);
    out[id] = { ...r, cx: c.x, cy: c.y, rot: normAngle(r.rot + delta) };
  }
  return out;
}

/** Mitte des Hüllrechtecks (bei einem einzelnen Objekt dessen Mittelpunkt). */
export function groupCenter(rects: readonly Rect[]): Vec | null {
  if (rects.length === 1) return { x: rects[0]!.cx, y: rects[0]!.cy };
  const b = boundsOfRects(rects);
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

/** Winkel von `from` nach `to` in Grad (Bildschirm: im Uhrzeigersinn, 0° = rechts). */
export const angleTo = (from: Vec, to: Vec) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/** Rastet einen Winkel auf Vielfache von `step` ein. */
export const snapAngle = (deg: number, step: number) => Math.round(deg / step) * step;
