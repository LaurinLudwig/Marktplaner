/**
 * Standnummern (M5, spec.md §5): Reihenfolge der Stände, Format, Neu-Nummerieren mit Vorschau und
 * doppelte Nummern.
 *
 * - Linear (links → rechts, rechts → links, oben → unten, unten → oben, eigene Richtung A → B, #12): alle Stände
 *   der Page nach der Lage ihrer Mitte entlang der Richtung, unabhängig von den Grundflächen (`orderAlong`).
 * - Im bzw. gegen den Uhrzeigersinn: nach dem Winkel der Standmitte um den Mittelpunkt, ab der Startrichtung
 *   (relativ zum Norden der Page).
 * - Ohne Toleranz (QA-M5-01): Verglichen werden auf 0,01 m bzw. 0,1° gerundete Werte als ganze Zahlen. Eine
 *   Toleranz „bis 0,01 m gleich“ wäre nicht transitiv, das Ergebnis hinge dann von der Anlegereihenfolge ab.
 * - Nummernkreis „pro Festplatz“ oder „global“ (Pages in Tab-Reihenfolge, manuelle ausgelassen).
 * - Fixierte Nummern werden übersprungen und nie an einen anderen Stand desselben Nummernkreises vergeben.
 */
import { rectGeo } from './geometry/polygon';
import { normAngle } from './geometry/rect';
import type { ClockwiseSettings, FestplatzPage, Id, NumberingDirection, NumberingMode, NumberingScope, Project, Rect, Stand, Vec } from './model/types';
import { activeAreas, type AreasOf } from './pageAreas';

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
 * Achsen einer linearen Nummerierung, als ganzzahlige Vektoren: sortiert wird nach dem Skalarprodukt der Standmitte
 * (in ganzen Zentimetern) mit `main`, bei Gleichstand mit `cross`, danach nach ID. Ganzzahlig, damit das Ergebnis
 * ohne Toleranz und unabhängig von der Anlegereihenfolge ist (QA-M5-01).
 */
export interface LinearAxes {
  main: Vec;
  cross: Vec;
}

/** Feste Richtungen an den Achsen der Zeichenfläche (y nach unten; Entscheidung Laurin 2026-11-05, #12). */
export type FixedDirectionMode = 'frontLtr' | 'rightToLeft' | 'topToBottom' | 'bottomToTop';
export const FIXED_AXES: Readonly<Record<FixedDirectionMode, LinearAxes>> = {
  // links → rechts: kleineres x zuerst, bei gleichem x kleineres y
  frontLtr: { main: { x: 1, y: 0 }, cross: { x: 0, y: 1 } },
  // rechts → links: größeres x zuerst, bei gleichem x kleineres y
  rightToLeft: { main: { x: -1, y: 0 }, cross: { x: 0, y: 1 } },
  // oben → unten: kleineres y zuerst, bei gleichem y kleineres x
  topToBottom: { main: { x: 0, y: 1 }, cross: { x: 1, y: 0 } },
  // unten → oben: größeres y zuerst, bei gleichem y kleineres x
  bottomToTop: { main: { x: 0, y: -1 }, cross: { x: 1, y: 0 } },
};

/** Lineare Modi (feste Richtungen und eigene Richtung). */
export const isLinearMode = (mode: NumberingMode): mode is FixedDirectionMode | 'direction' =>
  mode === 'direction' || mode === 'frontLtr' || mode === 'rightToLeft' || mode === 'topToBottom' || mode === 'bottomToTop';
/** Modi um einen Mittelpunkt. */
export const isCircularMode = (mode: NumberingMode): mode is 'clockwise' | 'counterClockwise' => mode === 'clockwise' || mode === 'counterClockwise';

/**
 * Achsen der eigenen Richtung A → B: Hauptachse = B − A in ganzen Zentimetern (Punkte auf 0,01 m gerundet),
 * Nebenachse senkrecht dazu, so dass bei Gleichstand der Stand links der Richtung (vom Pfeil aus gesehen) zuerst
 * kommt. Liegen A und B nach dem Runden aufeinander, gibt es keine Richtung: null.
 */
export function directionAxes(dir: NumberingDirection): LinearAxes | null {
  const main = { x: cm(dir.to.x) - cm(dir.from.x), y: cm(dir.to.y) - cm(dir.from.y) };
  if (main.x === 0 && main.y === 0) return null;
  // Rechts der Richtung liegt auf dem Bildschirm (y nach unten) bei (−y, x); aufsteigend sortiert kommt links zuerst
  return { main, cross: { x: -main.y, y: main.x } };
}

/**
 * Lineare Reihenfolge (spec.md §5): Standmitte auf 0,01 m gerundet und als ganze Zentimeter mit den Achsen
 * multipliziert; kleinster Wert auf der Hauptachse zuerst, dann auf der Nebenachse, dann nach ID. Die Lage der Punkte
 * selbst spielt keine Rolle, nur die Richtung (Stände vor A oder hinter B zählen genauso).
 */
export function orderAlong(stands: readonly Stand[], axes: LinearAxes): Stand[] {
  const { main, cross } = axes;
  return stands
    .map((s) => {
      const x = cm(s.cx);
      const y = cm(s.cy);
      return { s, m: x * main.x + y * main.y, c: x * cross.x + y * cross.y };
    })
    .toSorted((p, q) => p.m - q.m || p.c - q.c || byId(p.s, q.s))
    .map((k) => k.s);
}

/**
 * Links → rechts über den ganzen Festplatz, unabhängig von den Grundflächen (spec.md §5): Standmitte auf
 * 0,01 m gerundet; kleineres x zuerst, bei exakt gleichem x kleineres y (weiter oben), dann nach ID.
 */
export const orderLeftToRight = (stands: readonly Stand[]): Stand[] => orderAlong(stands, FIXED_AXES.frontLtr);

/** Winkel von `p` um `c` in Grad im Uhrzeigersinn ab „oben“ auf dem Bildschirm (y nach unten). */
const screenAngle = (c: Vec, p: Vec) => normAngle((Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI);

/** Richtung des Startstrahls auf dem Bildschirm (Grad im Uhrzeigersinn ab oben). */
export const clockwiseStartDirection = (cw: ClockwiseSettings, northAngle: number) => normAngle(northAngle + cw.startAngle);

/** Drehsinn: 1 = im Uhrzeigersinn, −1 = gegen den Uhrzeigersinn. */
export type TurnSense = 1 | -1;

/**
 * Um den Mittelpunkt, ab der Startrichtung (relativ zum Norden der Page); `sense` 1 = im Uhrzeigersinn (aufsteigender
 * Winkel), −1 = gegen den Uhrzeigersinn (absteigender Winkel). Standmitte und Mittelpunkt auf 0,01 m gerundet,
 * Winkel auf 0,1° (359,95° und mehr = 0°); bei gleichem Winkel der kleinere Abstand (auf 0,01 m gerundet), dann
 * nach ID. Gegen den Uhrzeigersinn wird der gerundete Winkel gespiegelt (3600 − Zehntel), damit beide Drehsinne
 * genau dieselben Gleichstände haben.
 */
export function orderClockwise(stands: readonly Stand[], cw: ClockwiseSettings, northAngle: number, sense: TurnSense = 1): Stand[] {
  const start = clockwiseStartDirection(cw, northAngle);
  const c = { x: cm(cw.center.x) / 100, y: cm(cw.center.y) / 100 };
  const keyed = stands.map((s) => {
    const p = { x: cm(s.cx) / 100, y: cm(s.cy) / 100 };
    const dist = cm(Math.hypot(p.x - c.x, p.y - c.y));
    const cwTenths = dist > 0 ? Math.round(normAngle(screenAngle(c, p) - start) * 10) % 3600 : 0;
    const tenths = sense === 1 ? cwTenths : (3600 - cwTenths) % 3600;
    return { s, tenths, dist };
  });
  keyed.sort((p, q) => p.tenths - q.tenths || p.dist - q.dist || byId(p.s, q.s));
  return keyed.map((k) => k.s);
}

/** Hüllrechteck der Rechtecke, sonst null. */
function boundsOf(rects: readonly Rect[]) {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    const b = rectGeo(r).bounds;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}
const round2 = (v: number) => cm(v) / 100;

/** Mitte des Hüllrechtecks aller (wirkenden, #17) Grundflächen und Stände (Vorgabe für den Mittelpunkt), sonst null. */
export function defaultClockwiseCenter(page: AreasOf & Pick<FestplatzPage, 'stands'>): Vec | null {
  const b = boundsOf([...activeAreas(page), ...page.stands]);
  return b ? { x: round2((b.minX + b.maxX) / 2), y: round2((b.minY + b.maxY) / 2) } : null;
}

/**
 * Vorgabe für die eigene Richtung beim ersten Umschalten (#12): waagrecht durch die Mitte aller Stände, von ihrem
 * linken bis zum rechten Rand – nummeriert also wie „links → rechts“. Ohne Stände über die (wirkenden, #17)
 * Grundflächen, ohne beides null.
 */
export function defaultDirection(page: AreasOf & Pick<FestplatzPage, 'stands'>): NumberingDirection | null {
  const b = boundsOf(page.stands.length ? page.stands : activeAreas(page));
  if (!b) return null;
  const y = round2((b.minY + b.maxY) / 2);
  return { from: { x: round2(b.minX), y }, to: { x: round2(b.maxX), y } };
}

/** Gespeicherte oder vorgegebene Einstellungen der Kreis-Modi, ohne Objekte null. */
export function clockwiseOf(page: FestplatzPage): ClockwiseSettings | null {
  if (page.clockwise) return page.clockwise;
  const center = defaultClockwiseCenter(page);
  return center ? { center, startAngle: 0 } : null;
}

/** Gespeicherte oder vorgegebene eigene Richtung, ohne Objekte null. */
export const directionOf = (page: FestplatzPage): NumberingDirection | null => page.direction ?? defaultDirection(page);

/**
 * Warum die Page nicht automatisch nummeriert werden kann, sonst null: Im Modus „eigene Richtung“ liegen Start- und
 * Zielpunkt (auf 0,01 m gerundet) aufeinander.
 */
export function numberingIssue(page: FestplatzPage): string | null {
  if (page.numberingMode !== 'direction') return null;
  const dir = directionOf(page);
  return dir && !directionAxes(dir) ? 'Start- und Zielpunkt der Richtung liegen aufeinander. Bitte zwei verschiedene Punkte setzen.' : null;
}

/** Stände einer Page in Nummerierungsreihenfolge; im Modus „manuell“ und bei ungültiger Richtung leer. */
export function orderStands(page: FestplatzPage): Stand[] {
  const mode = page.numberingMode;
  if (mode === 'manual') return [];
  if (isCircularMode(mode)) {
    const cw = clockwiseOf(page);
    return cw ? orderClockwise(page.stands, cw, page.northAngle, mode === 'clockwise' ? 1 : -1) : [];
  }
  if (mode === 'direction') {
    const dir = directionOf(page);
    const axes = dir ? directionAxes(dir) : null;
    return axes ? orderAlong(page.stands, axes) : [];
  }
  return orderAlong(page.stands, FIXED_AXES[mode]);
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

/**
 * Hindernis für „Neu nummerieren“ im Nummernkreis der Page `pageId` (#12): die erste betroffene Page, deren Modus
 * gerade nicht nummerieren kann (z. B. eigene Richtung mit A = B), mit Meldung; sonst null.
 */
export function renumberIssue(project: Pick<Project, 'pages' | 'settings'>, pageId: Id): { pageId: Id; pageName: string; message: string } | null {
  for (const page of circleOf(project, pageId).targets) {
    const message = numberingIssue(page);
    if (message) return { pageId: page.id, pageName: page.name, message };
  }
  return null;
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

// ---------- Alle Fixierungen lösen / alle Nummern fixieren (#14) ----------

/**
 * Stände, deren Fixierung „Alle Fixierungen lösen“ (`locked = false`) bzw. „Alle Nummern fixieren“ (`locked = true`)
 * ändert (spec.md §5). Es wirkt auf den Nummernkreis der Page `pageId` – bei „pro Festplatz“ die Page, bei „global“
 * alle Pages –, mit `pageId = null` (Start-Page) auf alle Pages; Pages im Modus „manuell“ zählen mit.
 * Fixiert werden nur Stände mit Nummer: fixiert und leer hieße, der Stand bliebe ohne Nummer.
 */
export function nrLockTargets(project: Pick<Project, 'pages' | 'settings'>, pageId: Id | null, locked: boolean): NrRef[] {
  const pages = pageId === null ? project.pages : circleOf(project, pageId).circle;
  const out: NrRef[] = [];
  for (const page of pages) {
    for (const s of page.stands) {
      if (s.nrLocked === locked) continue;
      if (locked && !s.nr.trim()) continue;
      out.push({ pageId: page.id, standId: s.id });
    }
  }
  return out;
}
