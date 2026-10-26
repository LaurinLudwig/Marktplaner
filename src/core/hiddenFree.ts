/**
 * Ausgeblendete Freiflächen (M11, #8, spec.md §4). Der Planer kann eine Freifläche „nicht mehr anzeigen“; sie wird
 * dann nicht gezeichnet, zählt nicht in den freien Frontmetern und fehlt in Freiflächenliste und PDF.
 *
 * Gespeichert wird pro Page der stabile Schlüssel der Freifläche zusammen mit ihrem Achsenintervall. Eine Ausblendung
 * gilt nur, solange es eine Freifläche mit demselben Schlüssel und (bis auf 0,01 m) demselben Intervall gibt; wird
 * ein angrenzender Stand verschoben, in der Größe geändert oder gelöscht, verfällt sie (`pruneHiddenFree`, angewandt
 * im selben Undo-Schritt wie die Änderung).
 */
import { createFreeSpaceCache, pageFreeSpaces, type AreaFreeSpaces, type FreeSpace, type FreeSpaceCache } from './freeSpace';
import { withinTol } from './geometry/tolerance';
import type { Polygon } from './geometry/polygon';
import { pageOccupants } from './infra';
import type { FestplatzPage, HiddenFree, Id, InfraTypeDef, Project, Vec } from './model/types';

/** Gehört die Ausblendung `h` zu dieser Freifläche? Gleicher Schlüssel, Intervallenden bis 0,01 m verschoben. */
export const matchesHidden = (fs: Pick<FreeSpace, 'key' | 'start' | 'end'>, h: HiddenFree) => fs.key === h.key && withinTol(Math.abs(fs.start - h.start)) && withinTol(Math.abs(fs.end - h.end));

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Eintrag für das Dateiformat (Intervall auf 0,01 m gerundet wie alle gespeicherten Maße). */
export const hiddenEntry = (fs: Pick<FreeSpace, 'key' | 'start' | 'end'>): HiddenFree => ({ key: fs.key, start: r2(fs.start), end: r2(fs.end) });

/** Zwischenspeicher je Ergebnis einer Grundfläche: unveränderte Flächen behalten ihre Identität (memo, Szene). */
const splitCache = new WeakMap<AreaFreeSpaces, { hidden: readonly HiddenFree[]; out: AreaFreeSpaces }>();

/** Teilt die Freiflächen in angezeigte (`free`) und ausgeblendete (`hidden`). Ohne Ausblendungen unverändert. */
export function applyHidden(all: readonly AreaFreeSpaces[], hidden: readonly HiddenFree[]): AreaFreeSpaces[] {
  if (!hidden.length) return all as AreaFreeSpaces[];
  return all.map((a) => {
    const hit = splitCache.get(a);
    if (hit && hit.hidden === hidden) return hit.out;
    const off = a.free.filter((fs) => hidden.some((h) => matchesHidden(fs, h)));
    const out = off.length ? { ...a, free: a.free.filter((fs) => !off.includes(fs)), hidden: [...a.hidden, ...off] } : a;
    splitCache.set(a, { hidden, out });
    return out;
  });
}

/** Was die Freiflächen einer Page aus dem Projekt brauchen. */
export interface FreeContext {
  minFreeWidth: number;
  infraTypes: readonly InfraTypeDef[];
}

/**
 * Freiflächen einer Page mit allem, was sie bestimmt: Stände und belegende Infrastruktur (§4, §11), Mindestbreite
 * und Ausblendungen. Gemeinsamer Einstieg für Zeichenfläche, Kennzahlen, Listen, Legende und PDF.
 */
export function pageFree(page: Pick<FestplatzPage, 'areas' | 'stands' | 'infra' | 'hiddenFree'>, ctx: FreeContext, cache?: FreeSpaceCache): AreaFreeSpaces[] {
  return applyHidden(pageFreeSpaces(page.areas, pageOccupants(page, ctx.infraTypes), ctx.minFreeWidth, cache), page.hiddenFree);
}

/**
 * Ausblendungen, zu denen es noch eine passende Freifläche gibt. `all` = Freiflächen der Page (mit oder ohne
 * angewandte Ausblendungen). Liefert dieselbe Liste, wenn nichts verfällt.
 */
export function pruneHiddenFree(hidden: readonly HiddenFree[], all: readonly AreaFreeSpaces[]): readonly HiddenFree[] {
  if (!hidden.length) return hidden;
  const spaces = all.flatMap((a) => (a.hidden.length ? [...a.free, ...a.hidden] : a.free));
  const keep = hidden.filter((h) => spaces.some((fs) => matchesHidden(fs, h)));
  return keep.length === hidden.length ? hidden : keep;
}

/** Zwischenspeicher der Freiflächen je Page für die Verfallsprüfung (nur geänderte Grundflächen rechnen neu). */
const pruneCaches = new Map<Id, FreeSpaceCache>();

/**
 * Pages, deren Ausblendungen nach einer Änderung von `before` auf `after` teilweise verfallen (#8, spec.md §4), mit
 * den verbleibenden Einträgen. Geprüft werden nur Pages mit Ausblendungen, deren Objekte, Mindestbreite oder
 * Infrastruktur-Typen sich geändert haben (Vergleich per Identität).
 */
export function expiredHiddenFree(before: Project, after: Project): Map<Id, readonly HiddenFree[]> {
  const out = new Map<Id, readonly HiddenFree[]>();
  const ctx = { minFreeWidth: after.settings.minFreeWidth, infraTypes: after.infraTypes };
  const ctxChanged = before.settings.minFreeWidth !== ctx.minFreeWidth || before.infraTypes !== ctx.infraTypes;
  const old = new Map(before.pages.map((p) => [p.id, p]));
  for (const page of after.pages) {
    if (!page.hiddenFree.length) continue;
    const prev = old.get(page.id);
    if (!ctxChanged && prev && prev.areas === page.areas && prev.stands === page.stands && prev.infra === page.infra && prev.hiddenFree === page.hiddenFree) continue;
    let c = pruneCaches.get(page.id);
    if (!c) pruneCaches.set(page.id, (c = createFreeSpaceCache()));
    const keep = pruneHiddenFree(page.hiddenFree, pageFree({ ...page, hiddenFree: [] }, ctx, c));
    if (keep !== page.hiddenFree) out.set(page.id, keep);
  }
  return out;
}

/** Punkt in einem konvexen Polygon (Rand eingeschlossen), unabhängig vom Umlaufsinn. */
function inConvex(poly: Polygon, p: Vec): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-12) continue;
    const s = Math.sign(c);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Angezeigte Freifläche unter dem Punkt (für das Kontextmenü der Zeichenfläche), sonst null. */
export function pickFreeSpace(all: readonly AreaFreeSpaces[], p: Vec): FreeSpace | null {
  for (let i = all.length - 1; i >= 0; i--) {
    for (const fs of all[i]!.free) if (fs.polygons.some((poly) => inConvex(poly, p))) return fs;
  }
  return null;
}
