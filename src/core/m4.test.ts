import { describe, expect, it } from 'vitest';
import { createFreeSpaceCache, pageFreeSpaces, resolveFreeSpace, TOL } from './freeSpace';
import { freeSpaceLabel } from './label';
import type { Area, Rect, Stand } from './model/types';
import { computeMoveSnap, type MoveSnapInput, type SnapOptions } from './moveSnap';
import { createStand } from './objects';
import { constrainDelta } from './transform';
import { countWarnings, pageWarnings } from './warnings';

/**
 * M4: Freiflächen, Warnungen und Fang (spec.md §3, §4). Die Fall-Tabelle entspricht den Fällen A1–A13
 * aus der Planung. Standardszene: Grundfläche G 50 × 10 m, Vorderseite bei y = 0 von x = 0 bis 50,
 * also Achse s = x und Tiefe t = −y.
 */

const area = (id: string, r: Partial<Rect> = {}, name = ''): Area => ({ id, name, cx: 25, cy: -5, w: 50, d: 10, rot: 0, ...r });
const G = area('G');
/** Achsenparalleler Stand in der Standardszene: s von a bis b, t von t0 bis t1. */
const st = (id: string, a: number, b: number, t0 = 0, t1 = 3, rot = 0): Stand => ({
  ...createStand({ cx: (a + b) / 2, cy: -(t0 + t1) / 2, w: b - a, d: t1 - t0, rot }),
  id,
});
const standAt = (id: string, r: Rect): Stand => ({ ...createStand(r), id });

type Span = [number, number];
interface Case {
  name: string;
  areas: Area[];
  stands: Stand[];
  minWidth?: number;
  /** Erwartete Freiflächen je Grundfläche: [start, end] (Breite = end − start). */
  free: Record<string, Span[]>;
  occupied?: Record<string, Span[]>;
  outside?: string[];
  overlap?: string[];
}

const H_NEXT = area('H', { cx: 75 }); // liegt bündig rechts neben G (x 50–100)
const H_OVER = area('H', { cx: 65 }); // überlappt G bei x 40–50 (A9)

const cases: Case[] = [
  { name: 'A1 bündig an der Vorderseite', areas: [G], stands: [st('s1', 20, 28)], occupied: { G: [[20, 28]] }, free: { G: [[0, 20], [28, 50]] } },
  { name: 'A2 hinten', areas: [G], stands: [st('s1', 20, 28, 7, 10)], occupied: { G: [[20, 28]] }, free: { G: [[0, 20], [28, 50]] } },
  { name: 'A2 mittig', areas: [G], stands: [st('s1', 20, 28, 3, 6)], free: { G: [[0, 20], [28, 50]] } },
  {
    name: 'A3 um 30° gedreht',
    areas: [G],
    stands: [standAt('s1', { cx: 25, cy: -5, w: 4, d: 3, rot: 30 })],
    occupied: { G: [[25 - 4.964 / 2, 25 + 4.964 / 2]] },
    free: { G: [[0, 22.518], [27.482, 50]] },
  },
  { name: 'A4 ragt seitlich heraus', areas: [G], stands: [st('s1', -2, 4)], occupied: { G: [[0, 4]] }, free: { G: [[4, 50]] }, outside: ['s1'] },
  { name: 'A5 tiefer, ragt hinten heraus', areas: [G], stands: [st('s1', 20, 28, 0, 14)], free: { G: [[0, 20], [28, 50]] }, outside: ['s1'] },
  {
    name: 'A6 über zwei anliegende Grundflächen',
    areas: [G, H_NEXT],
    stands: [st('s1', 48, 52)],
    occupied: { G: [[48, 50]], H: [[0, 2]] },
    free: { G: [[0, 48]], H: [[2, 50]] },
  },
  {
    name: 'A6b über die Lücke zwischen zwei Grundflächen',
    areas: [G, area('H', { cx: 76 })],
    stands: [st('s1', 49, 52)],
    free: { G: [[0, 49]], H: [[1, 50]] },
    outside: ['s1'],
  },
  { name: 'A7 exakt aneinander', areas: [G], stands: [st('s1', 20, 28), st('s2', 28, 31)], occupied: { G: [[20, 31]] }, free: { G: [[0, 20], [31, 50]] } },
  { name: 'A7b Lücke durch Rundung (0,005)', areas: [G], stands: [st('s1', 20, 28), st('s2', 28.005, 31.005)], occupied: { G: [[20, 31.005]] }, free: { G: [[0, 20], [31.005, 50]] } },
  { name: 'A7b Überlappung durch Rundung (0,005)', areas: [G], stands: [st('s1', 20, 28), st('s2', 27.995, 30.995)], free: { G: [[0, 20], [30.995, 50]] } },
  { name: 'A7c echte Überlappung (0,02)', areas: [G], stands: [st('s1', 20, 28), st('s2', 27.98, 30.98)], free: { G: [[0, 20], [30.98, 50]] }, overlap: ['s1', 's2'] },
  { name: 'A8 Lücke unter Mindestbreite', areas: [G], stands: [st('s1', 20, 28), st('s2', 28.3, 31)], free: { G: [[0, 20], [31, 50]] } },
  { name: 'A8 Lücke ab Mindestbreite 0,2', areas: [G], stands: [st('s1', 20, 28), st('s2', 28.3, 31)], minWidth: 0.2, free: { G: [[0, 20], [28, 28.3], [31, 50]] } },
  { name: 'A8 Lücke genau Mindestbreite', areas: [G], stands: [st('s1', 20, 28), st('s2', 28.5, 31)], free: { G: [[0, 20], [28, 28.5], [31, 50]] } },
  { name: 'A9 überlappende Grundflächen: frühere gewinnt', areas: [G, H_OVER], stands: [], free: { G: [[0, 50]], H: [[10, 50]] } },
  { name: 'A9b Stand im Überlappungsbereich', areas: [G, H_OVER], stands: [st('s1', 44, 47)], occupied: { G: [[44, 47]], H: [] }, free: { G: [[0, 44], [47, 50]], H: [[10, 50]] } },
  { name: 'A9c Stand ragt in die spätere Fläche', areas: [G, H_OVER], stands: [st('s1', 48, 53)], occupied: { G: [[48, 50]], H: [[10, 13]] }, free: { G: [[0, 48]], H: [[13, 50]] } },
  { name: 'A9e anliegende Grundflächen werden nicht beschnitten', areas: [G, H_NEXT], stands: [], free: { G: [[0, 50]], H: [[0, 50]] } },
  { name: 'A10 leere Grundfläche', areas: [G], stands: [], free: { G: [[0, 50]] } },
  { name: 'A10 voll belegt', areas: [G], stands: Array.from({ length: 10 }, (_, i) => st(`s${i}`, i * 5, i * 5 + 5)), occupied: { G: [[0, 50]] }, free: { G: [] } },
  { name: 'A11 berührt nur von außen', areas: [G], stands: [st('s1', 20, 28, -3, 0)], occupied: { G: [] }, free: { G: [[0, 50]] }, outside: ['s1'] },
  { name: 'A12 ragt von außen hinein', areas: [G], stands: [st('s1', 20, 28, -2, 1)], occupied: { G: [[20, 28]] }, free: { G: [[0, 20], [28, 50]] }, outside: ['s1'] },
  { name: 'A13 größer als die Grundfläche', areas: [G], stands: [standAt('s1', { cx: 25, cy: -5, w: 60, d: 12, rot: 0 })], occupied: { G: [[0, 50]] }, free: { G: [] }, outside: ['s1'] },
  // Grenzen der Toleranz
  { name: 'Toleranz: 0,009 hineinragen belegt nicht', areas: [G], stands: [st('s1', 20, 28, -2.991, 0.009)], occupied: { G: [] }, free: { G: [[0, 50]] }, outside: ['s1'] },
  { name: 'Toleranz: 0,011 hineinragen belegt', areas: [G], stands: [st('s1', 20, 28, -2.989, 0.011)], occupied: { G: [[20, 28]] }, free: { G: [[0, 20], [28, 50]] }, outside: ['s1'] },
  { name: 'Toleranz: 0,009 seitlich außerhalb ist innerhalb', areas: [G], stands: [st('s1', -0.009, 3)], free: { G: [[3, 50]] } },
  { name: 'Toleranz: 0,011 seitlich außerhalb ist außerhalb', areas: [G], stands: [st('s1', -0.011, 3)], free: { G: [[3, 50]] }, outside: ['s1'] },
  { name: 'Toleranz: 0,009 Überlappung zählt nicht', areas: [G], stands: [st('s1', 20, 28), st('s2', 27.991, 31)], free: { G: [[0, 20], [31, 50]] } },
  { name: 'Toleranz: 0,011 Überlappung zählt', areas: [G], stands: [st('s1', 20, 28), st('s2', 27.989, 31)], free: { G: [[0, 20], [31, 50]] }, overlap: ['s1', 's2'] },
  { name: 'Toleranz: Reststreifen am Achsenende entfällt', areas: [G], stands: [st('s1', 0.006, 5)], minWidth: 0.001, free: { G: [[5, 50]] } },
];

const close = (a: number, b: number) => Math.abs(a - b) < 1e-3;

describe('M4 Freiflächen: Fall-Tabelle (spec.md §4)', () => {
  it.each(cases)('$name', (c) => {
    const result = pageFreeSpaces(c.areas, c.stands, c.minWidth ?? 0.5);
    for (const [areaId, spans] of Object.entries(c.free)) {
      const r = result.find((x) => x.areaId === areaId)!;
      const got = r.free.map((f) => [f.start, f.end]);
      expect(got.length, `${areaId}: ${JSON.stringify(got)}`).toBe(spans.length);
      spans.forEach(([a, b], i) => {
        expect(close(got[i]![0]!, a) && close(got[i]![1]!, b), `${areaId}: ${JSON.stringify(got)}`).toBe(true);
        expect(close(r.free[i]!.width, b - a)).toBe(true);
      });
    }
    for (const [areaId, spans] of Object.entries(c.occupied ?? {})) {
      const r = result.find((x) => x.areaId === areaId)!;
      expect(r.occupied.length).toBe(spans.length);
      spans.forEach(([a, b], i) => expect(close(r.occupied[i]!.a, a) && close(r.occupied[i]!.b, b), JSON.stringify(r.occupied)).toBe(true));
    }
    const w = pageWarnings(c.areas, c.stands);
    const outside = c.stands.filter((s) => w.byStand.get(s.id)!.outside).map((s) => s.id);
    const overlap = c.stands.filter((s) => w.byStand.get(s.id)!.overlaps.length).map((s) => s.id);
    expect(outside).toEqual(c.outside ?? []);
    expect(overlap).toEqual(c.overlap ?? []);
  });

  it('jede Freifläche hat die volle Tiefe; Spec-Beispiel 50 × 10, Stand 8 m bei 20 m', () => {
    const [r] = pageFreeSpaces([G], [st('s1', 20, 28)], 0.5);
    expect(r!.free.map((f) => freeSpaceLabel(f.width, f.depth))).toEqual(['Frei 20 × 10 m', 'Frei 22 × 10 m']);
    expect(r!.free.every((f) => f.depth === 10 && !f.clipped && f.polygons.length === 1)).toBe(true);
  });

  it('A9: frühere Grundfläche ändert sich durch spätere nie', () => {
    const alone = pageFreeSpaces([G], [st('s1', 44, 47)], 0.5)[0]!;
    const withH = pageFreeSpaces([G, H_OVER], [st('s1', 44, 47)], 0.5)[0]!;
    expect(withH).toEqual(alone);
    // umgekehrte Reihenfolge: dann gewinnt H
    const [h, g] = pageFreeSpaces([H_OVER, G], [], 0.5);
    expect(h!.free.map((f) => [f.start, f.end])).toEqual([[0, 50]]);
    expect(g!.free.map((f) => [f.start, f.end])).toEqual([[0, 40]]);
  });

  it('A9d: Überlappung nur in einem Teil der Tiefe ergibt eine L-förmige Freifläche mit Hüllmaßen', () => {
    const H = area('H', { cx: 65, cy: -10 }); // y −15 … −5, überlappt G mit 10 × 5 m
    const h = pageFreeSpaces([G, H], [], 0.5)[1]!;
    expect(h.free).toHaveLength(1);
    const f = h.free[0]!;
    expect(f.clipped).toBe(true);
    expect(close(f.width, 50) && close(f.depth, 10)).toBe(true);
    expect(close(f.size, 450)).toBe(true);
  });

  it('A9: Lücke, die eine frühere Fläche quer zerschneidet, ergibt getrennte Teile mit #k', () => {
    const H = area('H', { cx: 65, w: 100 }); // x 15–115
    const cut = area('C', { cx: 40, w: 10, d: 30 }); // x 35–45, ganze Tiefe
    const h = pageFreeSpaces([cut, H], [], 0.5)[1]!;
    expect(h.free.map((f) => [Math.round(f.start), Math.round(f.end)])).toEqual([
      [0, 20],
      [30, 100],
    ]);
    expect(h.free.map((f) => f.key)).toEqual(['H|^|$#0', 'H|^|$#1']);
  });
});

describe('M4 Freiflächen: Schlüssel, Auflösung, Zwischenspeicher', () => {
  it('Schlüssel aus Grundfläche und begrenzenden Ständen; bleibt beim Verschieben gleich', () => {
    const a = pageFreeSpaces([G], [st('s1', 20, 28), st('s2', 35, 38)], 0.5)[0]!;
    expect(a.free.map((f) => f.key)).toEqual(['G|^|s1', 'G|s1|s2', 'G|s2|$']);
    const b = pageFreeSpaces([G], [st('s1', 21, 29), st('s2', 33, 36)], 0.5)[0]!;
    expect(b.free.map((f) => f.key)).toEqual(a.free.map((f) => f.key));
  });

  it('bei gleich langen Nachbarn gilt die kleinere ID, unabhängig von der Reihenfolge', () => {
    const one = pageFreeSpaces([G], [st('b', 20, 28, 0, 3), st('a', 20, 28, 5, 8)], 0.5)[0]!;
    const two = pageFreeSpaces([G], [st('a', 20, 28, 5, 8), st('b', 20, 28, 0, 3)], 0.5)[0]!;
    expect(one.free.map((f) => f.key)).toEqual(['G|^|a', 'G|a|$']);
    expect(two).toEqual(one);
  });

  it('Auflösung: exakter Schlüssel, sonst größte Überdeckung, sonst null', () => {
    const all = pageFreeSpaces([G], [st('s1', 20, 28)], 0.5);
    expect(resolveFreeSpace(all, { key: 'G|s1|$', areaId: 'G', start: 28, end: 50 })?.start).toBe(28);
    // s1 gelöscht: der Schlüssel existiert nicht mehr, die Lage passt zur ganzen Fläche
    const empty = pageFreeSpaces([G], [], 0.5);
    expect(resolveFreeSpace(empty, { key: 'G|s1|$', areaId: 'G', start: 28, end: 50 })?.key).toBe('G|^|$');
    const full = pageFreeSpaces([G], [st('s1', 0, 50)], 0.5);
    expect(resolveFreeSpace(full, { key: 'G|s1|$', areaId: 'G', start: 28, end: 50 })).toBeNull();
    expect(resolveFreeSpace(all, { key: 'X|^|$', areaId: 'X', start: 0, end: 1 })).toBeNull();
  });

  it('Zwischenspeicher: nur betroffene Grundflächen werden neu berechnet', () => {
    const areas = [area('A1', { cx: 25 }), area('A2', { cx: 25, cy: -105 }), area('A3', { cx: 25, cy: -205 })];
    let stands = [st('s1', 10, 13), standAt('s2', { cx: 10, cy: -101.5, w: 3, d: 3, rot: 0 })];
    const cache = createFreeSpaceCache();
    pageFreeSpaces(areas, stands, 0.5, cache);
    expect(cache.computed).toBe(3);
    pageFreeSpaces(areas, stands, 0.5, cache);
    expect(cache.computed).toBe(3);
    // s1 innerhalb von A1 verschoben: nur A1
    stands = [st('s1', 20, 23), stands[1]!];
    pageFreeSpaces(areas, stands, 0.5, cache);
    expect(cache.computed).toBe(4);
    // s1 von A1 nach A3: A1 und A3
    stands = [standAt('s1', { cx: 10, cy: -201.5, w: 3, d: 3, rot: 0 }), stands[1]!];
    pageFreeSpaces(areas, stands, 0.5, cache);
    expect(cache.computed).toBe(6);
    // Mindestbreite geändert: alle
    pageFreeSpaces(areas, stands, 1, cache);
    expect(cache.computed).toBe(9);
  });
});

describe('M4 Warnungen', () => {
  const settings = { warnOutside: true, warnOverlap: true, warnDuplicateNr: true, warnInfra: true, warnPassageWidth: true, warnDistance: true };
  it('zählt Stände mit aktiver Warnung; Häkchen und Projektschalter wirken je Art', () => {
    const stands = [st('s1', 20, 28), st('s2', 27, 30), st('s3', 40, 45, -5, -2)];
    const w = pageWarnings([G], stands);
    expect(countWarnings(w, stands, settings)).toEqual({ stands: 3, outside: 1, overlap: 2, duplicate: 0, infra: 0, narrow: 0, distance: 0 });
    expect(countWarnings(w, stands, { ...settings, warnOutside: false })).toEqual({ stands: 2, outside: 0, overlap: 2, duplicate: 0, infra: 0, narrow: 0, distance: 0 });
    expect(countWarnings(w, stands, { ...settings, warnOverlap: false })).toEqual({ stands: 1, outside: 1, overlap: 0, duplicate: 0, infra: 0, narrow: 0, distance: 0 });
    // „Überlappung ignorieren“ wirkt nur auf den eigenen Stand
    const ignored = [{ ...stands[0]!, suppressOverlapWarning: true }, stands[1]!, { ...stands[2]!, suppressOutsideWarning: true }];
    expect(countWarnings(pageWarnings([G], ignored), ignored, settings)).toEqual({ stands: 1, outside: 0, overlap: 1, duplicate: 0, infra: 0, narrow: 0, distance: 0 });
  });

  it('Überlappungsfläche wird für die Darstellung geliefert', () => {
    const w = pageWarnings([G], [st('s1', 20, 28), st('s2', 27, 30)]);
    expect(w.regions).toHaveLength(1);
    expect(w.regions[0]).toMatchObject({ a: 's1', b: 's2' });
    expect(w.regions[0]!.polygon.length).toBeGreaterThanOrEqual(4);
  });

  it('ohne Grundflächen ist jeder Stand außerhalb', () => {
    const w = pageWarnings([], [st('s1', 0, 3)]);
    expect(w.byStand.get('s1')!.outside).toBe(true);
  });
});

// ---------- Fang ----------

const ON: SnapOptions = { front: true, neighbors: true, grid: null };
/** Fangabstand bei 10 px/m: 8 px = 0,8 m, Lösen 16 px = 1,6 m. */
function snapInput(over: Partial<MoveSnapInput> & Pick<MoveSnapInput, 'rects0'>): MoveSnapInput {
  return {
    delta: { x: 0, y: 0 },
    grabbed: Object.keys(over.rects0)[0]!,
    standIds: new Set(Object.keys(over.rects0)),
    areas: [G],
    stands: [],
    options: ON,
    tol: 0.8,
    release: 1.6,
    state: { frontAreaId: null },
    shift: false,
    ...over,
  };
}
/** Stand 3 × 3, dessen (gedrehte) Mitte bei s, t der Standardszene liegt. */
const free3 = (s: number, t: number, rot = 0): Rect => ({ cx: s, cy: -t, w: 3, d: 3, rot });

describe('M4 Fang (spec.md §3)', () => {
  it('Vorderkante: rastet ein, übernimmt die Drehung, Vorderseite liegt auf der Vorderseite', () => {
    const r = computeMoveSnap(snapInput({ rects0: { m: free3(10, 2, 17) } }));
    expect(r.state.frontAreaId).toBe('G');
    expect(r.rects.m).toMatchObject({ cx: 10, rot: 0 });
    expect(r.rects.m!.cy).toBeCloseTo(-1.5, 9);
    expect(r.guides[0]).toMatchObject({ kind: 'front', label: 'Grundfläche' });
  });

  it('Vorderkante an einer gedrehten Grundfläche', () => {
    const A = area('R', { cx: 0, cy: 0, w: 20, d: 8, rot: 30 });
    const r = computeMoveSnap(snapInput({ areas: [A], rects0: { m: { cx: 0, cy: 2.2, w: 3, d: 3, rot: 0 } } }));
    expect(r.state.frontAreaId).toBe('R');
    expect(r.rects.m!.rot).toBeCloseTo(30, 9);
    // Vorderkante des Stands liegt auf der Vorderseite der Grundfläche (lokal y = d/2 = 4)
    const local = { x: (r.rects.m!.cx) * Math.cos(-Math.PI / 6) - r.rects.m!.cy * Math.sin(-Math.PI / 6), y: r.rects.m!.cx * Math.sin(-Math.PI / 6) + r.rects.m!.cy * Math.cos(-Math.PI / 6) };
    expect(local.y + 1.5).toBeCloseTo(4, 9);
  });

  it('Hysterese: einrasten bei 8 px, lösen erst über 16 px; danach ursprüngliche Drehung', () => {
    const rects0 = { m: free3(10, 1.5 + 1.2, 17) }; // 1,2 m = 12 px
    expect(computeMoveSnap(snapInput({ rects0 })).state.frontAreaId).toBeNull();
    const held = computeMoveSnap(snapInput({ rects0, state: { frontAreaId: 'G' } }));
    expect(held.state.frontAreaId).toBe('G');
    const far = computeMoveSnap(snapInput({ rects0: { m: free3(10, 1.5 + 2, 17) }, state: { frontAreaId: 'G' } }));
    expect(far.state.frontAreaId).toBeNull();
    expect(far.rects.m!.rot).toBe(17);
  });

  it('Shift hält einen eingerasteten Stand an der Vorderseite, auch weit weg', () => {
    const r = computeMoveSnap(snapInput({ rects0: { m: free3(10, 1.5) }, delta: { x: 5, y: -20 }, shift: true, state: { frontAreaId: 'G' } }));
    expect(r.state.frontAreaId).toBe('G');
    expect(r.rects.m!.cx).toBeCloseTo(15, 9);
    expect(r.rects.m!.cy).toBeCloseTo(-1.5, 9);
  });

  it('gleitet entlang und fängt am Achsenende und am Nachbarn', () => {
    const end = computeMoveSnap(snapInput({ rects0: { m: free3(1.9, 1.5) } }));
    expect(end.rects.m!.cx).toBeCloseTo(1.5, 9);
    expect(end.guides.map((g) => g.kind)).toEqual(['front', 'end']);
    const nb = computeMoveSnap(snapInput({ rects0: { m: free3(24.9, 1.5) }, stands: [st('n', 20, 23)] }));
    expect(nb.rects.m!.cx).toBeCloseTo(24.5, 9);
    expect(nb.guides.map((g) => g.kind)).toEqual(['front', 'contact']);
    const off = computeMoveSnap(snapInput({ rects0: { m: free3(24.9, 1.5) }, stands: [st('n', 20, 23)], options: { ...ON, neighbors: false } }));
    expect(off.rects.m!.cx).toBeCloseTo(24.9, 9);
  });

  it('zoomunabhängig: dieselbe Lage rastet bei 100 px/m nicht ein', () => {
    const r = computeMoveSnap(snapInput({ rects0: { m: free3(10, 2) }, tol: 0.08, release: 0.16 }));
    expect(r.state.frontAreaId).toBeNull();
    expect(r.rects.m!.cy).toBe(-2);
  });

  it('Nachbarstände ohne Grundfläche: anliegen und fluchten, nur parallel', () => {
    const n = standAt('n', { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const r = computeMoveSnap(snapInput({ areas: [], stands: [n], rects0: { m: { cx: 3.4, cy: 0.3, w: 3, d: 3, rot: 0 } } }));
    expect(r.rects.m!.cx).toBeCloseTo(3, 9);
    expect(r.rects.m!.cy).toBeCloseTo(0, 9);
    expect(r.guides.map((g) => g.kind).toSorted()).toEqual(['align', 'contact']);
    const rotated = computeMoveSnap(snapInput({ areas: [], stands: [{ ...n, rot: 30 }], rects0: { m: { cx: 3.4, cy: 0.3, w: 3, d: 3, rot: 0 } } }));
    expect(rotated.rects.m).toMatchObject({ cx: 3.4, cy: 0.3 });
    // um 90° gedreht zählt als parallel
    const quarter = computeMoveSnap(snapInput({ areas: [], stands: [{ ...n, rot: 90 }], rects0: { m: { cx: 3.4, cy: 0.3, w: 3, d: 3, rot: 0 } } }));
    expect(quarter.rects.m!.cx).toBeCloseTo(3, 9);
  });

  // #2 (M10): Anliegen mit Abstand, Fluchten ohne. Fall-Tabelle: Lage vor dem Fang → erwartete Mitte.
  const gapCases: [string, number, number, number][] = [
    // [Fall, Abstand, cx vorher, cx nachher]
    ['frei, rechts vom Nachbarn, bündig', 0, 3.4, 3],
    ['frei, rechts vom Nachbarn, 0,3 m', 0.3, 3.4, 3.3],
    ['frei, links vom Nachbarn, 0,3 m', 0.3, -3.4, -3.3],
    ['frei, rechts vom Nachbarn, 1 m', 1, 3.9, 4],
    ['frei, bereits mit Abstand: bleibt', 0.3, 3.3, 3.3],
  ];
  it.each(gapCases)('Nachbarstand mit Abstand: %s', (_name, gap, before, after) => {
    const n = standAt('n', { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const r = computeMoveSnap(snapInput({ areas: [], stands: [n], rects0: { m: { cx: before, cy: 0.3, w: 3, d: 3, rot: 0 } }, options: { ...ON, gap } }));
    expect(r.rects.m!.cx).toBeCloseTo(after, 9);
    // Fluchten bleibt ohne Abstand
    expect(r.rects.m!.cy).toBeCloseTo(0, 9);
    expect(r.guides.map((g) => g.kind).toSorted()).toEqual(['align', 'contact']);
  });

  // QA-M10-01: Abstand × Zoom (Fangabstand 8 px bei 10, 40 und 160 px/m) × Drehung; Lage 0,5 × Fangabstand neben dem Ziel
  const gapZoomCases = [0.8, 0.2, 0.05].flatMap((tol) => [0, 0.3, 1, 2, 5, 10].flatMap((gap) => [0, 30].map((rot) => [tol, gap, rot] as const)));
  it.each(gapZoomCases)('Nachbarstand mit Abstand bei jedem Zoom: Fangabstand %s m, Abstand %s m, Drehung %s°', (tol, gap, rot) => {
    const a = (rot * Math.PI) / 180;
    const along = 3 + gap + tol * 0.5;
    const n = standAt('n', { cx: 0, cy: 0, w: 3, d: 3, rot });
    const r = computeMoveSnap(
      snapInput({ areas: [], stands: [n], rects0: { m: { cx: along * Math.cos(a), cy: along * Math.sin(a), w: 3, d: 3, rot } }, options: { ...ON, front: false, gap }, tol, release: tol * 2 }),
    );
    const m = r.rects.m!;
    expect(m.cx * Math.cos(a) + m.cy * Math.sin(a)).toBeCloseTo(3 + gap, 6);
  });

  it('Nachbarstand mit Abstand entlang der Vorderkante, auf beiden Seiten; nur ein Fangpunkt', () => {
    const gap = { ...ON, gap: 0.3 };
    const behind = computeMoveSnap(snapInput({ rects0: { m: free3(24.9, 1.5) }, stands: [st('n', 20, 23)], options: gap }));
    expect(behind.rects.m!.cx).toBeCloseTo(24.8, 9);
    expect(behind.guides.map((g) => g.kind)).toEqual(['front', 'contact']);
    const before = computeMoveSnap(snapInput({ rects0: { m: free3(18.6, 1.5) }, stands: [st('n', 20, 23)], options: gap }));
    expect(before.rects.m!.cx).toBeCloseTo(18.2, 9);
    // Bündiges Anliegen ist kein zusätzlicher Fangpunkt: auch dicht an der bündigen Lage (24,5) landet er mit Abstand
    const near = computeMoveSnap(snapInput({ rects0: { m: free3(24.55, 1.5) }, stands: [st('n', 20, 23)], options: gap }));
    expect(near.rects.m!.cx).toBeCloseTo(24.8, 9);
  });

  it('Modifikator schaltet den Fang auch mit Abstand ganz aus', () => {
    const n = standAt('n', { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const r = computeMoveSnap(snapInput({ areas: [], stands: [n], rects0: { m: { cx: 3.4, cy: 0.3, w: 3, d: 3, rot: 0 } }, options: { front: false, neighbors: false, grid: null, gap: 0.3 } }));
    expect(r.rects.m).toMatchObject({ cx: 3.4, cy: 0.3 });
  });

  it('Raster: Rand oder Mitte des Hüllrechtecks, auch für Grundflächen', () => {
    const r = computeMoveSnap(snapInput({ areas: [], standIds: new Set(), rects0: { a: { cx: 10.3, cy: 5.2, w: 20, d: 8, rot: 0 } }, options: { front: false, neighbors: false, grid: 1 } }));
    expect(r.rects.a!.cx).toBeCloseTo(10, 9);
    expect(r.rects.a!.cy).toBeCloseTo(5, 9);
  });

  it('Priorität: Vorderkante vor Raster, Nachbar vor Raster', () => {
    const front = computeMoveSnap(snapInput({ rects0: { m: free3(10.3, 1.7) }, options: { ...ON, grid: 1 } }));
    expect(front.rects.m!.cx).toBeCloseTo(10.3, 9);
    const n = standAt('n', { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const nb = computeMoveSnap(snapInput({ areas: [], stands: [n], rects0: { m: { cx: 3.4, cy: 1.2, w: 3, d: 3, rot: 0 } }, options: { front: false, neighbors: true, grid: 0.5 } }));
    // x: Anliegen am Nachbarn (−0,4) gewinnt gegen das nähere Raster (+0,1); y: kein Nachbar-Kandidat → Raster
    expect(nb.rects.m!.cx).toBeCloseTo(3, 9);
    expect(nb.rects.m!.cy).toBeCloseTo(1, 9);
  });

  it('Mehrfachauswahl: nur parallel verschoben; Vorderkante nur, wenn der gegriffene Stand schon parallel steht', () => {
    const rects0 = { m: free3(10, 2), k: free3(14, 6, 45) };
    const r = computeMoveSnap(snapInput({ rects0, grabbed: 'm' }));
    expect(r.state.frontAreaId).toBe('G');
    expect(r.rects.m!.cy).toBeCloseTo(-1.5, 9);
    expect(r.rects.k!.cy).toBeCloseTo(-5.5, 9);
    expect(r.rects.k!.rot).toBe(45);
    const skew = computeMoveSnap(snapInput({ rects0: { m: free3(10, 2, 17), k: free3(14, 6) }, grabbed: 'm' }));
    expect(skew.state.frontAreaId).toBeNull();
  });

  it('alle Fänge aus (Cmd/Strg): unverändert', () => {
    const r = computeMoveSnap(snapInput({ rects0: { m: free3(10, 2, 17) }, options: { front: false, neighbors: false, grid: null } }));
    expect(r.rects.m).toEqual(free3(10, 2, 17));
  });

  it('Shift beschränkt auf waagerecht, senkrecht, 45°', () => {
    expect(constrainDelta({ x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
    expect(constrainDelta({ x: -1, y: 8 })).toEqual({ x: 0, y: 8 });
    const d = constrainDelta({ x: 10, y: 9 });
    expect(d.x).toBeCloseTo(9.5, 9);
    expect(d.y).toBeCloseTo(9.5, 9);
  });

  it('TOL ist die Speichergenauigkeit', () => {
    expect(TOL).toBe(0.01);
  });
});

describe('M4 Schraffur der Freiflächen', () => {
  it('Linien unter 45° im festen Abstand, innerhalb des Polygons', async () => {
    const { hatchPath } = await import('./geometry/polygon');
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const d = hatchPath(square, Math.SQRT1_2);
    const segs = d.split('M').filter(Boolean);
    // x + y = 1, 2, …, 7 (Ecken 0 und 8 berühren nur)
    expect(segs).toHaveLength(7);
    for (const s of segs) {
      const [p, q] = s.split('L').map((x) => x.split(' ').map(Number)) as [number[], number[]];
      expect(p[0]! + p[1]!).toBeCloseTo(q[0]! + q[1]!, 6);
      for (const v of [...p, ...q]) expect(v >= -1e-9 && v <= 4 + 1e-9).toBe(true);
    }
    expect(hatchPath(square, 0)).toBe('');
  });
});
