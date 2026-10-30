import { describe, expect, it } from 'vitest';
import { behindDir, fitInside, labelBounds, layoutStandLabels, wrapLine, type LabelPlacement } from './labelLayout';
import { approxTextWidth } from './label';
import type { Area, Stand } from './model/types';
import { createArea, createStand } from './objects';

/** #9: Beschriftung umbrechen, sonst hinter/vor/weiter weg mit Führungslinie, von Hand verschiebbar. */

const FS = 0.6;
const st = (id: string, cx: number, cy: number, w: number, d: number, fields: Partial<Stand> = {}): Stand => ({ ...createStand({ cx, cy, w, d, rot: 0 }, fields), id });
/** Grundfläche 100 × 20 m um (0, 0), Vorderseite unten (y = 10): „hinter“ den Ständen ist oben (−y). */
const area: Area = createArea({ cx: 0, cy: 0, w: 100, d: 20, rot: 0 }, 'Reihe');
const layout = (stands: Stand[], lines: (s: Stand) => string[], areas: Area[] = [area]) => layoutStandLabels({ stands, areas, infra: [], fontSize: FS, linesOf: lines });
const LONG = ['MW-5', 'Corn Dogs', 'J. Weinheimer', 'Süßwaren – Waffeln', '4×3,5 m', '3,5 kW'];

describe('#9 Beschriftung: umbrechen', () => {
  it('bricht an Leerzeichen und nach Bindestrichen um; zu lange Einzelwörter bleiben ganz', () => {
    const max = approxTextWidth('Spielgeschäft – Wurf-', FS);
    expect(wrapLine('Spielgeschäft – Wurf- und Geschicklichkeit', max, FS)).toEqual(['Spielgeschäft – Wurf-', 'und Geschicklichkeit']);
    expect(wrapLine('Hau-den-Lukas', approxTextWidth('Hau-den-', FS), FS)).toEqual(['Hau-den-', 'Lukas']);
    expect(wrapLine('Geschicklichkeitsspiel', 1, FS)).toEqual(['Geschicklichkeitsspiel']);
    expect(wrapLine('kurz', 100, FS)).toEqual(['kurz']);
  });

  it('passt umbrochen in den Stand → bleibt darauf; zu klein → null; gedrehter Stand nutzt die horizontale Ausdehnung', () => {
    const fit = fitInside(st('a', 0, 0, 7, 5), ['Spielgeschäft – Wurf- und Geschicklichkeit', '7×5 m'], FS);
    expect(fit!.lines.length).toBeGreaterThan(2);
    expect(fit!.w).toBeLessThanOrEqual(7);
    expect(fitInside(st('b', 0, 0, 4, 3.5), LONG, FS)).toBeNull();
    // 2 × 12 m um 90° gedreht: horizontal 12 m breit, 2 m hoch → eine Zeile passt
    expect(fitInside({ cx: 0, cy: 0, w: 2, d: 12, rot: 90 }, ['Bratwurst Meier'], FS)).not.toBeNull();
    expect(fitInside({ cx: 0, cy: 0, w: 2, d: 12, rot: 0 }, ['Bratwurst Meier'], FS)).toBeNull();
  });
});

describe('#9 Beschriftung: auslagern', () => {
  const top = (p: LabelPlacement) => labelBounds(p);

  it('hinter = gegenüber der Vorderseite der Grundfläche; ohne Grundfläche die des Stands', () => {
    expect(behindDir(st('a', 0, 5, 4, 3), [area])).toMatchObject({ x: expect.closeTo(0), y: -1 });
    const flipped = { ...area, rot: 180 };
    expect(behindDir(st('a', 0, 5, 4, 3), [flipped]).y).toBeCloseTo(1);
    expect(behindDir({ ...st('a', 500, 5, 4, 3), rot: 90 }, [area]).x).toBeCloseTo(1);
  });

  it('passt nicht auf den Stand → hinter den Stand, mit Führungslinie vom Standrand zum Block', () => {
    const s = st('a', 0, 8.25, 4, 3.5);
    const p = layout([s], () => LONG).get('a')!;
    expect(p.mode).toBe('behind');
    expect(p.lines).toEqual(LONG);
    expect(top(p).maxY).toBeLessThanOrEqual(s.cy - s.d / 2);
    expect(p.leader!.a.y).toBeCloseTo(s.cy - s.d / 2);
    expect(p.leader!.b.y).toBeCloseTo(top(p).maxY);
  });

  it('direkt dahinter belegt → weiter hinten; hinten alles belegt → davor; davor auch → weiter weg davor', () => {
    const s = st('a', 0, 0, 4, 3.5);
    const only = (x: Stand) => (x.id === 'a' ? LONG : []);
    const nearBack = st('nb', 0, -6, 6, 6);
    const p0 = layout([s, nearBack], only).get('a')!;
    expect(p0.mode).toBe('far');
    expect(p0.cy).toBeLessThan(s.cy); // weiterhin hinter dem Stand
    const allBack = st('back', 0, -41, 200, 76);
    expect(layout([s, allBack], only).get('a')!.mode).toBe('front');
    const nearFront = st('front', 0, 6, 6, 6);
    const p2 = layout([s, allBack, nearFront], only).get('a')!;
    expect(p2.mode).toBe('far');
    expect(p2.cy).toBeGreaterThan(s.cy);
    for (const o of [allBack, nearFront]) {
      const b = labelBounds(p2);
      const ob = { minX: o.cx - o.w / 2, maxX: o.cx + o.w / 2, minY: o.cy - o.d / 2, maxY: o.cy + o.d / 2 };
      expect(b.maxX <= ob.minX || b.minX >= ob.maxX || b.maxY <= ob.minY || b.minY >= ob.maxY).toBe(true);
    }
  });

  it('Beschriftungen der Grundflächen sind Hindernisse', () => {
    const s = st('a', 0, 8.25, 4, 3.5);
    const free = layout([s], () => LONG).get('a')!;
    const blocked = layoutStandLabels({ stands: [s], areas: [area], infra: [], fontSize: FS, linesOf: () => LONG, blocked: [labelBounds(free)] }).get('a')!;
    expect(blocked.cy === free.cy && blocked.cx === free.cx).toBe(false);
  });

  it('Nachbarn in einer Reihe: ausgelagerte Beschriftungen überlappen sich nicht', () => {
    const stands = [st('a', 0, 8.25, 4, 3.5), st('b', 4.5, 8.25, 4, 3.5), st('c', 9, 8.25, 4, 3.5)];
    const ps = [...layout(stands, () => LONG).values()];
    expect(ps.every((p) => p.mode !== 'inside' && p.mode !== 'fallback')).toBe(true);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = labelBounds(ps[i]!);
        const b = labelBounds(ps[j]!);
        expect(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY).toBe(true);
      }
  });

  it('von Hand verschoben: steht dort, ungebrochen, mit Führungslinie; ist Hindernis für die anderen', () => {
    const a = st('a', 0, 8.25, 4, 3.5, { labelOffset: { x: 0, y: -6 } });
    const b = st('b', 4.5, 8.25, 4, 3.5);
    const m = layout([a, b], () => LONG);
    expect(m.get('a')).toMatchObject({ mode: 'manual', cx: 0, cy: 2.25, lines: LONG });
    expect(m.get('a')!.leader).not.toBeNull();
    const ba = labelBounds(m.get('a')!);
    const bb = labelBounds(m.get('b')!);
    expect(ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY).toBe(true);
  });

  it('passt auf den Stand → wie bisher mittig, keine Führungslinie; Stände ohne Zeilen fehlen', () => {
    const m = layout([st('a', 0, 0, 10, 6), st('b', 20, 0, 4, 4)], (s) => (s.id === 'a' ? ['MW-1', 'Bratwurst'] : []));
    expect(m.get('a')).toMatchObject({ mode: 'inside', cx: 0, cy: 0, leader: null });
    expect(m.has('b')).toBe(false);
  });
});
