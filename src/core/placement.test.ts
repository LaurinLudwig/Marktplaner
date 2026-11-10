import { describe, expect, it } from 'vitest';
import { bgToWorld } from './background';
import { createInfra } from './infra';
import { DEFAULT_INFRA_TYPES } from './model/defaults';
import type { Background, Placement, Rect, Stand } from './model/types';
import { createArea, createStand } from './objects';
import { partRect } from './shape';
import {
  applyPlacement,
  cleanPlacement,
  composePlacement,
  IDENTITY,
  invertPlacement,
  isIdentity,
  placedBackground,
  placedList,
  placedObject,
  placementOfTransform,
  relativePlacement,
  toLocal,
  toWorld,
} from './placement';
import { applyTransform } from './verbund';
import { lineEnds } from './infra';

/** #27: Lage eines Festplatzes im Verbund – welt = R(rot) · lokal + (x, y). */

const P: Placement = { x: 37.21, y: -12.807, rot: 23.4567 };
const Q: Placement = { x: -5, y: 100, rot: 271.3 };

const closeRect = (a: Rect, b: Rect, digits = 9) => {
  expect(a.cx).toBeCloseTo(b.cx, digits);
  expect(a.cy).toBeCloseTo(b.cy, digits);
  expect(a.w).toBe(b.w);
  expect(a.d).toBe(b.d);
  const dr = (((a.rot - b.rot) % 360) + 540) % 360 - 180;
  expect(dr).toBeCloseTo(0, digits);
};
const closeVec = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('#27 Lage: Rechnung', () => {
  it('Punkte: Drehung um den Ursprung der Page, dann Verschiebung; Umkehrung und Verkettung', () => {
    expect(applyPlacement({ x: 100, y: 0, rot: 90 }, { x: 30, y: 5 })).toEqual({ x: 95, y: 30 });
    const v = { x: 12.3, y: -4.56 };
    closeVec(applyPlacement(invertPlacement(P), applyPlacement(P, v)), v);
    closeVec(applyPlacement(composePlacement(Q, P), v), applyPlacement(Q, applyPlacement(P, v)));
    // relativ: aus dem System von P in das von Q über die Welt
    closeVec(applyPlacement(Q, applyPlacement(relativePlacement(Q, P), v)), applyPlacement(P, v));
    // gleiche Lagen ergeben exakt die Identität
    expect(relativePlacement(P, { ...P })).toBe(IDENTITY);
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity({ x: 0, y: 0, rot: 360 })).toBe(true);
    expect(isIdentity({ x: 0, y: 1e-12, rot: 0 })).toBe(false);
  });

  it('Bewegung „um pivot drehen, dann verschieben“ als Lage', () => {
    const t = { dx: 3, dy: -4, rot: 33.3, pivot: { x: 10, y: 20 } };
    const p = placementOfTransform(t);
    for (const v of [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: -7.5, y: 123 },
    ])
      closeVec(applyPlacement(p, v), applyTransform(t, v));
  });

  it('cleanPlacement: nur Gleitkomma-Reste entfallen, Drehung auf 0 … 360°', () => {
    expect(cleanPlacement({ x: 1.0000000000001, y: -0.000000000001, rot: -90.00000000001 })).toEqual({ x: 1, y: 0, rot: 270 });
    expect(cleanPlacement({ x: 1.23456789, y: 0, rot: 3.7234 })).toEqual({ x: 1.23456789, y: 0, rot: 3.7234 });
  });
});

describe('#27 Lage: Objekte hin und zurück (toWorld/toLocal)', () => {
  const area = { ...createArea({ cx: 25, cy: -5, w: 50, d: 10, rot: 12.5 }), id: 'a' };
  const stand: Stand = {
    ...createStand({ cx: 10, cy: 4, w: 6, d: 4, rot: 30 }, { labelOffset: { x: 2.5, y: -4 } }),
    id: 's',
    // eigene Form mit gedrehtem Teil (#16): relativ zum Stand
    parts: [
      { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rot: 0 },
      { kind: 'ellipse', x: 0.1, y: 0.2, w: 0.5, h: 0.4, rot: 30 },
    ],
  };
  const types = DEFAULT_INFRA_TYPES;
  const line = { ...createInfra(types.find((t) => t.geometry === 'line')!, { cx: 5, cy: 5, w: 12, d: 0, rot: 40 }), id: 'l' };
  const point = { ...createInfra(types.find((t) => t.geometry === 'point')!, { cx: 7, cy: -3, w: 0, d: 0, rot: 0 }), id: 'p' };
  const rect = { ...createInfra(types.find((t) => t.geometry === 'rect')!, { cx: 1, cy: 2, w: 3, d: 4, rot: 350 }), id: 'r' };

  it('Grundfläche, Stand (mit Teilen und Beschriftung), Rechteck, Linie und Punkt: hin und zurück ergibt das Original', () => {
    for (const o of [area, stand, line, point, rect]) {
      for (const p of [P, Q, { x: 0, y: 0, rot: 180 }]) {
        const back = toLocal(p, toWorld(p, o));
        closeRect(back, o);
        expect(back.id).toBe(o.id);
      }
    }
    const back = toLocal(P, toWorld(P, stand));
    closeVec(back.labelOffset!, stand.labelOffset!);
    expect(back.parts).toBe(stand.parts);
  });

  it('Welt: Mitte abgebildet, Drehung + rot; Punkte behalten 0; Beschriftungsversatz mitgedreht; Teile und Linienenden liegen richtig', () => {
    const w = toWorld(P, stand);
    closeVec({ x: w.cx, y: w.cy }, applyPlacement(P, { x: stand.cx, y: stand.cy }));
    expect(w.rot).toBeCloseTo(30 + P.rot, 9);
    // Beschriftung: Weltlage der Beschriftungsmitte = Abbild der lokalen
    closeVec({ x: w.cx + w.labelOffset!.x, y: w.cy + w.labelOffset!.y }, applyPlacement(P, { x: stand.cx + 2.5, y: stand.cy - 4 }));
    // gedrehter Teil: Weltmitte und Drehung folgen dem Stand
    const partLocal = partRect(stand, stand.parts![1]!);
    const partWorld = partRect(w, w.parts![1]!);
    closeVec({ x: partWorld.cx, y: partWorld.cy }, applyPlacement(P, { x: partLocal.cx, y: partLocal.cy }));
    expect(partWorld.rot).toBeCloseTo(partLocal.rot + P.rot, 9);
    // Linie: beide Enden abgebildet
    const [a, b] = lineEnds(line);
    const [wa, wb] = lineEnds(toWorld(P, line));
    closeVec(wa, applyPlacement(P, a));
    closeVec(wb, applyPlacement(P, b));
    // Punkt: keine Drehung
    expect(toWorld(P, point).rot).toBe(0);
    // round: nur Gleitkomma-Reste
    const r = toWorld({ x: 0, y: 0, rot: 90 }, stand, { round: true });
    expect([r.cx, r.cy, r.rot]).toEqual([-4, 10, 120]);
    expect(r.labelOffset).toEqual({ x: 4, y: 2.5 });
  });

  it('Hintergrund: jeder Quellpunkt landet an seiner Weltstelle; Maßstab bleibt', () => {
    const bg: Background = { assetId: 'x', kind: 'image', fileName: 'x.png', pxSize: { w: 1000, h: 800 }, transform: { x: -20, y: 5, metersPerPx: 0.1, rot: 7 }, opacity: 1, locked: true };
    const w = placedBackground(P, bg);
    for (const s of [
      { x: 0, y: 0 },
      { x: 1000, y: 800 },
      { x: 333, y: 21 },
    ])
      closeVec(bgToWorld(w.transform, s), applyPlacement(P, bgToWorld(bg.transform, s)));
    expect(w.transform.metersPerPx).toBe(0.1);
  });

  it('Zwischenspeicher: dieselbe Eingabe und Lage liefert dieselbe Kopie; Identität das Original; neue Lage neue Kopie', () => {
    expect(placedObject(IDENTITY, stand)).toBe(stand);
    const list = [area];
    expect(placedList(IDENTITY, list)).toBe(list);
    const a = placedObject(P, stand);
    expect(placedObject({ ...P }, stand)).toBe(a);
    const l1 = placedList(P, [stand, area]);
    expect(l1[0]).toBe(a);
    const b = placedObject(Q, stand);
    expect(b).not.toBe(a);
    // beide Lagen bleiben im Zwischenspeicher (Nachbar mehrerer Pages und Gesamtansicht)
    expect(placedObject(P, stand)).toBe(a);
    expect(placedObject(Q, stand)).toBe(b);
    const bg: Background = { assetId: 'x', kind: 'image', fileName: 'x.png', pxSize: { w: 10, h: 10 }, transform: { x: 0, y: 0, metersPerPx: 1, rot: 0 }, opacity: 1, locked: true };
    expect(placedBackground(P, bg)).toBe(placedBackground({ ...P }, bg));
    expect(placedBackground(IDENTITY, bg)).toBe(bg);
  });
});
