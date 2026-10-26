/**
 * Geschäftsformen (M12, #9, spec.md §3 „Form“): Umriss eines Stands als Rechteck, Ellipse oder Formvorlage.
 *
 * Die Form betrifft nur die Darstellung (Zeichenfläche, PDF). Freiflächen, Warnungen, Fang, Treffer und Statistik
 * rechnen weiter mit dem Rechteck B × T (Hitbox). Alle Teile einer Vorlage sind konvex (Rechteck, Ellipse als
 * Vieleck); daraus entstehen die Füllung und die äußere Kontur einer zusammengesetzten Form.
 */
import { fromLocal, rectCorners } from './geometry/rect';
import { polyD } from './scene/prims';
import type { Id, Rect, ShapePart, ShapeTemplate, Stand, StandShape, Vec } from './model/types';

/** Ecken, mit denen eine Ellipse gezeichnet wird. */
export const ELLIPSE_SEGMENTS = 64;

/** Anzeigenamen der Grundformen. */
export const SHAPE_LABEL: Record<StandShape, string> = { rect: 'Rechteck', ellipse: 'Kreis/Oval' };

/** Formvorlage eines Stands, falls gesetzt und vorhanden. */
export function templateOf(stand: Pick<Stand, 'shapeTemplateId'>, templates: ReadonlyMap<Id, ShapeTemplate>): ShapeTemplate | undefined {
  return stand.shapeTemplateId ? templates.get(stand.shapeTemplateId) : undefined;
}

/** Hat der Stand eine andere Form als das Rechteck B × T (dann zeigt die Zeichenfläche bei Auswahl die Hitbox)? */
export const isShaped = (stand: Pick<Stand, 'shape'>, template: ShapeTemplate | undefined): boolean => !!template || stand.shape === 'ellipse';

/** Ellipse mit Halbachsen rx, ry um (cx, cy), im selben Umlaufsinn wie `rectCorners`. */
function ellipsePts(cx: number, cy: number, rx: number, ry: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const a = Math.PI + (i / ELLIPSE_SEGMENTS) * 2 * Math.PI;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/** Teil im lokalen System eines Rechtecks w × d (Mittelpunkt 0/0, y nach unten). */
function partLocal(part: ShapePart, w: number, d: number): Vec[] {
  const x0 = (part.x - 0.5) * w;
  const y0 = (part.y - 0.5) * d;
  const pw = part.w * w;
  const ph = part.h * d;
  if (part.kind === 'ellipse') return ellipsePts(x0 + pw / 2, y0 + ph / 2, pw / 2, ph / 2);
  return [
    { x: x0, y: y0 },
    { x: x0 + pw, y: y0 },
    { x: x0 + pw, y: y0 + ph },
    { x: x0, y: y0 + ph },
  ];
}

/**
 * Umriss eines Stands in Weltkoordinaten: ein konvexes Vieleck je Teil. Rechteck = `rectCorners` (eine Liste),
 * Ellipse = eine Liste mit `ELLIPSE_SEGMENTS` Ecken, Vorlage = ein Vieleck je Teil, gestreckt auf B × T.
 */
export function standOutline(stand: Rect & Pick<Stand, 'shape'>, template?: ShapeTemplate): Vec[][] {
  if (template) return template.parts.map((p) => partLocal(p, stand.w, stand.d).map((q) => fromLocal(stand, q)));
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
  const cx = part ? (part.x + part.w / 2 - 0.5) * stand.w : 0;
  const cy = part ? (part.y + part.h / 2 - 0.5) * stand.d : 0;
  const rx = ((part?.w ?? 1) * stand.w) / 2;
  const ry = ((part?.h ?? 1) * stand.d) / 2;
  return { at: (a) => fromLocal(stand, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }), rx, ry, rot: stand.rot };
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
 * `standOutline` bestimmen nur, welche Abschnitte einer Ellipse außen liegen.
 */
export function shapePaths(stand: Rect & Pick<Stand, 'shape'>, template?: ShapeTemplate): { fill: string; outline: string } {
  if (!template) {
    const d = stand.shape === 'ellipse' ? fullEllipseD(worldEllipse(stand, null)) : polyD(rectCorners(stand));
    return { fill: d, outline: d };
  }
  const polys = standOutline(stand, template);
  const orients = polys.map(orientation);
  let fill = '';
  let outline = '';
  template.parts.forEach((part, i) => {
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

/**
 * Teile einer Formvorlage aus Maßen in Metern (Editor): linke obere Ecke x/y, Breite w, Tiefe h. Liefert die auf das
 * Hüllrechteck normierten Teile und das Hüllrechteck (= Vorschlagsmaß) oder null ohne brauchbares Teil.
 */
export function normalizeParts(parts: readonly ShapePart[]): { w: number; d: number; parts: ShapePart[] } | null {
  const ok = parts.filter((p) => p.w > 0 && p.h > 0 && [p.x, p.y, p.w, p.h].every(Number.isFinite));
  if (!ok.length) return null;
  const minX = Math.min(...ok.map((p) => p.x));
  const minY = Math.min(...ok.map((p) => p.y));
  const w = Math.max(...ok.map((p) => p.x + p.w)) - minX;
  const d = Math.max(...ok.map((p) => p.y + p.h)) - minY;
  return { w, d, parts: ok.map((p) => ({ kind: p.kind, x: (p.x - minX) / w, y: (p.y - minY) / d, w: p.w / w, h: p.h / d })) };
}

/** Teile einer Vorlage in Metern (Gegenstück zu `normalizeParts`, für den Editor). */
export const partsInMeters = (t: Pick<ShapeTemplate, 'w' | 'd' | 'parts'>): ShapePart[] =>
  t.parts.map((p) => ({ kind: p.kind, x: p.x * t.w, y: p.y * t.d, w: p.w * t.w, h: p.h * t.d }));
