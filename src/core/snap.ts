/**
 * Fang für punktgenaue Werkzeuge (Messen, später Zeichnen).
 *
 * Fangquellen liefern Kandidaten; `findSnap` wählt den nächsten innerhalb der Toleranz.
 * Ecken haben Vorrang vor Kanten, damit man eine Ecke trifft, obwohl die Kante näher liegt.
 *
 * Erweiterung (M3/M4): weitere Quellen, z. B. Raster oder Mittelpunkte, als Funktion vom Typ
 * `SnapSource` ergänzen und an `findSnap` übergeben. Das Messwerkzeug nutzt bereits
 * `rectSnapSource` für alle Rechtecke der Page; sobald es Objekte gibt, fängt es daran.
 */
import { rectCorners } from './geometry/rect';
import { add, dot, len, mul, sub } from './geometry/vec';
import type { Rect, Vec } from './model/types';

export type SnapKind = 'corner' | 'edge';

export interface SnapCandidate {
  point: Vec;
  kind: SnapKind;
}

export interface SnapResult extends SnapCandidate {
  distance: number;
}

/** Liefert Kandidaten in der Nähe von `p` (darf auch mehr liefern; gefiltert wird in findSnap). */
export type SnapSource = (p: Vec, tolerance: number) => SnapCandidate[];

const PRIORITY: Record<SnapKind, number> = { corner: 0, edge: 1 };

/** Nächster Punkt auf der Strecke a–b zu p. */
export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, mul(ab, t));
}

/** Ecken und Kanten gedrehter Rechtecke (Grundflächen, Stände, Infrastruktur). */
export function rectSnapSource(rects: readonly Rect[]): SnapSource {
  return (p, tolerance) => {
    const out: SnapCandidate[] = [];
    for (const r of rects) {
      // Grobe Vorauswahl über den Umkreis
      if (len(sub(p, { x: r.cx, y: r.cy })) > Math.hypot(r.w, r.d) / 2 + tolerance) continue;
      const c = rectCorners(r);
      for (let i = 0; i < 4; i++) {
        const a = c[i]!;
        const b = c[(i + 1) % 4]!;
        out.push({ point: a, kind: 'corner' });
        out.push({ point: closestPointOnSegment(p, a, b), kind: 'edge' });
      }
    }
    return out;
  };
}

export function findSnap(p: Vec, sources: readonly SnapSource[], tolerance: number): SnapResult | null {
  let best: SnapResult | null = null;
  for (const source of sources) {
    for (const c of source(p, tolerance)) {
      const distance = len(sub(c.point, p));
      if (distance > tolerance) continue;
      if (!best || PRIORITY[c.kind] < PRIORITY[best.kind] || (PRIORITY[c.kind] === PRIORITY[best.kind] && distance < best.distance)) {
        best = { ...c, distance };
      }
    }
  }
  return best;
}
