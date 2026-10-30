/**
 * Warnungen für Geschäfte (M4, spec.md §3):
 * - außerhalb: Ein Teil des Stands liegt mehr als TOL außerhalb der Vereinigung aller Grundflächen.
 * - Überlappung: Zwei Stände dringen mehr als TOL ineinander ein.
 * - doppelte Nummer (M5): berechnet in numbering.ts (`cachedDuplicates`), hier nur angezeigt und gezählt.
 * - Infrastruktur (M7): Stand in einem Objekt mit „freihalten“ (core/infra.ts, `infraConflicts`).
 * - Durchfahrt zu eng (M7): hängt am Infrastruktur-Objekt, nicht am Stand.
 * - Abstand (#3): Stand derselben Kategorie näher als deren Mindestabstand (Kante zu Kante, `distanceConflicts`).
 * Die Rohdaten hängen nur von der Geometrie ab; ob eine Warnung angezeigt wird, entscheiden die
 * Projekteinstellungen und die Häkchen am Stand (`activeWarnings`).
 */
import { boundsTouch, clipConvex, dilateRect, distToRect, penetration, rectGap, rectGeo, subtractAll, type Polygon } from './geometry/polygon';
import { exceedsTol, greaterThan, lessThan, TOL, withinTol } from './geometry/tolerance';
import { infraConflicts, passageTooNarrow, typeMap } from './infra';
import type { Area, Category, FestplatzPage, Id, InfraObject, InfraTypeDef, ProjectSettings, Stand, Vec } from './model/types';

export interface StandWarning {
  outside: boolean;
  /** IDs der Stände, mit denen sich dieser Stand überschneidet. */
  overlaps: Id[];
}

export interface OverlapRegion {
  a: Id;
  b: Id;
  polygon: Polygon;
}

export interface PageWarnings {
  byStand: Map<Id, StandWarning>;
  regions: OverlapRegion[];
}

/**
 * Liegt ein Teil des Stands mehr als TOL außerhalb der Vereinigung der Grundflächen (QA-M4-02)?
 * Gemessen wird der echte Abstand, auch für schräg herausragende Ecken gedrehter Stände.
 * 1. Alle Ecken höchstens TOL von derselben Grundfläche entfernt → innerhalb (Rechteck aufgeweitet ist konvex).
 * 2. Eine Ecke mehr als TOL von allen Grundflächen entfernt → außerhalb.
 * 3. Sonst genau: Stand minus alle um TOL aufgeweiteten Grundflächen; bleibt etwas übrig → außerhalb.
 */
export function isOutside(stand: Stand, areas: readonly Area[]): boolean {
  const { poly, bounds } = rectGeo(stand);
  const near = areas.filter((a) => boundsTouch(bounds, rectGeo(a).bounds, TOL));
  if (!near.length) return true;
  if (near.some((a) => poly.every((p) => withinTol(distToRect(a, p))))) return false;
  if (poly.some((p) => near.every((a) => exceedsTol(distToRect(a, p))))) return true;
  return subtractAll([poly], near.map((a) => dilateRect(a, TOL))).length > 0;
}

/** Paare sich überschneidender Stände (Sweep über die Hüllrechtecke, genau per SAT). */
export function overlappingPairs(stands: readonly Stand[]): OverlapRegion[] {
  const items = stands.map((s) => ({ s, g: rectGeo(s) })).toSorted((p, q) => p.g.bounds.minX - q.g.bounds.minX);
  const out: OverlapRegion[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!;
    for (let j = i + 1; j < items.length; j++) {
      const q = items[j]!;
      if (greaterThan(q.g.bounds.minX, p.g.bounds.maxX)) break;
      if (!boundsTouch(p.g.bounds, q.g.bounds)) continue;
      if (exceedsTol(penetration(p.g.poly, q.g.poly))) {
        const [a, b] = p.s.id < q.s.id ? [p.s.id, q.s.id] : [q.s.id, p.s.id];
        out.push({ a, b, polygon: clipConvex(p.g.poly, q.g.poly) });
      }
    }
  }
  return out;
}

/** „außerhalb“ je Stand zwischenspeichern: hängt nur vom Stand und der Liste der Grundflächen ab. */
const outsideCache = new WeakMap<Stand, { areas: readonly Area[]; outside: boolean }>();

export function pageWarnings(areas: readonly Area[], stands: readonly Stand[]): PageWarnings {
  const byStand = new Map<Id, StandWarning>();
  for (const s of stands) {
    let c = outsideCache.get(s);
    if (!c || c.areas !== areas) {
      c = { areas, outside: isOutside(s, areas) };
      outsideCache.set(s, c);
    }
    byStand.set(s.id, { outside: c.outside, overlaps: [] });
  }
  const regions = overlappingPairs(stands);
  for (const r of regions) {
    byStand.get(r.a)?.overlaps.push(r.b);
    byStand.get(r.b)?.overlaps.push(r.a);
  }
  return { byStand, regions };
}

export type WarnSettings = Pick<ProjectSettings, 'warnOutside' | 'warnOverlap' | 'warnDuplicateNr' | 'warnInfra' | 'warnPassageWidth' | 'warnDistance'>;

export interface ActiveWarnings {
  outside: boolean;
  overlap: boolean;
  duplicate: boolean;
  /** Stand in einem Infrastruktur-Objekt mit „freihalten“ (M7). */
  infra: boolean;
  /** Stand derselben Kategorie zu nah (#3). */
  distance: boolean;
}

/**
 * Angezeigte Warnungen eines Stands nach Projekteinstellung und eigenen Häkchen.
 * `duplicate` = der Stand hat eine doppelte Nummer (numbering.ts); `infra` = er dringt in ein Objekt mit „freihalten“ ein;
 * `distance` = ein Stand derselben Kategorie steht näher als deren Mindestabstand (#3).
 */
export function activeWarnings(w: StandWarning | undefined, stand: Stand, settings: WarnSettings, duplicate = false, infra = false, distance = false): ActiveWarnings {
  return {
    outside: !!w?.outside && settings.warnOutside && !stand.suppressOutsideWarning,
    overlap: !!w?.overlaps.length && settings.warnOverlap && !stand.suppressOverlapWarning,
    duplicate: duplicate && settings.warnDuplicateNr && !stand.suppressDuplicateWarning,
    infra: infra && settings.warnInfra && !stand.suppressInfraWarning,
    distance: distance && settings.warnDistance && !stand.suppressDistanceWarning,
  };
}

/** Ein zu naher Stand derselben Kategorie (#3): Abstand Kante zu Kante (auf 0,01 m gerundet) und die nächsten Punkte. */
export interface DistanceConflict {
  id: Id;
  dist: number;
  /** Nächster Punkt auf diesem Stand bzw. auf dem anderen. */
  from: Vec;
  to: Vec;
}

/** Stand-ID → zu nahe Stände derselben Kategorie, nach Abstand sortiert. */
export type DistanceWarnings = ReadonlyMap<Id, readonly DistanceConflict[]>;

/** Abstand für die Anzeige, immer mit zwei Nachkommastellen („23,40 m“). */
export const fmtGap = (d: number) => `${d.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
export const NO_DISTANCE_WARNINGS: DistanceWarnings = new Map();

/**
 * Konkurrenzschutz (#3): Paare von Ständen derselben Kategorie, deren kürzester Abstand Kante zu Kante (Hitbox B × T,
 * auch bei Formen; Luftlinie, auf 0,01 m gerundet) unter dem Mindestabstand der Kategorie liegt. Nur Kategorien mit
 * Mindestabstand; je Kategorie ein Sweep über die Hüllrechtecke wie bei `overlappingPairs`.
 */
export function distanceConflicts(stands: readonly Stand[], categories: readonly Category[]): Map<Id, DistanceConflict[]> {
  const out = new Map<Id, DistanceConflict[]>();
  const limit = new Map(categories.flatMap((c) => (c.minDistance ? [[c.id, c.minDistance] as const] : [])));
  if (!limit.size) return out;
  const groups = new Map<Id, Stand[]>();
  for (const s of stands) {
    if (s.categoryId === null || !limit.has(s.categoryId)) continue;
    let g = groups.get(s.categoryId);
    if (!g) groups.set(s.categoryId, (g = []));
    g.push(s);
  }
  const push = (id: Id, c: DistanceConflict) => {
    const list = out.get(id);
    if (list) list.push(c);
    else out.set(id, [c]);
  };
  for (const [catId, group] of groups) {
    if (group.length < 2) continue;
    const min = limit.get(catId)!;
    const items = group.map((s) => ({ s, b: rectGeo(s).bounds })).toSorted((p, q) => p.b.minX - q.b.minX);
    for (let i = 0; i < items.length; i++) {
      const p = items[i]!;
      for (let j = i + 1; j < items.length; j++) {
        const q = items[j]!;
        if (q.b.minX - p.b.maxX >= min) break;
        if (!boundsTouch(p.b, q.b, min)) continue;
        const gap = rectGap(p.s, q.s);
        const dist = Math.round(gap.dist * 100) / 100;
        if (!lessThan(dist, min)) continue;
        push(p.s.id, { id: q.s.id, dist, from: gap.from, to: gap.to });
        push(q.s.id, { id: p.s.id, dist, from: gap.to, to: gap.from });
      }
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.dist - b.dist);
  return out;
}

/** Zwischenspeicher je Liste der Stände; gültig, solange die Kategorien gleich sind (Immer teilt unveränderte Listen). */
const distanceCache = new WeakMap<readonly Stand[], { categories: readonly Category[]; result: DistanceWarnings }>();

export function cachedDistanceWarnings(stands: readonly Stand[], categories: readonly Category[]): DistanceWarnings {
  if (!categories.some((c) => c.minDistance)) return NO_DISTANCE_WARNINGS;
  const hit = distanceCache.get(stands);
  if (hit && hit.categories === categories) return hit.result;
  const result = distanceConflicts(stands, categories);
  distanceCache.set(stands, { categories, result });
  return result;
}

/** Rohdaten der Infrastruktur-Warnungen einer Page (M7). */
export interface InfraWarnings {
  /** Stand-ID → IDs der Objekte mit „freihalten“, in die er eindringt. */
  byStand: ReadonlyMap<Id, readonly Id[]>;
  /** Durchfahrten unter der Mindestbreite. */
  narrow: ReadonlySet<Id>;
}

export const NO_INFRA_WARNINGS: InfraWarnings = { byStand: new Map(), narrow: new Set() };

/** Zwischenspeicher je Liste der Stände; gültig, solange Objekte, Typen und Mindestbreite gleich sind. */
const infraCache = new WeakMap<readonly Stand[], { infra: readonly InfraObject[]; types: readonly InfraTypeDef[]; min: number; result: InfraWarnings }>();

export function cachedInfraWarnings(page: Pick<FestplatzPage, 'stands' | 'infra'>, types: readonly InfraTypeDef[], minPassageWidth: number): InfraWarnings {
  if (!page.infra.length) return NO_INFRA_WARNINGS;
  const hit = infraCache.get(page.stands);
  if (hit && hit.infra === page.infra && hit.types === types && hit.min === minPassageWidth) return hit.result;
  const result: InfraWarnings = {
    byStand: infraConflicts(page.stands, page.infra, typeMap(types)),
    narrow: new Set(page.infra.filter((o) => passageTooNarrow(o, minPassageWidth)).map((o) => o.id)),
  };
  infraCache.set(page.stands, { infra: page.infra, types, min: minPassageWidth, result });
  return result;
}

/** Angezeigte Warnung „Durchfahrt zu eng“ eines Objekts. */
export const activeNarrow = (o: InfraObject, iw: InfraWarnings, settings: WarnSettings) => iw.narrow.has(o.id) && settings.warnPassageWidth && !o.suppressWidthWarning;

export interface WarningCount {
  /** Stände mit mindestens einer angezeigten Warnung. */
  stands: number;
  /** Je Art; ein Stand mit Überlappung zählt nur dort, sonst bei „außerhalb“. */
  outside: number;
  overlap: number;
  /** Stände mit doppelter Nummer (zusätzlich zu den beiden anderen gezählt). */
  duplicate: number;
  /** Stände mit Warnung „Infrastruktur“ (zusätzlich gezählt, M7). */
  infra: number;
  /** Infrastruktur-Objekte mit Warnung „Durchfahrt zu eng“ (M7; zählen nicht bei `stands`). */
  narrow: number;
  /** Stände mit Warnung „Abstand“ (zusätzlich gezählt, #3). */
  distance: number;
}

export const NO_WARNINGS: WarningCount = { stands: 0, outside: 0, overlap: 0, duplicate: 0, infra: 0, narrow: 0, distance: 0 };

export function countWarnings(
  w: PageWarnings,
  stands: readonly Stand[],
  settings: WarnSettings,
  duplicates?: ReadonlyMap<Id, unknown>,
  infra?: { warnings: InfraWarnings; objects: readonly InfraObject[] },
  distance: DistanceWarnings = NO_DISTANCE_WARNINGS,
): WarningCount {
  const n: WarningCount = { ...NO_WARNINGS };
  for (const s of stands) {
    const a = activeWarnings(w.byStand.get(s.id), s, settings, !!duplicates?.has(s.id), !!infra?.warnings.byStand.has(s.id), distance.has(s.id));
    if (a.outside || a.overlap || a.duplicate || a.infra || a.distance) n.stands++;
    if (a.overlap) n.overlap++;
    else if (a.outside) n.outside++;
    if (a.duplicate) n.duplicate++;
    if (a.infra) n.infra++;
    if (a.distance) n.distance++;
  }
  if (infra) for (const o of infra.objects) if (activeNarrow(o, infra.warnings, settings)) n.narrow++;
  return n;
}

/** Zahl am Page-Tab und in den Kennzahlen: Stände und Infrastruktur-Objekte mit Warnung (M7). */
export const warningTotal = (n: WarningCount) => n.stands + n.narrow;
/** Rot statt orange: Überlappung, Infrastruktur oder zu enge Durchfahrt (M7). */
export const warningSevere = (n: WarningCount) => n.overlap > 0 || n.infra > 0 || n.narrow > 0;

/**
 * Warnungen einer Page, zwischengespeichert je Liste der Stände (Immer liefert bei unveränderter Page
 * dieselbe Liste). Für die Zähler an den Page-Tabs, die alle Pages betrachten.
 */
const pageCache = new WeakMap<readonly Stand[], { areas: readonly Area[]; result: PageWarnings }>();
export function cachedPageWarnings(areas: readonly Area[], stands: readonly Stand[]): PageWarnings {
  const hit = pageCache.get(stands);
  if (hit && hit.areas === areas) return hit.result;
  const result = pageWarnings(areas, stands);
  pageCache.set(stands, { areas, result });
  return result;
}
