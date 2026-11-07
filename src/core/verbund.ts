/**
 * Festplatz-Verbund (#15, spec.md „Verbund / Gesamtansicht“): Pages, die räumlich zusammenhängen und sich am Rand
 * überschneiden (z. B. „Unterstadt“). Reine Logik ohne Oberfläche.
 *
 * Grundsätze (Entscheidungen 2026-11-03 und 2026-11-06):
 * - Gemeinsames Koordinatensystem: Beim Einrichten wird eine Page samt Hintergrund und allen Objekten einmal an ihre
 *   echte Lage verschoben bzw. gedreht (`transformPageContent`). Danach rechnet nichts mehr zwischen Pages um.
 * - Besitz eines Objekts = die Liste der Page, in der es steht (`ownerOf`); es gibt kein eigenes Feld.
 * - Eine Page gehört zu höchstens einem Verbund (`groupOf`).
 * - Nachbarn in der Einzelansicht (`neighbourObjects`): Fremdobjekte der anderen Mitglieder in der Ausdehnung der
 *   Page. Sie sind nur sichtbar, belegen Freiflächen und zählen für Überlappung, Abstand und Infrastruktur
 *   (freihalten); Warnungen erscheinen nur an eigenen Ständen. Für Statistik, Strom, Nummerierung, Standgeld und CSV
 *   zählen sie nicht (diese Rechnungen lesen weiter nur `page.stands`).
 * - „außerhalb“: Ein Stand ist innerhalb, wenn er in irgendeiner wirkenden Grundfläche des Verbunds steht
 *   (`PageEnv.outside`); auf einer Page ohne Grundflächen (#17) bleibt „außerhalb“ aus.
 *
 * Alle Ergebnisse sind zwischengespeichert und behalten ihre Identität, solange sich die Eingaben nicht ändern; so
 * treffen die Zwischenspeicher der Freiflächen, Warnungen und die memo-Komponenten der Zeichenfläche weiter.
 */
import { bgCorners, moveBy, rotateAround as rotateBackground } from './background';
import { footprint, type PartsRect } from './footprint';
import { boundsTouch, penetration, rectGeo } from './geometry/polygon';
import { boundsOfRects, normAngle, rotateAround, roundAngle } from './geometry/rect';
import { exceedsTol } from './geometry/tolerance';
import { rotate } from './geometry/vec';
import { activeAreas, usesAreas } from './pageAreas';
import type { Area, FestplatzPage, Id, InfraObject, Project, Rect, Stand, Vec, Verbund } from './model/types';
import type { Bounds } from './viewport';

/** Was die Funktionen hier aus dem Projekt brauchen. */
export type VerbundProject = Pick<Project, 'pages'> & Partial<Pick<Project, 'groups' | 'categories'>>;

/** Präfix der Seitenreferenz einer Gesamtansicht (Teil b von #15: Tab „Unterstadt (gesamt)“). */
export const VERBUND_PREFIX = 'verbund:';
export const verbundRef = (id: Id) => `${VERBUND_PREFIX}${id}`;

// ---------- Zugehörigkeit ----------

/** Verbund, zu dem die Page gehört, oder null. */
export function groupOf(project: Partial<Pick<Project, 'groups'>>, pageId: Id): Verbund | null {
  return project.groups?.find((g) => g.pageIds.includes(pageId)) ?? null;
}

/** Mitglieder eines Verbunds als Pages, in der Reihenfolge des Verbunds (unbekannte IDs entfallen). */
export function memberPages(project: Pick<Project, 'pages'>, verbund: Verbund): FestplatzPage[] {
  const byId = new Map(project.pages.map((p) => [p.id, p]));
  return verbund.pageIds.flatMap((id) => byId.get(id) ?? []);
}

const ownerCache = new WeakMap<readonly FestplatzPage[], Map<Id, Id>>();

/**
 * Besitzer-Page eines Objekts (Grundfläche, Stand, Infrastruktur): die Page, in deren Liste es steht. Objekt-IDs sind
 * projektweit eindeutig (schema.ts). null = gibt es nicht.
 */
export function ownerOf(project: Pick<Project, 'pages'>, objectId: Id): Id | null {
  let map = ownerCache.get(project.pages);
  if (!map) {
    map = new Map();
    for (const p of project.pages) for (const o of [...p.areas, ...p.stands, ...p.infra]) map.set(o.id, p.id);
    ownerCache.set(project.pages, map);
  }
  return map.get(objectId) ?? null;
}

// ---------- Gesamtansicht ----------

const mergedCache = new WeakMap<Verbund, { members: readonly FestplatzPage[]; out: FestplatzPage }>();
const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Virtuelle Page aus allen Mitgliedern (Grundlage der Gesamtansicht, Teil b/c von #15): Grundflächen (nur wirkende,
 * #17), Stände, Infrastruktur und Ausblendungen aller Mitglieder hintereinander, in der Reihenfolge des Verbunds. Die
 * Objekte sind dieselben wie in den Mitgliedern (Identität bleibt, `effectivePage` und Zwischenspeicher wirken weiter);
 * zu welcher Page ein Objekt gehört, sagt `ownerOf`. Blatt, Papier-Elemente, Ebenen und Ansicht kommen vom Verbund,
 * Raster und Nordrichtung vom ersten Mitglied. Die Gesamtansicht nummeriert nicht (Modus „manuell“). Hintergründe hat
 * jedes Mitglied selbst (`memberPages`); `background` ist der des ersten Mitglieds.
 */
export function mergedPage(project: Pick<Project, 'pages'>, verbund: Verbund): FestplatzPage {
  const members = memberPages(project, verbund);
  const hit = mergedCache.get(verbund);
  if (hit && sameList(hit.members, members)) return hit.out;
  const first = members[0];
  const out: FestplatzPage = {
    id: verbundRef(verbund.id),
    name: verbund.name,
    prefix: '',
    numberingMode: 'manual',
    powerLimitKw: null,
    blockOverLimit: false,
    northAngle: first?.northAngle ?? 0,
    grid: first ? { ...first.grid } : { size: 1, visible: true },
    layers: verbund.layers,
    background: first?.background ?? null,
    useAreas: members.some(usesAreas),
    areas: members.flatMap((p) => activeAreas(p)),
    stands: members.flatMap((p) => p.stands),
    infra: members.flatMap((p) => p.infra),
    sheet: verbund.sheet,
    titleBlock: verbund.titleBlock,
    titleBlockText: verbund.titleBlockText,
    legend: verbund.legend,
    scaleBar: verbund.scaleBar,
    northArrow: verbund.northArrow,
    hiddenFree: members.flatMap((p) => p.hiddenFree),
    view: verbund.view,
  };
  mergedCache.set(verbund, { members, out });
  return out;
}

// ---------- Zuordnung neuer Objekte ----------

export interface Assignment {
  /** Page, der das Objekt gehören soll; null nur bei einem Verbund ohne Mitglieder. */
  pageId: Id | null;
  /** true = eindeutig über die Grundfläche bestimmt; false = Ersatz-Platz (mehrere oder keine Grundfläche). */
  auto: boolean;
  /** Mitglieder, auf deren wirkenden Grundflächen das Objekt steht. */
  candidates: Id[];
}

/** Breite, mit der dünne Objekte (Linien ohne Stärke, Punkte) für die Zuordnung rechnen (wie `ZERO_LINE_OCCUPY`). */
const THIN = 0.05;

/**
 * Zuordnung eines neuen Objekts in der Gesamtansicht (Entscheidung 2026-11-03): der Platz, auf dessen Grundfläche es
 * steht, d. h. in dessen wirkende Grundflächen es mehr als 0,01 m hineinragt (bei Belegung wie gezeichnet mit einem
 * seiner Teile). Steht es auf mehreren oder auf keiner, entscheidet `fallback` (Auswahl „Neue Objekte auf: …“), sonst
 * das erste Mitglied. Verschieben ändert die Zuordnung nie; das ist Sache des Aufrufers.
 */
export function assignPage(project: Pick<Project, 'pages'>, verbund: Verbund, obj: PartsRect, fallback: Id | null = null): Assignment {
  const members = memberPages(project, verbund);
  const r: PartsRect = obj.w > 0 && obj.d > 0 ? obj : { ...obj, w: Math.max(obj.w, THIN), d: Math.max(obj.d, THIN) };
  const { polys, bounds } = footprint(r);
  const candidates = members
    .filter((p) =>
      activeAreas(p).some((a) => {
        const g = rectGeo(a);
        return boundsTouch(bounds, g.bounds) && polys.some((poly) => exceedsTol(penetration(poly, g.poly)));
      }),
    )
    .map((p) => p.id);
  if (candidates.length === 1) return { pageId: candidates[0]!, auto: true, candidates };
  const pageId = fallback && verbund.pageIds.includes(fallback) && members.some((p) => p.id === fallback) ? fallback : (members[0]?.id ?? null);
  return { pageId, auto: false, candidates };
}

// ---------- Nachbarn in der Einzelansicht ----------

/** Fremdobjekte der anderen Verbund-Mitglieder, die eine Page anzeigt und in ihre Rechnungen einbezieht. */
export interface Neighbours {
  stands: readonly Stand[];
  infra: readonly InfraObject[];
}

export const NO_NEIGHBOURS: Neighbours = Object.freeze({ stands: Object.freeze([]) as readonly Stand[], infra: Object.freeze([]) as readonly InfraObject[] });

/** Rand der Ausdehnung einer Page in Metern (Nachbarn knapp außerhalb der eigenen Objekte sind sichtbar). */
export const NEIGHBOUR_MARGIN = 10;

/**
 * Ausdehnung einer Page für die Nachbarn: das achsenparallele Hüllrechteck ihrer wirkenden Grundflächen, Stände und
 * Infrastruktur-Objekte, um `margin` erweitert. Hat die Page keine Objekte, gilt ihr Hintergrund (ohne Rand); ohne
 * beides hat sie keine Ausdehnung (null, keine Nachbarn).
 */
export function pageExtent(page: Pick<FestplatzPage, 'areas' | 'stands' | 'infra' | 'background'> & { useAreas?: boolean }, margin = NEIGHBOUR_MARGIN): Bounds | null {
  const b = boundsOfRects([...activeAreas(page), ...page.stands, ...page.infra]);
  if (b) return { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
  const bg = page.background;
  if (!bg) return null;
  const c = bgCorners(bg.transform, bg.pxSize);
  return { minX: Math.min(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxX: Math.max(...c.map((p) => p.x)), maxY: Math.max(...c.map((p) => p.y)) };
}

/**
 * Rand für die Nachbarn eines Projekts: `NEIGHBOUR_MARGIN`, mindestens aber der größte Mindestabstand einer Kategorie
 * (#3), damit der Konkurrenzschutz über die Platzgrenze vollständig ist.
 */
export const neighbourMargin = (categories: Project['categories'] = []) => Math.max(NEIGHBOUR_MARGIN, ...categories.map((c) => c.minDistance ?? 0));

interface NeighbourEntry {
  inputs: readonly unknown[];
  result: Neighbours;
}
const neighbourCache = new Map<Id, NeighbourEntry>();

/**
 * Nachbarn der Page in der Einzelansicht: Stände und Infrastruktur-Objekte der anderen Mitglieder ihres Verbunds,
 * deren Hüllrechteck die Ausdehnung der Page (`pageExtent` mit `neighbourMargin`) berührt. Ohne Verbund keine.
 * `page` darf eine Sicht mit Vorschau sein (core/derive.ts); das Ergebnis behält seine Identität, solange dieselben
 * Objekte Nachbarn sind.
 */
export function neighbourObjects(project: VerbundProject, page: FestplatzPage): Neighbours {
  const group = groupOf(project, page.id);
  if (!group || group.pageIds.length < 2) return NO_NEIGHBOURS;
  const others = memberPages(project, group).filter((p) => p.id !== page.id);
  if (!others.length) return NO_NEIGHBOURS;
  const margin = neighbourMargin(project.categories);
  const inputs = [page.areas, page.stands, page.infra, page.background, page.useAreas, margin, ...others.flatMap((p) => [p.stands, p.infra])];
  const hit = neighbourCache.get(page.id);
  if (hit && sameList(hit.inputs, inputs)) return hit.result;
  const ext = pageExtent(page, margin);
  let result: Neighbours = NO_NEIGHBOURS;
  if (ext) {
    const touches = (r: Rect) => boundsTouch(boundsOfRects([r])!, ext);
    const stands = others.flatMap((p) => p.stands.filter((s) => boundsTouch(footprint(s).bounds, ext)));
    const infra = others.flatMap((p) => p.infra.filter(touches));
    if (stands.length || infra.length) {
      const prev = hit?.result;
      result = prev && sameList(prev.stands, stands) && sameList(prev.infra, infra) ? prev : { stands, infra };
    }
  }
  neighbourCache.set(page.id, { inputs, result });
  return result;
}

/** Beschriftung eines Nachbarstands: „SE-02 · Seestraße“ (ohne Nummer der Name, sonst „Stand“). */
export const neighbourCaption = (stand: Pick<Stand, 'nr' | 'name'>, pageName: string) => `${stand.nr.trim() || stand.name.trim() || 'Stand'} · ${pageName}`;

// ---------- Rechengrundlage einer Page im Verbund ----------

/** Was eine Page für ihre Rechnungen aus dem Verbund braucht. */
export interface PageEnv {
  neighbours: Neighbours;
  /**
   * Bezug der Warnung „außerhalb“ (`isOutside`): ohne Verbund die Grundflächen der Page, im Verbund die wirkenden
   * Grundflächen aller Mitglieder (eigene zuerst); null auf einer Page ohne Grundflächen (#17).
   */
  outside: readonly Area[] | null;
}

const outsideCache = new WeakMap<Verbund, { lists: readonly (readonly Area[])[]; out: readonly Area[] }>();

/**
 * Grundflächen für „außerhalb“ im Verbund: die wirkenden Grundflächen aller Mitglieder in der Reihenfolge des
 * Verbunds. Alle Mitglieder teilen dieselbe Liste (gleiche Identität, solange sich keine ändert), damit der
 * Zwischenspeicher „außerhalb“ je Stand auch für Nachbarstände trifft.
 */
function verbundOutside(project: VerbundProject, page: FestplatzPage): readonly Area[] | null {
  if (!usesAreas(page)) return null;
  const group = groupOf(project, page.id);
  if (!group) return page.areas;
  // Die eigene Page kann eine Sicht mit Vorschau sein (gezogene Grundfläche)
  const members = memberPages(project, group);
  if (members.every((p) => p.id === page.id || !activeAreas(p).length)) return page.areas;
  const lists = members.map((p) => (p.id === page.id ? page.areas : activeAreas(p)));
  const hit = outsideCache.get(group);
  if (hit && sameList(hit.lists, lists)) return hit.out;
  const out = lists.flat();
  outsideCache.set(group, { lists, out });
  return out;
}

/** Nachbarn und Bezug von „außerhalb“ einer Page (`page` darf eine Sicht mit Vorschau sein). */
export function pageEnv(project: VerbundProject, page: FestplatzPage): PageEnv {
  return { neighbours: neighbourObjects(project, page), outside: verbundOutside(project, page) };
}

const combineCache = new WeakMap<readonly object[], { extra: readonly object[]; out: readonly object[] }>();

/**
 * Eigene Objekte und Nachbarn in einer Liste (für Freiflächen, Überlappung, Abstand, Infrastruktur). Ohne Nachbarn die
 * eigene Liste selbst; sonst zwischengespeichert, solange beide Listen gleich bleiben.
 */
export function withNeighbours<T extends object>(own: readonly T[], extra: readonly T[]): readonly T[] {
  if (!extra.length) return own;
  const hit = combineCache.get(own);
  if (hit && hit.extra === extra) return hit.out as readonly T[];
  const out = [...own, ...extra];
  combineCache.set(own, { extra, out });
  return out;
}

// ---------- Page verschieben und drehen ----------

/**
 * Starre Bewegung einer ganzen Page: erst um `pivot` drehen (`rot` in Grad im Uhrzeigersinn), dann um (`dx`, `dy`)
 * verschieben. Abbildung p ↦ R(p − pivot) + pivot + d.
 */
export interface PageTransform {
  dx: number;
  dy: number;
  rot: number;
  pivot: Vec;
}

/** Umkehrung: p = R⁻¹(p′ − pivot′) + pivot′ − d mit pivot′ = pivot + d. */
export const inverseTransform = (t: PageTransform): PageTransform => ({ dx: -t.dx, dy: -t.dy, rot: -t.rot, pivot: { x: t.pivot.x + t.dx, y: t.pivot.y + t.dy } });

export const applyTransform = (t: PageTransform, p: Vec): Vec => {
  const q = t.rot ? rotateAround(p, t.pivot, t.rot) : p;
  return { x: q.x + t.dx, y: q.y + t.dy };
};

/**
 * Drehpunkt für „Lage“ im Verbund: die Mitte der Ausdehnung der Page ohne Rand (Grundflächen, Stände, Infrastruktur;
 * ohne Objekte die Mitte des Hintergrunds; sonst der Ursprung), auf 0,01 m gerundet.
 */
export function pagePivot(page: FestplatzPage): Vec {
  const b = pageExtent(page, 0);
  if (!b) return { x: 0, y: 0 };
  return { x: r2((b.minX + b.maxX) / 2), y: r2((b.minY + b.maxY) / 2) };
}

const r2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Verschiebt bzw. dreht eine ganze Page in das gemeinsame Koordinatensystem des Verbunds (#15). Mit:
 * - Grundflächen, Stände (Teile einer eigenen Form hängen am Stand und drehen mit), Infrastruktur (Linien über Mitte
 *   und Richtung; Punkte behalten die Drehung 0): Mitte abgebildet, Drehung + `rot`;
 * - von Hand verschobene Beschriftung (`labelOffset`, horizontal relativ zur Standmitte): Versatz mitgedreht;
 * - Hintergrund über `rotateAround`/`moveBy` (Kalibrierpunkte liegen in Quell-Einheiten und bleiben gültig);
 * - Blatt: Mitte abgebildet; der Ausschnitt (#13) ist achsenparallel und bleibt es: seine Mitte wird abgebildet,
 *   Breite und Höhe bleiben (bei einer Drehung zeigt er also nicht mehr genau denselben Inhalt);
 * - Mittelpunkt der Nummerierung im (bzw. gegen den) Uhrzeigersinn; die Startrichtung gilt relativ zum Norden der
 *   Page und dreht so mit der Nordrichtung mit;
 * - eigene Richtung A → B (#12): A und B werden abgebildet (Entscheidung: A/B folgen der Transformation);
 * - Nordrichtung + `rot`;
 * - Ansicht: so verschoben, dass der Drehpunkt an derselben Bildschirmstelle bleibt.
 * Unverändert: Papier-Elemente (mm auf dem Papier), Raster, Teile einer Form (relativ zum Stand) und `hiddenFree`
 * (Schlüssel und Intervalle beziehen sich auf die Achse der Grundfläche und bleiben bei einer starren Bewegung gültig).
 * `round` (Standard): Positionen auf 0,01 m, Drehungen auf 0,1° wie beim Übernehmen; Hin- und Rückweg ergeben dann das
 * Original bis auf diese Rundung (bei reiner Verschiebung um ganze cm exakt).
 */
export function transformPageContent(page: FestplatzPage, t: PageTransform, opts: { round?: boolean } = {}): FestplatzPage {
  const round = opts.round ?? true;
  const pos = (n: number) => (round ? r2(n) : n);
  const ang = (a: number) => (round ? roundAngle(a) : normAngle(a));
  const pt = (p: Vec): Vec => {
    const q = applyTransform(t, p);
    return { x: pos(q.x), y: pos(q.y) };
  };
  const rect = <T extends Rect>(r: T, keepRot = false): T => {
    const c = pt({ x: r.cx, y: r.cy });
    return { ...r, cx: c.x, cy: c.y, rot: keepRot ? r.rot : ang(r.rot + t.rot) };
  };
  const stands = page.stands.map((s) => {
    const o = rect(s);
    if (s.labelOffset) {
      const v = rotate(s.labelOffset, t.rot);
      o.labelOffset = { x: pos(v.x), y: pos(v.y) };
    }
    return o;
  });
  const bg = page.background;
  const background = bg ? { ...bg, transform: moveBy(t.rot ? rotateBackground(bg.transform, bg.transform.rot + t.rot, t.pivot) : bg.transform, t.dx, t.dy) } : null;
  const sheetCenter = pt({ x: page.sheet.cx, y: page.sheet.cy });
  const region = page.sheet.region;
  const regionCenter = region ? pt({ x: region.cx, y: region.cy }) : null;
  const out: FestplatzPage = {
    ...page,
    areas: page.areas.map((a) => rect(a)),
    stands,
    // Punkte haben keine Drehung (schema.ts setzt sie beim Laden auf 0)
    infra: page.infra.map((o) => rect(o, o.w === 0 && o.d === 0)),
    background,
    sheet: { ...page.sheet, cx: sheetCenter.x, cy: sheetCenter.y, region: region && regionCenter ? { ...region, cx: regionCenter.x, cy: regionCenter.y } : region },
    northAngle: ang(page.northAngle + t.rot),
  };
  if (page.clockwise) out.clockwise = { ...page.clockwise, center: pt(page.clockwise.center) };
  if (page.direction) out.direction = { from: pt(page.direction.from), to: pt(page.direction.to) };
  if (page.view) out.view = shiftView(page.view, t);
  return out;
}

/** Ansicht nach `transformPageContent`: Der Drehpunkt bleibt an seiner Bildschirmstelle. */
export const shiftView = <V extends { scale: number; tx: number; ty: number }>(v: V, t: Pick<PageTransform, 'dx' | 'dy'>): V => ({ ...v, tx: v.tx - t.dx * v.scale, ty: v.ty - t.dy * v.scale });
