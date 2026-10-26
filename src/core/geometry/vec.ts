/**
 * Vektor-Grundlagen, unverändert aus prototype/freiflaechen.html (Geo-Modul) übernommen.
 * Einheit Meter, x nach rechts, y nach unten; Drehung in Grad im Uhrzeigersinn (wie SVG rotate()).
 */
import type { Vec } from '../model/types';

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => vec(a.x + b.x, a.y + b.y);
export const sub = (a: Vec, b: Vec): Vec => vec(a.x - b.x, a.y - b.y);
export const mul = (a: Vec, k: number): Vec => vec(a.x * k, a.y * k);
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const normalize = (a: Vec): Vec => {
  const l = len(a) || 1;
  return vec(a.x / l, a.y / l);
};
export const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Dreht Punkt p um den Ursprung (Grad, im Uhrzeigersinn auf dem Bildschirm). */
export function rotate(p: Vec, deg: number): Vec {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return vec(p.x * c - p.y * s, p.x * s + p.y * c);
}
