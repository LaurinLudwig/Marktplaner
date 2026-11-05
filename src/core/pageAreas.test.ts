import { describe, expect, it } from 'vitest';
import { expiredHiddenFree, pageFree } from './hiddenFree';
import { allSelectable, objectsInBounds, pickObject } from './hit';
import { legendEntries } from './legend';
import { createPage, createProject } from './model/defaults';
import type { Area, FestplatzPage, Project, Stand } from './model/types';
import { BUILTIN_PROFILES } from './exportProfiles';
import { computeMoveSnap } from './moveSnap';
import { defaultClockwiseCenter } from './numbering';
import { createStand } from './objects';
import { activeAreas, frontSnapAreas, NO_AREAS, outsideRef, usesAreas } from './pageAreas';
import { pageScene } from './scene/page';
import { contentBounds } from './sheet';
import { projectStats } from './stats';
import { cachedPageWarnings, countWarnings, isOutside, pageWarnings } from './warnings';

/**
 * Festplatz ohne Grundflächen (#17, spec.md §2): Schalter `useAreas` je Page. Szene: Grundfläche G 50 × 10 m mit
 * der Vorderseite bei y = 0 (x 0–50), Stand A darin, Stand B weit außerhalb.
 */

const G: Area = { id: 'G', name: 'Nord', cx: 25, cy: -5, w: 50, d: 10, rot: 0 };
const A = createStand({ cx: 10, cy: -1.5, w: 3, d: 3, rot: 0 });
const B = createStand({ cx: 100, cy: 40, w: 3, d: 3, rot: 0 });
const page = (useAreas: boolean, patch: Partial<FestplatzPage> = {}): FestplatzPage => ({ ...createPage('Obermarkt'), areas: [G], stands: [A, B], useAreas, ...patch });
const ctx = { minFreeWidth: 0.5, infraTypes: createProject().infraTypes };
const proj = (pages: FestplatzPage[]): Project => ({ ...createProject('T'), pages });

describe('#17 Grundflächen verwenden: Standard und Zugriff', () => {
  it('neue Pages verwenden Grundflächen; Teilobjekte ohne Feld gelten als an', () => {
    expect(createPage('X').useAreas).toBe(true);
    expect(usesAreas({ areas: [] })).toBe(true);
    expect(usesAreas({ areas: [], useAreas: false })).toBe(false);
  });

  it('aus: gespeicherte Grundflächen bleiben, wirken aber nicht (gemeinsame leere Liste)', () => {
    const p = page(false);
    expect(p.areas).toEqual([G]);
    expect(activeAreas(p)).toBe(NO_AREAS);
    expect(activeAreas(page(true))).toEqual([G]);
    expect(outsideRef(p)).toBeNull();
    expect(outsideRef(page(true))).toEqual([G]);
  });
});

describe('#17 Warnung „außerhalb“', () => {
  it('isOutside: ohne Grundflächen (null) nie, mit leerer Liste wie bisher immer', () => {
    expect(isOutside(B, [G])).toBe(true);
    expect(isOutside(A, [G])).toBe(false);
    expect(isOutside(B, null)).toBe(false);
    expect(isOutside(B, [])).toBe(true);
  });

  it('keine Warnung „außerhalb“ auf der Page; das Häkchen am Stand bleibt gespeichert; Überlappung bleibt', () => {
    const C = createStand({ cx: 101, cy: 40, w: 3, d: 3, rot: 0 }, { suppressOutsideWarning: true });
    const settings = createProject().settings;
    const on = page(true, { stands: [A, B, C] });
    const off = page(false, { stands: [A, B, C] });
    expect(countWarnings(pageWarnings(outsideRef(on), on.stands), on.stands, settings)).toMatchObject({ stands: 2, outside: 0, overlap: 2 });
    const w = pageWarnings(outsideRef(off), off.stands);
    expect([...w.byStand.values()].some((x) => x.outside)).toBe(false);
    expect(w.byStand.get(B.id)!.overlaps).toEqual([C.id]);
    expect(off.stands[2]!.suppressOutsideWarning).toBe(true);
    const onlyOutside = page(true, { stands: [A, B] });
    expect(countWarnings(cachedPageWarnings(outsideRef(onlyOutside), onlyOutside.stands), onlyOutside.stands, settings).outside).toBe(1);
    const offOnly = { ...onlyOutside, useAreas: false };
    // Gleiche Liste der Stände, anderer Bezug: der Zwischenspeicher rechnet neu
    expect(countWarnings(cachedPageWarnings(outsideRef(offOnly), offOnly.stands), offOnly.stands, settings).stands).toBe(0);
  });
});

describe('#17 Freiflächen, Ausblendungen, Kennzahlen', () => {
  it('ohne Grundflächen keine Freiflächen', () => {
    expect(pageFree(page(true), ctx).flatMap((a) => a.free).length).toBe(2);
    expect(pageFree(page(false), ctx)).toEqual([]);
  });

  it('Ausblendungen verfallen nicht, solange die Page keine Grundflächen verwendet; beim Wiedereinschalten wird geprüft', () => {
    const left = pageFree(page(true), ctx)[0]!.free[0]!;
    const hidden = [{ key: left.key, start: left.start, end: left.end }];
    const before = proj([page(false, { hiddenFree: hidden })]);
    // Stand A wandert während „aus“: die Ausblendung bleibt stehen
    const moved = proj([page(false, { hiddenFree: hidden, stands: [{ ...A, cx: 20 }, B] })]);
    expect(expiredHiddenFree(before, moved).size).toBe(0);
    // Wiedereinschalten: Die Lücke hat sich geändert, die Ausblendung verfällt
    const back = proj([{ ...moved.pages[0]!, useAreas: true }]);
    expect(expiredHiddenFree(moved, back).get(back.pages[0]!.id)).toEqual([]);
  });

  it('Start-Page: freie Frontmeter null („–“), nicht in der Summe; ohne jede Page mit Grundflächen auch gesamt null', () => {
    const freeOf = (p: FestplatzPage) => pageFree(p, ctx);
    // 50 m Vorderseite, Stand A 3 m breit → 47 m frei
    const on = page(true);
    const off = { ...page(false), id: 'off' };
    const s = projectStats(proj([on, off]), freeOf);
    expect(s.pages.map((p) => p.freeFrontM)).toEqual([47, null]);
    expect(s.total.freeFrontM).toBe(47);
    // Frontmeter (Standbreite) und Anzahl bleiben
    expect(s.pages[1]!.frontM).toBe(6);
    expect(projectStats(proj([off]), freeOf).total.freeFrontM).toBeNull();
    expect(projectStats(proj([]), freeOf).total.freeFrontM).toBe(0);
    // Keine Warnung „außerhalb“ in den Kennzahlen
    expect(s.pages[1]!.warnings.outside).toBe(0);
    expect(s.pages[0]!.warnings.outside).toBe(1);
  });
});

describe('#17 Legende, Auswahl, Hüllrechteck, Nummerierung', () => {
  const project = { categories: [], infraTypes: [], settings: { defaultStandColor: '#888888' } };

  it('Legende ohne „Grundfläche“ und „Freifläche“', () => {
    const on = page(true);
    expect(legendEntries(on, project, on.layers, true).map((e) => e.kind)).toEqual(['area', 'free', 'noCategory']);
    const off = page(false);
    expect(legendEntries(off, project, off.layers, true).map((e) => e.kind)).toEqual(['noCategory']);
  });

  it('PDF: keine Ebenen „Grundflächen“/„Freiflächen“, keine Grundflächen-Beschriftung, Legende ohne die Einträge', () => {
    const scene = (p: FestplatzPage) => pageScene(p, proj([p]), BUILTIN_PROFILES[0]!);
    const on = scene(page(true));
    expect(on.layers.map((l) => l.id)).toEqual(expect.arrayContaining(['areas', 'free']));
    expect(JSON.stringify(on.paper)).toContain('Grundfläche');
    expect(JSON.stringify(on.layers)).toContain('Nord · 50');
    const off = scene(page(false));
    expect(off.layers.map((l) => l.id)).not.toContain('areas');
    expect(off.layers.map((l) => l.id)).not.toContain('free');
    expect(JSON.stringify(off.layers)).not.toContain('Nord · 50');
    expect(JSON.stringify(off.paper)).not.toContain('Grundfläche');
    expect(JSON.stringify(off.paper)).not.toContain('Freifläche');
    // Stände und ihre Beschriftung bleiben
    expect(off.layers.map((l) => l.id)).toEqual(expect.arrayContaining(['stands', 'labels']));
  });

  it('ausgeblendete Grundflächen sind nicht auswählbar (Klick, Rechteck, Alles auswählen)', () => {
    const empty = page(false, { stands: [] });
    expect(pickObject(page(true, { stands: [] }), { x: 25, y: -5 })).toEqual({ kind: 'area', id: 'G' });
    expect(pickObject(empty, { x: 25, y: -5 })).toBeNull();
    expect(objectsInBounds(empty, { minX: -100, minY: -100, maxX: 100, maxY: 100 })).toEqual([]);
    expect(allSelectable(page(false))).toEqual([A.id, B.id]);
  });

  it('An Seite anpassen und Mittelpunkt der Nummerierung ohne ausgeblendete Grundflächen', () => {
    const big: Area = { ...G, cx: 0, cy: 0, w: 1000, d: 1000 };
    const only = (s: Stand) => page(false, { areas: [big], stands: [s] });
    expect(contentBounds(only(B), null)).toEqual({ minX: 98.5, minY: 38.5, maxX: 101.5, maxY: 41.5 });
    expect(contentBounds({ ...only(B), useAreas: true }, null)).toEqual({ minX: -500, minY: -500, maxX: 500, maxY: 500 });
    expect(defaultClockwiseCenter(only(B))).toEqual({ x: 100, y: 40 });
  });
});

describe('#17 Fang', () => {
  const input = (p: FestplatzPage) => ({
    // Vorderseite des Stands bei y = 0,5, 0,5 m vor der Vorderseite von G (Fangabstand 0,8 m)
    rects0: { m: { cx: 10, cy: -1, w: 3, d: 3, rot: 0 } },
    delta: { x: 0, y: 0 },
    grabbed: 'm',
    standIds: new Set(['m']),
    areas: frontSnapAreas(p),
    stands: [{ ...A, id: 'n', cx: 14, cy: -1 }],
    options: { front: true, neighbors: true, grid: 1, gap: 0.3 },
    tol: 0.8,
    release: 1.6,
    state: { frontAreaId: null },
    shift: false,
  });

  it('kein Einrasten der Vorderseite an Grundflächen; Nachbarstände und Raster bleiben', () => {
    const on = computeMoveSnap(input(page(true)));
    expect(on.state.frontAreaId).toBe('G');
    const off = computeMoveSnap(input(page(false)));
    expect(off.state.frontAreaId).toBeNull();
    expect(off.guides.some((g) => g.kind === 'front')).toBe(false);
    // Nachbar n (Kante bei x = 12,5) mit 0,3 m Abstand: rechte Kante von m bei 12,2 → Mitte 10,7
    expect(off.rects.m!.cx).toBeCloseTo(10.7, 9);
    expect(off.guides.some((g) => g.kind === 'contact')).toBe(true);
    // Ohne Nachbarn rastet das Raster
    const grid = computeMoveSnap({ ...input(page(false)), stands: [], rects0: { m: { cx: 10.2, cy: -1.2, w: 3, d: 3, rot: 0 } } });
    expect(grid.state.frontAreaId).toBeNull();
    expect(grid.rects.m!.cx).toBeCloseTo(10, 9);
    expect(grid.rects.m!.cy).toBeCloseTo(-1, 9);
  });

  it('ausgeblendete Ebene „Grundflächen“ fängt auch mit Grundflächen nicht', () => {
    const p = page(true);
    expect(frontSnapAreas({ ...p, layers: { ...p.layers, areas: { visible: false, locked: false } } })).toBe(NO_AREAS);
  });
});
