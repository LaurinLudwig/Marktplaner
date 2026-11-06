/**
 * Belegung wie gezeichnet (#16, spec.md §3 „Form“, Entscheidung Laurin 2026-11-06).
 *
 * Ein Stand belegt normalerweise sein Rechteck B × T (Hitbox), auch mit Kreis/Oval oder einer Formvorlage. Eine
 * eigene Form (`Stand.parts`) und eine Formvorlage mit „belegt wie gezeichnet“ (`ShapeTemplate.occupies`) belegen
 * dagegen mit ihren Teilen: Freiflächen (§4), Überlappung, „außerhalb“, Infrastruktur, Abstand, Treffer, Fang und
 * Frontmeter rechnen mit der Vereinigung der Teile (je Teil ein konvexes Vieleck, Ellipsen mit `ELLIPSE_SEGMENTS`
 * Ecken). Die Vorderseite bleibt die Unterkante des Hüllrechtecks B × T.
 *
 * Damit die Rechnungen die Formvorlagen nicht kennen müssen, setzt `occupancyStands` bei Ständen mit einer belegenden
 * Vorlage deren Teile als `parts` ein (nur zur Laufzeit, nie gespeichert). Alle Funktionen hier lesen nur `parts`.
 */
import { boundsTouch, clipConvex, penetration, polyBounds, polygonArea, rectGap, rectGeo, type Polygon } from './geometry/polygon';
import { pointInRect, toLocal } from './geometry/rect';
import { atLeast, EPS, TOL, withinTol } from './geometry/tolerance';
import { add, cross, dot, len, mul, sub, vec } from './geometry/vec';
import type { FestplatzPage, Rect, ShapePart, ShapeTemplate, Stand, Vec } from './model/types';
import { partPolygon, partRect } from './shape';
import type { Bounds } from './viewport';

/** Rechteck mit den Teilen, mit denen es belegt (eigene Form oder eingesetzte Vorlage); ohne Teile das Rechteck. */
export type PartsRect = Rect & { parts?: readonly ShapePart[] | null };

/** Belegt das Objekt mit Teilen statt mit seinem Rechteck? */
export const occupiesParts = (s: PartsRect): boolean => !!s.parts?.length;

/** Eigene Form eines gespeicherten Stands (#16): Teile ohne Vorlage. Eingesetzte Vorlagen zählen nicht. */
export const hasOwnForm = (s: Pick<Stand, 'parts' | 'shapeTemplateId'>): boolean => !!s.parts?.length && !s.shapeTemplateId;

// ---------- Vorlagen mit „belegt wie gezeichnet“ einsetzen ----------

const standCache = new WeakMap<Stand, { tpl: ShapeTemplate; out: Stand }>();
const listCache = new WeakMap<readonly Stand[], { templates: readonly ShapeTemplate[]; out: readonly Stand[] }>();

/**
 * Stände, wie sie belegen: Bei einem Stand mit einer Vorlage mit „belegt wie gezeichnet“ (und ohne eigene Form)
 * stehen deren Teile in `parts`. Unveränderte Stände und Listen behalten ihre Identität (Zwischenspeicher der
 * Freiflächen, Warnungen und Beschriftung); ohne belegende Vorlage ist das Ergebnis die Eingabe selbst.
 */
export function occupancyStands<T extends Stand>(stands: readonly T[], templates: readonly ShapeTemplate[]): readonly T[] {
  if (!templates.some((t) => t.occupies)) return stands;
  const hit = listCache.get(stands);
  if (hit && hit.templates === templates) return hit.out as readonly T[];
  const byId = new Map(templates.filter((t) => t.occupies).map((t) => [t.id, t]));
  let changed = false;
  const out = stands.map((s) => {
    const tpl = !s.parts?.length && s.shapeTemplateId ? byId.get(s.shapeTemplateId) : undefined;
    if (!tpl) return s;
    changed = true;
    const c = standCache.get(s);
    if (c && c.tpl === tpl) return c.out as T;
    const o = { ...s, parts: tpl.parts };
    standCache.set(s, { tpl, out: o });
    return o;
  });
  const result = changed ? out : stands;
  listCache.set(stands, { templates, out: result });
  return result;
}

/** Stände einer Page, wie sie belegen (siehe `occupancyStands`). */
export const pageStands = (page: Pick<FestplatzPage, 'stands'>, templates: readonly ShapeTemplate[]): readonly Stand[] => occupancyStands(page.stands, templates);

// ---------- Umriss ----------

export interface Footprint {
  /** Konvexe Vielecke: ein Teil je Eintrag, ohne Teile die vier Ecken des Rechtecks. */
  polys: Polygon[];
  /** Achsenparalleles Hüllrechteck aller Vielecke. */
  bounds: Bounds;
  /** Belegt mit Teilen (sonst ist `polys` das Rechteck). */
  parts: boolean;
}

const fpCache = new WeakMap<object, Footprint>();

/** Belegte Fläche eines Stands als konvexe Vielecke, je Objekt zwischengespeichert (Objekte sind unveränderlich). */
export function footprint(s: PartsRect): Footprint {
  let f = fpCache.get(s);
  if (f) return f;
  if (!s.parts?.length) {
    const g = rectGeo(s);
    f = { polys: [g.poly], bounds: g.bounds, parts: false };
  } else {
    const polys = s.parts.map((p) => partPolygon(s, p));
    const bs = polys.map(polyBounds);
    f = {
      polys,
      bounds: { minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) },
      parts: true,
    };
  }
  fpCache.set(s, f);
  return f;
}

/** Größte Eindringtiefe zweier belegter Flächen (über alle Paare von Teilen); ≤ 0 = getrennt oder berührend. */
export function footprintPenetration(a: Polygon[], b: Polygon[]): number {
  let best = -Infinity;
  for (const p of a) for (const q of b) best = Math.max(best, penetration(p, q));
  return best;
}

/** Überschneidungen (je Paar von Teilen mit mehr als TOL Eindringtiefe) als konvexe Vielecke. */
export function overlapPolygons(a: Polygon[], b: Polygon[]): Polygon[] {
  const out: Polygon[] = [];
  for (const p of a)
    for (const q of b) {
      if (withinTol(penetration(p, q))) continue;
      const c = clipConvex(p, q);
      if (c.length >= 3) out.push(c);
    }
  return out;
}

/** Abstand eines Punkts von einem konvexen Vieleck (0 innerhalb oder auf dem Rand). */
export function distToConvex(poly: readonly Vec[], p: Vec): number {
  let sign = 0;
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = cross(sub(b, a), sub(p, a));
    if (Math.abs(c) > 1e-12) {
      const s = Math.sign(c);
      if (sign && s !== sign) inside = false;
      sign ||= s;
    }
    best = Math.min(best, len(sub(p, closestOnSegment(p, a, b))));
  }
  return inside ? 0 : best;
}

function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, mul(ab, t));
}

/** Trifft p den Stand (Teile bzw. Rechteck, mit Toleranz `tol` in Metern)? */
export function pointInFootprint(s: PartsRect, p: Vec, tol = 0): boolean {
  if (!s.parts?.length) return pointInRect(s, p, tol);
  const f = footprint(s);
  if (!boundsTouch(f.bounds, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, tol)) return false;
  return f.polys.some((poly) => distToConvex(poly, p) <= tol);
}

/**
 * Kürzester Abstand Kante zu Kante zweier konvexer Vielecke mit den beiden nächsten Punkten; bei Überschneidung 0
 * (Punkte: die Mitten der Hüllrechtecke). Für getrennte konvexe Vielecke liegt der kürzeste Abstand an einer Ecke.
 */
export function polyGap(pa: readonly Vec[], pb: readonly Vec[]): { dist: number; from: Vec; to: Vec } {
  if (penetration(pa, pb) > 0) {
    const ba = polyBounds(pa);
    const bb = polyBounds(pb);
    return { dist: 0, from: vec((ba.minX + ba.maxX) / 2, (ba.minY + ba.maxY) / 2), to: vec((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2) };
  }
  let best = { dist: Infinity, from: pa[0]!, to: pb[0]! };
  const edges = (poly: readonly Vec[], fn: (a: Vec, b: Vec) => void) => {
    for (let i = 0; i < poly.length; i++) fn(poly[i]!, poly[(i + 1) % poly.length]!);
  };
  for (const p of pa)
    edges(pb, (a, b) => {
      const q = closestOnSegment(p, a, b);
      const d = len(sub(q, p));
      if (d < best.dist) best = { dist: d, from: p, to: q };
    });
  for (const q of pb)
    edges(pa, (a, b) => {
      const p = closestOnSegment(q, a, b);
      const d = len(sub(q, p));
      if (d < best.dist) best = { dist: d, from: p, to: q };
    });
  return best;
}

/** Kürzester Abstand Kante zu Kante zweier Stände (#3): ohne Teile wie bisher zwischen den Rechtecken, sonst zwischen den Teilen. */
export function footprintGap(a: PartsRect, b: PartsRect): { dist: number; from: Vec; to: Vec } {
  if (!a.parts?.length && !b.parts?.length) return rectGap(a, b);
  let best: { dist: number; from: Vec; to: Vec } | null = null;
  for (const p of footprint(a).polys)
    for (const q of footprint(b).polys) {
      const g = polyGap(p, q);
      if (!best || g.dist < best.dist) best = g;
      if (best.dist === 0) return best;
    }
  return best!;
}

/** Fläche der Teile in m² (überlappende Teile doppelt); ohne Teile B × T. Für „größter Teil“ beim Zusammenfassen. */
export const footprintArea = (s: PartsRect): number => (s.parts?.length ? footprint(s).polys.reduce((n, p) => n + Math.abs(polygonArea(p)), 0) : s.w * s.d);

// ---------- Beschriftung, Fang ----------

/** Fläche eines Teils in m² (Ellipse π/4 · B · T). */
const partArea = (s: Rect, p: ShapePart) => p.w * s.w * p.h * s.d * (p.kind === 'ellipse' ? Math.PI / 4 : 1);

/**
 * Rechteck, in dem die Beschriftung steht (#16: im größten Teil): bei Teilen das Rechteck des größten (bei gleicher
 * Fläche des ersten), bei einer Ellipse das eingeschriebene Rechteck; sonst der Stand selbst.
 */
export function labelRect(s: PartsRect): Rect {
  if (!s.parts?.length) return s;
  let best = s.parts[0]!;
  for (const p of s.parts) if (partArea(s, p) > partArea(s, best) + EPS) best = p;
  const r = partRect(s, best);
  return best.kind === 'ellipse' ? { ...r, w: r.w / Math.SQRT2, d: r.d / Math.SQRT2 } : r;
}

/** Rechtecke, an deren Kanten gefangen wird: die Teile (Ellipsen als Rechteck um sie herum) bzw. der Stand selbst. */
export const snapRects = (s: PartsRect): Rect[] => (s.parts?.length ? s.parts.map((p) => partRect(s, p)) : [s]);

// ---------- Frontmeter (Standgeld, Kennzahlen) ----------

/**
 * Belegte Länge an der Vorderseite (#16): Die Vorderseite ist die Unterkante des Hüllrechtecks B × T. Ein Teil zählt,
 * wenn er sie berührt (sein tiefster Punkt liegt höchstens TOL über ihr). Gezählt wird die Vereinigung der Projektionen
 * dieser Teile auf die Vorderseite, begrenzt auf die Breite B; Lücken bis TOL werden zusammengefasst. Ergebnis auf
 * 0,01 m gerundet. Ohne Teile: B.
 */
export function autoFrontMeters(s: PartsRect): number {
  if (!s.parts?.length) return Math.round(s.w * 100) / 100;
  const half = s.w / 2;
  const iv: [number, number][] = [];
  for (const poly of footprint(s).polys) {
    const pts = poly.map((p) => toLocal(s, p));
    if (!atLeast(Math.max(...pts.map((p) => p.y)), s.d / 2 - TOL)) continue;
    const lo = Math.max(-half, Math.min(...pts.map((p) => p.x)));
    const hi = Math.min(half, Math.max(...pts.map((p) => p.x)));
    if (hi > lo) iv.push([lo, hi]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of iv) {
    if (cur && withinTol(a - cur[1])) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total * 100) / 100;
}

/** Was die Frontmeter eines Stands brauchen (Tests übergeben auch nur die Breite). */
export type FrontStand = Pick<Stand, 'w'> & Partial<Rect> & { parts?: readonly ShapePart[] | null; frontOverride?: number | null };

/**
 * Frontmeter eines Stands fürs Standgeld und die Kennzahlen: belegt er wie gezeichnet, die Frontmeter von Hand oder
 * sonst automatisch die belegte Länge an der Vorderseite (`autoFrontMeters`); sonst die Breite B.
 */
export function frontMeters(s: FrontStand): number {
  if (!s.parts?.length || s.d === undefined || s.cx === undefined || s.cy === undefined) return s.w;
  if (s.frontOverride !== null && s.frontOverride !== undefined) return s.frontOverride;
  return autoFrontMeters(s as PartsRect);
}

// ---------- Mindestabstand (Darstellung) ----------

/**
 * Konvexes Vieleck um `by` Meter aufgeweitet (Minkowski-Summe mit einem Kreis, Ecken mit Bögen aus höchstens 10°
 * Schritten): Umriss des Mindestabstands um einen Teil (#3, #16).
 */
export function dilateConvex(poly: readonly Vec[], by: number): Polygon {
  const n = poly.length;
  const orient = polygonArea(poly) >= 0 ? 1 : -1;
  const out: Polygon = [];
  // Außennormale einer Kante (für beide Umlaufrichtungen)
  const normal = (a: Vec, b: Vec) => {
    const e = sub(b, a);
    const l = len(e) || 1;
    return orient > 0 ? vec(e.y / l, -e.x / l) : vec(-e.y / l, e.x / l);
  };
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n]!;
    const cur = poly[i]!;
    const next = poly[(i + 1) % n]!;
    const n0 = normal(prev, cur);
    const n1 = normal(cur, next);
    let a0 = Math.atan2(n0.y, n0.x);
    let a1 = Math.atan2(n1.y, n1.x);
    // Bogen in Umlaufrichtung des Vielecks
    if (orient > 0) while (a1 < a0) a1 += 2 * Math.PI;
    else while (a1 > a0) a1 -= 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / ((10 * Math.PI) / 180)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      out.push(add(cur, vec(Math.cos(a) * by, Math.sin(a) * by)));
    }
  }
  return out;
}

