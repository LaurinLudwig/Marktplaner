/**
 * Infrastruktur-Objekte (spec.md §11): Typen, Geometrie je Typ, Standardmaße.
 *
 * Gespeichert wird immer ein Rechteck. Linien: `w` = Länge entlang der lokalen x-Achse (Richtung `rot`),
 * `d` = Strichstärke (auch 0). Punkte: `w` = `d` = 0.
 */
import { boundsTouch, distToRect, penetration, rectGeo } from './geometry/polygon';
import { fromLocal, normAngle, roundRect, toLocal } from './geometry/rect';
import { EPS, exceedsTol, lessThan, TOL } from './geometry/tolerance';
import { vec } from './geometry/vec';
import { newId } from './id';
import type { FestplatzPage, Id, InfraGeometry, InfraObject, InfraTypeDef, Rect, Stand, Vec } from './model/types';
import { MIN_DRAW_SIZE } from './objects';

/**
 * Symbole, aus denen eigene Typen wählen können (Material Symbols, lokal gebündelt, siehe ui/icons/Icon.tsx).
 * Enthält auch die Symbole der festen Typen.
 */
export const INFRA_ICONS = [
  'fence',
  'block',
  'medical_services',
  'ambulance',
  'wc',
  'delete',
  'arrow_range',
  'location_on',
  'local_hospital',
  'health_and_safety',
  'emergency',
  'fire_truck',
  'local_fire_department',
  'warning',
  'traffic',
  'road',
  'gate',
  'door_sliding',
  'signpost',
  'stadium',
  'mic',
  'theater_comedy',
  'celebration',
  'storefront',
  'info',
  'campaign',
  'family_restroom',
  'chair',
  'water_drop',
  'bolt',
  'electrical_services',
  'recycling',
  'flag',
] as const;
export type InfraIcon = (typeof INFRA_ICONS)[number];

export const isInfraIcon = (v: unknown): v is InfraIcon => typeof v === 'string' && (INFRA_ICONS as readonly string[]).includes(v);

export const GEOMETRIES: readonly InfraGeometry[] = ['rect', 'line', 'point'];

/** Grenzen der Maße je Geometrie (Zahlenfelder, Griffe, Prüfung beim Öffnen). */
export const INFRA_LIMITS = {
  rect: { w: { min: 0.5, max: 2000 }, d: { min: 0.5, max: 2000 } },
  line: { w: { min: 0.5, max: 2000 }, d: { min: 0, max: 5 } },
  point: { w: { min: 0, max: 0 }, d: { min: 0, max: 0 } },
} as const;

/** Symbolgröße eines Markers (Punkt) in Metern: 2,5-fache Schriftgröße der Beschriftung (§11). */
export const markerSize = (labelFontSize: number) => labelFontSize * 2.5;

/** ID der engen Durchfahrt; nur sie wird auf die Mindestbreite geprüft (§11). */
export const PASSAGE_TYPE_ID = 'narrowPassage';

export function typeMap(types: readonly InfraTypeDef[]): Map<Id, InfraTypeDef> {
  return new Map(types.map((t) => [t.id, t]));
}

export const clampToLimits = (v: number, lim: { min: number; max: number }) => Math.min(lim.max, Math.max(lim.min, v));

/** Endpunkte einer Linie (Mittellinie entlang `w`): lokal (−w/2, 0) und (w/2, 0). */
export function lineEnds(o: Rect): [Vec, Vec] {
  return [fromLocal(o, vec(-o.w / 2, 0)), fromLocal(o, vec(o.w / 2, 0))];
}

/** Neues Objekt eines Typs; Maße werden auf die Grenzen der Geometrie gebracht und gerundet. */
export function createInfra(type: InfraTypeDef, rect: Rect, fields: Partial<Omit<InfraObject, 'id' | 'typeId'>> = {}): InfraObject {
  return {
    id: newId(),
    typeId: type.id,
    label: '',
    note: '',
    powerKw: 0,
    connection: null,
    suppressWidthWarning: false,
    ...fields,
    ...fitRect(type.geometry, rect),
  };
}

/** Rechteck auf die Grenzen der Geometrie bringen und runden (Punkte: ohne Maße und Drehung). */
export function fitRect(geometry: InfraGeometry, r: Rect): Rect {
  const lim = INFRA_LIMITS[geometry];
  if (geometry === 'point') return roundRect({ cx: r.cx, cy: r.cy, w: 0, d: 0, rot: 0 });
  return roundRect({ cx: r.cx, cy: r.cy, w: clampToLimits(r.w, lim.w), d: clampToLimits(r.d, lim.d), rot: normAngle(r.rot) });
}

/**
 * Lage bei einem Klick mit dem Infrastruktur-Werkzeug (§11): Rechteck mit der Mitte an der Klickstelle,
 * Linie waagerecht mit dem Anfangspunkt an der Klickstelle, Punkt an der Klickstelle.
 */
export function clickRect(type: InfraTypeDef, p: Vec): Rect {
  if (type.geometry === 'line') return fitRect('line', { cx: p.x + type.defaultW / 2, cy: p.y, w: type.defaultW, d: type.defaultD, rot: 0 });
  return fitRect(type.geometry, { cx: p.x, cy: p.y, w: type.defaultW, d: type.defaultD, rot: 0 });
}

/**
 * Lage beim Aufziehen von a nach b, oder null, wenn die Geste als Klick zählt (unter 0,5 m in einer
 * Richtung bzw. bei Linien unter 0,5 m Länge; Punkte immer).
 */
export function dragRect(type: InfraTypeDef, a: Vec, b: Vec): Rect | null {
  if (type.geometry === 'point') return null;
  if (type.geometry === 'line') {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < MIN_DRAW_SIZE) return null;
    const rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return fitRect('line', { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: length, d: type.defaultD, rot });
  }
  const w = Math.abs(b.x - a.x);
  const d = Math.abs(b.y - a.y);
  if (w < MIN_DRAW_SIZE || d < MIN_DRAW_SIZE) return null;
  return fitRect('rect', { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w, d, rot: 0 });
}

/** Linie mit neuen Endpunkten (Endpunkt-Griffe); die Stärke bleibt. */
export function lineFromEnds(o: Rect, a: Vec, b: Vec): Rect {
  const length = Math.max(INFRA_LIMITS.line.w.min, Math.hypot(b.x - a.x, b.y - a.y));
  const rot = Math.hypot(b.x - a.x, b.y - a.y) > EPS ? (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI : o.rot;
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: length, d: o.d, rot: normAngle(rot) };
}

/**
 * Linien ohne Stärke belegen die Achse einer Grundfläche als Streifen dieser Breite (§4): So zählt ihre
 * Projektion, und die Eindringtiefe liegt sicher über der Toleranz.
 */
export const ZERO_LINE_OCCUPY = 0.05;

/** Verbreiterte Linien je Objekt: gleiche Identität, solange das Objekt gleich bleibt (Zwischenspeicher der Freiflächen). */
const widened = new WeakMap<InfraObject, Rect & { id: Id }>();

/** Objekte, die Grundflächen belegen (§4), als Rechtecke für die Freiflächen-Berechnung. */
export function occupyingRects(infra: readonly InfraObject[], types: ReadonlyMap<Id, InfraTypeDef>): (Rect & { id: Id })[] {
  const out: (Rect & { id: Id })[] = [];
  for (const o of infra) {
    const t = types.get(o.typeId);
    if (!t?.occupiesArea || t.geometry === 'point') continue;
    if (t.geometry === 'line' && o.d < ZERO_LINE_OCCUPY) {
      let w = widened.get(o);
      if (!w) widened.set(o, (w = { ...o, d: ZERO_LINE_OCCUPY }));
      out.push(w);
    } else out.push(o);
  }
  return out;
}

const occupantCache = new WeakMap<readonly InfraObject[], { stands: readonly Stand[]; types: readonly InfraTypeDef[]; result: readonly (Rect & { id: Id })[] }>();

/** Alles, was Grundflächen belegt: Stände und belegende Infrastruktur (zwischengespeichert je Page-Listen). */
export function pageOccupants(page: Pick<FestplatzPage, 'stands' | 'infra'>, types: readonly InfraTypeDef[]): readonly (Rect & { id: Id })[] {
  if (!page.infra.length) return page.stands;
  const hit = occupantCache.get(page.infra);
  if (hit && hit.stands === page.stands && hit.types === types) return hit.result;
  const occ = occupyingRects(page.infra, typeMap(types));
  const result = occ.length ? [...page.stands, ...occ] : page.stands;
  occupantCache.set(page.infra, { stands: page.stands, types, result });
  return result;
}

/** Länge des Abschnitts a–b, der im Rechteck r liegt (Clipping in lokalen Koordinaten). */
export function segmentLengthInRect(r: Rect, a: Vec, b: Vec): number {
  const p = toLocal(r, a);
  const q = toLocal(r, b);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (den: number, num: number) => {
    // Bedingung den · t ≤ num
    if (Math.abs(den) < 1e-15) return num >= 0;
    const t = num / den;
    if (den > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
    return t0 <= t1;
  };
  const hw = r.w / 2;
  const hd = r.d / 2;
  if (!clip(dx, hw - p.x) || !clip(-dx, hw + p.x) || !clip(dy, hd - p.y) || !clip(-dy, hd + p.y)) return 0;
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}

/**
 * Dringt der Stand mehr als TOL in das Objekt ein (Warnung „Infrastruktur“, §11)? Rechtecke und Linien mit
 * Stärke wie die Überlappung zweier Stände; Linien ohne Stärke: Die Linie reicht mehr als TOL in den Stand hinein
 * (ein Teil liegt im um TOL verkleinerten Stand). Eine Linie auf der Standkante zählt so nicht.
 */
export function standInObject(stand: Stand, o: InfraObject, geometry: InfraGeometry): boolean {
  if (geometry === 'point') return false;
  const sg = rectGeo(stand);
  if (geometry === 'line' && o.d <= EPS) {
    const [a, b] = lineEnds(o);
    const lb = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const m = 2 * (TOL + EPS);
    if (!boundsTouch(sg.bounds, lb) || stand.w <= m || stand.d <= m) return false;
    return segmentLengthInRect({ ...stand, w: stand.w - m, d: stand.d - m }, a, b) > EPS;
  }
  const og = rectGeo(o);
  return boundsTouch(sg.bounds, og.bounds) && exceedsTol(penetration(sg.poly, og.poly));
}

/** Objekte mit „freihalten“, in die ein Stand eindringt: Stand-ID → Objekt-IDs. */
export function infraConflicts(stands: readonly Stand[], infra: readonly InfraObject[], types: ReadonlyMap<Id, InfraTypeDef>): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  const clear = infra.filter((o) => types.get(o.typeId)?.keepClear);
  if (!clear.length) return out;
  for (const s of stands) {
    for (const o of clear) {
      if (!standInObject(s, o, types.get(o.typeId)!.geometry)) continue;
      const list = out.get(s.id);
      if (list) list.push(o.id);
      else out.set(s.id, [o.id]);
    }
  }
  return out;
}

/** Ist die lichte Breite der Durchfahrt kleiner als die Mindestbreite (beide auf 0,01 m gerundet)? */
export function passageTooNarrow(o: Pick<InfraObject, 'typeId' | 'w'>, minWidth: number): boolean {
  return o.typeId === PASSAGE_TYPE_ID && lessThan(Math.round(o.w * 100) / 100, Math.round(minWidth * 100) / 100);
}

/**
 * Trifft p das Objekt? Rechtecke: Fläche (plus `tol`); Linien: Abstand zur Linie höchstens halbe Stärke
 * plus `line`; Punkte: das Symbol über dem Punkt (Spitze unten), `point` = halbe Symbolgröße. Toleranzen in Metern.
 */
export function hitInfra(o: InfraObject, geometry: InfraGeometry, p: Vec, tol: { rect: number; line: number; point: number }): boolean {
  if (geometry === 'point') return Math.abs(p.x - o.cx) <= tol.point && p.y <= o.cy + tol.rect && p.y >= o.cy - 2 * tol.point;
  if (geometry === 'line') return distToRect(o, p) <= tol.line;
  return distToRect(o, p) <= tol.rect;
}
