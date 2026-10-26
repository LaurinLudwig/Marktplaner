import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { occupiedInterval, pageFreeSpaces, TOL, type AreaFreeSpaces } from './freeSpace';
import { penetration, rectGeo } from './geometry/polygon';
import { fromFrame, frontFrame, normAngle } from './geometry/rect';
import { rotate } from './geometry/vec';
import type { Area, Stand } from './model/types';
import { createStand } from './objects';

/**
 * Eigenschaftstests der Freiflächen (M4, spec.md §4) mit zufälligen Anordnungen. Bei einem Fehlschlag
 * meldet fast-check den Seed und ein verkleinertes Gegenbeispiel.
 */

const RUNS = 300;
const dbl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const arbArea = fc.record({ cx: dbl(-50, 50), cy: dbl(-50, 50), w: dbl(5, 100), d: dbl(2, 20), rot: dbl(0, 359.9) }).map((r): Area => ({ id: 'A', name: '', ...r }));

/** Stand relativ zur Achse der Grundfläche: Lage s/t (Anteile), Maße, eigene Drehung. */
const arbRel = fc.record({
  s: dbl(-0.1, 1.05),
  t: dbl(-0.2, 1.1),
  w: dbl(0.5, 10),
  d: dbl(0.5, 15),
  rot: fc.oneof(fc.constant(0), fc.constant(0), dbl(0, 359.9)),
  /** Kette: weitere Stände bündig rechts daneben (Anstoßen genau auf der Kante). */
  chain: fc.integer({ min: 0, max: 3 }),
});

type Rel = typeof arbRel extends fc.Arbitrary<infer T> ? T : never;

function placeStands(area: Area, rels: Rel[]): Stand[] {
  const f = frontFrame(area);
  const out: Stand[] = [];
  let n = 0;
  for (const r of rels) {
    let s = r.s * f.length;
    for (let k = 0; k <= r.chain; k++) {
      const t = r.t * f.depth;
      const c = fromFrame(f, s + r.w / 2, t + r.d / 2);
      out.push({ ...createStand({ cx: c.x, cy: c.y, w: r.w, d: r.d, rot: normAngle(area.rot + r.rot) }), id: `s${String(n++).padStart(3, '0')}` });
      if (r.rot !== 0) break;
      s += r.w;
    }
  }
  return out;
}

const arbScene = fc.tuple(arbArea, fc.array(arbRel, { maxLength: 12 })).map(([area, rels]) => ({ area, stands: placeStands(area, rels) }));

const summary = (r: AreaFreeSpaces) => r.free.map((f) => ({ key: f.key, start: f.start, end: f.end, width: f.width, depth: f.depth }));

describe('M4 Freiflächen: Eigenschaften (zufällige Anordnungen)', () => {
  it('Summe der freien und belegten Breiten = Breite der Grundfläche', () => {
    fc.assert(
      fc.property(arbScene, ({ area, stands }) => {
        const r = pageFreeSpaces([area], stands, 0)[0]!;
        const free = r.gaps.reduce((m, g) => m + (g.b - g.a), 0);
        const occ = r.occupied.reduce((m, o) => m + (o.b - o.a), 0);
        expect(free + occ).toBeCloseTo(area.w, 9);
      }),
      { numRuns: RUNS },
    );
  });

  it('keine Freifläche überschneidet die Projektion oder die Fläche eines Stands', () => {
    fc.assert(
      fc.property(arbScene, ({ area, stands }) => {
        const r = pageFreeSpaces([area], stands, 0)[0]!;
        const f = frontFrame(area);
        for (const s of stands) {
          const iv = occupiedInterval(area, f, s);
          for (const fs of r.free) {
            if (iv) expect(Math.min(iv[1], fs.end) - Math.max(iv[0], fs.start)).toBeLessThanOrEqual(1e-9);
            for (const p of fs.polygons) expect(penetration(p, rectGeo(s).poly)).toBeLessThanOrEqual(TOL + 1e-9);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('Ergebnis unabhängig von der Reihenfolge der Stände', () => {
    fc.assert(
      fc.property(arbScene, fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 40, maxLength: 40 }), ({ area, stands }, keys) => {
        const shuffled = stands
          .map((s, i) => ({ s, k: keys[i % keys.length]! + i * 1e-9 }))
          .toSorted((a, b) => a.k - b.k)
          .map((x) => x.s);
        expect(pageFreeSpaces([area], shuffled, 0.5)).toEqual(pageFreeSpaces([area], stands, 0.5));
      }),
      { numRuns: RUNS },
    );
  });

  it('Ergebnis unabhängig von einer gemeinsamen Drehung und Verschiebung der Szene', () => {
    fc.assert(
      fc.property(arbScene, dbl(0, 359.9), dbl(-100, 100), dbl(-100, 100), ({ area, stands }, phi, px, py) => {
        const turn = <T extends Area | Stand>(o: T): T => {
          const c = rotate({ x: o.cx - px, y: o.cy - py }, phi);
          return { ...o, cx: c.x + px + 3, cy: c.y + py - 7, rot: normAngle(o.rot + phi) };
        };
        const a = summary(pageFreeSpaces([area], stands, 0.5)[0]!);
        const b = summary(pageFreeSpaces([turn(area)], stands.map(turn), 0.5)[0]!);
        expect(b.map((x) => x.key)).toEqual(a.map((x) => x.key));
        b.forEach((x, i) => {
          expect(x.start).toBeCloseTo(a[i]!.start, 6);
          expect(x.end).toBeCloseTo(a[i]!.end, 6);
          expect(x.depth).toBeCloseTo(a[i]!.depth, 6);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it('überlappende Grundflächen: spätere dringen nicht in frühere ein, frühere bleiben unverändert', () => {
    const arbTwo = fc.tuple(arbScene, dbl(-0.6, 0.6), dbl(-0.6, 0.6), dbl(0, 359.9), dbl(5, 60), dbl(2, 20)).map(([scene, ox, oy, rot, w, d]) => {
      const later: Area = { id: 'B', name: '', cx: scene.area.cx + ox * scene.area.w, cy: scene.area.cy + oy * scene.area.w, w, d, rot };
      return { ...scene, later };
    });
    fc.assert(
      fc.property(arbTwo, ({ area, later, stands }) => {
        const [first, second] = pageFreeSpaces([area, later], stands, 0.5);
        expect(first).toEqual(pageFreeSpaces([area], stands, 0.5)[0]);
        for (const fs of second!.free) for (const p of fs.polygons) expect(penetration(p, rectGeo(area).poly)).toBeLessThanOrEqual(TOL + 1e-9);
      }),
      { numRuns: RUNS },
    );
  });

  it('eine größere Mindestbreite entfernt nur Freiflächen und verändert keine', () => {
    fc.assert(
      fc.property(arbScene, dbl(0.05, 2), dbl(0, 5), ({ area, stands }, m1, extra) => {
        const small = summary(pageFreeSpaces([area], stands, m1)[0]!);
        const big = summary(pageFreeSpaces([area], stands, m1 + extra)[0]!);
        for (const f of big) expect(small).toContainEqual(f);
      }),
      { numRuns: RUNS },
    );
  });
});
