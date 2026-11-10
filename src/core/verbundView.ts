/**
 * Gesamtansicht eines Festplatz-Verbunds (#15 Teil b, spec.md §12 „Gesamtansicht“): Seitenreferenzen `verbund:<id>`,
 * die Sicht der Zeichenfläche, die Pages, in deren Listen eine Änderung landet, die Zuordnung neuer Objekte und die
 * Rechnungen des Werkzeugs „Ausrichten“. Reine Logik ohne Oberfläche; die Grundlagen stehen in core/verbund.ts.
 */
import type { Background, FestplatzPage, Id, Project, Rect, Vec, Verbund } from './model/types';
import { usesAreas } from './pageAreas';
import { applyTransform, assignPage, mergedPage, memberPages, ownerOf, transformPageContent, VERBUND_PREFIX, verbundRef, type PageTransform } from './verbund';
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

/** Vorschau eines bewegten Platzes (`alignPreview`): für die Vorschau im Store und den Hintergrund der Zeichenfläche. */
export interface AlignPreview {
  /** Grundflächen, Stände und Infrastruktur an ihrer bewegten Stelle (`Preview.rects`). */
  rects: Record<Id, Rect>;
  /** Mitgedrehte, von Hand verschobene Beschriftungen (`Preview.labelOffsets`). */
  labelOffsets: Record<Id, Vec>;
  /** Bewegter Hintergrund (null = keiner). */
  background: Background | null;
  /** Bewegte Page (ungerundet), z. B. für den Fang an ihren Objekten. */
  page: FestplatzPage;
}

/**
 * Vorschau des Werkzeugs „Ausrichten“ (#26): die eine Stelle, an der eine Vorschau-Transformation je Platz auf
 * Objekte, Beschriftungen und Hintergrund angewendet wird (`transformPageContent` ohne Rundung). Übernommen wird
 * dieselbe Transformation mit `movePageContent`.
 */
export function alignPreview(member: FestplatzPage, t: PageTransform): AlignPreview {
  const page = transformPageContent(member, t, { round: false });
  const rects: Record<Id, Rect> = {};
  for (const o of [...page.areas, ...page.stands, ...page.infra]) rects[o.id] = { cx: o.cx, cy: o.cy, w: o.w, d: o.d, rot: o.rot };
  const labelOffsets: Record<Id, Vec> = {};
  for (const s of page.stands) if (s.labelOffset) labelOffsets[s.id] = s.labelOffset;
  return { rects, labelOffsets, background: page.background, page };
}

/** Winkel in Grad auf (−180, 180] (Anzeige der Drehung im Werkzeug „Ausrichten“). */
export const normRot = (deg: number) => {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
};

/**
 * Offene Änderungen der manuellen Sitzung des Werkzeugs „Ausrichten“ (#26): Verschiebung in m und Drehung in Grad im
 * Uhrzeigersinn um die Mitte des Platzes. Ziehen und Drehen sammeln sich hier, übernommen wird einmal (`sessionTransform`).
 */
export interface AlignSession {
  dx: number;
  dy: number;
  rot: number;
}

export const NO_SESSION: AlignSession = Object.freeze({ dx: 0, dy: 0, rot: 0 });
export const sessionOpen = (s: AlignSession | null): boolean => !!s && (s.dx !== 0 || s.dy !== 0 || s.rot !== 0);

const round = (n: number, f: number) => Math.round(n * f) / f;
const angleOf = (v: Vec) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** Ziehen um `delta` (m, Welt) auf die Sitzung `base`; die Verschiebung des Ziehens auf 0,01 m. */
export const sessionMove = (base: AlignSession, delta: Vec): AlignSession => ({ ...base, dx: base.dx + round(delta.x, 100), dy: base.dy + round(delta.y, 100) });

/**
 * Drehgriff: Drehung von `from` nach `to` (Weltpunkte) um `center` (bewegte Mitte des Platzes) auf die Sitzung `base`,
 * auf 0,1°; mit `step` (Shift) die gesamte Drehung der Sitzung auf 15°-Schritte. Ergebnis (−180 … 180].
 */
export function sessionRotate(base: AlignSession, center: Vec, from: Vec, to: Vec, step = false): AlignSession {
  const delta = normRot(angleOf({ x: to.x - center.x, y: to.y - center.y }) - angleOf({ x: from.x - center.x, y: from.y - center.y }));
  let rot = base.rot + round(delta, 10);
  if (step) rot = Math.round(rot / 15) * 15;
  return { ...base, rot: normRot(rot) };
}

/**
 * Transformation der Sitzung für `pivot` (Mitte des Platzes, `pagePivot`): erst um die Mitte drehen, dann verschieben.
 * Eine Drehung um die bewegte Mitte (pivot + d) addiert sich so einfach zur bisherigen Drehung: R(ψ)(R(φ)(p − c) + c +
 * d − (c + d)) + c + d = R(φ + ψ)(p − c) + c + d. null ohne offene Änderungen.
 */
export const sessionTransform = (s: AlignSession | null, pivot: Vec): PageTransform | null => (s && sessionOpen(s) ? { dx: s.dx, dy: s.dy, rot: s.rot, pivot } : null);

/** Punktpaar des Werkzeugs „Ausrichten“: `a` auf dem gewählten Plan soll auf `b` (Referenz) liegen. */
export interface PointPair {
  a: Vec;
  b: Vec;
}

/** Ergebnis der Ausrichtung nach Punktpaaren (`fitRigid`). */
export interface RigidFit {
  /** Starre Bewegung (Maßstab 1): Schwerpunkt der A-Punkte → Schwerpunkt der B-Punkte, gedreht um ihn. */
  t: PageTransform;
  /** Drehung in Grad im Uhrzeigersinn (−180 … 180]. */
  rot: number;
  /** Restabweichung je Paar in m: Abstand zwischen bewegtem A und B. */
  residuals: number[];
  /** Mittlere (quadratisch gemittelte) und größte Restabweichung in m. */
  rms: number;
  max: number;
  /**
   * Auffälliges Paar oder null (Hinweis „prüfen oder entfernen“): ab `ALIGN_OUTLIER_MIN_PAIRS` Paaren das Paar, ohne das
   * die übrigen am besten zusammenpassen, wenn es von deren Lösung mehr als `ALIGN_OUTLIER_FACTOR`-mal so weit abweicht,
   * wie nach ihrer Streuung zu erwarten wäre (mindestens `ALIGN_DEVIATION_HINT`). `rmsWithout` = mittlere Abweichung
   * der übrigen ohne dieses Paar.
   */
  outlier: { index: number; rmsWithout: number } | null;
}

/** Ab dieser Abweichung (m) gilt etwas als Abweichung (Toleranz wie bei der Geometrie). */
export const ALIGN_DEVIATION_HINT = 0.01;
/**
 * Faktor für ein auffälliges Paar (`RigidFit.outlier`). Ein fester Faktor auf die gemeinsame mittlere Abweichung (etwa
 * „> 3 × RMS“) taugt bei wenigen Paaren nicht: Die größte Abweichung ist höchstens √n-mal die mittlere, unter 10 Paaren
 * also nie dreimal so groß. Deshalb der Vergleich mit der Lösung der übrigen; 8 ergab in Simulationen mit gleichmäßig
 * verrauschten Paaren bei 4 Paaren in etwa 5 %, ab 5 Paaren in unter 1 % der Fälle einen Fehlalarm und erkennt ein um
 * das 30-Fache der Streuung verschobenes Paar fast immer.
 */
export const ALIGN_OUTLIER_FACTOR = 8;
/** Ab so vielen Paaren prüft `fitRigid` auf ein auffälliges Paar (mit 3 Paaren lässt sich keines verlässlich erkennen). */
export const ALIGN_OUTLIER_MIN_PAIRS = 4;

/** Kleinste-Quadrate-Lösung ohne Auffälligkeiten; null bei weniger als 2 Paaren oder ohne Ausdehnung. */
function solveRigid(pairs: readonly PointPair[]): Omit<RigidFit, 'outlier'> | null {
  const n = pairs.length;
  if (n < 2) return null;
  let ax = 0, ay = 0, bx = 0, by = 0;
  for (const { a, b } of pairs) {
    ax += a.x;
    ay += a.y;
    bx += b.x;
    by += b.y;
  }
  const ca = { x: ax / n, y: ay / n };
  const cb = { x: bx / n, y: by / n };
  // Σ p·q und Σ p×q der zentrierten Punkte: tan θ = Σ p×q / Σ p·q minimiert Σ |R(θ)p − q|²
  let dot = 0, cross = 0, spreadA = 0, spreadB = 0;
  for (const { a, b } of pairs) {
    const px = a.x - ca.x, py = a.y - ca.y;
    const qx = b.x - cb.x, qy = b.y - cb.y;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    spreadA += px * px + py * py;
    spreadB += qx * qx + qy * qy;
  }
  // Alle A (bzw. alle B) an einer Stelle: keine Richtung
  if (spreadA < 1e-12 || spreadB < 1e-12 || Math.hypot(dot, cross) < 1e-12) return null;
  const rot = normRot((Math.atan2(cross, dot) * 180) / Math.PI);
  const t: PageTransform = { dx: cb.x - ca.x, dy: cb.y - ca.y, rot, pivot: ca };
  const residuals = pairs.map(({ a, b }) => {
    const m = applyTransform(t, a);
    return Math.hypot(m.x - b.x, m.y - b.y);
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  return { t, rot, residuals, rms, max: Math.max(...residuals) };
}

/**
 * Ausrichtung nach beliebig vielen Punktpaaren (#26, ersetzt die 2-Punkt-Ausrichtung): die starre Bewegung (Drehung
 * und Verschiebung, Maßstab 1, gleiche Stadtgrundkarte), die die Summe der Abstandsquadrate |T(a_i) − b_i|² minimiert
 * (2D-Procrustes/Kabsch ohne Skalierung). Lösung in geschlossener Form: Die Verschiebung bringt den Schwerpunkt der A
 * auf den der B; mit den zentrierten Punkten p_i = a_i − ā, q_i = b_i − b̄ ist der Winkel θ = atan2(Σ p_i × q_i,
 * Σ p_i · q_i) (in Bildschirmkoordinaten mit y nach unten = im Uhrzeigersinn, wie `PageTransform.rot`). Ergebnis als
 * `PageTransform` mit Drehpunkt ā: p ↦ R(θ)(p − ā) + b̄. Für genau 2 Paare ist das die frühere 2-Punkt-Ausrichtung
 * (Mitte auf Mitte, Winkel zwischen a1→a2 und b1→b2). null bei weniger als 2 Paaren oder wenn alle A (bzw. alle B)
 * zusammenfallen.
 */
export function fitRigid(pairs: readonly PointPair[]): RigidFit | null {
  const fit = solveRigid(pairs);
  if (!fit) return null;
  let outlier: RigidFit['outlier'] = null;
  if (pairs.length >= ALIGN_OUTLIER_MIN_PAIRS) {
    // Kandidat: das Paar, ohne das die übrigen am besten zusammenpassen (kleinste mittlere Abweichung)
    let best: { index: number; rest: Omit<RigidFit, 'outlier'> } | null = null;
    pairs.forEach((_, index) => {
      const rest = solveRigid(pairs.filter((__, j) => j !== index));
      if (rest && (!best || rest.rms < best.rest.rms)) best = { index, rest };
    });
    const c = best as { index: number; rest: Omit<RigidFit, 'outlier'> } | null;
    if (c) {
      // Streuung je Achse der übrigen m Paare (Freiheitsgrade 2m − 3); ein weiterer passender Punkt läge im Mittel
      // etwa √2·σ neben ihrer Lösung
      const m = pairs.length - 1;
      const sigma = Math.sqrt((c.rest.rms * c.rest.rms * m) / (2 * m - 3));
      const pair = pairs[c.index]!;
      const q = applyTransform(c.rest.t, pair.a);
      const error = Math.hypot(q.x - pair.b.x, q.y - pair.b.y);
      if (error > ALIGN_OUTLIER_FACTOR * Math.max(Math.SQRT2 * sigma, ALIGN_DEVIATION_HINT)) outlier = { index: c.index, rmsWithout: c.rest.rms };
    }
  }
  return { ...fit, outlier };
}
