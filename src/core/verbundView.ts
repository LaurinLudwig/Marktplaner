/**
 * Gesamtansicht eines Festplatz-Verbunds (#15 Teil b, spec.md §12 „Gesamtansicht“): Seitenreferenzen `verbund:<id>`,
 * die Sicht der Zeichenfläche, die Pages, in deren Listen eine Änderung landet, die Zuordnung neuer Objekte und die
 * Rechnungen des Werkzeugs „Ausrichten“. Reine Logik ohne Oberfläche; die Grundlagen stehen in core/verbund.ts.
 */
import { measure } from './measure';
import type { Background, FestplatzPage, Id, Project, Rect, Vec, Verbund } from './model/types';
import { usesAreas } from './pageAreas';
import { assignPage, mergedPage, memberPages, ownerOf, VERBUND_PREFIX, verbundRef, type PageTransform } from './verbund';
import type { PartsRect } from './footprint';

type GroupsOf = { groups?: readonly Verbund[] };

/** Ist die Seitenreferenz die Gesamtansicht eines Verbunds (`verbund:<id>`)? */
export const isVerbundRef = (ref: string): boolean => ref.startsWith(VERBUND_PREFIX);

/** Verbund einer Seitenreferenz `verbund:<id>`, sonst null. */
export function verbundOfRef(project: GroupsOf, ref: string): Verbund | null {
  if (!isVerbundRef(ref)) return null;
  const id = ref.slice(VERBUND_PREFIX.length);
  return project.groups?.find((g) => g.id === id) ?? null;
}

/** Hat der Verbund eine Gesamtansicht? Erst ab einem vorhandenen Mitglied. */
export const hasOverview = (project: Pick<Project, 'pages'>, verbund: Verbund) => memberPages(project, verbund).length > 0;

const viewCache = new WeakMap<FestplatzPage, FestplatzPage>();

/**
 * Sicht der Gesamtansicht auf der Zeichenfläche: die `mergedPage` ohne Hintergrund (die Hintergründe zeichnet die
 * Zeichenfläche je Mitglied, keiner ist dort auswählbar oder verschiebbar; `viewBackgrounds`). Blatt, Schriftfeld,
 * Legende, Maßstabsbalken, Nordpfeil und Ebenen sind die des Verbunds (Teil c). Behält ihre Identität, solange die
 * `mergedPage` gleich bleibt.
 */
function overviewPage(merged: FestplatzPage): FestplatzPage {
  let out = viewCache.get(merged);
  if (!out) {
    out = { ...merged, background: null };
    viewCache.set(merged, out);
  }
  return out;
}

/** Hintergrund eines Mitglieds in einer Ansicht; `pageId` = Besitzer-Page. */
export interface ViewBackground {
  pageId: Id;
  background: Background;
}

/**
 * Hintergründe einer Page bzw. der Gesamtansicht eines Verbunds (Teil c, Entscheidung 2026-11-06): in der Gesamtansicht
 * (`page.id` = `verbund:<id>`, `mergedPage` oder `pageView`) je Mitglied sein Hintergrund in der Reihenfolge des
 * Verbunds (spätere oben, keine Masken), sonst der Hintergrund der Page. Ohne `project.pages` nur der eigene.
 */
export function viewBackgrounds(project: Partial<Pick<Project, 'pages'>> & GroupsOf, page: Pick<FestplatzPage, 'id' | 'background'>): ViewBackground[] {
  const verbund = project.pages ? verbundOfRef(project, page.id) : null;
  if (verbund && project.pages) return memberPages({ pages: project.pages }, verbund).flatMap((m) => (m.background ? [{ pageId: m.id, background: m.background }] : []));
  return page.background ? [{ pageId: page.id, background: page.background }] : [];
}

/**
 * Page einer Seitenreferenz: die Festplatz-Page oder die Gesamtansicht eines Verbunds (`overviewPage`). null = gibt es
 * nicht, auch für einen Verbund ohne Mitglieder.
 */
export function pageView(project: Pick<Project, 'pages'> & GroupsOf, ref: string): FestplatzPage | null {
  const verbund = verbundOfRef(project, ref);
  if (verbund) return hasOverview(project, verbund) ? overviewPage(mergedPage(project, verbund)) : null;
  return project.pages.find((p) => p.id === ref) ?? null;
}

/**
 * Pages, in deren Listen die Objekte einer Seitenreferenz stehen: die Page selbst bzw. alle Mitglieder des Verbunds.
 * Objekt-IDs sind projektweit eindeutig; eine Änderung „an den Objekten mit diesen IDs“ über alle Mitglieder trifft so
 * jedes Objekt genau in der Liste seiner Besitzer-Page (gruppiert nach Besitzer, ein Undo-Schritt). Funktioniert auch
 * mit einem Entwurf (immer).
 */
export function ownerPages<P extends Pick<FestplatzPage, 'id'>>(project: { pages: P[]; groups?: readonly Verbund[] }, ref: string): P[] {
  const verbund = verbundOfRef(project, ref);
  if (!verbund) return project.pages.filter((p) => p.id === ref);
  const byId = new Map(project.pages.map((p) => [p.id, p]));
  return verbund.pageIds.flatMap((id) => byId.get(id) ?? []);
}

// ---------- Tabs ----------

export type TabEntry = { kind: 'page'; page: FestplatzPage } | { kind: 'verbund'; verbund: Verbund; ref: string };

/**
 * Reihenfolge der Tabs nach der Start-Page: die Festplatz-Pages in ihrer Reihenfolge; der Tab der Gesamtansicht eines
 * Verbunds („Unterstadt (gesamt)“) steht direkt vor dem ersten seiner Mitglieder. Verbünde ohne Mitglieder haben keinen.
 */
export function tabOrder(project: Pick<Project, 'pages'> & GroupsOf): TabEntry[] {
  const out: TabEntry[] = [];
  const seen = new Set<Id>();
  for (const page of project.pages) {
    const g = project.groups?.find((x) => x.pageIds.includes(page.id));
    if (g && !seen.has(g.id)) {
      seen.add(g.id);
      out.push({ kind: 'verbund', verbund: g, ref: verbundRef(g.id) });
    }
    out.push({ kind: 'page', page });
  }
  return out;
}

/** Titel des Tabs der Gesamtansicht. */
export const overviewTitle = (verbund: Pick<Verbund, 'name'>) => `${verbund.name} (gesamt)`;

// ---------- Zuordnung neuer Objekte ----------

/** Ersatz-Platz („Neue Objekte auf: …“): die Auswahl, wenn sie noch Mitglied ist, sonst das erste Mitglied. */
export function fallbackPage(project: Pick<Project, 'pages'>, verbund: Verbund, chosen: Id | null | undefined): Id | null {
  const members = memberPages(project, verbund);
  return (chosen && members.some((p) => p.id === chosen) ? chosen : members[0]?.id) ?? null;
}

/**
 * Besitzer-Pages für neue Objekte in der Gesamtansicht (Entscheidung 2026-11-03, `assignPage`): der Platz, auf dessen
 * wirkender Grundfläche ein Objekt steht; steht es auf mehreren oder keiner, `fallbackOf(obj)` (die Auswahl „Neue
 * Objekte auf: …“, bei Kopien der Platz des Originals). Grundflächen kommen nur auf Plätze, die Grundflächen verwenden
 * (#17): sonst auf das erste solche Mitglied, ohne eins entfallen sie (nicht in der Zuordnung).
 */
export function assignObjects(
  project: Pick<Project, 'pages'>,
  verbund: Verbund,
  objs: { areas: readonly (Rect & { id: Id })[]; stands: readonly (PartsRect & { id: Id })[]; infra: readonly (Rect & { id: Id })[] },
  fallbackOf: (obj: { id: Id }) => Id | null,
): Map<Id, Id> {
  const members = memberPages(project, verbund);
  const out = new Map<Id, Id>();
  const assign = (o: PartsRect & { id: Id }) => assignPage(project, verbund, o, fallbackOf(o)).pageId;
  for (const a of objs.areas) {
    const id = assign(a);
    const page = members.find((p) => p.id === id);
    const target = page && usesAreas(page) ? page.id : members.find(usesAreas)?.id;
    if (target) out.set(a.id, target);
  }
  for (const o of [...objs.stands, ...objs.infra]) {
    const id = assign(o);
    if (id) out.set(o.id, id);
  }
  return out;
}

/**
 * Ersatz-Platz für Kopien (Duplizieren, Alt+Ziehen) in der Gesamtansicht: der Platz des Originals, falls bekannt,
 * sonst `fallback`.
 */
export const copyFallback = (project: Pick<Project, 'pages'>, from: Readonly<Record<Id, Id>>, fallback: Id | null) => (o: { id: Id }) =>
  (from[o.id] ? ownerOf(project, from[o.id]!) : null) ?? fallback;

// ---------- Werkzeug „Ausrichten“ ----------

/** Reine Verschiebung einer Page (Ziehen mit dem Werkzeug „Ausrichten“). */
export const translation = (dx: number, dy: number): PageTransform => ({ dx, dy, rot: 0, pivot: { x: 0, y: 0 } });

/** Ergebnis der 2-Punkt-Ausrichtung. */
export interface TwoPointResult {
  /** Starre Bewegung (Maßstab 1): Mitte der Punkte auf diesem Plan → Mitte der Punkte auf dem Referenzplan, gedreht. */
  t: PageTransform;
  /** Drehung in Grad im Uhrzeigersinn (−180 … 180). */
  rot: number;
  /** Abstand der beiden Punkte auf diesem Plan bzw. auf dem Referenzplan (m). */
  from: number;
  to: number;
  /** |to − from| in m: So weit passen die Punktpaare bei Maßstab 1 nicht zusammen (je Paar die Hälfte). */
  deviation: number;
}

/**
 * 2-Punkt-Ausrichtung (#15, Vorlage: Kalibrieren): Punkt a1 dieses Plans soll auf b1 des Referenzplans liegen, a2 auf
 * b2. Der Maßstab bleibt 1 (gleiche Stadtgrundkarte); gedreht wird um den Winkel zwischen a1→a2 und b1→b2, verschoben so,
 * dass die Mitte von a1/a2 auf die Mitte von b1/b2 fällt (bei abweichendem Abstand verteilt sich der Fehler gleich auf
 * beide Paare). null, wenn die Punkte eines Paares zusammenfallen (keine Richtung).
 */
export function twoPointTransform(a1: Vec, a2: Vec, b1: Vec, b2: Vec): TwoPointResult | null {
  const from = measure(a1, a2).distance;
  const to = measure(b1, b2).distance;
  if (from < 1e-6 || to < 1e-6) return null;
  const angle = (p: Vec, q: Vec) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  let rot = angle(b1, b2) - angle(a1, a2);
  rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  const ca = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  const cb = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
  return { t: { dx: cb.x - ca.x, dy: cb.y - ca.y, rot, pivot: ca }, rot, from, to, deviation: Math.abs(to - from) };
}

/** Ab dieser Abweichung der Abstände (m) weist die 2-Punkt-Ausrichtung darauf hin (Toleranz wie bei der Geometrie). */
export const ALIGN_DEVIATION_HINT = 0.01;
