/**
 * Geschäftsformen (M12, #9, spec.md §3 „Form“): Umriss eines Stands als Rechteck, Ellipse, Formvorlage oder eigene
 * Form (#16).
 *
 * Grundformen und Vorlagen ohne „belegt wie gezeichnet“ betreffen nur die Darstellung (Zeichenfläche, PDF);
 * Freiflächen, Warnungen, Fang, Treffer und Statistik rechnen dann mit dem Rechteck B × T (Hitbox). Eine eigene Form
 * und eine Vorlage mit „belegt wie gezeichnet“ belegen mit ihren Teilen (core/footprint.ts). Alle Teile sind konvex
 * (Rechteck, Ellipse als Vieleck) und können gedreht sein (#16); daraus entstehen die Füllung und die äußere Kontur
 * einer zusammengesetzten Form.
 */
import { fromLocal, normAngle, rectCorners } from './geometry/rect';
import { polyD } from './scene/prims';
import type { Id, Rect, ShapePart, ShapeTemplate, Stand, StandShape, Vec } from './model/types';

/** Ecken, mit denen eine Ellipse gezeichnet (und bei Belegung wie gezeichnet gerechnet) wird. */
export const ELLIPSE_SEGMENTS = 64;

/** Anzeigenamen der Grundformen. */
export const SHAPE_LABEL: Record<StandShape, string> = { rect: 'Rechteck', ellipse: 'Kreis/Oval' };

/** Formvorlage eines Stands, falls gesetzt und vorhanden (eine eigene Form hat Vorrang, siehe `drawnParts`). */
export function templateOf(stand: Pick<Stand, 'shapeTemplateId'>, templates: ReadonlyMap<Id, ShapeTemplate>): ShapeTemplate | undefined {
  return stand.shapeTemplateId ? templates.get(stand.shapeTemplateId) : undefined;
}

/** Teile, aus denen ein Stand gezeichnet wird: eigene Form (#16), sonst die Vorlage; null = Grundform. */
export const drawnParts = (stand: { parts?: readonly ShapePart[] | null }, template: ShapeTemplate | undefined): readonly ShapePart[] | null =>
  stand.parts?.length ? stand.parts : (template?.parts ?? null);

/** Hat der Stand eine andere Form als das Rechteck B × T (dann zeigt die Zeichenfläche bei Auswahl die Hitbox)? */
export const isShaped = (stand: Pick<Stand, 'shape'> & { parts?: readonly ShapePart[] | null }, template: ShapeTemplate | undefined): boolean =>
  !!stand.parts?.length || !!template || stand.shape === 'ellipse';

/** Ellipse mit Halbachsen rx, ry um (cx, cy), im selben Umlaufsinn wie `rectCorners`. */
function ellipsePts(cx: number, cy: number, rx: number, ry: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const a = Math.PI + (i / ELLIPSE_SEGMENTS) * 2 * Math.PI;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/**
 * Teil in Weltkoordinaten als gedrehtes Rechteck: Mitte und Maße aus dem Hüllrechteck B × T gestreckt, Drehung =
 * Drehung des Stands plus Drehung des Teils (um seine Mitte, #16). Bei einer Ellipse das Rechteck um sie herum.
 */
export function partRect(stand: Rect, part: ShapePart): Rect {
  const c = fromLocal(stand, { x: (part.x + part.w / 2 - 0.5) * stand.w, y: (part.y + part.h / 2 - 0.5) * stand.d });
  return { cx: c.x, cy: c.y, w: part.w * stand.w, d: part.h * stand.d, rot: normAngle(stand.rot + (part.rot || 0)) };
}

/** Teil als konvexes Vieleck in Weltkoordinaten: Rechteck = `rectCorners`, Ellipse mit `ELLIPSE_SEGMENTS` Ecken. */
export function partPolygon(stand: Rect, part: ShapePart): Vec[] {
  const r = partRect(stand, part);
  if (part.kind === 'ellipse') return ellipsePts(0, 0, r.w / 2, r.d / 2).map((q) => fromLocal(r, q));
  return rectCorners(r);
}

/**
 * Umriss eines Stands in Weltkoordinaten: ein konvexes Vieleck je Teil. Rechteck = `rectCorners` (eine Liste),
 * Ellipse = eine Liste mit `ELLIPSE_SEGMENTS` Ecken, Teile (Vorlage oder eigene Form) = ein Vieleck je Teil, gestreckt
 * auf B × T.
 */
export function standOutline(stand: Rect & Pick<Stand, 'shape'>, parts?: readonly ShapePart[] | null): Vec[][] {
  if (parts?.length) return parts.map((p) => partPolygon(stand, p));
  if (stand.shape === 'ellipse') return [ellipsePts(0, 0, stand.w / 2, stand.d / 2).map((q) => fromLocal(stand, q))];
  return [rectCorners(stand)];
}

const EPS = 1e-9;

/** Umlaufsinn eines Vielecks: +1 oder −1 (doppelte Fläche > 0 bzw. < 0). */
function orientation(poly: readonly Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a >= 0 ? 1 : -1;
}

/**
 * Teil [t0, t1] der Strecke a→b, der im Inneren des konvexen Vielecks `poly` liegt, oder null.
 * Liegt die Strecke auf einer Kante von `poly`, zählt sie als innen, wenn sie entgegengesetzt läuft (gemeinsame
 * Innenkante zweier anliegender Teile) oder `sameDirInside` gesetzt ist (deckungsgleiche Außenkante nur einmal).
 */
function insideInterval(a: Vec, b: Vec, poly: readonly Vec[], orient: number, sameDirInside: boolean, tol: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const len = Math.hypot(ex, ey);
    if (len < EPS) continue;
    // Abstand nach innen (positiv = innen), normiert auf Meter
    const sa = (orient * (ex * (a.y - p.y) - ey * (a.x - p.x))) / len;
    const sd = (orient * (ex * dy - ey * dx)) / len;
    if (Math.abs(sd) < tol && Math.abs(sa) <= tol) {
      // Strecke liegt auf dieser Kante
      const same = ex * dx + ey * dy > 0;
      if (same ? sameDirInside : true) continue;
      return null;
    }
    if (Math.abs(sd) < EPS) {
      if (sa <= tol) return null;
      continue;
    }
    const t = -sa / sd;
    if (sd > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t1 - t0 <= EPS) return null;
  }
  return [t0, t1];
}

/** Abschnitte [t0, t1] der Kante k von Teil i, die in keinem anderen Teil liegen (Umlaufreihenfolge). */
function edgePieces(polys: readonly (readonly Vec[])[], orients: readonly number[], i: number, k: number, tol: number): [number, number][] {
  const poly = polys[i]!;
  const a = poly[k]!;
  const b = poly[(k + 1) % poly.length]!;
  const cut: [number, number][] = [];
  polys.forEach((other, j) => {
    if (j === i) return;
    const iv = insideInterval(a, b, other, orients[j]!, j < i, tol);
    if (iv) cut.push(iv);
  });
  cut.sort((u, v) => u[0] - v[0]);
  const out: [number, number][] = [];
  let t = 0;
  for (const [c0, c1] of cut) {
    if (c0 > t + EPS) out.push([t, c0]);
    t = Math.max(t, c1);
  }
  if (t < 1 - EPS) out.push([t, 1]);
  return out;
}

/**
 * Äußere Kontur mehrerer konvexer Teile als Strecken: jede Kante eines Teils ohne die Abschnitte, die in einem
 * anderen Teil liegen. So entstehen bei überlappenden oder anliegenden Teilen keine Innenkanten.
 * `tol` ist die Toleranz für „auf der Kante“ in Metern.
 */
export function unionOutline(polys: readonly (readonly Vec[])[], tol = 1e-6): [Vec, Vec][] {
  const orients = polys.map(orientation);
  const out: [Vec, Vec][] = [];
  polys.forEach((poly, i) => {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!;
      const b = poly[(k + 1) % poly.length]!;
      const at = (s: number): Vec => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
      for (const [t0, t1] of edgePieces(polys, orients, i, k, tol)) out.push([at(t0), at(t1)]);
    }
  });
  return out;
}

const f3 = (p: Vec) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;

/** Ellipse eines Teils (bzw. des ganzen Stands) in Weltkoordinaten: Punkt zum Winkel, Halbachsen, Drehung. */
interface WorldEllipse {
  at: (angle: number) => Vec;
  rx: number;
  ry: number;
  rot: number;
}

function worldEllipse(stand: Rect, part: ShapePart | null): WorldEllipse {
  const r = part ? partRect(stand, part) : stand;
  const rx = r.w / 2;
  const ry = r.d / 2;
  return { at: (a) => fromLocal(r, { x: rx * Math.cos(a), y: ry * Math.sin(a) }), rx, ry, rot: r.rot };
}

/** Elliptischer Bogen von Winkel a0 nach a1 (a1 > a0, im Umlaufsinn von `ellipsePts`) in Stücken bis 90°. */
function arcD(e: WorldEllipse, a0: number, a1: number, move: boolean): string {
  let d = move ? `M${f3(e.at(a0))}` : '';
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2) - 1e-9));
  for (let i = 1; i <= n; i++) d += `A${e.rx.toFixed(3)} ${e.ry.toFixed(3)} ${e.rot} 0 1 ${f3(e.at(a0 + ((a1 - a0) * i) / n))}`;
  return d;
}

const fullEllipseD = (e: WorldEllipse) => `${arcD(e, Math.PI, 3 * Math.PI, true)}Z`;

/**
 * Pfade eines Stands mit Form für Zeichenfläche und PDF: `fill` (alle Teile im selben Umlaufsinn, als ein Pfad also
 * ohne doppelte Tönung) und `outline` (nur der äußere Umriss). Ellipsen sind echte Bögen statt Vielecke; das hält die
 * Zeichenfläche bei vielen runden Ständen flüssig (WebKit zeichnet beim Ziehen die ganze Ebene neu). Die Vielecke aus
 * `standOutline` bestimmen nur, welche Abschnitte einer Ellipse außen liegen. `parts` = Teile einer Vorlage oder der
 * eigenen Form (`drawnParts`), sonst die Grundform.
 */
export function shapePaths(stand: Rect & Pick<Stand, 'shape'>, parts?: readonly ShapePart[] | null): { fill: string; outline: string } {
  if (!parts?.length) {
    const d = stand.shape === 'ellipse' ? fullEllipseD(worldEllipse(stand, null)) : polyD(rectCorners(stand));
    return { fill: d, outline: d };
  }
  const polys = standOutline(stand, parts);
  const orients = polys.map(orientation);
  let fill = '';
  let outline = '';
  parts.forEach((part, i) => {
    const poly = polys[i]!;
    if (part.kind === 'rect') {
      fill += polyD(poly);
      const pieces = poly.map((_, k) => edgePieces(polys, orients, i, k, 1e-6));
      // ganz außen: geschlossenes Vieleck (saubere Ecke am Anfang)
      if (pieces.every((ps) => ps.length === 1 && ps[0]![0] < EPS && ps[0]![1] > 1 - EPS)) {
        outline += polyD(poly);
        return;
      }
      // Umlauf an einer Lücke beginnen, damit ein Zug über die erste Ecke hinweg nicht zerfällt
      const n = poly.length;
      const continues = (k: number) => {
        const prev = pieces[(k + n - 1) % n]!;
        return (pieces[k]![0]?.[0] ?? 1) < EPS && (prev[prev.length - 1]?.[1] ?? 0) > 1 - EPS;
      };
      const start = Math.max(0, pieces.findIndex((_, k) => !continues(k)));
      let joined = false;
      pieces.forEach((_, j) => {
        const k = (start + j) % n;
        const ps = pieces[k]!;
        const a = poly[k]!;
        const b = poly[(k + 1) % n]!;
        const at = (t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        for (const [t0, t1] of ps) {
          // an den vorigen Abschnitt anschließen, wenn er genau am Ende der vorigen Kante endete
          outline += (joined && t0 < EPS ? '' : `M${f3(at(t0))}`) + `L${f3(at(t1))}`;
          joined = t1 > 1 - EPS;
        }
        if (!ps.length) joined = false;
      });
      return;
    }
    const e = worldEllipse(stand, part);
    fill += fullEllipseD(e);
    // Außen liegende Abschnitte des Vielecks → Winkelbereiche der Ellipse, zusammenhängende zusammengefasst
    const step = (2 * Math.PI) / ELLIPSE_SEGMENTS;
    const ranges: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      for (const [t0, t1] of edgePieces(polys, orients, i, k, 1e-6)) {
        const a0 = Math.PI + (k + t0) * step;
        const a1 = Math.PI + (k + t1) * step;
        const prev = ranges[ranges.length - 1];
        if (prev && Math.abs(prev[1] - a0) < 1e-9) prev[1] = a1;
        else ranges.push([a0, a1]);
      }
    }
    // Bereich über den Startwinkel hinweg (Ende bei 3π, Anfang bei π) verbinden
    const first = ranges[0];
    const lastR = ranges[ranges.length - 1];
    if (ranges.length > 1 && first && lastR && Math.abs(first[0] - Math.PI) < 1e-9 && Math.abs(lastR[1] - 3 * Math.PI) < 1e-9) {
      ranges.pop();
      first[0] = lastR[0] - 2 * Math.PI;
    }
    if (ranges.length === 1 && first && first[1] - first[0] > 2 * Math.PI - 1e-9) outline += fullEllipseD(e);
    else for (const [a0, a1] of ranges) outline += arcD(e, a0, a1, true);
  });
  return { fill, outline };
}

/** Halbe Ausdehnung eines (gedrehten) Teils in Metern entlang x und y (Hüllrechteck um den gedrehten Teil). */
function partExtent(kind: StandShape, w: number, h: number, rot: number): { ex: number; ey: number } {
  const a = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  if (kind === 'ellipse') return { ex: Math.hypot((w / 2) * c, (h / 2) * s), ey: Math.hypot((w / 2) * s, (h / 2) * c) };
  return { ex: (w * c + h * s) / 2, ey: (w * s + h * c) / 2 };
}

/**
 * Teile einer Form aus Maßen in Metern (Editor): linke obere Ecke x/y des ungedrehten Teils, Breite w, Tiefe h,
 * Drehung rot um die Mitte. Liefert die auf das Hüllrechteck normierten Teile, das Hüllrechteck (= Vorschlagsmaß bzw.
 * B × T) und dessen linke obere Ecke `x0`/`y0` im Eingabesystem, oder null ohne brauchbares Teil. Das Hüllrechteck
 * umschließt auch gedrehte Teile.
 */
export function normalizeParts(parts: readonly ShapePart[]): { w: number; d: number; x0: number; y0: number; parts: ShapePart[] } | null {
  const ok = parts.filter((p) => p.w > 0 && p.h > 0 && [p.x, p.y, p.w, p.h].every(Number.isFinite));
  if (!ok.length) return null;
  const boxes = ok.map((p) => {
    const { ex, ey } = partExtent(p.kind, p.w, p.h, p.rot || 0);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    return { minX: cx - ex, maxX: cx + ex, minY: cy - ey, maxY: cy + ey };
  });
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const w = Math.max(...boxes.map((b) => b.maxX)) - minX;
  const d = Math.max(...boxes.map((b) => b.maxY)) - minY;
  if (!(w > 0) || !(d > 0)) return null;
  return {
    w,
    d,
    x0: minX,
    y0: minY,
    parts: ok.map((p) => ({ kind: p.kind, x: (p.x - minX) / w, y: (p.y - minY) / d, w: p.w / w, h: p.h / d, rot: normAngle(p.rot || 0) })),
  };
}

/** Teile einer Vorlage bzw. eines Stands in Metern relativ zur linken oberen Ecke von B × T (Gegenstück zu `normalizeParts`). */
export const partsInMeters = (t: Pick<ShapeTemplate, 'w' | 'd'> & { parts: readonly ShapePart[] }): ShapePart[] =>
  t.parts.map((p) => ({ kind: p.kind, x: p.x * t.w, y: p.y * t.d, w: p.w * t.w, h: p.h * t.d, rot: p.rot || 0 }));
