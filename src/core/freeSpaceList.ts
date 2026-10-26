/**
 * Freiflächenliste der Start-Page (M6, spec.md §7): alle Freiflächen aller Festplätze mit Sprung-Verweis,
 * Filter „passt für einen Stand mit mindestens B × T“, Sortierung und Summe.
 */
import { frontFrame, toFrame, type FrontFrame } from './geometry/rect';
import { atLeast, TOL } from './geometry/tolerance';
import type { Polygon } from './geometry/polygon';
import type { AreaFreeSpaces, FreeSpace, FreeSpaceRef } from './freeSpace';
import type { Area, FestplatzPage, Id, Project } from './model/types';
import type { SortKey } from './standTable';

export interface FreeSpaceRow {
  ref: FreeSpaceRef;
  pageIndex: number;
  pageName: string;
  areaName: string;
  /** Hüllmaße (bei angeschnittenen Freiflächen größer als das nutzbare Rechteck). */
  width: number;
  depth: number;
  /** Fläche in m². */
  size: number;
  /** Durch eine frühere Grundfläche angeschnitten (L-förmig, §4). */
  clipped: boolean;
  /** Tiefe, die über die ganze Breite ab der Vorderseite durchgehend frei ist (ohne Anschnitt = `depth`). */
  usableDepth: number;
  /** Vom Planer ausgeblendet (#8); nur mit Filter `showHidden` sichtbar, zählt nie in der Summe. */
  hidden: boolean;
}

/** Tiefe der durchgehenden Freifläche ab der Vorderseite (t = 0) an der Stelle s. */
function columnDepth(f: FrontFrame, polys: readonly Polygon[], s: number): number {
  const spans: [number, number][] = [];
  for (const poly of polys) {
    let lo = Infinity;
    let hi = -Infinity;
    const pts = poly.map((p) => toFrame(f, p));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if ((a.s - s) * (b.s - s) > 0 || a.s === b.s) continue;
      const t = a.t + ((s - a.s) / (b.s - a.s)) * (b.t - a.t);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    if (hi > lo) spans.push([lo, hi]);
  }
  let reach = 0;
  for (const [lo, hi] of spans.toSorted((x, y) => x[0] - y[0])) {
    if (lo > reach + TOL) break;
    reach = Math.max(reach, hi);
  }
  return reach;
}

/**
 * Kleinste durchgehende Tiefe ab der Vorderseite über die ganze Breite einer Freifläche (spec.md §7). Zwischen
 * den Ecken der Teilstücke verläuft die Tiefe linear, das Minimum liegt also an einer Ecke; ausgewertet wird
 * knapp links und rechts jeder Ecke.
 */
export function usableDepth(area: Area, free: Pick<FreeSpace, 'start' | 'end' | 'depth' | 'polygons' | 'clipped'>): number {
  if (!free.clipped) return free.depth;
  const f = frontFrame(area);
  const breaks = new Set<number>([free.start, free.end]);
  for (const poly of free.polygons) for (const p of poly) breaks.add(toFrame(f, p).s);
  const sorted = [...breaks].filter((s) => s >= free.start && s <= free.end).toSorted((a, b) => a - b);
  const eps = 1e-6;
  let min = Infinity;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (b - a <= 2 * eps) continue;
    min = Math.min(min, columnDepth(f, free.polygons, a + eps), columnDepth(f, free.polygons, b - eps));
  }
  return Number.isFinite(min) ? min : 0;
}

/** Zeilen aller Pages in Tab-Reihenfolge; `freeOf` liefert die (zwischengespeicherten) Freiflächen einer Page. */
export function freeSpaceRows(project: Pick<Project, 'pages'>, freeOf: (page: FestplatzPage) => readonly AreaFreeSpaces[]): FreeSpaceRow[] {
  const rows: FreeSpaceRow[] = [];
  project.pages.forEach((page, pageIndex) => {
    const areas = new Map(page.areas.map((a) => [a.id, a]));
    for (const af of freeOf(page)) {
      const area = areas.get(af.areaId);
      if (!area) continue;
      const spaces = af.hidden.length ? [...af.free.map((fs) => [fs, false] as const), ...af.hidden.map((fs) => [fs, true] as const)] : af.free.map((fs) => [fs, false] as const);
      for (const [fs, hidden] of spaces) {
        rows.push({
          ref: { pageId: page.id, key: fs.key, areaId: fs.areaId, start: fs.start, end: fs.end },
          pageIndex,
          pageName: page.name,
          areaName: area.name,
          width: fs.width,
          depth: fs.depth,
          size: fs.size,
          clipped: fs.clipped,
          usableDepth: usableDepth(area, fs),
          hidden,
        });
      }
    }
  });
  return rows;
}

/** Passt ein Stand B × T (Breite an der Vorderseite)? Bis einschließlich 0,01 m zu knapp gilt als passend (§4). */
export const fitsStand = (row: Pick<FreeSpaceRow, 'width' | 'usableDepth'>, w: number, d: number) => atLeast(row.width + TOL, w) && atLeast(row.usableDepth + TOL, d);

export interface FreeSpaceFilter {
  pages: Id[] | null;
  /** Mindestmaße des Stands; null = ohne diese Bedingung. */
  minW: number | null;
  minD: number | null;
  /** Ausgeblendete Freiflächen (#8) mit anzeigen. */
  showHidden?: boolean;
}

export const EMPTY_FREE_FILTER: FreeSpaceFilter = { pages: null, minW: null, minD: null, showHidden: false };
export const isFitFilterActive = (f: FreeSpaceFilter) => f.minW !== null || f.minD !== null;

export function filterFreeSpaces(rows: readonly FreeSpaceRow[], f: FreeSpaceFilter): FreeSpaceRow[] {
  const pages = f.pages && new Set(f.pages);
  return rows.filter((r) => (f.showHidden || !r.hidden) && (!pages || pages.has(r.ref.pageId)) && fitsStand(r, f.minW ?? 0, f.minD ?? 0));
}

export type FreeSortColumn = 'page' | 'area' | 'w' | 'd' | 'size';

/** Standard: Breite absteigend; mit Passt-Filter aufsteigend (engste passende Lücke zuerst). */
export const defaultFreeSort = (fitFilter: boolean): SortKey<FreeSortColumn>[] => [{ col: 'w', dir: fitFilter ? 'asc' : 'desc' }];

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function compareFree(col: FreeSortColumn, a: FreeSpaceRow, b: FreeSpaceRow): number {
  switch (col) {
    case 'page':
      return a.pageIndex - b.pageIndex;
    case 'area':
      return collator.compare(a.areaName, b.areaName);
    case 'w':
      return a.width - b.width;
    case 'd':
      return a.depth - b.depth;
    case 'size':
      return a.size - b.size;
  }
}

export function sortFreeSpaces(rows: readonly FreeSpaceRow[], keys: readonly SortKey<FreeSortColumn>[]): FreeSpaceRow[] {
  const all: SortKey<FreeSortColumn>[] = [...keys, { col: 'page', dir: 'asc' }, { col: 'area', dir: 'asc' }];
  return rows.toSorted((a, b) => {
    for (const k of all) {
      const c = compareFree(k.col, a, b);
      if (c) return k.dir === 'asc' ? c : -c;
    }
    return a.ref.start - b.ref.start || (a.ref.key < b.ref.key ? -1 : a.ref.key > b.ref.key ? 1 : 0);
  });
}

/** Summe der angezeigten, nicht ausgeblendeten Zeilen (#8). */
export function sumFreeSpaces(rows: readonly FreeSpaceRow[]): { count: number; widthM: number } {
  const shown = rows.filter((r) => !r.hidden);
  return { count: shown.length, widthM: Math.round(shown.reduce((n, r) => n + r.width * 100, 0)) / 100 };
}
