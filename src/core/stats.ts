/**
 * Kennzahlen der Start-Page (M6, spec.md §7): je Festplatz und gesamt Anzahl Geschäfte, Frontmeter (Summe der
 * Breiten bzw. bei Belegung wie gezeichnet der Frontmeter nach #16; das ist die „belegte Fläche“), freie Frontmeter (Summe der Breiten der angezeigten Freiflächen, M6-11),
 * Strom (§6) und Warnzahl; seit M7 Anzahl je Infrastruktur-Typ, Strom der Infrastruktur und deren Warnungen;
 * seit M11 (#7) Anzahl, Frontmeter und Strom je Kategorie. Pages ohne Grundflächen (#17) haben keine freien
 * Frontmeter (null, Anzeige „–“) und zählen in deren Summe nicht mit.
 * Warnungen und doppelte Nummern kommen aus den
 * vorhandenen Zwischenspeichern, unveränderte Pages kosten nichts.
 */
import { feesOf, NO_FEE_SUM, sumFees, type FeeSum } from './fee';
import type { AreaFreeSpaces } from './freeSpace';
import { cachedDuplicates, type NrRef } from './numbering';
import { CONNECTION_KEYS, pagePower, type ConnectionKey, type PowerSummary } from './power';
import { outsideRef, usesAreas } from './pageAreas';
import { cachedDistanceWarnings, cachedInfraWarnings, cachedPageWarnings, countWarnings, NO_WARNINGS, type WarningCount, type WarnSettings } from './warnings';
import { frontMeters, pageStands, type FrontStand } from './footprint';
import type { FestplatzPage, Id, Project, ProjectSettings, Stand } from './model/types';

/** Summe auf 0,01 m gerundet (Speichergenauigkeit), ohne Gleitkomma-Reste. */
export const sumWidths = (stands: readonly Pick<Stand, 'w'>[]) => Math.round(stands.reduce((n, s) => n + s.w * 100, 0)) / 100;

/** Frontmeter der Stände (#16: bei Belegung wie gezeichnet `frontMeters`, sonst die Breite), auf 0,01 m gerundet. */
export const sumFront = (stands: readonly FrontStand[]) => Math.round(stands.reduce((n, s) => n + Math.round(frontMeters(s) * 100), 0)) / 100;

/** Freie Frontmeter: Breiten der angezeigten Freiflächen (ab Mindestbreite; angeschnittene mit Hüllbreite). */
export const freeFrontMeters = (free: readonly AreaFreeSpaces[]) => sumWidths(free.flatMap((a) => a.free.map((f) => ({ w: f.width }))));

/** Freiflächen einer Page (der Aufrufer reicht seinen Zwischenspeicher durch). */
export type FreeOf = (page: FestplatzPage) => readonly AreaFreeSpaces[];

/** Schlüssel für Stände ohne (gültige) Kategorie in `byCategory`. */
export const NO_CATEGORY = '';

export interface CategoryFigures {
  count: number;
  frontM: number;
  kw: number;
}

/** Kennzahlen je Kategorie-ID bzw. `NO_CATEGORY` (nur vorkommende). */
export type ByCategory = Record<Id, CategoryFigures>;

/**
 * Anzahl, Frontmeter und Strom (nur Stände) je Kategorie (#7). IDs, die es nicht (mehr) gibt, zählen als „ohne“.
 * Frontmeter und kW werden in ganzen cm bzw. W summiert, damit keine Gleitkomma-Reste entstehen.
 */
export function categoryFigures(stands: readonly (FrontStand & Pick<Stand, 'powerKw' | 'categoryId'>)[], categoryIds: ReadonlySet<Id>): ByCategory {
  const acc: Record<Id, { count: number; cm: number; w: number }> = {};
  for (const s of stands) {
    const k = s.categoryId !== null && categoryIds.has(s.categoryId) ? s.categoryId : NO_CATEGORY;
    const a = (acc[k] ??= { count: 0, cm: 0, w: 0 });
    a.count++;
    a.cm += Math.round(frontMeters(s) * 100);
    a.w += Math.round(s.powerKw * 1000);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, { count: a.count, frontM: a.cm / 100, kw: a.w / 1000 }]));
}

export interface PageStats {
  pageId: Id;
  name: string;
  stands: number;
  frontM: number;
  /** null: Page ohne Grundflächen (#17), es gibt keine Freiflächen. */
  freeFrontM: number | null;
  power: PowerSummary;
  warnings: WarningCount;
  /** Anzahl Infrastruktur-Objekte je Typ-ID (nur vorkommende Typen). */
  infraByType: Record<Id, number>;
  byCategory: ByCategory;
  /** Standgeld (#5) der Stände mit Preis. */
  fee: FeeSum;
}

export interface ProjectStats {
  pages: PageStats[];
  total: {
    stands: number;
    frontM: number;
    /** Summe über die Pages mit Grundflächen; null, wenn keine Page Grundflächen verwendet (#17). */
    freeFrontM: number | null;
    sumKw: number;
    byConnection: Record<ConnectionKey, { count: number; kw: number }>;
    warnings: WarningCount;
    infraByType: Record<Id, number>;
    infraKw: number;
    byCategory: ByCategory;
    fee: FeeSum;
  };
}

/** Was die Kennzahlen aus dem Projekt brauchen. */
export type StatsProject = Pick<Project, 'pages' | 'infraTypes' | 'categories'> & Partial<Pick<Project, 'shapeTemplates'>> & { settings: WarnSettings & Pick<ProjectSettings, 'minPassageWidth' | 'numbering' | 'pricing'> };

export function pageStats(page: FestplatzPage, project: Omit<StatsProject, 'pages'>, duplicates: ReadonlyMap<Id, readonly NrRef[]>, freeOf: FreeOf, categoryIds: ReadonlySet<Id> = new Set(project.categories.map((c) => c.id))): PageStats {
  const { settings } = project;
  // Stände, wie sie belegen (#16): Vorlagen mit „belegt wie gezeichnet“ eingesetzt
  const stands = pageStands(page, project.shapeTemplates ?? []);
  const infraByType: Record<Id, number> = {};
  for (const o of page.infra) infraByType[o.typeId] = (infraByType[o.typeId] ?? 0) + 1;
  return {
    pageId: page.id,
    name: page.name,
    stands: page.stands.length,
    frontM: sumFront(stands),
    freeFrontM: usesAreas(page) ? freeFrontMeters(freeOf(page)) : null,
    power: pagePower(page),
    warnings: countWarnings(cachedPageWarnings(outsideRef(page), stands), stands, settings, duplicates, {
      warnings: cachedInfraWarnings({ stands, infra: page.infra }, project.infraTypes, settings.minPassageWidth),
      objects: page.infra,
    }, cachedDistanceWarnings(stands, project.categories)),
    infraByType,
    byCategory: categoryFigures(stands, categoryIds),
    fee: sumFees(feesOf(stands, project.categories, settings.pricing)),
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function projectStats(project: StatsProject, freeOf: FreeOf): ProjectStats {
  const dups = cachedDuplicates(project.pages, project.settings.numbering.scope);
  const categoryIds = new Set(project.categories.map((c) => c.id));
  const pages = project.pages.map((p) => pageStats(p, project, dups, freeOf, categoryIds));
  const byCategory: ByCategory = {};
  const infraByType: Record<Id, number> = {};
  let infraKw = 0;
  const byConnection = Object.fromEntries(CONNECTION_KEYS.map((k) => [k, { count: 0, kw: 0 }])) as ProjectStats['total']['byConnection'];
  const warnings: WarningCount = { ...NO_WARNINGS };
  let frontCm = 0;
  let freeCm = 0;
  let withAreas = 0;
  let kw = 0;
  let fee: FeeSum = NO_FEE_SUM;
  for (const p of pages) {
    fee = { net: (Math.round(fee.net * 100) + Math.round(p.fee.net * 100)) / 100, gross: (Math.round(fee.gross * 100) + Math.round(p.fee.gross * 100)) / 100, count: fee.count + p.fee.count };
    frontCm += Math.round(p.frontM * 100);
    if (p.freeFrontM !== null) {
      freeCm += Math.round(p.freeFrontM * 100);
      withAreas++;
    }
    kw += p.power.sumKw;
    for (const k of CONNECTION_KEYS) {
      byConnection[k].count += p.power.byConnection[k].count;
      byConnection[k].kw += p.power.byConnection[k].kw;
    }
    for (const k of ['stands', 'outside', 'overlap', 'duplicate', 'infra', 'narrow', 'distance'] as const) warnings[k] += p.warnings[k];
    for (const [id, n] of Object.entries(p.infraByType)) infraByType[id] = (infraByType[id] ?? 0) + n;
    infraKw += p.power.infraKw;
    for (const [id, c] of Object.entries(p.byCategory)) {
      const t = (byCategory[id] ??= { count: 0, frontM: 0, kw: 0 });
      t.count += c.count;
      t.frontM = (Math.round(t.frontM * 100) + Math.round(c.frontM * 100)) / 100;
      t.kw = (Math.round(t.kw * 1000) + Math.round(c.kw * 1000)) / 1000;
    }
  }
  for (const k of CONNECTION_KEYS) byConnection[k].kw = round3(byConnection[k].kw);
  return {
    pages,
    total: { stands: pages.reduce((n, p) => n + p.stands, 0), frontM: frontCm / 100, freeFrontM: withAreas || !pages.length ? freeCm / 100 : null, sumKw: round3(kw), byConnection, warnings, infraByType, infraKw: round3(infraKw), byCategory, fee },
  };
}
