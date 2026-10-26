/**
 * Freiflächen-Logik (M4, spec.md §4), aus prototype/freiflaechen.html übernommen und ergänzt:
 *
 * - Achse entlang der Vorderseite [0, Breite] (`frontFrame`, Vorderseite = Kante 2).
 * - Ein Stand belegt eine Grundfläche nur, wenn er mehr als TOL in sie hineinragt; er belegt die
 *   Projektion seines Teils innerhalb der Grundfläche auf die Achse.
 * - Freiflächen = [0, Breite] minus Vereinigung der belegten Intervalle, jeweils über die volle Tiefe.
 * - Überlappende Grundflächen: Die frühere (Reihenfolge der Page) gewinnt. Eine spätere rechnet nur
 *   mit ihrem Teil außerhalb aller früheren; ihre Freiflächen verlieren den Teil in früheren Flächen.
 * - Freiflächen werden nie gespeichert. Jede hat einen stabilen Schlüssel aus Grundfläche und den
 *   beiden begrenzenden Ständen (Grundlage der Sprung-Links in M6).
 */
import { AXIS_END, AXIS_START, mergeIntervals, subtractIntervals, type Gap, type Interval, type Merged } from './geometry/interval';
import { boundsTouch, centroid, clipConvex, penetration, polygonArea, projectOn, rectGeo, subtractAll, thickness, type Polygon } from './geometry/polygon';
import { exceedsTol, greaterThan, lessThan, TOL, withinTol } from './geometry/tolerance';
import { fromFrame, frontFrame, type FrontFrame } from './geometry/rect';
import type { Area, Id, Rect, Vec } from './model/types';

/** Fachliche Toleranz (siehe geometry/tolerance.ts), hier weitergereicht für bestehende Importe. */
export { TOL };

/** Grenzen der Mindestbreite (immer größer als TOL). */
export const MIN_FREE_WIDTH = { min: 0.05, max: 100 };

type StandLike = Rect & { id: Id };

export interface FreeSpace {
  /** Stabiler Schlüssel `areaId|links|rechts[#k]` (siehe `freeSpaceKey`). */
  key: string;
  areaId: Id;
  /** Lage auf der Achse der Grundfläche. */
  start: number;
  end: number;
  /** Hüllmaße in der Achse: Breite entlang der Vorderseite × größte Tiefe. */
  width: number;
  depth: number;
  /** Konvexe Stücke; ohne überlappende frühere Grundflächen genau ein Rechteck. */
  polygons: Polygon[];
  /** Fläche in m². */
  size: number;
  /** Punkt für die Beschriftung. */
  center: Vec;
  /** Durch eine frühere Grundfläche angeschnitten (A9). */
  clipped: boolean;
}

export interface AreaFreeSpaces {
  areaId: Id;
  /** Zusammengefasste belegte Intervalle. */
  occupied: Merged[];
  /** Alle Lücken, auch die schmaleren als die Mindestbreite. */
  gaps: Gap[];
  /** Angezeigte Freiflächen (ab Mindestbreite, ohne ausgeblendete). */
  free: FreeSpace[];
  /** Vom Planer ausgeblendete Freiflächen (#8, siehe hiddenFree.ts); zählen nirgends mit. */
  hidden: FreeSpace[];
}

/** Polygone früherer Grundflächen, die `area` um mehr als TOL überlappen. */
export function earlierOverlaps(area: Area, earlier: readonly Area[]): Polygon[] {
  const g = rectGeo(area);
  return earlier.filter((e) => boundsTouch(g.bounds, rectGeo(e).bounds) && exceedsTol(penetration(g.poly, rectGeo(e).poly))).map((e) => rectGeo(e).poly);
}

/**
 * BELEGTES INTERVALL eines Stands auf der Achse einer Grundfläche, oder null.
 * `cutters` = Polygone früherer Grundflächen, deren Teil nicht zu dieser Fläche gehört.
 */
export function occupiedInterval(area: Area, f: FrontFrame, stand: Rect, cutters: readonly Polygon[] = []): [number, number] | null {
  const ap = rectGeo(area).poly;
  const sp = rectGeo(stand).poly;
  if (withinTol(penetration(sp, ap))) return null;
  let pieces: Polygon[] = [clipConvex(sp, ap)].filter((p) => p.length >= 3);
  if (cutters.length) pieces = subtractAll(pieces, cutters).filter((p) => exceedsTol(thickness(p)));
  if (!pieces.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pieces) {
    const [a, b] = projectOn(p, f.origin, f.u);
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  lo = Math.max(0, Math.min(f.length, lo));
  hi = Math.max(0, Math.min(f.length, hi));
  // Enden bis einschließlich TOL an den Achsenenden dorthin ziehen: keine Reststreifen von Millimetern
  if (withinTol(lo)) lo = 0;
  if (withinTol(f.length - hi)) hi = f.length;
  return greaterThan(hi, lo) ? [lo, hi] : null;
}

/** Schlüssel einer Freifläche; `part` nur, wenn eine Lücke in mehrere getrennte Teile zerfällt. */
export const freeSpaceKey = (areaId: Id, left: Id, right: Id, part?: number) => `${areaId}|${left}|${right}${part !== undefined ? `#${part}` : ''}`;

/** Rechteck-Streifen [a, b] über die volle Tiefe als Polygon. */
const strip = (f: FrontFrame, a: number, b: number): Polygon => [fromFrame(f, a, 0), fromFrame(f, b, 0), fromFrame(f, b, f.depth), fromFrame(f, a, f.depth)];

/** Zerlegt eine angeschnittene Lücke in Teile, deren Lage auf der Achse sich nicht überschneidet. */
function splitParts(f: FrontFrame, pieces: Polygon[]): Polygon[][] {
  const withRange = pieces.map((p) => ({ p, r: projectOn(p, f.origin, f.u) })).toSorted((x, y) => x.r[0] - y.r[0]);
  const parts: { polys: Polygon[]; end: number }[] = [];
  for (const { p, r } of withRange) {
    const last = parts[parts.length - 1];
    if (last && withinTol(r[0] - last.end)) {
      last.polys.push(p);
      last.end = Math.max(last.end, r[1]);
    } else parts.push({ polys: [p], end: r[1] });
  }
  return parts.map((x) => x.polys);
}

function toFreeSpace(f: FrontFrame, areaId: Id, key: string, polys: Polygon[], clipped: boolean): FreeSpace {
  let s0 = Infinity;
  let s1 = -Infinity;
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const p of polys) {
    const [a, b] = projectOn(p, f.origin, f.u);
    const [c, d] = projectOn(p, f.origin, f.v);
    s0 = Math.min(s0, a);
    s1 = Math.max(s1, b);
    t0 = Math.min(t0, c);
    t1 = Math.max(t1, d);
  }
  const areas = polys.map((p) => Math.abs(polygonArea(p)));
  const largest = polys[areas.indexOf(Math.max(...areas))]!;
  return {
    key,
    areaId,
    start: s0,
    end: s1,
    width: s1 - s0,
    depth: t1 - t0,
    polygons: polys,
    size: areas.reduce((m, x) => m + x, 0),
    center: clipped ? centroid(largest) : fromFrame(f, (s0 + s1) / 2, f.depth / 2),
    clipped,
  };
}

/**
 * FREIFLÄCHEN einer Grundfläche.
 * @param stands  Stände, die die Fläche berühren könnten (mehr schadet nicht).
 * @param earlier Frühere Grundflächen der Page (Reihenfolge der Page, A9).
 * @param minWidth Lücken schmaler als die Mindestbreite werden nicht angezeigt.
 */
export function areaFreeSpaces(area: Area, stands: readonly StandLike[], earlier: readonly Area[], minWidth: number): AreaFreeSpaces {
  const f = frontFrame(area);
  const cutters = earlierOverlaps(area, earlier);
  const intervals: Interval[] = [];
  for (const s of stands) {
    const iv = occupiedInterval(area, f, s, cutters);
    if (iv) intervals.push({ a: iv[0], b: iv[1], id: s.id });
  }
  const occupied = mergeIntervals(intervals);
  const gaps = subtractIntervals(f.length, occupied);
  const free: FreeSpace[] = [];
  for (const g of gaps) {
    if (lessThan(g.b - g.a, minWidth)) continue;
    const rect = strip(f, g.a, g.b);
    if (!cutters.length) {
      free.push(toFreeSpace(f, area.id, freeSpaceKey(area.id, g.left, g.right), [rect], false));
      continue;
    }
    const pieces = subtractAll([rect], cutters).filter((p) => exceedsTol(thickness(p)));
    const parts = splitParts(f, pieces);
    parts.forEach((polys, k) => {
      const fs = toFreeSpace(f, area.id, freeSpaceKey(area.id, g.left, g.right, parts.length > 1 ? k : undefined), polys, true);
      if (!lessThan(fs.width, minWidth)) free.push(fs);
    });
  }
  return { areaId: area.id, occupied, gaps, free, hidden: [] };
}

// ---------- Ganze Page mit Zwischenspeicher ----------

interface CacheEntry {
  area: Area;
  stands: StandLike[];
  earlier: Area[];
  minWidth: number;
  result: AreaFreeSpaces;
}

/**
 * Zwischenspeicher für `pageFreeSpaces`: Eine Grundfläche wird nur neu berechnet, wenn sich sie selbst,
 * die Stände in ihrer Nähe, die früheren überlappenden Grundflächen oder die Mindestbreite ändern
 * (Vergleich per Objektidentität; Immer und die Vorschau lassen unveränderte Objekte unangetastet).
 */
export interface FreeSpaceCache {
  entries: Map<Id, CacheEntry>;
  /** Anzahl der tatsächlichen Berechnungen (für Tests). */
  computed: number;
}

export const createFreeSpaceCache = (): FreeSpaceCache => ({ entries: new Map(), computed: 0 });

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Freiflächen aller Grundflächen einer Page, in der Reihenfolge der Grundflächen. */
export function pageFreeSpaces(areas: readonly Area[], stands: readonly StandLike[], minWidth: number, cache: FreeSpaceCache = createFreeSpaceCache()): AreaFreeSpaces[] {
  const out: AreaFreeSpaces[] = [];
  const seen = new Set<Id>();
  areas.forEach((area, i) => {
    const b = rectGeo(area).bounds;
    const near = stands.filter((s) => boundsTouch(b, rectGeo(s).bounds));
    const earlier = areas.slice(0, i).filter((e) => boundsTouch(b, rectGeo(e).bounds));
    const hit = cache.entries.get(area.id);
    let result: AreaFreeSpaces;
    if (hit && hit.area === area && hit.minWidth === minWidth && sameList(hit.stands, near) && sameList(hit.earlier, earlier)) {
      result = hit.result;
    } else {
      result = areaFreeSpaces(area, near, earlier, minWidth);
      cache.computed++;
      cache.entries.set(area.id, { area, stands: near, earlier, minWidth, result });
    }
    seen.add(area.id);
    out.push(result);
  });
  for (const id of cache.entries.keys()) if (!seen.has(id)) cache.entries.delete(id);
  return out;
}

// ---------- Sprung-Links (Grundlage für M6) ----------

/** Verweis auf eine Freifläche, wie ihn ein Link der Start-Page speichert. */
export interface FreeSpaceRef {
  pageId: Id;
  key: string;
  areaId: Id;
  start: number;
  end: number;
}

/**
 * Findet die Freifläche zu einem Verweis: exakter Schlüssel, sonst die Freifläche derselben
 * Grundfläche mit der größten Überdeckung von [start, end]. null = es gibt keine passende mehr
 * (dann hebt die Start-Page die Grundfläche hervor).
 */
export function resolveFreeSpace(all: readonly AreaFreeSpaces[], ref: Omit<FreeSpaceRef, 'pageId'>): FreeSpace | null {
  const area = all.find((a) => a.areaId === ref.areaId);
  if (!area) return null;
  // Ausgeblendete zählen mit: Ein Sprung aus der Liste („ausgeblendete zeigen“) soll sie trotzdem finden (#8)
  const spaces = area.hidden.length ? [...area.free, ...area.hidden] : area.free;
  const exact = spaces.find((f) => f.key === ref.key);
  if (exact) return exact;
  let best: FreeSpace | null = null;
  let bestOverlap = 0;
  for (const f of spaces) {
    const o = Math.min(f.end, ref.end) - Math.max(f.start, ref.start);
    if (greaterThan(o, bestOverlap)) {
      best = f;
      bestOverlap = o;
    }
  }
  return best;
}

export { AXIS_END, AXIS_START };
