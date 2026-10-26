import { describe, expect, it } from 'vitest';
import {
  clickRect,
  createInfra,
  dragRect,
  hitInfra,
  infraConflicts,
  lineEnds,
  lineFromEnds,
  occupyingRects,
  passageTooNarrow,
  segmentLengthInRect,
  standInObject,
  typeMap,
  ZERO_LINE_OCCUPY,
} from './infra';
import { DEFAULT_INFRA_TYPES } from './model/defaults';
import type { InfraTypeDef } from './model/types';
import { createStand } from './objects';

/** M7: Infrastruktur-Objekte (spec.md §11). */

const T = typeMap(DEFAULT_INFRA_TYPES);
const type = (id: string) => T.get(id)!;
const stand = (cx: number, cy: number, w = 3, d = 3, rot = 0) => createStand({ cx, cy, w, d, rot });

describe('Anlegen je Geometrie', () => {
  it('Klick: Rechteck mittig, Linie waagerecht ab der Klickstelle, Punkt ohne Maße', () => {
    expect(clickRect(type('toilet'), { x: 10, y: 5 })).toEqual({ cx: 10, cy: 5, w: 6, d: 2.5, rot: 0 });
    expect(clickRect(type('barrierMobile'), { x: 10, y: 5 })).toEqual({ cx: 11.75, cy: 5, w: 3.5, d: 0.3, rot: 0 });
    expect(lineEnds(clickRect(type('narrowPassage'), { x: 10, y: 5 }))[0]).toEqual({ x: 10, y: 5 });
    expect(clickRect(type('marker'), { x: 1.234, y: 2 })).toEqual({ cx: 1.23, cy: 2, w: 0, d: 0, rot: 0 });
  });

  it('Aufziehen: Linie von A nach B (Länge, Richtung, Standardstärke); unter 0,5 m zählt als Klick', () => {
    const r = dragRect(type('barrierFixed'), { x: 0, y: 0 }, { x: 0, y: 10 })!;
    expect(r).toEqual({ cx: 0, cy: 5, w: 10, d: 0.8, rot: 90 });
    const [a, b] = lineEnds(r);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(10);
    expect(dragRect(type('barrierFixed'), { x: 0, y: 0 }, { x: 0.3, y: 0.3 })).toBeNull();
    expect(dragRect(type('toilet'), { x: 0, y: 0 }, { x: 5, y: 0.4 })).toBeNull();
    expect(dragRect(type('toilet'), { x: 4, y: 2 }, { x: 0, y: 0 })).toEqual({ cx: 2, cy: 1, w: 4, d: 2, rot: 0 });
    expect(dragRect(type('marker'), { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });

  it('Endpunkte setzen ändert Länge und Richtung, nie unter 0,5 m', () => {
    const o = createInfra(type('narrowPassage'), { cx: 0, cy: 0, w: 4, d: 0, rot: 0 });
    expect(lineFromEnds(o, { x: 0, y: 0 }, { x: -3, y: 0 })).toMatchObject({ cx: -1.5, w: 3, rot: 180 });
    expect(lineFromEnds(o, { x: 0, y: 0 }, { x: 0, y: 0.1 }).w).toBe(0.5);
  });

  it('Maße werden auf die Grenzen der Geometrie gebracht', () => {
    expect(createInfra(type('toilet'), { cx: 0, cy: 0, w: 0.1, d: 3000, rot: 370 })).toMatchObject({ w: 0.5, d: 2000, rot: 10 });
    expect(createInfra(type('barrierMobile'), { cx: 0, cy: 0, w: 2, d: 9, rot: 0 }).d).toBe(5);
    expect(createInfra(type('marker'), { cx: 0, cy: 0, w: 2, d: 9, rot: 45 })).toMatchObject({ w: 0, d: 0, rot: 0 });
  });
});

describe('Freihalten (Warnung „Infrastruktur“)', () => {
  const rtw = createInfra(type('ambulance'), { cx: 0, cy: 0, w: 8, d: 3.5, rot: 0 });

  it('Rechteck: Eindringen über 0,01 m warnt, Berühren und 0,01 m nicht', () => {
    // RTW reicht bis x = 4; Stand 3 m breit
    expect(standInObject(stand(4.5, 0), rtw, 'rect')).toBe(true); // 1 m hinein
    expect(standInObject(stand(5.49, 0), rtw, 'rect')).toBe(false); // 0,01 m
    expect(standInObject(stand(5.48, 0), rtw, 'rect')).toBe(true); // 0,02 m
    expect(standInObject(stand(5.5, 0), rtw, 'rect')).toBe(false); // bündig
  });

  it('Linie ohne Stärke (Durchfahrt): reicht mehr als 0,01 m in den Stand hinein', () => {
    const p = createInfra(type('narrowPassage'), { cx: 0, cy: 0, w: 4, d: 0, rot: 0 });
    expect(standInObject(stand(0, 0), p, 'line')).toBe(true);
    expect(standInObject(stand(3.48, 0), p, 'line')).toBe(true); // reicht 0,02 m hinein
    expect(standInObject(stand(3.49, 0), p, 'line')).toBe(false); // 0,01 m
    expect(standInObject(stand(3.5, 0), p, 'line')).toBe(false); // Stand beginnt am Endpunkt
    expect(standInObject(stand(0, 1.5), p, 'line')).toBe(false); // Linie auf der Kante: liegt nicht im Stand
    expect(standInObject(stand(0, 1.6), p, 'line')).toBe(false);
    expect(standInObject(stand(0, 1.49), p, 'line')).toBe(false); // 0,01 m innerhalb der Kante
    expect(standInObject(stand(0, 1.48), p, 'line')).toBe(true);
  });

  it('Linie mit Stärke (Sperre) zählt als Rechteck', () => {
    const s = createInfra(type('barrierFixed'), { cx: 0, cy: 0, w: 4, d: 0.8, rot: 90 });
    expect(standInObject(stand(1.8, 0), s, 'line')).toBe(true); // 0,1 m in die 0,4 m halbe Stärke
    expect(standInObject(stand(1.9, 0), s, 'line')).toBe(false);
  });

  it('nur Typen mit „freihalten“ zählen; ein Stand kann mehrere Objekte verletzen', () => {
    // feste Typen außer dem Marker haben „freihalten“ (Toilette und Müllcontainer seit 2026-10-12, Laurin)
    expect(DEFAULT_INFRA_TYPES.filter((t) => !t.keepClear).map((t) => t.id)).toEqual(['marker']);
    const stage: InfraTypeDef = { ...type('toilet'), id: 'buehne', builtin: false, keepClear: false };
    const types = typeMap([...DEFAULT_INFRA_TYPES, stage]);
    const wc = createInfra(type('toilet'), { cx: 0, cy: 0, w: 6, d: 2.5, rot: 0 });
    const free = { ...wc, id: 'b1', typeId: 'buehne' };
    const s = stand(0, 0);
    const p = createInfra(type('narrowPassage'), { cx: 0, cy: 0, w: 4, d: 0, rot: 90 });
    const m = infraConflicts([s, stand(50, 50)], [free, wc, rtw, p], types);
    expect(m.get(s.id)).toEqual([wc.id, rtw.id, p.id]);
    expect(m.size).toBe(1);
    expect(infraConflicts([s], [free], types).size).toBe(0);
  });

  it('Abschnitt im gedrehten Rechteck', () => {
    const r = { cx: 0, cy: 0, w: 2, d: 2, rot: 45 };
    expect(segmentLengthInRect(r, { x: -5, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(2 * Math.SQRT2);
    expect(segmentLengthInRect(r, { x: 0, y: 0 }, { x: 0.5, y: 0 })).toBeCloseTo(0.5);
    expect(segmentLengthInRect(r, { x: 3, y: 3 }, { x: 4, y: 4 })).toBe(0);
  });
});

describe('Enge Durchfahrt: Mindestbreite', () => {
  it('warnt unter der Mindestbreite, nicht bei genau der Mindestbreite; nur für die Durchfahrt', () => {
    expect(passageTooNarrow({ typeId: 'narrowPassage', w: 3.49 }, 3.5)).toBe(true);
    expect(passageTooNarrow({ typeId: 'narrowPassage', w: 3.5 }, 3.5)).toBe(false);
    expect(passageTooNarrow({ typeId: 'narrowPassage', w: 3.4999 }, 3.5)).toBe(false); // gerundet 3,50
    expect(passageTooNarrow({ typeId: 'barrierMobile', w: 1 }, 3.5)).toBe(false);
  });
});

describe('Belegen (Freiflächen)', () => {
  it('nur Typen mit „belegt Fläche“; Linien ohne Stärke als schmaler Streifen; Punkte nie', () => {
    const wc = createInfra(type('toilet'), { cx: 0, cy: 0, w: 6, d: 2.5, rot: 0 });
    const sperre = createInfra(type('barrierMobile'), { cx: 0, cy: 0, w: 3, d: 0.3, rot: 0 });
    const p = createInfra(type('narrowPassage'), { cx: 0, cy: 0, w: 4, d: 0, rot: 0 });
    const m = createInfra(type('marker'), { cx: 0, cy: 0, w: 0, d: 0, rot: 0 });
    const r = occupyingRects([wc, sperre, p, m], T);
    expect(r.map((x) => x.id)).toEqual([wc.id, p.id]);
    expect(r[1]!.d).toBe(ZERO_LINE_OCCUPY);
    expect(p.d).toBe(0); // Original unverändert
  });
});

describe('Treffer', () => {
  it('Rechteck, Linie (mit Toleranz um die halbe Stärke), Punkt (Symbol über dem Punkt)', () => {
    const tol = { rect: 0, line: 0.2, point: 0.5 };
    const l = createInfra(type('narrowPassage'), { cx: 0, cy: 0, w: 4, d: 0, rot: 0 });
    expect(hitInfra(l, 'line', { x: 1, y: 0.15 }, tol)).toBe(true);
    expect(hitInfra(l, 'line', { x: 1, y: 0.25 }, tol)).toBe(false);
    expect(hitInfra(l, 'line', { x: 2.1, y: 0 }, tol)).toBe(true);
    const m = createInfra(type('marker'), { cx: 5, cy: 5, w: 0, d: 0, rot: 0 });
    // Symbol steht über dem Punkt (1 m hoch bei halber Größe 0,5 m)
    expect(hitInfra(m, 'point', { x: 5.3, y: 4.2 }, tol)).toBe(true);
    expect(hitInfra(m, 'point', { x: 5.3, y: 5.3 }, tol)).toBe(false);
    expect(hitInfra(m, 'point', { x: 5.6, y: 4.5 }, tol)).toBe(false);
    expect(hitInfra(m, 'point', { x: 5, y: 3.9 }, tol)).toBe(false);
    const wc = createInfra(type('toilet'), { cx: 0, cy: 0, w: 6, d: 2.5, rot: 0 });
    expect(hitInfra(wc, 'rect', { x: 2.9, y: 1.2 }, tol)).toBe(true);
    expect(hitInfra(wc, 'rect', { x: 3.1, y: 0 }, tol)).toBe(false);
  });
});
