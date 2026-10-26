/**
 * Geschäftstabelle der Start-Page (M6, spec.md §7): Zeilen über alle Festplätze, Suche, Filter, Sortierung und
 * Summen. Rein und ohne UI; die Tabelle zeigt nur an, was hier berechnet wird.
 */
import { sumWidths } from './stats';
import { cachedDuplicates, nrKey, type NrRef } from './numbering';
import { CONNECTION_KEYS, sumPower, type ConnectionKey } from './power';
import { activeWarnings, cachedInfraWarnings, cachedPageWarnings, NO_INFRA_WARNINGS, type ActiveWarnings } from './warnings';
import type { Id, Project, Stand } from './model/types';

export interface StandRow {
  pageId: Id;
  /** Position der Page in der Tab-Reihenfolge (0 = erster Festplatz). */
  pageIndex: number;
  pageName: string;
  stand: Stand;
  categoryName: string | null;
  warnings: ActiveWarnings;
  /** Andere Stände mit derselben Nummer (nur wenn die Warnung „doppelte Nummer“ angezeigt wird). */
  duplicates: readonly NrRef[];
}

export function standRows(project: Pick<Project, 'pages' | 'settings' | 'categories'> & Partial<Pick<Project, 'infraTypes'>>): StandRow[] {
  const cats = new Map(project.categories.map((c) => [c.id, c.name]));
  const dups = cachedDuplicates(project.pages, project.settings.numbering.scope);
  const rows: StandRow[] = [];
  project.pages.forEach((page, pageIndex) => {
    const w = cachedPageWarnings(page.areas, page.stands);
    const iw = project.infraTypes ? cachedInfraWarnings(page, project.infraTypes, project.settings.minPassageWidth) : NO_INFRA_WARNINGS;
    for (const s of page.stands) {
      const d = dups.get(s.id);
      const warnings = activeWarnings(w.byStand.get(s.id), s, project.settings, !!d, iw.byStand.has(s.id));
      rows.push({
        pageId: page.id,
        pageIndex,
        pageName: page.name,
        stand: s,
        categoryName: s.categoryId ? (cats.get(s.categoryId) ?? null) : null,
        warnings,
        duplicates: warnings.duplicate && d ? d : [],
      });
    }
  });
  return rows;
}

export const hasWarning = (r: StandRow) => r.warnings.outside || r.warnings.overlap || r.warnings.duplicate || r.warnings.infra;

// ---------- Suche und Filter ----------

/** Für die Suche: ohne Groß-/Kleinschreibung, ohne Akzente („Café“ = „cafe“), ß = ss, Leerraum vereinheitlicht. */
export const normalizeSearch = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();

export interface StandFilter {
  search: string;
  /** null = alle; sonst die gewählten Pages. */
  pages: Id[] | null;
  /** null = alle; `null` in der Liste = „ohne Kategorie“. */
  categories: (Id | null)[] | null;
  /** null = alle; 'none' = „ohne Angabe“. */
  connections: ConnectionKey[] | null;
  withWarning: boolean;
  withoutNr: boolean;
}

export const EMPTY_STAND_FILTER: StandFilter = { search: '', pages: null, categories: null, connections: null, withWarning: false, withoutNr: false };

export const isFilterActive = (f: StandFilter) =>
  !!f.search.trim() || f.pages !== null || f.categories !== null || f.connections !== null || f.withWarning || f.withoutNr;

/** Die Suche findet jedes Wort einzeln in Name, Eigentümer oder Ware („müller bratwurst“). */
export function filterRows(rows: readonly StandRow[], f: StandFilter): StandRow[] {
  const words = normalizeSearch(f.search).split(' ').filter(Boolean);
  const pages = f.pages && new Set(f.pages);
  const cats = f.categories && new Set(f.categories);
  const conns = f.connections && new Set(f.connections);
  return rows.filter((r) => {
    const s = r.stand;
    if (pages && !pages.has(r.pageId)) return false;
    if (cats && !cats.has(s.categoryId && r.categoryName !== null ? s.categoryId : null)) return false;
    if (conns && !conns.has(s.connection ?? 'none')) return false;
    if (f.withWarning && !hasWarning(r)) return false;
    if (f.withoutNr && s.nr.trim()) return false;
    if (words.length) {
      const hay = normalizeSearch(`${s.name} ${s.owner} ${s.ware}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

// ---------- Sortierung ----------

export type StandSortColumn = 'page' | 'nr' | 'name' | 'owner' | 'ware' | 'category' | 'w' | 'd' | 'power' | 'connection' | 'warnings' | 'note';
export interface SortKey<C extends string = StandSortColumn> {
  col: C;
  dir: 'asc' | 'desc';
}

export const DEFAULT_STAND_SORT: SortKey[] = [
  { col: 'page', dir: 'asc' },
  { col: 'nr', dir: 'asc' },
];

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/**
 * Natürlicher Vergleich von Platznummern: Ziffernfolgen als Zahl („A-2“ vor „A-10“, „012“ = „12“), Text ohne
 * Groß-/Kleinschreibung. Leere Nummern sind hier gleich; ans Ende stellt sie `sortRows`.
 */
export function compareNr(a: string, b: string): number {
  const ta = nrKey(a).match(/\d+|\D+/g) ?? [];
  const tb = nrKey(b).match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i]!;
    const y = tb[i]!;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    let c: number;
    if (nx && ny) c = x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
    else if (nx !== ny) c = nx ? -1 : 1;
    else c = collator.compare(x, y);
    if (c) return c;
  }
  return ta.length - tb.length;
}

const WARN_RANK = (r: StandRow) => (r.warnings.infra ? 8 : 0) + (r.warnings.overlap ? 4 : 0) + (r.warnings.outside ? 2 : 0) + (r.warnings.duplicate ? 1 : 0);
const CONN_RANK: Record<ConnectionKey, number> = { '230V': 0, CEE16: 1, CEE32: 2, none: 3 };

/** Wert für den Vergleich; null = leer (steht in beiden Richtungen am Ende). */
function sortValue(r: StandRow, col: StandSortColumn): string | number | null {
  const s = r.stand;
  const text = (t: string) => (t.trim() ? t : null);
  switch (col) {
    case 'page':
      return r.pageIndex;
    case 'nr':
      return text(s.nr);
    case 'name':
      return text(s.name);
    case 'owner':
      return text(s.owner);
    case 'ware':
      return text(s.ware);
    case 'note':
      return text(s.note);
    case 'category':
      return r.categoryName;
    case 'w':
      return s.w;
    case 'd':
      return s.d;
    case 'power':
      return s.powerKw;
    case 'connection':
      return s.connection ? CONN_RANK[s.connection] : null;
    case 'warnings':
      return WARN_RANK(r) || null;
  }
}

function compareBy(col: StandSortColumn, a: StandRow, b: StandRow): number {
  const x = sortValue(a, col);
  const y = sortValue(b, col);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  if (col === 'nr') return compareNr(x as string, y as string);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return collator.compare(String(x), String(y));
}

/**
 * Sortiert nach den Schlüsseln (erster zuerst). Leere Werte stehen immer am Ende. Gleichstände entscheiden
 * Festplatz, Nummer und zuletzt die ID, damit die Reihenfolge nie von der Anlegereihenfolge abhängt.
 */
export function sortRows(rows: readonly StandRow[], keys: readonly SortKey[]): StandRow[] {
  const all: SortKey[] = [...keys, { col: 'page', dir: 'asc' }, { col: 'nr', dir: 'asc' }];
  return rows.toSorted((a, b) => {
    for (const k of all) {
      const empty = (sortValue(a, k.col) === null) !== (sortValue(b, k.col) === null);
      const c = compareBy(k.col, a, b);
      if (c) return empty || k.dir === 'asc' ? c : -c;
    }
    return a.stand.id < b.stand.id ? -1 : a.stand.id > b.stand.id ? 1 : 0;
  });
}

/** Klick auf einen Spaltenkopf: neue erste Stufe bzw. Richtung umkehren; mit Shift eine weitere Stufe. */
export function toggleSort<C extends string>(keys: readonly SortKey<C>[], col: C, add: boolean): SortKey<C>[] {
  const i = keys.findIndex((k) => k.col === col);
  if (add) {
    if (i < 0) return [...keys, { col, dir: 'asc' }];
    return keys.map((k, j) => (j === i ? { col, dir: k.dir === 'asc' ? 'desc' : 'asc' } : k));
  }
  if (i === 0) return [{ col, dir: keys[0]!.dir === 'asc' ? 'desc' : 'asc' }];
  return [{ col, dir: 'asc' }];
}

// ---------- Summen ----------

export interface StandSums {
  count: number;
  frontM: number;
  powerKw: number;
  byConnection: Record<ConnectionKey, number>;
}

export function sumRows(rows: readonly StandRow[]): StandSums {
  const stands = rows.map((r) => r.stand);
  const byConnection = Object.fromEntries(CONNECTION_KEYS.map((k) => [k, 0])) as Record<ConnectionKey, number>;
  for (const s of stands) byConnection[s.connection ?? 'none']++;
  return { count: rows.length, frontM: sumWidths(stands), powerKw: sumPower(stands), byConnection };
}
