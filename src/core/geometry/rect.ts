/**
 * Rechteck-Geometrie aus prototype/freiflaechen.html (Geo-Modul), ergänzt um Auswahl,
 * Umorientieren der Vorderseite, Größenänderung und Rundung (M3).
 * Ecken-Reihenfolge (lokal, ungedreht): 0 oben links, 1 oben rechts, 2 unten rechts, 3 unten links.
 * Kante i verbindet Ecke i und Ecke i+1: 0 oben, 1 rechts, 2 unten (= Vorderseite), 3 links.
 */
import type { EdgeIndex, Rect, Vec } from '../model/types';
import type { Bounds } from '../viewport';
import { add, dot, rotate, sub, vec } from './vec';

/** Die vier Weltkoordinaten-Ecken eines gedrehten Rechtecks. */
export function rectCorners(r: Rect): Vec[] {
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
    const p = rotate(vec((sx * r.w) / 2, (sy * r.d) / 2), r.rot);
    return vec(r.cx + p.x, r.cy + p.y);
  });
}

/** Achsenparalleles Hüllrechteck mehrerer gedrehter Rechtecke, oder null bei leerer Liste. */
export function boundsOfRects(rects: readonly Rect[]): Bounds | null {
  if (!rects.length) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rects) {
    for (const p of rectCorners(r)) {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}

/**
 * Winkel auf 0 ≤ a < 360 normieren. Werte im Bereich bleiben bitgenau unverändert (kein
 * „+ 360 % 360“, das z. B. aus 12,3 den Wert 12.300000000000011 macht, QA-M3-04).
 */
export function normAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a >= 360 - 1e-9 || Object.is(a, -0) ? 0 : a;
}

const round = (n: number, f: number) => {
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Genauigkeit beim Übernehmen ins Projekt: Positionen und Maße 0,01 m, Drehung 0,1°. */
export function roundRect<T extends Rect>(r: T): T {
  // Erst normieren, dann runden: Das Ergebnis ist exakt die nächste Zehntelzahl (12.3, nicht 12.300000000000011)
  return { ...r, cx: round(r.cx, 100), cy: round(r.cy, 100), w: round(r.w, 100), d: round(r.d, 100), rot: normAngle(round(normAngle(r.rot), 10)) };
}

/** Weltpunkt → lokale Koordinaten des Rechtecks (Ursprung im Mittelpunkt, ungedreht). */
export function toLocal(r: Rect, p: Vec): Vec {
  return rotate(sub(p, vec(r.cx, r.cy)), -r.rot);
}

/** Lokaler Punkt → Weltpunkt. */
export function fromLocal(r: Rect, p: Vec): Vec {
  return add(vec(r.cx, r.cy), rotate(p, r.rot));
}

/** Liegt p im Rechteck (Toleranz in Metern, positiv = großzügiger)? */
export function pointInRect(r: Rect, p: Vec, tol = 0): boolean {
  const l = toLocal(r, p);
  return Math.abs(l.x) <= r.w / 2 + tol && Math.abs(l.y) <= r.d / 2 + tol;
}

/** Liegt das Rechteck vollständig im achsenparallelen Bereich? */
export function rectInBounds(r: Rect, b: Bounds): boolean {
  return rectCorners(r).every((p) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY);
}

/** Endpunkte der Kante `edge` in Weltkoordinaten. */
export function rectEdge(r: Rect, edge: EdgeIndex): [Vec, Vec] {
  const c = rectCorners(r);
  return [c[edge]!, c[(edge + 1) % 4]!];
}

/** Drehung, um die sich das Rechteck dreht, wenn Kante `edge` zur Vorderseite (Kante 2) wird. */
const FRONT_TURN: Record<EdgeIndex, number> = { 0: 180, 1: -90, 2: 0, 3: 90 };

/**
 * Macht Kante `edge` zur Vorderseite. Die Fläche bleibt exakt an derselben Stelle: Nur das lokale
 * Koordinatensystem dreht sich (Drehung ±90°/180°, bei ±90° tauschen Breite und Tiefe).
 */
export function setFront<T extends Rect>(r: T, edge: EdgeIndex): T {
  if (edge === 2) return r;
  const odd = edge % 2 === 1;
  return { ...r, rot: normAngle(r.rot + FRONT_TURN[edge]), w: odd ? r.d : r.w, d: odd ? r.w : r.d };
}

/**
 * Koordinatensystem entlang der Vorderseite (aus dem Prototyp, `frontFrame`), vereinfacht für die
 * feste Vorderseite an Kante 2: Ursprung = linkes Ende der Vorderkante aus Sicht einer Person, die
 * davor steht; u entlang der Vorderseite, v senkrecht ins Innere. Grundlage der Freiflächen (M4).
 */
export interface FrontFrame {
  origin: Vec;
  u: Vec;
  v: Vec;
  length: number;
  depth: number;
}

export function frontFrame(r: Rect): FrontFrame {
  return {
    origin: fromLocal(r, vec(-r.w / 2, r.d / 2)),
    u: rotate(vec(1, 0), r.rot),
    v: rotate(vec(0, -1), r.rot),
    length: r.w,
    depth: r.d,
  };
}

/** Weltpunkt → Achsenkoordinaten (s entlang der Vorderseite, t in die Tiefe). */
export const toFrame = (f: FrontFrame, p: Vec) => {
  const d = sub(p, f.origin);
  return { s: dot(d, f.u), t: dot(d, f.v) };
};
/** Achsenkoordinaten → Weltpunkt. */
export const fromFrame = (f: FrontFrame, s: number, t: number): Vec => add(f.origin, add(vec(f.u.x * s, f.u.y * s), vec(f.v.x * t, f.v.y * t)));
/** Drehwinkel (Grad), den ein Objekt braucht, damit seine lokale x-Achse = u ist. */
export const frameAngle = (f: FrontFrame) => (Math.atan2(f.u.y, f.u.x) * 180) / Math.PI;

/** Griff zur Größenänderung in lokalen Einheiten: (-1|0|1, -1|0|1), nicht (0, 0). */
export interface Handle {
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
}

export const RESIZE_HANDLES: readonly Handle[] = [
  { hx: -1, hy: -1 },
  { hx: 0, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 1 },
  { hx: -1, hy: 0 },
];

/** Weltposition eines Griffs. */
export const handlePoint = (r: Rect, h: Handle): Vec => fromLocal(r, vec((h.hx * r.w) / 2, (h.hy * r.d) / 2));

/**
 * Größenänderung per Griff: Der Griff folgt dem Punkt p, die gegenüberliegende Kante bzw. Ecke
 * bleibt fest. Drehung bleibt; Maße werden auf [min, max] begrenzt (dieselben Grenzen wie die
 * Zahlenfelder, QA-M3-02).
 */
export function resizeRect<T extends Rect>(r: T, h: Handle, p: Vec, min: number, max = Infinity): T {
  const l = toLocal(r, p);
  let { w, d } = r;
  let cx = 0;
  let cy = 0;
  if (h.hx !== 0) {
    const anchor = (-h.hx * r.w) / 2;
    w = Math.min(max, Math.max(min, h.hx * (l.x - anchor)));
    cx = anchor + (h.hx * w) / 2;
  }
  if (h.hy !== 0) {
    const anchor = (-h.hy * r.d) / 2;
    d = Math.min(max, Math.max(min, h.hy * (l.y - anchor)));
    cy = anchor + (h.hy * d) / 2;
  }
  const c = fromLocal(r, vec(cx, cy));
  return { ...r, cx: c.x, cy: c.y, w, d };
}

/** Dreht p um `pivot` (Grad, im Uhrzeigersinn). */
export function rotateAround(p: Vec, pivot: Vec, deg: number): Vec {
  return add(pivot, rotate(sub(p, pivot), deg));
}
