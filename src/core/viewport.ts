import type { Vec, View } from './model/types';

/** Zoomgrenzen in Pixel pro Meter. */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 500;
export const DEFAULT_SCALE = 10;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const screenToWorld = (v: View, p: Vec): Vec => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });
export const worldToScreen = (v: View, p: Vec): Vec => ({ x: v.tx + p.x * v.scale, y: v.ty + p.y * v.scale });

/** Zoomt um den Faktor `factor`; der Bildschirmpunkt `at` bleibt dabei an derselben Weltposition. */
export function zoomAt(v: View, factor: number, at: Vec): View {
  const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / v.scale;
  return { scale, tx: at.x - (at.x - v.tx) * k, ty: at.y - (at.y - v.ty) * k };
}

/** Standardansicht: Ursprung in der Mitte, 1 m = DEFAULT_SCALE px. */
export const defaultView = (width: number, height: number): View => ({
  scale: DEFAULT_SCALE,
  tx: width / 2,
  ty: height / 2,
});

/** Ansicht, die `bounds` mit `pad` Pixeln Rand in eine Fläche width × height einpasst. */
export function fitBounds(bounds: Bounds | null, width: number, height: number, pad = 40): View {
  if (!bounds) return defaultView(width, height);
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = clamp(
    Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh),
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    tx: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    ty: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

/**
 * Ziel eines Sprungs (M6-09): `bounds` um die Mitte auf mindestens `minSize` Meter je Richtung erweitert, damit die
 * Umgebung eines kleinen Stands sichtbar bleibt.
 */
export function focusBounds(bounds: Bounds, minSize = 30): Bounds {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const hw = Math.max(bounds.maxX - bounds.minX, minSize) / 2;
  const hh = Math.max(bounds.maxY - bounds.minY, minSize) / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}
