import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bgToWorld } from './background';
import { feesOf } from './fee';
import { decodeProjectFile } from './fileFormat';
import { expiredHiddenFree, hiddenEntry, pageFree } from './hiddenFree';
import { lineEnds } from './infra';
import { createInfra } from './infra';
import { createPage, createProject, createVerbund } from './model/defaults';
import type { Area, Background, FestplatzPage, Project, Stand } from './model/types';
import { planRenumber } from './numbering';
import { createStand } from './objects';
import { pagePower } from './power';
import { pageScene } from './scene/page';
import { BUILTIN_PROFILES } from './exportProfiles';
import { projectStats } from './stats';
import { standRows } from './standTable';
import {
  applyTransform,
  assignPage,
  groupOf,
  inverseTransform,
  memberPages,
  mergedPage,
  neighbourCaption,
  neighbourObjects,
  NO_NEIGHBOURS,
  rotatePageInPlace,
  straightenAngle,
  worldPage,
  ownerOf,
  pageEnv,
  pageExtent,
  pagePivot,
  transformPageContent,
  verbundRef,
  withNeighbours,
  type PageTransform,
} from './verbund';
import { cachedWarningData, countWarnings } from './warnings';
import { toLocal, toWorld } from './placement';
import { viewBackgrounds } from './verbundView';

/**
 * Festplatz-Verbund (#15). Szene: Zwei Plätze, deren Grundflächen sich bei x 45–50 überschneiden.
 * - Ziegelturm (Z): Grundfläche GZ 50 × 10 m (x 0–50, Vorderseite y = 0), Stand Z-01 bei x = 10.
 * - Seestraße (S): Grundfläche GS 50 × 10 m (x 45–95), Stand SE-02 im Überschneidungsbereich (x 46–49), SE-03 bei x = 80.
 */
const GZ: Area = { id: 'GZ', name: 'Ziegelturm', cx: 25, cy: -5, w: 50, d: 10, rot: 0 };
const GS: Area = { id: 'GS', name: 'Seestraße', cx: 70, cy: -5, w: 50, d: 10, rot: 0 };
const st = (id: string, cx: number, fields: Partial<Stand> = {}) => ({ ...createStand({ cx, cy: -1.5, w: 3, d: 3, rot: 0 }, fields), id });
const Z1 = st('z1', 10, { nr: 'Z-01', powerKw: 5 });
const SE2 = st('se2', 47.5, { nr: 'SE-02', name: 'Crêpes', powerKw: 7 });
const SE3 = st('se3', 80, { nr: 'SE-03' });
const zPage = (stands: Stand[] = [Z1], patch: Partial<FestplatzPage> = {}): FestplatzPage => ({ ...createPage('Ziegelturm'), id: 'Z', areas: [GZ], stands, ...patch });
const sPage = (stands: Stand[] = [SE2, SE3], patch: Partial<FestplatzPage> = {}): FestplatzPage => ({ ...createPage('Seestraße'), id: 'S', areas: [GS], stands, ...patch });
const verbund = { ...createVerbund('Unterstadt', ['Z', 'S']), id: 'u' };
const proj = (pages: FestplatzPage[], groups = [verbund], patch: Partial<Project> = {}): Project => ({ ...createProject('T'), pages, groups, ...patch });

describe('#15 Zugehörigkeit und Gesamtansicht', () => {
  it('groupOf, memberPages und ownerOf (Besitz = Liste der Page)', () => {
    const p = proj([zPage(), sPage(), { ...createPage('Escher'), id: 'E' }]);
    expect(groupOf(p, 'Z')).toBe(verbund);
    expect(groupOf(p, 'E')).toBeNull();
    expect(memberPages(p, verbund).map((x) => x.id)).toEqual(['Z', 'S']);
    expect(ownerOf(p, 'se2')).toBe('S');
    expect(ownerOf(p, 'z1')).toBe('Z');
    expect(ownerOf(p, 'GS')).toBe('S');
    expect(ownerOf(p, 'gibt-es-nicht')).toBeNull();
  });

  it('mergedPage: alle Objekte der Mitglieder mit gleicher Identität, Papier vom Verbund; zwischengespeichert', () => {
    const z = zPage();
    const s = sPage();
    const p = proj([z, s]);
    const m = mergedPage(p, verbund);
    expect(m.id).toBe(verbundRef('u'));
    expect(m.name).toBe('Unterstadt');
    expect(m.stands).toHaveLength(3);
    expect(m.stands[0]).toBe(Z1);
    expect(m.stands[1]).toBe(SE2);
    expect(m.areas).toEqual([GZ, GS]);
    expect(m.sheet).toBe(verbund.sheet);
    expect(m.numberingMode).toBe('manual');
    expect(mergedPage(p, verbund)).toBe(m);
    // Eine Page ohne Grundflächen (#17) bringt keine wirkenden Grundflächen mit
    const off = mergedPage(proj([zPage([Z1], { useAreas: false }), s]), verbund);
    expect(off.areas).toEqual([GS]);
    expect(off).not.toBe(m);
  });

  it('assignPage: eindeutig über die Grundfläche, sonst Ersatz-Platz', () => {
    const p = proj([zPage(), sPage()]);
    expect(assignPage(p, verbund, { cx: 10, cy: -1.5, w: 3, d: 3, rot: 0 })).toEqual({ pageId: 'Z', auto: true, candidates: ['Z'] });
    expect(assignPage(p, verbund, { cx: 80, cy: -1.5, w: 3, d: 3, rot: 0 }, 'Z')).toEqual({ pageId: 'S', auto: true, candidates: ['S'] });
    // im Überschneidungsbereich: beide → Auswahl „Neue Objekte auf: …“
    expect(assignPage(p, verbund, { cx: 47.5, cy: -1.5, w: 3, d: 3, rot: 0 }, 'S')).toEqual({ pageId: 'S', auto: false, candidates: ['Z', 'S'] });
    // auf keiner: Ersatz-Platz, ohne gültigen Ersatz das erste Mitglied
    expect(assignPage(p, verbund, { cx: 200, cy: 200, w: 3, d: 3, rot: 0 }, 'S')).toMatchObject({ pageId: 'S', auto: false, candidates: [] });
    expect(assignPage(p, verbund, { cx: 200, cy: 200, w: 3, d: 3, rot: 0 }, 'E')).toMatchObject({ pageId: 'Z', auto: false });
    // Berührung von außen zählt nicht (0,01 m Toleranz)
    expect(assignPage(p, verbund, { cx: 25, cy: 1.5, w: 3, d: 3, rot: 0 }).candidates).toEqual([]);
    // Linie ohne Stärke
    expect(assignPage(p, verbund, { cx: 80, cy: -5, w: 4, d: 0, rot: 0 }).pageId).toBe('S');
  });
});

describe('#15 Nachbarn in der Einzelansicht', () => {
  it('Ausdehnung: Hülle der Grundflächen und Objekte plus Rand; ohne Objekte der Hintergrund; sonst keine', () => {
    expect(pageExtent(zPage(), 10)).toEqual({ minX: -10, minY: -20, maxX: 60, maxY: 10 });
    expect(pageExtent({ ...createPage('leer') })).toBeNull();
    const bg: Background = { assetId: 'x', kind: 'image', fileName: 'x', pxSize: { w: 100, h: 50 }, transform: { x: 5, y: 6, metersPerPx: 1, rot: 0 }, opacity: 1, locked: false };
    expect(pageExtent({ ...createPage('nur Plan'), background: bg })).toEqual({ minX: 5, minY: 6, maxX: 105, maxY: 56 });
  });

  it('nur Objekte anderer Mitglieder in der Ausdehnung; ohne Verbund keine; Identität bleibt', () => {
    const infraTypes = createProject().infraTypes;
    const wc = { ...createInfra(infraTypes.find((t) => t.id === 'toilet')!, { cx: 52, cy: -12, w: 6, d: 2.5, rot: 0 }), id: 'wc' };
    const z = zPage();
    const p = proj([z, sPage([SE2, SE3], { infra: [wc] })]);
    const nb = neighbourObjects(p, z);
    expect(nb.stands).toEqual([SE2]);
    expect(nb.infra).toEqual([wc]);
    expect(neighbourObjects(p, z)).toBe(nb);
    // Sicht mit Vorschau (andere Liste der eigenen Stände): dieselben Nachbarn, dieselbe Identität
    expect(neighbourObjects(p, { ...z, stands: [{ ...Z1, cx: 11 }] })).toBe(nb);
    expect(neighbourObjects(proj([z, sPage()], []), z)).toBe(NO_NEIGHBOURS);
    // Mindestabstand einer Kategorie vergrößert den Rand (Konkurrenzschutz über die Platzgrenze)
    const wide = proj([z, sPage()], [verbund], { categories: [{ id: 'c', name: 'Süßwaren', color: '#ffffff', minDistance: 40, price: null }] });
    expect(neighbourObjects(wide, z).stands).toEqual([SE2, SE3]);
    expect(neighbourCaption(SE2, 'Seestraße')).toBe('SE-02 · Seestraße');
    expect(neighbourCaption({ nr: ' ', name: 'Crêpes' }, 'Seestraße')).toBe('Crêpes · Seestraße');
  });

  it('Freiflächen: Nachbarstände belegen mit', () => {
    const z = zPage();
    const p = proj([z, sPage()]);
    const ctx = { minFreeWidth: 0.5, infraTypes: p.infraTypes };
    const spans = (all: ReturnType<typeof pageFree>) => all.flatMap((a) => a.free.map((f) => [f.start, f.end]));
    expect(spans(pageFree(z, ctx))).toEqual([
      [0, 8.5],
      [11.5, 50],
    ]);
    expect(spans(pageFree(z, { ...ctx, verbund: p }))).toEqual([
      [0, 8.5],
      [11.5, 46],
      [49, 50],
    ]);
  });

  it('Überlappung: Warnung nur am eigenen Stand, auf beiden Plätzen jeweils am eigenen', () => {
    const Z2 = st('z2', 48.5, { nr: 'Z-02' });
    const z = zPage([Z1, Z2]);
    const s = sPage();
    const p = proj([z, s]);
    const settings = p.settings;
    const wz = cachedWarningData(z.stands, z.infra, pageEnv(p, z), p);
    expect(wz.page.byStand.get('z2')!.overlaps).toEqual(['se2']);
    expect(countWarnings(wz.page, z.stands, settings)).toMatchObject({ stands: 1, overlap: 1 });
    const ws = cachedWarningData(s.stands, s.infra, pageEnv(p, s), p);
    expect(countWarnings(ws.page, s.stands, settings)).toMatchObject({ stands: 1, overlap: 1 });
    // ohne Verbund keine Überlappung
    const solo = proj([z, s], []);
    expect(countWarnings(cachedWarningData(z.stands, z.infra, pageEnv(solo, z), solo).page, z.stands, settings).overlap).toBe(0);
    // Kennzahlen, Tab-Zähler und Geschäftstabelle sehen die Warnung ebenso
    const stats = projectStats(p, (pg) => pageFree(pg, { minFreeWidth: 0.5, infraTypes: p.infraTypes, verbund: p }));
    expect(stats.pages.map((x) => x.warnings.overlap)).toEqual([1, 1]);
    expect(standRows(p).find((r) => r.stand.id === 'z2')!.warnings.overlap).toBe(true);
    expect(standRows(p).find((r) => r.stand.id === 'z1')!.warnings.overlap).toBe(false);
  });

  it('Abstand (Konkurrenzschutz) über die Platzgrenze; Infrastruktur eines Nachbarn warnt nicht (Entscheidung 2026-11-09)', () => {
    const categories = [{ id: 'c', name: 'Crêpes', color: '#ffffff', minDistance: 20, price: null }];
    const Z3 = st('z3', 30, { categoryId: 'c', name: 'Waffeln' });
    const SE2c = { ...SE2, categoryId: 'c' };
    const z = zPage([Z1, Z3]);
    const infraTypes = createProject().infraTypes;
    const rtw = { ...createInfra(infraTypes.find((t) => t.id === 'ambulance')!, { cx: 10, cy: -3, w: 8, d: 3.5, rot: 0 }), id: 'rtw' };
    // Enge Durchfahrt der Seestraße unter der Mindestbreite, ebenfalls in der Ausdehnung des Ziegelturms
    const passage = { ...createInfra(infraTypes.find((t) => t.id === 'narrowPassage')!, { cx: 20, cy: -8, w: 2, d: 0, rot: 0 }), id: 'eng' };
    const p = proj([z, sPage([SE2c, SE3], { infra: [rtw, passage] })], [verbund], { categories });
    const env = pageEnv(p, z);
    // Beide Objekte sind Nachbarn (blass sichtbar) …
    expect(env.neighbours.infra.map((o) => o.id)).toEqual(['rtw', 'eng']);
    const w = cachedWarningData(z.stands, z.infra, env, p);
    expect(w.distance.get('z3')!.map((c) => [c.id, c.dist])).toEqual([['se2', 14.5]]);
    // … aber das RTW-Feld der Seestraße auf Z-01 und ihre zu enge Durchfahrt warnen auf dem Ziegelturm nicht
    expect(w.infra.byStand.has('z1')).toBe(false);
    expect(w.infra.narrow.size).toBe(0);
    expect(countWarnings(w.page, z.stands, p.settings, undefined, { warnings: w.infra, objects: z.infra }, w.distance)).toMatchObject({ stands: 1, distance: 1, infra: 0, narrow: 0 });
    // Das RTW-Feld belegt aber die Freifläche unter sich (Achse 6–14 m)
    const free = pageFree(z, { minFreeWidth: 0.5, infraTypes, verbund: p })[0]!.free.map((f) => [f.start, f.end]);
    expect(free[0]).toEqual([0, 6]);
    // Dasselbe Feld als eigenes Objekt des Ziegelturms warnt wie bisher
    const own = zPage([Z1, Z3], { infra: [rtw] });
    const p2 = proj([own, sPage([SE2c, SE3])], [verbund], { categories });
    const w2 = cachedWarningData(own.stands, own.infra, pageEnv(p2, own), p2);
    expect(w2.infra.byStand.get('z1')).toEqual(['rtw']);
  });

  it('„außerhalb“ über alle wirkenden Grundflächen des Verbunds; ohne Grundflächen keine', () => {
    const out = st('out', 60);
    const z = zPage([Z1, out]);
    const p = proj([z, sPage()]);
    const settings = p.settings;
    const env = pageEnv(p, z);
    expect(env.outside).toEqual([GZ, GS]);
    // alle Mitglieder teilen dieselbe Liste (Zwischenspeicher „außerhalb“ je Stand)
    expect(pageEnv(p, p.pages[1]!).outside).toBe(env.outside);
    expect(countWarnings(cachedWarningData(z.stands, z.infra, env, p).page, z.stands, settings).outside).toBe(0);
    const solo = proj([z, sPage()], []);
    expect(countWarnings(cachedWarningData(z.stands, z.infra, pageEnv(solo, z), solo).page, z.stands, settings).outside).toBe(1);
    // Seestraße ohne Grundflächen (#17): ihre Grundflächen wirken nicht, auch nicht für den Ziegelturm
    const sOff = proj([z, sPage([SE2, SE3], { useAreas: false })]);
    expect(pageEnv(sOff, z).outside).toBe(z.areas);
    expect(pageEnv(sOff, sOff.pages[1]!).outside).toBeNull();
  });

  it('Statistik, Strom, Standgeld, Nummerierung und Geschäftstabelle zählen nur eigene Stände', () => {
    const z = zPage();
    const p = proj([z, sPage()], [verbund], { settings: { ...createProject().settings, pricing: { perMeter: 10, roundUpMeters: false, vatRate: 19 } } });
    const stats = projectStats(p, (pg) => pageFree(pg, { minFreeWidth: 0.5, infraTypes: p.infraTypes, verbund: p }));
    expect(stats.pages.map((x) => x.stands)).toEqual([1, 2]);
    expect(stats.total.stands).toBe(3);
    expect(stats.pages[0]!.power.sumKw).toBe(5);
    expect(pagePower(z).sumKw).toBe(5);
    expect(stats.pages[0]!.fee.net).toBe(30);
    expect(feesOf(z.stands, [], p.settings.pricing)).toHaveLength(1);
    // Freie Frontmeter des Ziegelturms ohne den Platz unter SE-02
    expect(stats.pages[0]!.freeFrontM).toBe(8.5 + 34.5 + 1);
    expect(planRenumber(p, 'Z').changes.map((c) => c.standId)).toEqual(['z1']);
    expect(standRows(p).filter((r) => r.pageId === 'Z').map((r) => r.stand.id)).toEqual(['z1']);
  });

  it('Ausblendungen verfallen, wenn ein Nachbarstand die Lücke verändert', () => {
    const z0 = zPage();
    const p0 = proj([z0, sPage()]);
    const free = pageFree(z0, { minFreeWidth: 0.5, infraTypes: p0.infraTypes, verbund: p0 });
    const gap = free[0]!.free.find((f) => f.start === 11.5)!;
    expect(gap.end).toBe(46);
    const z = { ...z0, hiddenFree: [hiddenEntry(gap)] };
    const before = proj([z, sPage()]);
    // unverändert: nichts verfällt
    expect(expiredHiddenFree(before, proj([z, before.pages[1]!])).size).toBe(0);
    // SE-02 wird verschoben: Die Lücke auf dem Ziegelturm ändert sich, die Ausblendung verfällt
    const after = proj([z, sPage([{ ...SE2, cx: 48 }, SE3])]);
    expect(expiredHiddenFree(before, after).get('Z')).toEqual([]);
  });


  it('PDF: Nachbarn werden nicht gezeichnet, belegen aber die Freiflächen', () => {
    const z = zPage([Z1], { sheet: { ...createPage('x').sheet, format: 'A3', scale: null } });
    const p = proj([z, sPage()]);
    const scene = pageScene(z, p, BUILTIN_PROFILES[0]!);
    const stands = scene.layers.find((l) => l.id === 'stands')!;
    expect(stands.prims.length).toBeGreaterThan(0);
    // genau ein Stand (Z-01) gezeichnet: Alle Punkte liegen bei x 8,5–11,5
    const xs = stands.prims.flatMap((pr) => ('points' in pr ? (pr.points as { x: number }[]).map((q) => q.x) : []));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(11.5);
    const freeLabels = scene.layers.find((l) => l.id === 'labels')!.prims.filter((pr) => pr.t === 'text' && JSON.stringify(pr).includes('Frei'));
    expect(freeLabels).toHaveLength(3);
  });

  it('withNeighbours: ohne Nachbarn die eigene Liste, sonst zwischengespeichert', () => {
    const own = [Z1];
    expect(withNeighbours(own, [])).toBe(own);
    const extra = [SE2];
    const both = withNeighbours<Stand>(own, extra);
    expect(both).toEqual([Z1, SE2]);
    expect(withNeighbours<Stand>(own, extra)).toBe(both);
  });
});

describe('#15 transformPageContent', () => {
  const infraTypes = createProject().infraTypes;
  const type = (id: string) => infraTypes.find((t) => t.id === id)!;
  const bg: Background = { assetId: 'a', kind: 'image', fileName: 'plan.png', pxSize: { w: 800, h: 600 }, transform: { x: -12.5, y: 3.25, metersPerPx: 0.1, rot: 10 }, opacity: 0.8, locked: true };
  const full = (): FestplatzPage => ({
    ...createPage('Seestraße'),
    id: 'S',
    areas: [{ id: 'a', name: 'Nord', cx: 25, cy: -5, w: 50, d: 10, rot: 15 }],
    stands: [
      {
        ...createStand({ cx: 10, cy: -1.5, w: 25, d: 12, rot: 350 }, { labelOffset: { x: 2.5, y: -4 }, frontOverride: 24 }),
        id: 's',
        parts: [
          { kind: 'rect', x: 0.1, y: 0, w: 0.8, h: 1, rot: 0 },
          { kind: 'ellipse', x: 0, y: 0.2, w: 0.1, h: 0.58, rot: 30 },
        ],
      },
    ],
    infra: [
      { ...createInfra(type('barrierMobile'), { cx: 30, cy: 4, w: 3.5, d: 0.3, rot: 20 }), id: 'line' },
      { ...createInfra(type('marker'), { cx: 5, cy: 5, w: 0, d: 0, rot: 0 }), id: 'pt', label: 'Treffpunkt' },
      { ...createInfra(type('toilet'), { cx: 40, cy: -8, w: 6, d: 2.5, rot: 90 }), id: 'wc' },
    ],
    background: bg,
    sheet: { format: 'region', orientation: 'landscape', scale: 500, cx: 20, cy: 0, margin: null, targetWidth: 841, region: { cx: 22, cy: -3, w: 80, h: 30 } },
    numberingMode: 'direction',
    clockwise: { center: { x: 25, y: -5 }, startAngle: 90 },
    direction: { from: { x: 0, y: -1 }, to: { x: 50, y: -1 } },
    northAngle: 20,
    hiddenFree: [{ key: 'a|^|s', start: 0, end: 2.5 }],
    view: { scale: 10, tx: 100, ty: 50 },
  });
  const t: PageTransform = { dx: 12.34, dy: -5.67, rot: 33.3, pivot: { x: 5, y: 7 } };

  /** Alle Zahlen zweier Objekte vergleichen (Drehungen modulo 360). */
  const close = (a: unknown, b: unknown, digits: number, path = ''): void => {
    if (typeof a === 'number' && typeof b === 'number') {
      const d = Math.abs(a - b);
      expect(Math.min(d, Math.abs(d - 360)), path).toBeLessThan(10 ** -digits);
      return;
    }
    if (a && b && typeof a === 'object') {
      expect(Object.keys(a as object).toSorted(), path).toEqual(Object.keys(b as object).toSorted());
      for (const k of Object.keys(a as object)) close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], digits, `${path}.${k}`);
      return;
    }
    expect(a, path).toEqual(b);
  };

  it('Hin- und Rücktransformation ergibt das Original (ungerundet exakt, gerundet bis auf 0,01 m)', () => {
    const page = full();
    const there = transformPageContent(page, t, { round: false });
    close(transformPageContent(there, inverseTransform(t), { round: false }), page, 9);
    const rounded = transformPageContent(transformPageContent(page, t), inverseTransform(t));
    close(rounded, page, 1.9);
    // reine Verschiebung um ganze cm: auch gerundet exakt
    const move = { dx: 3.25, dy: -7.5, rot: 0, pivot: { x: 0, y: 0 } };
    expect(transformPageContent(transformPageContent(page, move), inverseTransform(move))).toEqual(page);
  });

  it('bildet alles ab: Mitten, Drehungen, Linien, Beschriftung, Hintergrund, Blatt, Mittelpunkt, A/B, Norden, Ansicht', () => {
    const page = full();
    const out = transformPageContent(page, t, { round: false });
    const map = (p: { x: number; y: number }) => applyTransform(t, p);
    close({ x: out.areas[0]!.cx, y: out.areas[0]!.cy }, map({ x: 25, y: -5 }), 9);
    expect(out.areas[0]!.rot).toBeCloseTo(48.3, 9);
    const s = out.stands[0]!;
    expect(s.rot).toBeCloseTo(23.3, 9);
    // Teile hängen am Stand und bleiben; Frontmeter von Hand ebenso
    expect(s.parts).toBe(page.stands[0]!.parts);
    expect(s.frontOverride).toBe(24);
    // Beschriftung bleibt relativ zum Stand an derselben Stelle des Plans
    const label0 = { x: 10 + 2.5, y: -1.5 - 4 };
    close({ x: s.cx + s.labelOffset!.x, y: s.cy + s.labelOffset!.y }, map(label0), 9);
    // Linie: beide Endpunkte abgebildet
    const [a0, b0] = lineEnds(page.infra[0]!);
    const [a1, b1] = lineEnds(out.infra[0]!);
    close(a1, map(a0), 9);
    close(b1, map(b0), 9);
    // Punkt: keine Drehung
    expect(out.infra[1]!.rot).toBe(0);
    close({ x: out.infra[1]!.cx, y: out.infra[1]!.cy }, map({ x: 5, y: 5 }), 9);
    // Hintergrund: jeder Planpunkt landet an der abgebildeten Stelle, Kalibrierung und Sperre bleiben
    for (const src of [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 123, y: 456 }]) close(bgToWorld(out.background!.transform, src), map(bgToWorld(bg.transform, src)), 9);
    expect(out.background).toMatchObject({ locked: true, opacity: 0.8, pxSize: bg.pxSize });
    // Blatt: Mitte abgebildet; Ausschnitt achsenparallel, nur die Mitte wandert
    close({ x: out.sheet.cx, y: out.sheet.cy }, map({ x: 20, y: 0 }), 9);
    close({ x: out.sheet.region!.cx, y: out.sheet.region!.cy }, map({ x: 22, y: -3 }), 9);
    expect(out.sheet.region).toMatchObject({ w: 80, h: 30 });
    expect(out.sheet).toMatchObject({ format: 'region', scale: 500 });
    // Mittelpunkt (Startrichtung relativ zum Norden bleibt), A/B folgen, Norden dreht mit
    close(out.clockwise!.center, map({ x: 25, y: -5 }), 9);
    expect(out.clockwise!.startAngle).toBe(90);
    close(out.direction!.from, map({ x: 0, y: -1 }), 9);
    close(out.direction!.to, map({ x: 50, y: -1 }), 9);
    expect(out.northAngle).toBeCloseTo(53.3, 9);
    // Papier-Elemente, Ausblendungen und Raster bleiben
    expect(out.titleBlock).toBe(page.titleBlock);
    expect(out.hiddenFree).toBe(page.hiddenFree);
    expect(out.grid).toBe(page.grid);
    // Ansicht: Drehpunkt bleibt an seiner Bildschirmstelle
    expect(out.view).toEqual({ scale: 10, tx: 100 - 123.4, ty: 50 + 56.7 });
  });

  it('gerundet: nur Gleitkomma-Reste entfallen (10⁻⁸); Drehungen bleiben auf 0,1°', () => {
    const out = transformPageContent(full(), t);
    for (const r of [...out.areas, ...out.stands, ...out.infra]) {
      expect(Math.round(r.cx * 1e8) / 1e8).toBe(r.cx);
      expect(Math.round(r.cy * 1e8) / 1e8).toBe(r.cy);
      expect(Math.round(r.rot * 10) / 10).toBe(r.rot);
    }
    // 90° um den Ursprung: exakte Werte ohne Reste wie 6e-17
    const quarter = transformPageContent(full(), { dx: 0, dy: 0, rot: 90, pivot: { x: 0, y: 0 } });
    expect(quarter.areas[0]).toMatchObject({ cx: 5, cy: 25, rot: 105 });
  });

  it('Drehen erzeugt keine Fehlwarnungen: bündige Stände bleiben innerhalb und ohne Überlappung, Freiflächen gleich', () => {
    // Nicht auf 0,01 m runden: Einzeln gerundet verschöben sich Stand und Grundfläche bzw. zwei bündige Stände um bis zu
    // etwa 0,014 m gegeneinander (mehr als die Toleranz); vorher bei 66 von 515 Winkeln eine Fehlwarnung
    const area: Area = { id: 'A', name: '', cx: 45, cy: -5, w: 90, d: 10, rot: 0 };
    const stands = Array.from({ length: 30 }, (_, i) => st(`b${i}`, 1.5 + 3 * i));
    const flat: FestplatzPage = { ...createPage('bündig'), areas: [area], stands: stands.filter((_, i) => i % 7 !== 3) };
    const p = proj([flat], []);
    const ctx = { minFreeWidth: 0.5, infraTypes: p.infraTypes };
    const widths = (pg: FestplatzPage) => pageFree(pg, ctx).flatMap((a) => a.free.map((f) => Math.round((f.end - f.start) * 1000) / 1000));
    const before = widths(flat);
    expect(before).toHaveLength(4);
    for (let r = 0.1; r < 360; r += 0.7) {
      const q = transformPageContent(flat, { dx: 12.34, dy: -5.67, rot: Math.round(r * 10) / 10, pivot: { x: 0.003, y: 0 } });
      const w = cachedWarningData(q.stands, q.infra, pageEnv(p, q), p);
      expect(countWarnings(w.page, q.stands, p.settings), `Drehung ${Math.round(r * 10) / 10}°`).toMatchObject({ outside: 0, overlap: 0 });
      expect(widths(q), `Drehung ${Math.round(r * 10) / 10}°`).toEqual(before);
    }
  });

  it('Lastprojekt: Drehen und Verschieben jedes Platzes ändert weder Warnungen noch Freiflächen', () => {
    // vorher (Rundung auf 0,01 m): bei 183 von 392 Fällen andere Warnungen und über 10 000 Freiflächen Unterschied
    const project = decodeProjectFile(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'last-500-staende.schelme')))).project;
    const ctx = { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes };
    const sig = (pg: FestplatzPage) => {
      const w = cachedWarningData(pg.stands, pg.infra, pageEnv(project, pg), project);
      const free = pageFree(pg, ctx).flatMap((a) => a.free.map((f) => `${f.key} ${(f.end - f.start).toFixed(3)}`));
      return { warnings: countWarnings(w.page, pg.stands, project.settings, undefined, { warnings: w.infra, objects: pg.infra }, w.distance), free };
    };
    for (const pg of project.pages) {
      const before = sig(pg);
      for (const rot of [7.3, 45, 123.4, 271.9]) expect(sig(transformPageContent(pg, { dx: 12.34, dy: 5.67, rot, pivot: pagePivot(pg) })), `${pg.name} ${rot}°`).toEqual(before);
    }
  });

  it('ausgeblendete Freiflächen bleiben nach Verschieben und Drehen gültig', () => {
    const page: FestplatzPage = {
      ...createPage('P'),
      areas: [{ id: 'a', name: '', cx: 25, cy: -5, w: 50, d: 10, rot: 0 }],
      stands: [st('x', 10), st('y', 30)],
    };
    const ctx = { minFreeWidth: 0.5, infraTypes };
    const gap = pageFree(page, ctx)[0]!.free.find((f) => f.start === 11.5)!;
    const hidden = { ...page, hiddenFree: [hiddenEntry(gap)] };
    expect(pageFree(hidden, ctx)[0]!.hidden).toHaveLength(1);
    const moved = transformPageContent(hidden, { dx: 101.37, dy: -40.02, rot: 37.5, pivot: pagePivot(hidden) });
    const after = pageFree(moved, ctx)[0]!;
    expect(after.hidden.map((f) => f.key)).toEqual([gap.key]);
    // Die Rundung auf 0,01 m nach der Drehung verschiebt Stände um höchstens etwa 0,005 m gegen die Grundfläche;
    // das liegt in der Toleranz der Ausblendung (0,01 m)
    const spans = after.free.map((f) => [f.start, f.end]).flat();
    [0, 8.5, 31.5, 50].forEach((v, i) => expect(Math.abs(spans[i]! - v)).toBeLessThanOrEqual(0.01));
  });

  it('pagePivot: Mitte der Objekte, ohne Objekte der Ursprung', () => {
    expect(pagePivot(zPage())).toEqual({ x: 25, y: -5 });
    expect(pagePivot(createPage('leer'))).toEqual({ x: 0, y: 0 });
  });
});

/**
 * #27: Jede Page behält ihr eigenes Koordinatensystem, der Verbund speichert die Lage. Referenz: die Szene oben mit
 * gemeinsamem System (alle Lagen Identität). Dieselbe Szene „gedreht“: beide Plätze liegen in eigenen, gedrehten
 * Koordinaten (Inhalt = Lage⁻¹ · Referenz), der Verbund speichert die Lagen. Alles über Platzgrenzen muss gleich sein.
 */
describe('#27 Lage im Verbund: gleiche Ergebnisse wie mit gemeinsamem System', () => {
  const PZ = { x: -5, y: 3, rot: 320 };
  const PS = { x: 37.5, y: -12.25, rot: 23.4 };
  const Z2 = st('z2', 48.5, { nr: 'Z-02' });
  const OUT = st('out', 60);
  const local = <T extends Stand | Area>(p: typeof PZ, list: T[]) => list.map((o) => toLocal(p, o));
  const ref = () => proj([zPage([Z1, Z2, OUT]), sPage()]);
  const rotated = () =>
    proj([zPage(local(PZ, [Z1, Z2, OUT]), { areas: local(PZ, [GZ]) }), sPage(local(PS, [SE2, SE3]), { areas: local(PS, [GS]) })], [{ ...verbund, placements: { Z: PZ, S: PS } }]);
  const near = (a: { cx: number; cy: number; rot: number }, b: { cx: number; cy: number; rot: number }) => {
    expect(a.cx).toBeCloseTo(b.cx, 8);
    expect(a.cy).toBeCloseTo(b.cy, 8);
    expect((((a.rot - b.rot) % 360) + 540) % 360 - 180).toBeCloseTo(0, 8);
  };

  it('Gesamtansicht: Objekte in der Welt wie in der Referenz, gleiche IDs; Einzelansicht in eigenen Koordinaten', () => {
    const r = mergedPage(ref(), verbund);
    const p = rotated();
    const m = mergedPage(p, p.groups[0]!);
    expect(m.stands.map((x) => x.id)).toEqual(r.stands.map((x) => x.id));
    m.stands.forEach((x, i) => near(x, r.stands[i]!));
    m.areas.forEach((x, i) => near(x, r.areas[i]!));
    expect(ownerOf(p, 'se2')).toBe('S');
    // zwischengespeichert: gleiche Kopien beim zweiten Mal
    expect(mergedPage(p, p.groups[0]!)).toBe(m);
    expect(mergedPage({ pages: [...p.pages] }, p.groups[0]!).stands[3]).toBe(m.stands[3]);
    // Zuordnung in der Welt
    expect(assignPage(p, p.groups[0]!, { cx: 80, cy: -3, w: 2, d: 2, rot: 0 }).pageId).toBe('S');
    expect(assignPage(p, p.groups[0]!, { cx: 10, cy: -3, w: 2, d: 2, rot: 0 }).pageId).toBe('Z');
  });

  it('Nachbarn, Freiflächen, Überlappung und „außerhalb“ der Einzelansichten wie in der Referenz', () => {
    const r = ref();
    const p = rotated();
    for (const id of ['Z', 'S']) {
      const P = id === 'Z' ? PZ : PS;
      const rp = r.pages.find((x) => x.id === id)!;
      const pp = p.pages.find((x) => x.id === id)!;
      // Nachbarn im System der Page; in die Welt gerechnet wie in der Referenz
      const rn = neighbourObjects(r, rp);
      const pn = neighbourObjects(p, pp);
      expect(pn.stands.map((x) => x.id)).toEqual(rn.stands.map((x) => x.id));
      pn.stands.forEach((x, i) => near(toWorld(P, x), rn.stands[i]!));
      expect(neighbourObjects(p, pp)).toBe(pn);
      // Freiflächen (Achse der Grundfläche, unabhängig vom System)
      const ctxR = { minFreeWidth: 0.5, infraTypes: r.infraTypes, verbund: r };
      const ctxP = { minFreeWidth: 0.5, infraTypes: p.infraTypes, verbund: p };
      const spans = (all: ReturnType<typeof pageFree>) => all.flatMap((a) => a.free.map((f) => [f.key, +f.start.toFixed(6) || 0, +f.end.toFixed(6) || 0]));
      expect(spans(pageFree(pp, ctxP))).toEqual(spans(pageFree(rp, ctxR)));
      // Warnungen
      const wr = cachedWarningData(rp.stands, rp.infra, pageEnv(r, rp), r);
      const wp = cachedWarningData(pp.stands, pp.infra, pageEnv(p, pp), p);
      expect(countWarnings(wp.page, pp.stands, p.settings)).toEqual(countWarnings(wr.page, rp.stands, r.settings));
      for (const x of pp.stands) expect(wp.page.byStand.get(x.id)).toEqual(wr.page.byStand.get(x.id));
    }
    // konkret: Z-02 überlappt SE-02, „out“ (x 60) steht auf der Grundfläche der Seestraße und ist innerhalb
    const z = p.pages[0]!;
    const w = cachedWarningData(z.stands, z.infra, pageEnv(p, z), p);
    expect(w.page.byStand.get('z2')!.overlaps).toEqual(['se2']);
    expect(w.page.byStand.get('out')!.outside).toBe(false);
  });

  it('Einzelansicht und Einzel-PDF hängen nicht von der eigenen Lage ab: Szene wie ohne Verbund bzw. bei gleicher relativer Lage identisch', () => {
    const prof = BUILTIN_PROFILES[0]!;
    // Seestraße weit weg (keine Nachbarn): Szene des Ziegelturms wie ohne Verbund
    const far = { x: 5000, y: 0, rot: 77 };
    const z = zPage([Z1, Z2]);
    const solo = proj([z, sPage()], []);
    const inV = proj([z, sPage()], [{ ...verbund, placements: { Z: PS, S: far } }]);
    expect(neighbourObjects(inV, z)).toBe(NO_NEIGHBOURS);
    expect(pageScene(z, inV, prof)).toEqual(pageScene(z, solo, prof));
    // Mit Nachbarn: beide Lagen um dieselbe Bewegung geändert → relative Lage gleich → Szene exakt gleich
    const a = proj([z, sPage()], [{ ...verbund, placements: { Z: { x: 0, y: 0, rot: 0 }, S: { x: 0, y: 0, rot: 0 } } }]);
    const b = proj([z, sPage()], [{ ...verbund, placements: { Z: PS, S: { ...PS } } }]);
    expect(pageScene(z, b, prof)).toEqual(pageScene(z, a, prof));
  });

  it('Hintergründe der Gesamtansicht in der Welt; worldPage für „Ausrichten“', () => {
    const bg: Background = { assetId: 'x', kind: 'image', fileName: 'x', pxSize: { w: 100, h: 50 }, transform: { x: 5, y: 6, metersPerPx: 1, rot: 0 }, opacity: 1, locked: false };
    const p = rotated();
    p.pages[1] = { ...p.pages[1]!, background: bg, northAngle: 10 };
    const bgs = viewBackgrounds(p, mergedPage(p, p.groups[0]!));
    expect(bgs.map((b) => b.pageId)).toEqual(['S']);
    expect(bgs[0]!.background.transform.rot).toBeCloseTo(23.4, 9);
    // Einzelansicht: der eigene, ungedrehte Hintergrund
    expect(viewBackgrounds(p, p.pages[1]!)[0]!.background).toBe(bg);
    const w = worldPage(p.groups[0]!, p.pages[1]!);
    expect(w.northAngle).toBeCloseTo(33.4, 9);
    near(w.stands[0]!, SE2);
    expect(worldPage(p.groups[0]!, p.pages[1]!)).toBe(w);
    // Nordrichtung der Gesamtansicht: erstes Mitglied samt Drehung seiner Lage
    expect(mergedPage(p, p.groups[0]!).northAngle).toBeCloseTo(320, 9);
  });

  it('rotatePageInPlace: Inhalt lokal gedreht, Lage ausgeglichen, Welt unverändert; straightenAngle stellt den Hintergrund gerade', () => {
    const p = rotated();
    const g = p.groups[0]!;
    const s0 = p.pages[1]!;
    const bg: Background = { assetId: 'x', kind: 'image', fileName: 'x', pxSize: { w: 100, h: 50 }, transform: { x: 5, y: 6, metersPerPx: 1, rot: 336.6 }, opacity: 1, locked: false };
    const s = { ...s0, background: bg };
    expect(straightenAngle(s)).toBeCloseTo(23.4, 9);
    expect(straightenAngle({ background: null })).toBe(0);
    const r = rotatePageInPlace(s, PS, straightenAngle(s));
    expect(r.page.background!.transform.rot).toBe(0);
    expect(r.placement.rot).toBeCloseTo(0, 6);
    const g2 = { ...g, placements: { ...g.placements, S: r.placement } };
    const before = worldPage(g, s);
    const after = worldPage(g2, r.page);
    after.stands.forEach((x, i) => near(x, before.stands[i]!));
    after.areas.forEach((x, i) => near(x, before.areas[i]!));
    // die Seestraße liegt jetzt in ihrer Einzelansicht wie in der Welt (Lage ohne Drehung)
    near(r.page.areas[0]!, { ...GS, cx: GS.cx - r.placement.x, cy: GS.cy - r.placement.y });
  });
});
