import { describe, expect, it } from 'vitest';
import { effectivePage } from './derive';
import {
  frontFrame,
  fromFrame,
  fromLocal,
  handlePoint,
  normAngle,
  pointInRect,
  rectCorners,
  rectEdge,
  rectInBounds,
  resizeRect,
  roundRect,
  setFront,
  toFrame,
} from './geometry/rect';
import { allSelectable, objectsInBounds, pickObject } from './hit';
import { areaLabel, formatLabel } from './label';
import { createPage, createProject } from './model/defaults';
import { parseProjectFile, toProjectFile } from './model/schema';
import type { EdgeIndex, Rect, Vec } from './model/types';
import { cloneObjects, createArea, createStand } from './objects';
import { groupCenter, moveRects, rotateRects } from './transform';

const near = (a: Vec, b: Vec, eps = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) < eps;
/** Gleiche Eckenmenge (Reihenfolge egal). */
const sameCorners = (a: Rect, b: Rect, eps = 1e-9) => rectCorners(a).every((p) => rectCorners(b).some((q) => near(p, q, eps)));

describe('Rundung (M3-22)', () => {
  it('rundet Positionen und Maße auf 0,01 m, Drehung auf 0,1° und ist idempotent', () => {
    const r = roundRect({ cx: 1.23456, cy: -0.004, w: 2.999999, d: 3.005, rot: 359.97 });
    expect(r).toEqual({ cx: 1.23, cy: 0, w: 3, d: 3.01, rot: 0 });
    expect(roundRect(r)).toEqual(r);
    expect(roundRect({ cx: 0, cy: 0, w: 1, d: 1, rot: -37.26 }).rot).toBe(322.7);
  });

  it('gerundete Drehungen sind exakt (12.3, nicht 12.300000000000011; QA-M3-04)', () => {
    for (const rot of [12.3, 33.3, 271.2, 0.3, -37.3, 372.3, 359.96, -0.04]) {
      const r = roundRect({ cx: 0, cy: 0, w: 1, d: 1, rot }).rot;
      expect(r).toBe(Number((((rot % 360) + 360) % 360).toFixed(1)) % 360);
      expect(String(r).length).toBeLessThanOrEqual(5);
    }
    expect(normAngle(12.3)).toBe(12.3);
    expect(normAngle(271.2)).toBe(271.2);
  });

  it('normAngle liefert 0 ≤ a < 360', () => {
    expect(normAngle(-90)).toBe(270);
    expect(normAngle(720)).toBe(0);
    expect(normAngle(359.9999999999)).toBe(0);
  });
});

describe('Vorderseite wechseln (M3-03)', () => {
  const rects: Rect[] = [
    { cx: 10, cy: 20, w: 50, d: 10, rot: 0 },
    { cx: -3.5, cy: 7.25, w: 12.4, d: 6.1, rot: 37.3 },
    { cx: 100, cy: -40, w: 8, d: 30, rot: 271.9 },
  ];

  it('die Fläche bleibt exakt an derselben Stelle; nur die Vorderseite wandert', () => {
    for (const r of rects) {
      for (const edge of [0, 1, 2, 3] as EdgeIndex[]) {
        const f = setFront(r, edge);
        expect(sameCorners(r, f)).toBe(true);
        // Die gewählte Kante ist jetzt die Vorderseite (Kante 2)
        const [a, b] = rectEdge(r, edge);
        const [fa, fb] = rectEdge(f, 2);
        expect((near(a, fa) && near(b, fb)) || (near(a, fb) && near(b, fa))).toBe(true);
        // Breite = Länge der Vorderseite
        expect(f.w).toBeCloseTo(Math.hypot(a.x - b.x, a.y - b.y), 9);
        expect(f.cx).toBe(r.cx);
        expect(f.cy).toBe(r.cy);
      }
    }
  });

  it('auch nach dem Runden weichen die Ecken höchstens 0,01 m ab', () => {
    for (const r of rects.map(roundRect)) {
      for (const edge of [0, 1, 3] as EdgeIndex[]) expect(sameCorners(r, roundRect(setFront(r, edge)), 0.01)).toBe(true);
    }
  });

  it('Kante 2 ändert nichts; viermal „rechts“ ergibt wieder das Original', () => {
    const r = rects[1]!;
    expect(setFront(r, 2)).toBe(r);
    let x = r;
    for (let i = 0; i < 4; i++) x = setFront(x, 1);
    expect(x.w).toBe(r.w);
    expect(x.rot).toBeCloseTo(r.rot, 9);
  });
});

describe('Achse entlang der Vorderseite', () => {
  it('Ursprung links unten, Länge = Breite, Tiefe ins Innere', () => {
    const r: Rect = { cx: 25, cy: 5, w: 50, d: 10, rot: 0 };
    const f = frontFrame(r);
    expect(near(f.origin, { x: 0, y: 10 })).toBe(true);
    expect(f.length).toBe(50);
    expect(f.depth).toBe(10);
    expect(toFrame(f, { x: 20, y: 10 })).toEqual({ s: 20, t: 0 });
    expect(near(fromFrame(f, 50, 10), { x: 50, y: 0 })).toBe(true);
  });

  it('gedreht: Ursprung ist die Ecke 3', () => {
    const r: Rect = { cx: 3, cy: -2, w: 7, d: 4, rot: 123 };
    const f = frontFrame(r);
    expect(near(f.origin, rectCorners(r)[3]!)).toBe(true);
    expect(near(fromFrame(f, r.w, 0), rectCorners(r)[2]!)).toBe(true);
  });
});

describe('Größe per Griff (M3-20)', () => {
  it('die gegenüberliegende Ecke bzw. Kante bleibt fest, auch gedreht', () => {
    const r: Rect = { cx: 10, cy: 10, w: 20, d: 8, rot: 30 };
    const fixed = handlePoint(r, { hx: -1, hy: -1 });
    // Zielpunkt: 26 × 11 m ab der festen Ecke (lokal −10/−4)
    const p = fromLocal(r, { x: -10 + 26, y: -4 + 11 });
    const out = resizeRect(r, { hx: 1, hy: 1 }, p, 0.5);
    expect(out.w).toBeCloseTo(26);
    expect(out.d).toBeCloseTo(11);
    expect(near(handlePoint(out, { hx: -1, hy: -1 }), fixed, 1e-9)).toBe(true);
    // Kantengriff ändert nur eine Richtung
    const side = resizeRect(r, { hx: 0, hy: 1 }, handlePoint({ ...r, d: 5 }, { hx: 1, hy: 1 }), 0.5);
    expect(side.w).toBe(20);
    expect(side.d).toBeCloseTo(6.5, 6);
  });

  it('nicht kleiner als das Minimum, nicht größer als das Maximum (QA-M3-02)', () => {
    const r: Rect = { cx: 0, cy: 0, w: 4, d: 4, rot: 0 };
    expect(resizeRect(r, { hx: 1, hy: 0 }, { x: -10, y: 0 }, 0.5).w).toBe(0.5);
    const big = resizeRect(r, { hx: 1, hy: 1 }, { x: 5000, y: 3000 }, 0.5, 2000);
    expect(big).toMatchObject({ w: 2000, d: 2000 });
    expect(handlePoint(big, { hx: -1, hy: -1 })).toEqual({ x: -2, y: -2 }); // feste Ecke bleibt
  });
});

describe('Treffer und Auswahl (M3-15)', () => {
  const page = createPage('T');
  const area = { ...createArea({ cx: 25, cy: 5, w: 50, d: 10, rot: 0 }), id: 'A' };
  const stand = { ...createStand({ cx: 10, cy: 7, w: 4, d: 3, rot: 45 }), id: 'S' };
  page.areas.push(area);
  page.stands.push(stand);

  it('Stände liegen über Grundflächen', () => {
    expect(pickObject(page, { x: 10, y: 7 })?.id).toBe('S');
    expect(pickObject(page, { x: 40, y: 5 })?.id).toBe('A');
    expect(pickObject(page, { x: 60, y: 5 })).toBeNull();
    expect(pointInRect(stand, fromLocal(stand, { x: 1.9, y: 1.4 }))).toBe(true);
    expect(pointInRect(stand, { x: 12.4, y: 7 })).toBe(false); // gedreht: liegt außerhalb
  });

  it('gesperrte oder ausgeblendete Ebenen sind nicht auswählbar', () => {
    const locked = { ...page, layers: { ...page.layers, stands: { visible: true, locked: true } } };
    expect(pickObject(locked, { x: 10, y: 7 })?.id).toBe('A');
    const hidden = { ...page, layers: { ...page.layers, areas: { visible: false, locked: false } } };
    expect(pickObject(hidden, { x: 40, y: 5 })).toBeNull();
    expect(allSelectable(hidden)).toEqual(['S']);
  });

  it('Auswahlrechteck nimmt nur vollständig enthaltene Objekte', () => {
    expect(objectsInBounds(page, { minX: 0, minY: 0, maxX: 20, maxY: 12 })).toEqual(['S']);
    expect(objectsInBounds(page, { minX: -1, minY: -1, maxX: 51, maxY: 11 })).toEqual(['A', 'S']);
    expect(rectInBounds(stand, { minX: 9, minY: 6, maxX: 11, maxY: 8 })).toBe(false);
  });
});

describe('Verschieben und Drehen von Gruppen', () => {
  it('Drehung um die gemeinsame Mitte erhält Abstände; Einzeldrehung um den Mittelpunkt', () => {
    const rects = { a: { cx: 0, cy: 0, w: 2, d: 2, rot: 0 }, b: { cx: 10, cy: 0, w: 2, d: 2, rot: 0 } };
    const c = groupCenter(Object.values(rects))!;
    expect(c).toEqual({ x: 5, y: 0 });
    const out = rotateRects(rects, c, 90);
    expect(out.a!.cx).toBeCloseTo(5);
    expect(out.a!.cy).toBeCloseTo(-5);
    expect(out.b!.rot).toBe(90);
    expect(Math.hypot(out.a!.cx - out.b!.cx, out.a!.cy - out.b!.cy)).toBeCloseTo(10);
    const single = rotateRects({ b: { ...rects.b, rot: 10 } }, { x: 10, y: 0 }, -20);
    expect(single.b).toMatchObject({ cx: 10, cy: 0, rot: 350 });
  });

  it('moveRects verschiebt alle gleich', () => {
    const out = moveRects({ a: { cx: 1, cy: 2, w: 1, d: 1, rot: 0 } }, { x: 0.5, y: -1 });
    expect(out.a).toMatchObject({ cx: 1.5, cy: 1 });
  });
});

describe('Beschriftung (M3-09)', () => {
  const s = createStand({ cx: 0, cy: 0, w: 8, d: 3.5, rot: 0 }, { nr: '12', name: 'Bäckerei Wenz' });

  it('Standardvorlage', () => {
    expect(formatLabel('{nr}\n{name}\n{breite}×{tiefe} m', s)).toEqual(['12', 'Bäckerei Wenz', '8×3,5 m']);
  });

  it('leere Zeilen und Zeilen mit nur leeren Platzhaltern entfallen; Unbekanntes bleibt stehen', () => {
    const empty = { ...s, nr: '', name: '' };
    expect(formatLabel('{nr}\n{name}\n{breite}×{tiefe} m', empty)).toEqual(['8×3,5 m']);
    expect(formatLabel('{strom} kW\n{anschluss}', s)).toEqual([]);
    expect(formatLabel('{strom} kW · {anschluss}', { ...s, powerKw: 16, connection: 'CEE32' })).toEqual(['16 kW · CEE 32 A']);
    expect(formatLabel('{foo} {kategorie}', s, 'Imbiss')).toEqual(['{foo} Imbiss']);
  });

  it('Grundfläche: Name und Maße, ohne Namen nur Maße', () => {
    expect(areaLabel({ ...createArea({ cx: 0, cy: 0, w: 50, d: 10, rot: 0 }), name: 'Nord' })).toBe('Nord · 50 × 10 m');
    expect(areaLabel(createArea({ cx: 0, cy: 0, w: 12.5, d: 4, rot: 0 }))).toBe('12,5 × 4 m');
  });
});

describe('Kopieren (M3-16)', () => {
  it('neue IDs, versetzt, leere und nicht fixierte Platznummer', () => {
    const s = createStand({ cx: 1, cy: 1, w: 3, d: 3, rot: 0 }, { nr: '7', nrLocked: true, name: 'X' });
    const a = createArea({ cx: 0, cy: 0, w: 10, d: 5, rot: 0 });
    const out = cloneObjects([a], [s], 1, 1);
    expect(out.stands[0]).toMatchObject({ nr: '', nrLocked: false, name: 'X', cx: 2, cy: 2 });
    expect(out.stands[0]!.id).not.toBe(s.id);
    expect(out.areas[0]!.id).not.toBe(a.id);
  });
});

describe('Projektdatei: Grundflächen, Geschäfte, Kategorien (M3-01)', () => {
  it('Rundreise erhält alle Felder', () => {
    const p = createProject('T');
    p.categories.push({ id: 'c1', name: 'Imbiss', color: '#e57373' });
    p.pages[0]!.areas.push(createArea({ cx: 1, cy: 2, w: 50, d: 10, rot: 15 }, 'Nord'));
    p.pages[0]!.stands.push(createStand({ cx: 3, cy: 4, w: 3, d: 2, rot: 0 }, { categoryId: 'c1', color: '#ffffff', connection: 'CEE16', powerKw: 11 }));
    expect(parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(p))))).toEqual(p);
  });

  it('kaputte Einträge werden verworfen, doppelte IDs neu vergeben, unbekannte Kategorie entfernt', () => {
    const p = createProject('T');
    const raw = JSON.parse(JSON.stringify(toProjectFile(p)));
    raw.project.pages[0].areas = [{ id: 'x', cx: 0, cy: 0, w: 10, d: 5, rot: 400, front: 2 }, { id: 'y', cx: 0, cy: 0, w: -1, d: 5 }];
    raw.project.pages[0].stands = [{ id: 'x', cx: 1, cy: 1, w: 3, d: 3, categoryId: 'nope', connection: '400V', color: 'rot' }];
    const out = parseProjectFile(raw).pages[0]!;
    expect(out.areas).toHaveLength(1);
    expect(out.areas[0]).toEqual({ id: 'x', name: '', cx: 0, cy: 0, w: 10, d: 5, rot: 40 });
    expect(out.stands[0]!.id).not.toBe('x');
    expect(out.stands[0]).toMatchObject({ categoryId: null, connection: null, color: null, nr: '' });
  });

  it('E-13: eine alte Ebenen-Sperre des Hintergrunds wird zur Hintergrund-Sperre', () => {
    const p = createProject('T');
    const raw = JSON.parse(JSON.stringify(toProjectFile(p)));
    raw.project.pages[0].layers.background = { visible: true, locked: true };
    raw.project.pages[0].background = { assetId: 'a.png', kind: 'image', fileName: 'a.png', pxSize: { w: 10, h: 10 }, transform: { x: 0, y: 0, metersPerPx: 1, rot: 0 }, opacity: 1, locked: false };
    const page = parseProjectFile(raw).pages[0]!;
    expect(page.background!.locked).toBe(true);
    expect(page.layers.background.locked).toBe(false);
  });
});

describe('Vorschau während einer Geste', () => {
  it('setzt Rechtecke ein und erhält unveränderte Objekte', () => {
    const page = createPage('T');
    const a = createStand({ cx: 0, cy: 0, w: 1, d: 1, rot: 0 });
    const b = createStand({ cx: 5, cy: 0, w: 1, d: 1, rot: 0 });
    page.stands.push(a, b);
    const eff = effectivePage(page, { pageId: page.id, rects: { [a.id]: { cx: 2, cy: 3, w: 1, d: 1, rot: 0 } } });
    expect(eff.stands[0]).toMatchObject({ cx: 2, cy: 3 });
    expect(eff.stands[1]).toBe(b);
    expect(eff.areas).toBe(page.areas);
    expect(effectivePage(page, null)).toBe(page);
    expect(effectivePage(page, { pageId: 'other', rects: {} })).toBe(page);
  });
});
