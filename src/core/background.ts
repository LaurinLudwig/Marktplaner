/**
 * Geometrie des Hintergrundplans: Abbildung zwischen Quell-Einheiten (Pixel bei PNG/JPEG,
 * Nutzereinheiten bei SVG, PDF-Punkte bei PDF) und Weltkoordinaten in Metern.
 *
 *   welt = (x, y) + rotate(quelle · metersPerPx, rot)
 *
 * (x, y) ist die Weltposition der linken oberen Ecke des Plans, `rot` die Drehung in Grad
 * (im Uhrzeigersinn, wie überall im Projekt).
 *
 * Gezeichnete Objekte sind in Metern gespeichert und hängen nicht vom Hintergrund ab:
 * Kalibrieren, Verschieben und Drehen ändern ausschließlich diese Transformation.
 */
import { UserError } from './errors';
import { add, len, rotate, sub, vec } from './geometry/vec';
import type { Background, Vec } from './model/types';
import type { Bounds } from './viewport';

export type BgTransform = Background['transform'];

/** Ein PDF-Punkt ist 1/72 Zoll = 0,3527̅ mm auf dem Papier. */
export const METERS_PER_PDF_POINT = 0.0254 / 72;

export function bgToWorld(t: BgTransform, s: Vec): Vec {
  return add(vec(t.x, t.y), rotate(vec(s.x * t.metersPerPx, s.y * t.metersPerPx), t.rot));
}

export function worldToBg(t: BgTransform, w: Vec): Vec {
  const local = rotate(sub(w, vec(t.x, t.y)), -t.rot);
  return vec(local.x / t.metersPerPx, local.y / t.metersPerPx);
}

export class CalibrationError extends UserError {
  override name = 'CalibrationError';
}

/**
 * Kalibrierung über zwei Punkte: `w1`, `w2` sind die angeklickten Weltpunkte auf dem Plan,
 * `meters` der reale Abstand. Der Maßstab wird so gesetzt, dass der Abstand stimmt;
 * der Planpunkt unter `w1` bleibt an derselben Weltposition. Drehung bleibt unverändert.
 */
export function calibrate(t: BgTransform, w1: Vec, w2: Vec, meters: number): BgTransform {
  if (!(meters > 0) || !Number.isFinite(meters)) throw new CalibrationError('Der reale Abstand muss größer als 0 sein.');
  const s1 = worldToBg(t, w1);
  const s2 = worldToBg(t, w2);
  const srcDist = len(sub(s2, s1));
  if (srcDist < 1e-9) throw new CalibrationError('Die beiden Punkte liegen aufeinander.');
  const next: BgTransform = { ...t, metersPerPx: meters / srcDist };
  // Verschieben, sodass s1 wieder auf w1 liegt
  const moved = bgToWorld(next, s1);
  return { ...next, x: next.x + (w1.x - moved.x), y: next.y + (w1.y - moved.y) };
}

/** Setzt den Maßstab eines PDF-Plans direkt aus dem Papiermaßstab 1:n; `anchor` (Welt) bleibt fest. */
export function applyPaperScale(t: BgTransform, denominator: number, anchor: Vec): BgTransform {
  if (!(denominator > 0) || !Number.isFinite(denominator)) throw new CalibrationError('Der Maßstab muss größer als 0 sein.');
  return rescaleAround(t, denominator * METERS_PER_PDF_POINT, anchor);
}

/** Papiermaßstab 1:n eines PDF-Plans bei gegebener Transformation. */
export const paperScaleDenominator = (t: BgTransform): number => t.metersPerPx / METERS_PER_PDF_POINT;

/** Neuer Maßstab; der Planpunkt unter `anchor` (Welt) bleibt fest. */
export function rescaleAround(t: BgTransform, metersPerPx: number, anchor: Vec): BgTransform {
  const s = worldToBg(t, anchor);
  const next = { ...t, metersPerPx };
  const moved = bgToWorld(next, s);
  return { ...next, x: next.x + (anchor.x - moved.x), y: next.y + (anchor.y - moved.y) };
}

/** Dreht den Plan auf den absoluten Winkel `rot`; der Weltpunkt `pivot` bleibt fest. */
export function rotateAround(t: BgTransform, rot: number, pivot: Vec): BgTransform {
  const s = worldToBg(t, pivot);
  const next = { ...t, rot };
  const moved = bgToWorld(next, s);
  return { ...next, x: next.x + (pivot.x - moved.x), y: next.y + (pivot.y - moved.y) };
}

export const moveBy = (t: BgTransform, dx: number, dy: number): BgTransform => ({ ...t, x: t.x + dx, y: t.y + dy });

/** Weltmittelpunkt des Plans. */
export const bgCenter = (t: BgTransform, size: { w: number; h: number }): Vec => bgToWorld(t, vec(size.w / 2, size.h / 2));

/** Die vier Weltecken des Plans (oben links, oben rechts, unten rechts, unten links). */
export function bgCorners(t: BgTransform, size: { w: number; h: number }): Vec[] {
  return [vec(0, 0), vec(size.w, 0), vec(size.w, size.h), vec(0, size.h)].map((s) => bgToWorld(t, s));
}

/**
 * Anfangstransformation nach dem Import: Plan mittig auf `center`, so groß, dass er
 * `worldWidth` Meter breit ist. Danach wird kalibriert.
 */
export function initialTransform(size: { w: number; h: number }, center: Vec, worldWidth: number): BgTransform {
  const metersPerPx = worldWidth / Math.max(size.w, 1e-9);
  return { x: center.x - (size.w * metersPerPx) / 2, y: center.y - (size.h * metersPerPx) / 2, metersPerPx, rot: 0 };
}

/**
 * Beim Ersetzen des Plans: gleiche Position (linke obere Ecke), gleiche Drehung und gleiche
 * Breite in Metern. Stimmt die neue Datei inhaltlich überein, passt sie damit wieder; sonst
 * muss neu kalibriert werden.
 */
export function transformForReplacement(old: BgTransform, oldSize: { w: number }, newSize: { w: number }): BgTransform {
  return { ...old, metersPerPx: (old.metersPerPx * oldSize.w) / Math.max(newSize.w, 1e-9) };
}

/**
 * Sichtbarer Ausschnitt des Plans in Quell-Einheiten (achsenparallel, auf den Plan begrenzt)
 * für ein Weltrechteck, z. B. den Bildschirmausschnitt. null, wenn der Plan nicht sichtbar ist.
 */
export function visibleSourceRegion(t: BgTransform, size: { w: number; h: number }, world: Bounds): Bounds | null {
  const corners = [
    vec(world.minX, world.minY),
    vec(world.maxX, world.minY),
    vec(world.maxX, world.maxY),
    vec(world.minX, world.maxY),
  ].map((w) => worldToBg(t, w));
  const minX = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const minY = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const maxX = Math.min(size.w, Math.max(...corners.map((c) => c.x)));
  const maxY = Math.min(size.h, Math.max(...corners.map((c) => c.y)));
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

/** Grenzen der Plausibilitätsprüfung (QA-M2-07). */
export const PLAUSIBLE = {
  /** Papiermaßstab 1:n bei PDFs. */
  minDenominator: 50,
  maxDenominator: 10_000,
  /** Planbreite in Metern bei Bildern/SVG (kein Papiermaßstab bekannt). */
  minWidth: 10,
  maxWidth: 5_000,
  /** Änderung gegenüber einer vorhandenen Kalibrierung. */
  maxFactor: 2,
} as const;

/**
 * Prüft einen neuen Maßstab auf Plausibilität. Liefert Hinweise auf Deutsch; leere Liste = unauffällig.
 * `previous` = bisherige Transformation, falls der Plan schon kalibriert war (bzw. einen Planmaßstab hatte).
 */
export function scaleWarnings(
  kind: Background['kind'],
  size: { w: number; h: number },
  next: BgTransform,
  previous: BgTransform | null,
): string[] {
  const out: string[] = [];
  const fmt = (n: number, d = 0) => n.toLocaleString('de-DE', { maximumFractionDigits: d });
  if (kind === 'pdf') {
    const n = paperScaleDenominator(next);
    if (n < PLAUSIBLE.minDenominator || n > PLAUSIBLE.maxDenominator) {
      out.push(`Der Plan hätte den Maßstab 1:${fmt(n, n < 10 ? 2 : 0)} (üblich sind 1:${fmt(PLAUSIBLE.minDenominator)} bis 1:${fmt(PLAUSIBLE.maxDenominator)}).`);
    }
  } else {
    const width = size.w * next.metersPerPx;
    if (width < PLAUSIBLE.minWidth || width > PLAUSIBLE.maxWidth) {
      out.push(`Der Plan wäre ${fmt(width, width < 10 ? 2 : 0)} m breit (üblich sind ${fmt(PLAUSIBLE.minWidth)} m bis ${fmt(PLAUSIBLE.maxWidth)} m).`);
    }
  }
  if (previous) {
    const factor = next.metersPerPx / previous.metersPerPx;
    if (factor > PLAUSIBLE.maxFactor || factor < 1 / PLAUSIBLE.maxFactor) {
      const f = factor >= 1 ? factor : 1 / factor;
      out.push(`Der Maßstab ändert sich gegenüber der bisherigen Kalibrierung um den Faktor ${fmt(f, 1)} (${factor >= 1 ? 'größer' : 'kleiner'}).`);
    }
  }
  return out;
}
