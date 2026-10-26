/**
 * Standnummern (M5, spec.md §5): Reihenfolge der Stände, Format, Neu-Nummerieren mit Vorschau und
 * doppelte Nummern.
 *
 * - Links → rechts: alle Stände der Page nach der x-Koordinate ihrer Mitte, unabhängig von den Grundflächen.
 * - Uhrzeigersinn: nach dem Winkel der Standmitte um den Mittelpunkt, ab der Startrichtung (relativ
 *   zum Norden der Page).
 * - Ohne Toleranz (QA-M5-01): Verglichen werden auf 0,01 m bzw. 0,1° gerundete Werte als ganze Zahlen. Eine
 *   Toleranz „bis 0,01 m gleich“ wäre nicht transitiv, das Ergebnis hinge dann von der Anlegereihenfolge ab.
 * - Nummernkreis „pro Festplatz“ oder „global“ (Pages in Tab-Reihenfolge, manuelle ausgelassen).
 * - Fixierte Nummern werden übersprungen und nie an einen anderen Stand desselben Nummernkreises vergeben.
 */
import { rectGeo } from './geometry/polygon';
import { normAngle } from './geometry/rect';
import type { ClockwiseSettings, FestplatzPage, Id, NumberingScope, Project, Stand, Vec } from './model/types';

/** Grenzen der Einstellungen. */
export const NUMBERING_LIMITS = { start: { min: 0, max: 99_999 }, digits: { min: 1, max: 4 } };
const clampInt = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(n)));
export const clampStart = (n: number) => clampInt(n, NUMBERING_LIMITS.start);
export const clampDigits = (n: number) => clampInt(n, NUMBERING_LIMITS.digits);

/** „A-“, 7, 2 → „A-07“. */
export const formatNr = (prefix: string, n: number, digits: number) => prefix + String(n).padStart(digits, '0');

/**
 * Vergleichsschlüssel einer Nummer: ohne Leerzeichen am Rand, ohne Groß/Klein, ohne führende Nullen in
 * Zahlen („A-012“ = „a-12“). Leere Nummer → ''.
 */
export const nrKey = (nr: string) =>
  nr
    .trim()
    .toLowerCase()
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ''));

/** Zwei Nummern gelten als gleich (leere nie). */
export const sameNr = (a: string, b: string) => nrKey(a) !== '' && nrKey(a) === nrKey(b);

// ---------- Reihenfolge ----------

/** Auf 0,01 m gerundet, in Zentimetern (ganze Zahl). */
const cm = (v: number) => Math.round(v * 100);
const byId = (a: Stand, b: Stand) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Links → rechts über den ganzen Festplatz, unabhängig von den Grundflächen (spec.md §5): Standmitte auf
 * 0,01 m gerundet; kleineres x zuerst, bei exakt gleichem x kleineres y (weiter oben), dann nach ID.
 */
export function orderLeftToRight(stands: readonly Stand[]): Stand[] {
  return stands
    .map((s) => ({ s, x: cm(s.cx), y: cm(s.cy) }))
    .toSorted((p, q) => p.x - q.x || p.y - q.y || byId(p.s, q.s))
    .map((k) => k.s);
}

/** Winkel von `p` um `c` in Grad im Uhrzeigersinn ab „oben“ auf dem Bildschirm (y nach unten). */
const screenAngle = (c: Vec, p: Vec) => normAngle((Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI);

/** Richtung des Startstrahls auf dem Bildschirm (Grad im Uhrzeigersinn ab oben). */
export const clockwiseStartDirection = (cw: ClockwiseSettings, northAngle: number) => normAngle(northAngle + cw.startAngle);

/**
 * Im Uhrzeigersinn um den Mittelpunkt, ab der Startrichtung (relativ zum Norden der Page). Standmitte und
 * Mittelpunkt auf 0,01 m gerundet, Winkel auf 0,1° (359,95° und mehr = 0°); bei gleichem Winkel der kleinere
 * Abstand (auf 0,01 m gerundet), dann nach ID.
 */
export function orderClockwise(stands: readonly Stand[], cw: ClockwiseSettings, northAngle: number): Stand[] {
  const start = clockwiseStartDirection(cw, northAngle);
  const c = { x: cm(cw.center.x) / 100, y: cm(cw.center.y) / 100 };
  const keyed = stands.map((s) => {
    const p = { x: cm(s.cx) / 100, y: cm(s.cy) / 100 };
    const dist = cm(Math.hypot(p.x - c.x, p.y - c.y));
    const tenths = dist > 0 ? Math.round(normAngle(screenAngle(c, p) - start) * 10) % 3600 : 0;
    return { s, tenths, dist };
  });
  keyed.sort((p, q) => p.tenths - q.tenths || p.dist - q.dist || byId(p.s, q.s));
  return keyed.map((k) => k.s);
}

/** Mitte des Hüllrechtecks aller Grundflächen und Stände (Vorgabe für den Mittelpunkt), sonst null. */
export function defaultClockwiseCenter(page: Pick<FestplatzPage, 'areas' | 'stands'>): Vec | null {
  const all = [...page.areas, ...page.stands];
  if (!all.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of all) {
    const b = rectGeo(r).bounds;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { x: Math.round(((minX + maxX) / 2) * 100) / 100, y: Math.round(((minY + maxY) / 2) * 100) / 100 };
}

/** Stände einer Page in Nummerierungsreihenfolge; im Modus „manuell“ leer. */
export function orderStands(page: FestplatzPage): Stand[] {
  if (page.numberingMode === 'manual') return [];
  if (page.numberingMode === 'clockwise') {
    const cw = page.clockwise ?? (defaultClockwiseCenter(page) ? { center: defaultClockwiseCenter(page)!, startAngle: 0 } : null);
    return cw ? orderClockwise(page.stands, cw, page.northAngle) : [];
  }
  return orderLeftToRight(page.stands);
}

// ---------- Doppelte Nummern ----------

export interface NrRef {
  pageId: Id;
  standId: Id;
}

/** Nummernkreis eines Stands: bei „global“ das Projekt, sonst die Page. */
const circleKey = (scope: NumberingScope, pageId: Id) => (scope === 'global' ? '' : pageId);

/**
 * Doppelte Nummern je Nummernkreis: Stand-ID → die anderen Stände mit gleicher Nummer.
 * `override` ersetzt Nummern (für die Vorschau des Neu-Nummerierens).
 */
export function findDuplicates(pages: readonly FestplatzPage[], scope: NumberingScope, override?: ReadonlyMap<Id, string>): Map<Id, NrRef[]> {
  const groups = new Map<string, NrRef[]>();
  for (const page of pages) {
    for (const s of page.stands) {
      const key = nrKey(override?.get(s.id) ?? s.nr);
      if (!key) continue;
      const g = `${circleKey(scope, page.id)}\u0000${key}`;
      let list = groups.get(g);
      if (!list) groups.set(g, (list = []));
      list.push({ pageId: page.id, standId: s.id });
    }
  }
  const out = new Map<Id, NrRef[]>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const r of list) out.set(r.standId, list.filter((o) => o !== r));
  }
  return out;
}

/** Wie `findDuplicates`, zwischengespeichert je Liste der Pages (Immer liefert bei unverändertem Projekt dieselbe). */
const dupCache = new WeakMap<readonly FestplatzPage[], { scope: NumberingScope; result: Map<Id, NrRef[]> }>();
export function cachedDuplicates(pages: readonly FestplatzPage[], scope: NumberingScope): Map<Id, NrRef[]> {
  const hit = dupCache.get(pages);
  if (hit && hit.scope === scope) return hit.result;
  const result = findDuplicates(pages, scope);
  dupCache.set(pages, { scope, result });
  return result;
}

// ---------- Neu nummerieren ----------

export interface NrChange extends NrRef {
  old: string;
  next: string;
}

/** „Alle neu nummerieren“ oder „Nur Stände ohne Nummer“ (spec.md §5). */
export type RenumberMode = 'all' | 'missing';

export interface RenumberPlan {
  scope: NumberingScope;
  mode: RenumberMode;
  /** Betroffene Pages in Tab-Reihenfolge. */
  pageIds: Id[];
  /** Stände, deren Nummer sich ändert, in Nummerierungsreihenfolge. */
  changes: NrChange[];
  /** Fixierte Stände auf den betroffenen Pages (übersprungen). */
  fixed: number;
  /** Stände, die ihre Nummer behalten. */
  unchanged: number;
  /** Doppelte Nummern, die nach dem Übernehmen bleiben (Stand-ID → andere). */
  duplicates: Map<Id, NrRef[]>;
}

/** Pages des Nummernkreises der Page `pageId` (bei „global“ alle) und die davon neu zu nummerierenden. */
function circleOf(project: Pick<Project, 'pages' | 'settings'>, pageId: Id) {
  const global = project.settings.numbering.scope === 'global';
  const circle = global ? project.pages : project.pages.filter((p) => p.id === pageId);
  return { circle, targets: circle.filter((p) => p.numberingMode !== 'manual') };
}

/** Zahl einer Nummer: die letzte Ziffernfolge („A-012“ → 12, „12a“ → 12), ohne Ziffern null. */
export function nrNumber(nr: string): number | null {
  const m = /(\d+)\D*$/.exec(nr.trim());
  return m ? Number(m[1]) : null;
}

/** Vorauswahl im Dialog: „Nur Stände ohne Nummer“, sobald im Nummernkreis schon ein Stand eine Nummer hat. */
export function defaultRenumberMode(project: Pick<Project, 'pages' | 'settings'>, pageId: Id): RenumberMode {
  return circleOf(project, pageId).circle.some((p) => p.stands.some((s) => s.nr.trim())) ? 'missing' : 'all';
}

/**
 * Plan für „Neu nummerieren“: bei „pro Festplatz“ die Page `pageId`, bei „global“ alle Pages außer den
 * manuellen.
 * - `all`: alle nicht fixierten Stände in der Reihenfolge des Modus. Fixierte Nummern im selben Nummernkreis
 *   (bei „global“ auch alle Nummern manueller Pages) werden nie vergeben.
 * - `missing`: nur Stände ohne Nummer, fortlaufend ab der höchsten vergebenen Nummer im Nummernkreis
 *   (mindestens der Startnummer); Nummern, die im Nummernkreis schon vorkommen, werden übersprungen.
 */
export function planRenumber(project: Pick<Project, 'pages' | 'settings'>, pageId: Id, mode: RenumberMode = 'all'): RenumberPlan {
  const { scope, start, digits } = project.settings.numbering;
  const { circle, targets } = circleOf(project, pageId);
  const changes: NrChange[] = [];
  const override = new Map<Id, string>();
  let fixed = 0;
  let unchanged = 0;

  const keysOf = (pages: readonly FestplatzPage[], all: boolean) => {
    const keys = new Set<string>();
    for (const p of pages) for (const s of p.stands) if (all || s.nrLocked || p.numberingMode === 'manual') keys.add(nrKey(s.nr));
    keys.delete('');
    return keys;
  };
  const missing = mode === 'missing';
  const globalReserved = scope === 'global' ? keysOf(circle, missing) : null;
  const highest = (pages: readonly FestplatzPage[]) => {
    let max = start - 1;
    for (const p of pages) for (const s of p.stands) max = Math.max(max, nrNumber(s.nr) ?? -Infinity);
    return max + 1;
  };

  let counter = missing ? highest(circle) : start;
  for (const page of targets) {
    if (scope === 'perPage') counter = missing ? highest([page]) : start;
    const reserved = globalReserved ?? keysOf([page], missing);
    for (const s of orderStands(page)) {
      if (s.nrLocked) {
        fixed++;
        continue;
      }
      if (missing && s.nr.trim()) {
        unchanged++;
        continue;
      }
      let next = formatNr(page.prefix, counter++, digits);
      while (reserved.has(nrKey(next))) next = formatNr(page.prefix, counter++, digits);
      if (next === s.nr) unchanged++;
      else {
        changes.push({ pageId: page.id, standId: s.id, old: s.nr, next });
        override.set(s.id, next);
      }
    }
  }
  return { scope, mode, pageIds: targets.map((p) => p.id), changes, fixed, unchanged, duplicates: findDuplicates(project.pages, scope, override) };
}
