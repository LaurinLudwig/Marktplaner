import { describe, expect, it } from 'vitest';
import {
  applyPaperScale,
  bgCenter,
  bgToWorld,
  calibrate,
  CalibrationError,
  initialTransform,
  METERS_PER_PDF_POINT,
  paperScaleDenominator,
  rotateAround,
  transformForReplacement,
  visibleSourceRegion,
  worldToBg,
  type BgTransform,
} from './background';
import { constrainAngle, measure } from './measure';
import { closestPointOnSegment, findSnap, rectSnapSource } from './snap';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('Hintergrund-Transformation', () => {
  const t: BgTransform = { x: 12, y: -4, metersPerPx: 0.25, rot: 30 };

  it('bgToWorld und worldToBg sind zueinander invers', () => {
    const s = { x: 123.4, y: 56.7 };
    close(worldToBg(t, bgToWorld(t, s)), s);
  });

  it('Ursprung des Plans liegt bei (x, y)', () => {
    close(bgToWorld(t, { x: 0, y: 0 }), { x: 12, y: -4 });
  });

  it('initialTransform zentriert den Plan mit der gewünschten Breite', () => {
    const it0 = initialTransform({ w: 1000, h: 800 }, { x: 5, y: 5 }, 200);
    expect(it0.metersPerPx).toBe(0.2);
    close(bgCenter(it0, { w: 1000, h: 800 }), { x: 5, y: 5 });
  });
});

describe('Kalibrierung', () => {
  // Testplan wie tests/fixtures/raster-10m.png: 1000 × 800 px, Linien alle 100 px = 10 m.
  const size = { w: 1000, h: 800 };
  const start = initialTransform(size, { x: 0, y: 0 }, 137); // beliebiger, falscher Maßstab

  it('zwei Punkte im Abstand von 100 px mit 10 m ergeben exakt 0,1 m/px', () => {
    const w1 = bgToWorld(start, { x: 100, y: 100 });
    const w2 = bgToWorld(start, { x: 200, y: 100 });
    const c = calibrate(start, w1, w2, 10);
    expect(c.metersPerPx).toBeCloseTo(0.1, 12);
    // Alle Rasterlinien liegen danach auf exakten 10-m-Abständen
    for (let i = 0; i <= 10; i++) {
      const a = bgToWorld(c, { x: i * 100, y: 0 });
      const b = bgToWorld(c, { x: (i + 1) * 100, y: 0 });
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 9);
    }
  });

  it('der erste Punkt bleibt an seiner Weltposition', () => {
    const w1 = bgToWorld(start, { x: 300, y: 400 });
    const w2 = bgToWorld(start, { x: 300, y: 100 });
    const c = calibrate(start, w1, w2, 30);
    close(bgToWorld(c, { x: 300, y: 400 }), w1);
  });

  it('funktioniert auch bei gedrehtem Plan und schräger Strecke', () => {
    const rotated = { ...start, rot: -37 };
    const w1 = bgToWorld(rotated, { x: 0, y: 0 });
    const w2 = bgToWorld(rotated, { x: 300, y: 400 }); // 500 px
    const c = calibrate(rotated, w1, w2, 50);
    expect(c.metersPerPx).toBeCloseTo(0.1, 12);
    expect(c.rot).toBe(-37);
  });

  it('erneute Kalibrierung ändert nur die Transformation (Ergebnis unabhängig vom Vorzustand)', () => {
    const w = (tt: BgTransform) => [bgToWorld(tt, { x: 100, y: 0 }), bgToWorld(tt, { x: 600, y: 0 })] as const;
    const once = calibrate(start, ...w(start), 50);
    const twice = calibrate(once, ...w(once), 50);
    expect(twice.metersPerPx).toBeCloseTo(once.metersPerPx, 12);
  });

  it('lehnt ungültige Eingaben ab', () => {
    const p = { x: 1, y: 1 };
    expect(() => calibrate(start, p, { x: 2, y: 2 }, 0)).toThrow(CalibrationError);
    expect(() => calibrate(start, p, { x: 2, y: 2 }, -5)).toThrow(CalibrationError);
    expect(() => calibrate(start, p, { x: 2, y: 2 }, Number.NaN)).toThrow(CalibrationError);
    expect(() => calibrate(start, p, p, 10)).toThrow(/aufeinander/);
  });
});

describe('Papiermaßstab (PDF)', () => {
  it('1:1000: 10 mm auf dem Papier sind 10 m', () => {
    const t = applyPaperScale(initialTransform({ w: 842, h: 595 }, { x: 0, y: 0 }, 50), 1000, { x: 0, y: 0 });
    const tenMillimetres = 10 / 25.4 * 72; // in PDF-Punkten
    const a = bgToWorld(t, { x: 0, y: 0 });
    const b = bgToWorld(t, { x: tenMillimetres, y: 0 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 9);
    expect(paperScaleDenominator(t)).toBeCloseTo(1000, 9);
    expect(METERS_PER_PDF_POINT * 72).toBeCloseTo(0.0254, 12);
  });

  it('der Ankerpunkt bleibt fest', () => {
    const t0 = initialTransform({ w: 842, h: 595 }, { x: 3, y: 4 }, 50);
    const anchor = { x: 3, y: 4 };
    const s = worldToBg(t0, anchor);
    close(bgToWorld(applyPaperScale(t0, 500, anchor), s), anchor);
  });
});

describe('Drehen und Ersetzen', () => {
  it('rotateAround hält den Drehpunkt fest', () => {
    const t0 = initialTransform({ w: 1000, h: 800 }, { x: 0, y: 0 }, 100);
    const pivot = { x: 10, y: -3 };
    const s = worldToBg(t0, pivot);
    const r = rotateAround(t0, 45, pivot);
    expect(r.rot).toBe(45);
    close(bgToWorld(r, s), pivot);
  });

  it('Ersetzen behält Position, Drehung und Breite in Metern', () => {
    const old = { x: 1, y: 2, metersPerPx: 0.1, rot: 15 };
    const r = transformForReplacement(old, { w: 1000 }, { w: 4000 });
    expect(r.metersPerPx).toBeCloseTo(0.025, 12);
    expect([r.x, r.y, r.rot]).toEqual([1, 2, 15]);
  });

  it('visibleSourceRegion begrenzt auf den Plan und erkennt „nicht sichtbar“', () => {
    const t = { x: 0, y: 0, metersPerPx: 0.1, rot: 0 };
    expect(visibleSourceRegion(t, { w: 1000, h: 800 }, { minX: 10, minY: 10, maxX: 20, maxY: 30 })).toEqual({
      minX: 100,
      minY: 100,
      maxX: 200,
      maxY: 300,
    });
    expect(visibleSourceRegion(t, { w: 1000, h: 800 }, { minX: -50, minY: -50, maxX: 500, maxY: 500 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1000,
      maxY: 800,
    });
    expect(visibleSourceRegion(t, { w: 1000, h: 800 }, { minX: 200, minY: 0, maxX: 300, maxY: 10 })).toBeNull();
  });
});

describe('Messen', () => {
  it('Abstand und Winkel', () => {
    const m = measure({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(m.distance).toBe(50);
    expect(m.angle).toBeCloseTo(53.1301, 3);
    expect(measure({ x: 0, y: 0 }, { x: -1, y: 0 }).angle).toBe(180);
  });

  it('Shift beschränkt auf 45°-Schritte und erhält die Länge', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    close(p, { x: Math.hypot(10, 1), y: 0 });
    const q = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y, 9);
  });
});

describe('Fang', () => {
  const rect = { cx: 10, cy: 5, w: 20, d: 10, rot: 0 };

  it('fängt an Ecken mit Vorrang vor Kanten', () => {
    const r = findSnap({ x: 0.3, y: 0.2 }, [rectSnapSource([rect])], 1);
    expect(r).toMatchObject({ kind: 'corner', point: { x: 0, y: 0 } });
  });

  it('fängt an Kanten, wenn keine Ecke in Reichweite ist', () => {
    const r = findSnap({ x: 10, y: 0.4 }, [rectSnapSource([rect])], 1);
    expect(r?.kind).toBe('edge');
    close(r!.point, { x: 10, y: 0 });
  });

  it('nichts in Reichweite, keine Quellen, gedrehte Rechtecke', () => {
    expect(findSnap({ x: 50, y: 50 }, [rectSnapSource([rect])], 1)).toBeNull();
    expect(findSnap({ x: 0, y: 0 }, [], 1)).toBeNull();
    expect(findSnap({ x: 0, y: 0 }, [rectSnapSource([])], 1)).toBeNull();
    const rotated = { cx: 0, cy: 0, w: 2, d: 2, rot: 45 };
    const r = findSnap({ x: 0, y: -1.35 }, [rectSnapSource([rotated])], 0.2);
    expect(r?.kind).toBe('corner');
    close(r!.point, { x: 0, y: -Math.SQRT2 });
  });

  it('closestPointOnSegment begrenzt auf die Strecke', () => {
    close(closestPointOnSegment({ x: -5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), { x: 0, y: 0 });
    close(closestPointOnSegment({ x: 4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), { x: 4, y: 0 });
  });
});

describe('Plausibilität des Maßstabs (QA-M2-07)', () => {
  const pdfSize = { w: 842, h: 595 };
  const at = (n: number) => ({ x: 0, y: 0, metersPerPx: n * METERS_PER_PDF_POINT, rot: 0 });

  it('PDF: 1:50 bis 1:10.000 ist unauffällig, außerhalb gibt es einen Hinweis', async () => {
    const { scaleWarnings } = await import('./background');
    expect(scaleWarnings('pdf', pdfSize, at(50), null)).toEqual([]);
    expect(scaleWarnings('pdf', pdfSize, at(10000), null)).toEqual([]);
    expect(scaleWarnings('pdf', pdfSize, at(1), null)[0]).toContain('1:1');
    expect(scaleWarnings('pdf', pdfSize, at(1_000_000), null)[0]).toContain('1:1.000.000');
  });

  it('Bild/SVG: Planbreite 10 m bis 5 km', async () => {
    const { scaleWarnings } = await import('./background');
    const size = { w: 1000, h: 800 };
    expect(scaleWarnings('image', size, { x: 0, y: 0, metersPerPx: 0.1, rot: 0 }, null)).toEqual([]);
    expect(scaleWarnings('image', size, { x: 0, y: 0, metersPerPx: 0.001, rot: 0 }, null)[0]).toContain('1 m breit');
    expect(scaleWarnings('svg', size, { x: 0, y: 0, metersPerPx: 10, rot: 0 }, null)[0]).toContain('10.000 m breit');
  });

  it('Neukalibrierung: Änderung um mehr als Faktor 2 wird gemeldet', async () => {
    const { scaleWarnings } = await import('./background');
    const size = { w: 1000, h: 800 };
    const old = { x: 0, y: 0, metersPerPx: 0.1, rot: 0 };
    expect(scaleWarnings('image', size, { ...old, metersPerPx: 0.19 }, old)).toEqual([]);
    expect(scaleWarnings('image', size, { ...old, metersPerPx: 0.25 }, old)[0]).toContain('Faktor 2,5 (größer)');
    expect(scaleWarnings('image', size, { ...old, metersPerPx: 0.04 }, old)[0]).toContain('Faktor 2,5 (kleiner)');
  });
});
