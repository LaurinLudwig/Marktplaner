import { describe, expect, it } from 'vitest';
import { toLocal } from './geometry/rect';
import type { ShapeTemplate, Vec } from './model/types';
import { ELLIPSE_SEGMENTS, normalizeParts, partsInMeters, shapePaths, standOutline, unionOutline } from './shape';

/** Geschäftsformen (M12, #9, spec.md §3 „Form“). */

const stand = (over: object = {}) => ({ cx: 10, cy: 20, w: 6, d: 4, rot: 0, shape: 'rect' as const, ...over });
const len = (s: [Vec, Vec]) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
const total = (segs: [Vec, Vec][]) => segs.reduce((n, s) => n + len(s), 0);

describe('standOutline', () => {
  it('Rechteck: die vier Ecken des Stands', () => {
    expect(standOutline(stand())).toEqual([[{ x: 7, y: 18 }, { x: 13, y: 18 }, { x: 13, y: 22 }, { x: 7, y: 22 }]]);
  });

  it('Kreis/Oval: Ellipse im Rechteck B × T, auch gedreht', () => {
    for (const rot of [0, 30, 245]) {
      const s = stand({ shape: 'ellipse', rot });
      const [poly] = standOutline(s);
      expect(poly).toHaveLength(ELLIPSE_SEGMENTS);
      for (const p of poly!) {
        const l = toLocal(s, p);
        expect((l.x / 3) ** 2 + (l.y / 2) ** 2).toBeCloseTo(1, 9);
      }
      // berührt alle vier Seiten des Rechtecks
      const ls = poly!.map((p) => toLocal(s, p));
      expect(Math.max(...ls.map((p) => p.x))).toBeCloseTo(3, 9);
      expect(Math.min(...ls.map((p) => p.y))).toBeCloseTo(-2, 9);
    }
  });

  it('Vorlage: Teile werden auf B × T gestreckt; die Vorlage hat Vorrang vor der Grundform', () => {
    const t: ShapeTemplate = { id: 't', name: 'T', w: 2, d: 2, parts: [{ kind: 'rect', x: 0, y: 0.5, w: 1, h: 0.5 }, { kind: 'ellipse', x: 0.25, y: 0, w: 0.5, h: 0.5 }] };
    const polys = standOutline(stand({ shape: 'ellipse' }), t);
    expect(polys).toHaveLength(2);
    expect(polys[0]).toEqual([{ x: 7, y: 20 }, { x: 13, y: 20 }, { x: 13, y: 22 }, { x: 7, y: 22 }]);
    const xs = polys[1]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(8.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(11.5, 9);
  });
});

describe('unionOutline', () => {
  const sq = (x: number, y: number, w: number, h: number): Vec[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

  it('ein Teil: alle Kanten', () => {
    expect(total(unionOutline([sq(0, 0, 4, 2)]))).toBeCloseTo(12, 9);
  });

  it('überlappende Rechtecke: nur der äußere Umriss, keine Innenkante', () => {
    // L-Form: 4 × 2 und 2 × 4, überlappend in 2 × 2
    const segs = unionOutline([sq(0, 0, 4, 2), sq(0, 0, 2, 4)]);
    expect(total(segs)).toBeCloseTo(16, 9);
    // kein Stück liegt im Inneren
    for (const [a, b] of segs) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(m.x > 0.01 && m.x < 1.99 && m.y > 0.01 && m.y < 1.99).toBe(false);
    }
  });

  it('anliegende Rechtecke: die gemeinsame Kante entfällt', () => {
    expect(total(unionOutline([sq(0, 0, 2, 2), sq(2, 0, 2, 2)]))).toBeCloseTo(12, 9);
  });

  it('deckungsgleiche Teile: der Umriss erscheint nur einmal', () => {
    expect(total(unionOutline([sq(0, 0, 2, 2), sq(0, 0, 2, 2)]))).toBeCloseTo(8, 9);
  });

  it('Teil ganz im anderen: nur der äußere', () => {
    expect(total(unionOutline([sq(0, 0, 4, 4), sq(1, 1, 1, 1)]))).toBeCloseTo(16, 9);
  });

  it('Kreis auf Rechteck (Karussell mit Kasse): Kreis-Abschnitt im Rechteck entfällt', () => {
    const t: ShapeTemplate = { id: 't', name: 'T', w: 1, d: 1, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 1 }, { kind: 'rect', x: 0.4, y: 0.5, w: 0.2, h: 0.5 }] };
    const polys = standOutline({ cx: 0, cy: 0, w: 10, d: 10, rot: 17, shape: 'rect' }, t);
    const segs = unionOutline(polys);
    const s = { cx: 0, cy: 0, w: 10, d: 10, rot: 17 };
    for (const [a, b] of segs) {
      const m = toLocal(s, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      // kein Stück im Inneren des Rechtecks …
      expect(m.x > -0.99 && m.x < 0.99 && m.y > 0.01 && m.y < 4.99).toBe(false);
      // … und keines innerhalb des Kreises
      expect(Math.hypot(m.x, m.y) < 4.9).toBe(false);
    }
  });
});

describe('normalizeParts', () => {
  it('Teile in Metern → relativ zum Hüllrechteck; Vorschlagsmaß = Hüllrechteck; Rückweg über partsInMeters', () => {
    const n = normalizeParts([{ kind: 'ellipse', x: 1, y: 1, w: 8, h: 8 }, { kind: 'rect', x: 3, y: 7, w: 4, h: 4 }])!;
    expect(n.w).toBe(8);
    expect(n.d).toBe(10);
    expect(n.parts).toEqual([{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 0.8 }, { kind: 'rect', x: 0.25, y: 0.6, w: 0.5, h: 0.4 }]);
    expect(partsInMeters(n)).toEqual([{ kind: 'ellipse', x: 0, y: 0, w: 8, h: 8 }, { kind: 'rect', x: 2, y: 6, w: 4, h: 4 }]);
  });

  it('ohne brauchbares Teil null; unbrauchbare Teile entfallen', () => {
    expect(normalizeParts([])).toBeNull();
    expect(normalizeParts([{ kind: 'rect', x: 0, y: 0, w: 0, h: 1 }])).toBeNull();
    expect(normalizeParts([{ kind: 'rect', x: 0, y: 0, w: 2, h: 1 }, { kind: 'rect', x: NaN, y: 0, w: 1, h: 1 }])!.parts).toHaveLength(1);
  });
});

describe('shapePaths (Bögen statt Vielecke)', () => {
  /** Endpunkte aller Bögen und Linien eines Pfads. */
  const points = (d: string): Vec[] =>
    [...d.matchAll(/([MLA])([^MLAZ]*)/g)].map(([, c, args]) => {
      const n = args!.trim().split(/[\s,]+/).map(Number);
      return c === 'A' ? { x: n[5]!, y: n[6]! } : { x: n[0]!, y: n[1]! };
    });
  const tpl = (parts: ShapeTemplate['parts']): ShapeTemplate => ({ id: 't', name: 'T', w: 1, d: 1, parts });

  it('Kreis/Oval: geschlossener Pfad aus vier Bögen auf der Ellipse, gedreht', () => {
    const s = stand({ shape: 'ellipse', rot: 30 });
    const { fill, outline } = shapePaths(s);
    expect(fill).toBe(outline);
    expect(fill.match(/A/g)).toHaveLength(4);
    expect(fill.endsWith('Z')).toBe(true);
    expect(fill).toContain('A3.000 2.000 30 0 1');
    for (const p of points(fill)) {
      const l = toLocal(s, p);
      expect((l.x / 3) ** 2 + (l.y / 2) ** 2).toBeCloseTo(1, 4);
    }
  });

  it('Rechteck links über dem Kreis: der Bogen läuft über den Startwinkel hinweg als ein Zug, kein Stück im Rechteck', () => {
    // Kreis 0 … 1, Rechteck x −0,2 … 0,3 mittig: schneidet den Kreis links (Winkel π)
    const t = tpl([{ kind: 'ellipse', x: 0.2, y: 0, w: 0.8, h: 1 }, { kind: 'rect', x: 0, y: 0.3, w: 0.4, h: 0.4 }]);
    const s = { cx: 0, cy: 0, w: 10, d: 10, rot: 0, shape: 'rect' as const };
    const { outline } = shapePaths(s, t);
    expect(outline.match(/M/g)).toHaveLength(2);
    for (const p of points(outline)) {
      const inRect = p.x > -5 + 0.01 && p.x < -1 - 0.01 && p.y > -2 + 0.01 && p.y < 2 - 0.01;
      expect(inRect).toBe(false);
    }
  });

  it('Kreis ganz im Rechteck: keine Bögen in der Kontur', () => {
    const t = tpl([{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }, { kind: 'ellipse', x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]);
    const { fill, outline } = shapePaths({ cx: 0, cy: 0, w: 4, d: 4, rot: 0, shape: 'rect' }, t);
    expect(fill.match(/A/g)).toHaveLength(4);
    expect(outline).not.toContain('A');
    expect(outline.match(/M/g)).toHaveLength(1);
  });

  it('Vorlage aus einem Kreis: ganze Ellipse als Kontur', () => {
    const { outline } = shapePaths({ cx: 0, cy: 0, w: 4, d: 2, rot: 0, shape: 'rect' }, tpl([{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 1 }]));
    expect(outline.match(/A/g)).toHaveLength(4);
    expect(outline.endsWith('Z')).toBe(true);
  });
});

