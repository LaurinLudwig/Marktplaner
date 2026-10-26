/** Messen: Abstand und Winkel zwischen zwei Weltpunkten (Meter). */
import { len, sub, vec } from './geometry/vec';
import type { Vec } from './model/types';

export interface Measurement {
  distance: number;
  /** Winkel der Strecke in Grad, 0 = nach rechts, positiv im Uhrzeigersinn (Bildschirm), Bereich (-180, 180]. */
  angle: number;
  dx: number;
  dy: number;
}

export function measure(a: Vec, b: Vec): Measurement {
  const d = sub(b, a);
  const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  return { distance: len(d), angle: angle === -180 ? 180 : angle, dx: d.x, dy: d.y };
}

/** Beschränkt die Richtung a→b auf Vielfache von `stepDeg` (Shift-Taste); die Länge bleibt. */
export function constrainAngle(a: Vec, b: Vec, stepDeg = 45): Vec {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return b;
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(d.y, d.x) / step) * step;
  return vec(a.x + Math.cos(ang) * l, a.y + Math.sin(ang) * l);
}
