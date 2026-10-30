/**
 * Objekte einer Festplatz-Page (Grundflächen, Geschäfte, ab M7 Infrastruktur): anlegen, finden, kopieren (M3).
 */
import { newId } from './id';
import type { Area, Category, FestplatzPage, Id, InfraObject, LayerId, Rect, Stand } from './model/types';

export type ObjectKind = 'area' | 'stand' | 'infra';

/** Standardmaße und Grenzen. */
export const AREA_DEFAULT = { w: 20, d: 8 };
export const STAND_DEFAULT = { w: 3, d: 3 };
export const LIMITS: Record<ObjectKind, { min: number; max: number }> = {
  area: { min: 0.5, max: 2000 },
  stand: { min: 0.1, max: 100 },
  /** Infrastruktur: Grenzen je Geometrie in core/infra.ts (`INFRA_LIMITS`). */
  infra: { min: 0, max: 2000 },
};
export const LAYER_OF: Record<ObjectKind, LayerId> = { area: 'areas', stand: 'stands', infra: 'infra' };

/**
 * Beim Aufziehen zählt eine Geste mit weniger als 0,5 m in einer Richtung als Klick (Standardmaß),
 * damit versehentlich flache Rechtecke wie 10 × 0,1 m nicht entstehen (QA-M3-L2).
 */
export const MIN_DRAW_SIZE = 0.5;

/** Standardfarbe neuer Projekte für Stände ohne Kategorie und eigene Farbe (bis Formatversion 5 fest). */
export const DEFAULT_STAND_COLOR = '#a7adb3';

/** Füllfarbe eines Stands: eigene Farbe > Kategoriefarbe > Standardfarbe des Projekts (§3, #3). */
export const resolveStandColor = (s: Pick<Stand, 'color'>, cat: Category | undefined, defaultColor: string): string =>
  s.color ?? cat?.color ?? defaultColor;

/** Feste Farbpalette für Kategorien und eigene Standfarben. */
export const PALETTE = ['#e57373', '#f0a35e', '#f2d15c', '#9ccc65', '#4db6ac', '#4fc3f7', '#7986cb', '#ba68c8', '#f06292', '#a1887f', '#90a4ae', '#ffffff'];

export function createArea(rect: Rect, name = ''): Area {
  return { id: newId(), name, cx: rect.cx, cy: rect.cy, w: rect.w, d: rect.d, rot: rect.rot };
}

export function createStand(rect: Rect, fields: Partial<Omit<Stand, 'id'>> = {}): Stand {
  return {
    id: newId(),
    nr: '',
    nrLocked: false,
    name: '',
    owner: '',
    ware: '',
    powerKw: 0,
    connection: null,
    note: '',
    categoryId: null,
    color: null,
    suppressOutsideWarning: false,
    suppressOverlapWarning: false,
    suppressDuplicateWarning: false,
    suppressInfraWarning: false,
    suppressDistanceWarning: false,
    shape: 'rect',
    shapeTemplateId: null,
    ...fields,
    cx: rect.cx,
    cy: rect.cy,
    w: rect.w,
    d: rect.d,
    rot: rect.rot,
  };
}

export type PageObject = { kind: 'area'; obj: Area } | { kind: 'stand'; obj: Stand } | { kind: 'infra'; obj: InfraObject };

export function findObject(page: FestplatzPage, id: Id): PageObject | null {
  const a = page.areas.find((x) => x.id === id);
  if (a) return { kind: 'area', obj: a };
  const s = page.stands.find((x) => x.id === id);
  if (s) return { kind: 'stand', obj: s };
  const i = page.infra.find((x) => x.id === id);
  return i ? { kind: 'infra', obj: i } : null;
}

export function findObjects(page: FestplatzPage, ids: readonly Id[]): PageObject[] {
  return ids.map((id) => findObject(page, id)).filter((o): o is PageObject => !!o);
}

/** Darf ein Objekt dieser Art ausgewählt werden (Ebene sichtbar und nicht gesperrt)? */
export const selectable = (page: FestplatzPage, kind: ObjectKind) => {
  const l = page.layers[LAYER_OF[kind]];
  return l.visible && !l.locked;
};

/** Zwischenablage: Kopien der Objekte und die Page, von der sie stammen. */
export interface Clipboard {
  areas: Area[];
  stands: Stand[];
  infra: InfraObject[];
  sourcePageId: Id;
}

/**
 * Kopien mit neuen IDs, um (dx, dy) verschoben. Kopierte Stände bekommen eine leere, nicht fixierte
 * Platznummer, damit keine Nummer doppelt vorkommt.
 */
export function cloneObjects(
  areas: readonly Area[],
  stands: readonly Stand[],
  dx: number,
  dy: number,
  infra: readonly InfraObject[] = [],
): { areas: Area[]; stands: Stand[]; infra: InfraObject[] } {
  return {
    areas: areas.map((a) => ({ ...structuredClone(a), id: newId(), cx: a.cx + dx, cy: a.cy + dy })),
    stands: stands.map((s) => ({ ...structuredClone(s), id: newId(), cx: s.cx + dx, cy: s.cy + dy, nr: '', nrLocked: false })),
    infra: infra.map((o) => ({ ...structuredClone(o), id: newId(), cx: o.cx + dx, cy: o.cy + dy })),
  };
}
