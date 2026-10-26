import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pageFreeSpaces } from './freeSpace';
import { normAngle } from './geometry/rect';
import { rotate } from './geometry/vec';
import type { Area, Rect, Stand } from './model/types';
import { createStand } from './objects';
import { pageWarnings } from './warnings';

/**
 * Toleranzgrenze (QA-M4-01, QA-M4-02, spec.md Begriffe): Eine Eindringtiefe bzw. ein Überstand bis
 * EINSCHLIESSLICH 0,01 m ist bündig (belegt nicht, keine Warnung), darüber zählt er. Das gilt gerade,
 * in einer gedrehten Szene mit krummen Koordinaten und für schräg herausragende Ecken gedrehter Stände.
 */

const H = Math.SQRT2 * 1.5; // halbe Diagonale eines 3 × 3-Stands
type Variant = 'gerade' | 'Szene gedreht' | 'Ecke 45°';
type Kind = 'belegt' | 'Überlappung' | 'außerhalb';

/** Szene in Achskoordinaten: Grundfläche 50 × 10, Vorderseite y = 0 (Inneres y < 0). */
function scene(kind: Kind, variant: Variant, d: number): { areas: Area[]; stands: Stand[] } {
  const corner = variant === 'Ecke 45°';
  const rotS = corner ? 45 : 0;
  const area: Area = { id: 'G', name: '', cx: 0, cy: -5, w: 50, d: 10, rot: 0 };
  const st = (id: string, r: Rect): Stand => ({ ...createStand(r), id });
  let stands: Stand[];
  if (kind === 'belegt') {
    // vor der Fläche, ragt d hinein
    stands = [st('s', { cx: 0, cy: (corner ? H : 1.5) - d, w: 3, d: 3, rot: rotS })];
  } else if (kind === 'außerhalb') {
    // in der Fläche, ragt d nach vorn heraus
    stands = [st('s', { cx: 0, cy: -(corner ? H : 1.5) + d, w: 3, d: 3, rot: rotS })];
  } else {
    // zwei Stände in der Fläche, B ragt d in A hinein (von rechts)
    stands = [st('a', { cx: 0, cy: -5, w: 3, d: 3, rot: 0 }), st('b', { cx: 1.5 + (corner ? H : 1.5) - d, cy: -5, w: 3, d: 3, rot: rotS })];
  }
  const areas = [area];
  if (variant !== 'Szene gedreht') return { areas, stands };
  return transform({ areas, stands }, 33.3, { x: 20.37, y: 14.37 });
}

function transform<T extends { areas: Area[]; stands: Stand[] }>(s: T, phi: number, shift: { x: number; y: number }): T {
  const turn = <O extends Rect>(o: O): O => {
    const c = rotate({ x: o.cx, y: o.cy }, phi);
    return { ...o, cx: c.x + shift.x, cy: c.y + shift.y, rot: normAngle(o.rot + phi) };
  };
  return { ...s, areas: s.areas.map(turn), stands: s.stands.map(turn) };
}

function decide(kind: Kind, sc: { areas: Area[]; stands: Stand[] }): boolean {
  const w = pageWarnings(sc.areas, sc.stands);
  if (kind === 'belegt') return pageFreeSpaces(sc.areas, sc.stands, 0.5)[0]!.occupied.length > 0;
  if (kind === 'Überlappung') return w.byStand.get('a')!.overlaps.length > 0;
  return w.byStand.get('s')!.outside;
}

const kinds: Kind[] = ['belegt', 'Überlappung', 'außerhalb'];
const variants: Variant[] = ['gerade', 'Szene gedreht', 'Ecke 45°'];
const cases = kinds.flatMap((kind) => variants.flatMap((variant) => [0.009, 0.01, 0.011].map((d) => ({ kind, variant, d, expected: d > 0.0105 }))));

describe('Toleranzgrenze 0,01 m (einschließlich)', () => {
  it.each(cases)('$kind, $variant, $d m → zählt: $expected', ({ kind, variant, d, expected }) => {
    expect(decide(kind, scene(kind, variant, d))).toBe(expected);
  });

  it('QA-M4-01: Stand 3 × 3 bei y = 1,49 berührt die Vorderseite nur (1,49 − 1,5 ≠ −0,01 genau)', () => {
    const area: Area = { id: 'G', name: '', cx: 0, cy: -5, w: 50, d: 10, rot: 0 };
    const s = { ...createStand({ cx: 0, cy: 1.49, w: 3, d: 3, rot: 0 }), id: 's' };
    expect(pageFreeSpaces([area], [s], 0.5)[0]!.free.map((f) => [f.start, f.end])).toEqual([[0, 50]]);
  });

  it('QA-M4-02: schräge Ecke 0,013 m vor der Vorderseite ist außerhalb, 0,010 m nicht', () => {
    expect(decide('außerhalb', scene('außerhalb', 'Ecke 45°', 0.013))).toBe(true);
    expect(decide('außerhalb', scene('außerhalb', 'Ecke 45°', 0.01))).toBe(false);
  });

  it('Eigenschaft: eine gemeinsame Drehung und Verschiebung der Szene ändert keine Entscheidung', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.constantFrom<Variant>('gerade', 'Ecke 45°'),
        fc.oneof(fc.constantFrom(0.009, 0.01, 0.011, 0, 0.02), fc.double({ min: 0, max: 0.03, noNaN: true })),
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (kind, variant, d, phi, x, y) => {
          // Nur knapp über der Grenze (innerhalb der Rechentoleranz) ist die Entscheidung bewusst unbestimmt;
          // genau 0,01 bleibt drin und muss unter jeder Drehung „bündig“ sein
          fc.pre(!(d > 0.01 && d < 0.01 + 1e-5));
          const base = scene(kind, variant, d);
          expect(decide(kind, transform(base, phi, { x, y }))).toBe(decide(kind, base));
        },
      ),
      { numRuns: 1000 },
    );
  });
});
