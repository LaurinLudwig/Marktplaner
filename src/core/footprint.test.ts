import { describe, expect, it } from 'vitest';
import { dissolveStand, mergeStands, refitStand, standPartsInMeters } from './compound';
import { standFee } from './fee';
import { areaFreeSpaces } from './freeSpace';
import { autoFrontMeters, footprint, footprintGap, frontMeters, labelRect, occupancyStands, pointInFootprint } from './footprint';
import { toLocal } from './geometry/rect';
import { pickObject } from './hit';
import { infraConflicts } from './infra';
import { labelBounds, layoutStandLabels } from './labelLayout';
import { createPage } from './model/defaults';
import type { Area, Category, InfraObject, InfraTypeDef, ShapePart, ShapeTemplate, Stand } from './model/types';
import { createStand } from './objects';
import { normalizeParts, partPolygon } from './shape';
import { categoryFigures, sumFront } from './stats';
import { distanceConflicts, isOutside, pageWarnings } from './warnings';

/**
 * Belegung wie gezeichnet (#16, spec.md §3 „Form“). Beispiel Bleiche B-06 „Hip-Hop Fly“: Hauptkörper 20 × 12 m, links
 * und rechts je ein Ausleger 2,5 × 7 m, mittig in der Tiefe. Hüllrechteck 25 × 12 m; die vier Ecken (je 2,5 × 2,5 m)
 * sind frei. Lage: Mitte (0/0), Vorderseite unten bei y = 6.
 */
const B06_PARTS: ShapePart[] = [
  { kind: 'rect', x: 0.1, y: 0, w: 0.8, h: 1, rot: 0 },
  { kind: 'rect', x: 0, y: 2.5 / 12, w: 0.1, h: 7 / 12, rot: 0 },
  { kind: 'rect', x: 0.9, y: 2.5 / 12, w: 0.1, h: 7 / 12, rot: 0 },
];
const b06 = (over: Partial<Stand> = {}) => createStand({ cx: 0, cy: 0, w: 25, d: 12, rot: 0 }, { name: 'Hip-Hop Fly', nr: 'B-06', parts: B06_PARTS, ...over });
/** Dasselbe Hüllrechteck ohne Teile (bisheriges Verhalten). */
const hull = () => createStand({ cx: 0, cy: 0, w: 25, d: 12, rot: 0 });
const box = (cx: number, cy: number, w: number, d: number, rot = 0) => createStand({ cx, cy, w, d, rot });
const area = (cx: number, cy: number, w: number, d: number, id = 'a'): Area => ({ id, name: '', cx, cy, w, d, rot: 0 });
/** Mitte der freien Ecke oben links (Hüllrechteck x −12,5…−10, y −6…−3,5). */
const CORNER = { x: -11.25, y: -4.75 };

describe('Umriss der Teile', () => {
  it('B-06: drei Rechtecke, gestreckt auf B × T', () => {
    const f = footprint(b06());
    expect(f.parts).toBe(true);
    expect(f.polys).toHaveLength(3);
    const ext = (i: number) => {
      const xs = f.polys[i]!.map((p) => p.x);
      const ys = f.polys[i]!.map((p) => p.y);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e9) / 1e9);
    };
    expect(ext(0)).toEqual([-10, 10, -6, 6]);
    expect(ext(1)).toEqual([-12.5, -10, -3.5, 3.5]);
    expect(ext(2)).toEqual([10, 12.5, -3.5, 3.5]);
    expect([f.bounds.minX, f.bounds.maxX, f.bounds.minY, f.bounds.maxY].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-12.5, 12.5, -6, 6]);
    // ohne Teile: das Rechteck
    expect(footprint(hull()).polys).toHaveLength(1);
    expect(footprint(hull()).parts).toBe(false);
  });

  it('gedrehter Teil: um seine Mitte, relativ zum Stand; der Stand selbst gedreht', () => {
    const part: ShapePart = { kind: 'rect', x: 0.3, y: 0, w: 0.4, h: 1, rot: 90 };
    // Teil 4 × 5 m, um 90° gedreht → 5 m breit, 4 m tief um die Mitte (0/0)
    const s = createStand({ cx: 0, cy: 0, w: 10, d: 5, rot: 0 }, { parts: [part] });
    const poly = partPolygon(s, part);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 9);
    // Stand um 30° gedreht: Teil insgesamt um 120° gedreht; im System des Stands liegt er wie oben
    const r = createStand({ cx: 7, cy: -3, w: 10, d: 5, rot: 30 }, { parts: [part] });
    const loc = partPolygon(r, part).map((p) => toLocal(r, p));
    expect(Math.max(...loc.map((p) => p.x)) - Math.min(...loc.map((p) => p.x))).toBeCloseTo(5, 9);
    expect(Math.max(...loc.map((p) => p.y))).toBeCloseTo(2, 9);
    // um 45° gedreht: Ecke in Richtung der Diagonale
    const q = createStand({ cx: 0, cy: 0, w: 2, d: 2, rot: 0 }, { parts: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1, rot: 45 }] });
    expect(Math.max(...footprint(q).polys[0]!.map((p) => p.x))).toBeCloseTo(Math.SQRT2, 9);
  });

  it('Hüllrechteck umschließt gedrehte Teile (normalizeParts)', () => {
    const n = normalizeParts([{ kind: 'rect', x: 0, y: 0, w: 4, h: 2, rot: 90 }])!;
    expect(n.w).toBeCloseTo(2, 9);
    expect(n.d).toBeCloseTo(4, 9);
    expect([n.x0, n.y0].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, -1]);
    const q = n.parts[0]!;
    expect([q.x, q.y, q.w, q.h, q.rot].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-0.5, 0.25, 2, 0.5, 90]);
    // Ellipse 45° gedreht: Ausdehnung √((a cos)² + (b sin)²)
    const e = normalizeParts([{ kind: 'ellipse', x: 0, y: 0, w: 4, h: 2, rot: 45 }])!;
    expect(e.w).toBeCloseTo(2 * Math.hypot(2 * Math.SQRT1_2, Math.SQRT1_2), 9);
  });

  it('B × T ändern streckt die Teile proportional (auch die Frontmeter)', () => {
    const s = { ...b06(), w: 50, d: 24 };
    const f = footprint(s);
    expect(Math.max(...f.polys[0]!.map((p) => p.x))).toBeCloseTo(20, 9);
    expect(Math.min(...f.polys[1]!.map((p) => p.y))).toBeCloseTo(-7, 9);
    expect(autoFrontMeters(s)).toBe(40);
  });
});

describe('B-06: die vier freien Ecken gelten nicht als belegt', () => {
  it('Treffer nur auf den Teilen', () => {
    const s = b06();
    expect(pointInFootprint(s, CORNER)).toBe(false);
    expect(pointInFootprint(s, { x: -11.25, y: 0 })).toBe(true);
    expect(pointInFootprint(s, { x: 0, y: 5.9 })).toBe(true);
    expect(pointInFootprint(hull(), CORNER)).toBe(true);
    const page = createPage('P');
    page.stands.push(s);
    expect(pickObject(page, CORNER)).toBeNull();
    expect(pickObject(page, { x: 11, y: 1 })).toEqual({ kind: 'stand', id: s.id });
    // Toleranz wirkt bis an die Teile
    expect(pointInFootprint(s, { x: -10.5, y: -3.7 }, 0.25)).toBe(true);
  });

  it('Überlappung: ein Stand in der freien Ecke überlappt nicht, im Ausleger schon', () => {
    const s = b06();
    const inCorner = box(CORNER.x, CORNER.y, 2, 2);
    expect(pageWarnings(null, [s, inCorner]).byStand.get(s.id)!.overlaps).toEqual([]);
    expect(pageWarnings(null, [hull(), inCorner]).byStand.get(inCorner.id)!.overlaps).toHaveLength(1);
    const inWing = box(11.25, 0, 2, 2);
    const w = pageWarnings(null, [s, inWing]);
    expect(w.byStand.get(s.id)!.overlaps).toEqual([inWing.id]);
    expect(w.regions).toHaveLength(1);
    // Ein Stand über Hauptkörper und Ausleger: zwei Überschneidungen, aber nur ein Eintrag je Stand
    const across = box(10, 0, 2, 2);
    const a = pageWarnings(null, [s, across]);
    expect(a.regions).toHaveLength(2);
    expect(a.byStand.get(across.id)!.overlaps).toEqual([s.id]);
  });

  it('„außerhalb“: Grundflächen in Kreuzform um B-06 – mit Teilen innerhalb, als Rechteck außerhalb', () => {
    const areas = [area(0, 0, 20, 12, 'main'), area(0, 0, 25, 7, 'band')];
    expect(isOutside(b06(), areas)).toBe(false);
    expect(isOutside(hull(), areas)).toBe(true);
    // ein Ausleger ragt hinaus
    expect(isOutside(b06(), [area(0, 0, 22, 12)])).toBe(true);
    expect(isOutside(b06(), null)).toBe(false);
  });

  it('Freiflächen: flache Grundfläche vor B-06 – die zurückgesetzten Ausleger belegen nichts', () => {
    // Grundfläche 40 × 2 m, Vorderseite bündig mit der Vorderseite von B-06 (y = 6)
    const a = area(0, 5, 40, 2);
    const r = areaFreeSpaces(a, [b06()], [], 0.5);
    expect(r.occupied.map((o) => [o.a, o.b])).toEqual([[10, 30]]);
    expect(r.free.map((f) => [f.start, f.end])).toEqual([
      [0, 10],
      [30, 40],
    ]);
    // als Rechteck: 25 m belegt
    expect(areaFreeSpaces(a, [hull()], [], 0.5).occupied.map((o) => [o.a, o.b])).toEqual([[7.5, 32.5]]);
    // tiefe Grundfläche: die Ausleger liegen darin und belegen ihre Projektion (§4: hinter einem Stand nie frei)
    expect(areaFreeSpaces(area(0, 0, 40, 12), [b06()], [], 0.5).occupied.map((o) => [o.a, o.b])).toEqual([[7.5, 32.5]]);
  });

  it('Infrastruktur „freihalten“ in der freien Ecke stört nicht, im Ausleger schon; Linie ohne Stärke ebenso', () => {
    const t: InfraTypeDef = { id: 'k', builtin: false, label: 'Frei', geometry: 'rect', color: '#000', icon: 'block', defaultW: 1, defaultD: 1, occupiesArea: false, keepClear: true };
    const l: InfraTypeDef = { ...t, id: 'l', geometry: 'line' };
    const types = new Map([
      [t.id, t],
      [l.id, l],
    ]);
    const obj = (cx: number, cy: number, typeId = 'k', w = 1.5, d = 1.5): InfraObject => ({ id: `o${cx}${cy}${typeId}`, typeId, label: '', note: '', powerKw: 0, connection: null, suppressWidthWarning: false, cx, cy, w, d, rot: 0 });
    const s = b06();
    expect(infraConflicts([s], [obj(CORNER.x, CORNER.y)], types).size).toBe(0);
    expect(infraConflicts([hull()], [obj(CORNER.x, CORNER.y)], types).size).toBe(1);
    expect(infraConflicts([s], [obj(-11.25, 0)], types).get(s.id)).toHaveLength(1);
    // waagerechte Linie durch die freien Ecken oben (y = −5), ohne Stärke: nur der Hauptkörper zählt
    expect(infraConflicts([s], [obj(-11.25, -5, 'l', 2, 0)], types).size).toBe(0);
    expect(infraConflicts([s], [obj(-10, -5, 'l', 4, 0)], types).get(s.id)).toHaveLength(1);
  });

  it('Abstand (Konkurrenzschutz): gemessen zu den Teilen, nicht zum Hüllrechteck', () => {
    const cat: Category = { id: 'c', name: 'Imbiss', color: '#000', minDistance: 1, price: null };
    // 1 × 1 m in der freien Ecke oben rechts (x 10,75…11,75, y −5,75…−4,75)
    const near = createStand({ cx: 11.25, cy: -5.25, w: 1, d: 1, rot: 0 }, { categoryId: 'c' });
    const s = b06({ categoryId: 'c' });
    expect(footprintGap(s, near).dist).toBeCloseTo(0.75, 9);
    expect(distanceConflicts([s, near], [cat]).get(s.id)).toMatchObject([{ id: near.id, dist: 0.75 }]);
    expect(distanceConflicts([hull(), near].map((x) => ({ ...x, categoryId: 'c' })), [cat]).values().next().value![0]!.dist).toBe(0);
    expect(distanceConflicts([s, near], [{ ...cat, minDistance: 0.7 }]).size).toBe(0);
  });

  it('Beschriftung im größten Teil; die freien Ecken sind kein Hindernis', () => {
    const s = b06();
    expect(labelRect(s)).toMatchObject({ cx: 0, cy: 0, w: 20, d: 12 });
    const placed = layoutStandLabels({ stands: [s], areas: [], infra: [], fontSize: 1, linesOf: () => ['B-06'] }).get(s.id)!;
    expect(placed.mode).toBe('inside');
    // Ellipse als größter Teil: eingeschriebenes Rechteck
    const e = createStand({ cx: 0, cy: 0, w: 10, d: 10, rot: 0 }, { parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 1, rot: 0 }] });
    expect(labelRect(e).w).toBeCloseTo(10 / Math.SQRT2, 9);
    // Ein Nachbar mit langer Beschriftung darf seinen Text in die freie Ecke legen
    const small = createStand({ cx: -14, cy: -4.75, w: 1, d: 1, rot: 0 });
    const out = layoutStandLabels({ stands: [s, small], areas: [], infra: [], fontSize: 0.5, linesOf: (x) => (x.id === small.id ? ['Wurst'] : []) }).get(small.id)!;
    expect(out.mode).not.toBe('inside');
    const b = labelBounds(out);
    expect(b.maxX).toBeGreaterThan(b.minX);
  });
});

describe('Frontmeter (Standgeld)', () => {
  it('automatisch: belegte Länge an der Vorderseite; B-06 = 20 m, als Rechteck 25 m', () => {
    expect(autoFrontMeters(b06())).toBe(20);
    expect(frontMeters(b06())).toBe(20);
    expect(frontMeters(hull())).toBe(25);
    expect(frontMeters({ w: 4.3 })).toBe(4.3);
  });

  it('Teile, die die Vorderseite berühren: Vereinigung der Projektionen, Lücken bis 0,01 m zusammengefasst', () => {
    const s = (parts: ShapePart[]) => createStand({ cx: 0, cy: 0, w: 10, d: 4, rot: 0 }, { parts });
    // zwei Teile vorn mit 2 m Lücke: 3 + 3 m; ein Teil hinten zählt nicht
    expect(
      autoFrontMeters(
        s([
          { kind: 'rect', x: 0, y: 0.5, w: 0.3, h: 0.5, rot: 0 },
          { kind: 'rect', x: 0.5, y: 0.5, w: 0.3, h: 0.5, rot: 0 },
          { kind: 'rect', x: 0, y: 0, w: 1, h: 0.4, rot: 0 },
        ]),
      ),
    ).toBe(6);
    // überlappende und bis 0,01 m auseinanderliegende Teile zählen einmal
    expect(
      autoFrontMeters(
        s([
          { kind: 'rect', x: 0, y: 0.5, w: 0.5, h: 0.5, rot: 0 },
          { kind: 'rect', x: 0.4, y: 0.5, w: 0.3, h: 0.5, rot: 0 },
          { kind: 'rect', x: 0.701, y: 0.5, w: 0.299, h: 0.5, rot: 0 },
        ]),
      ),
    ).toBe(10);
    // 0,01 m über der Vorderseite berührt noch, 0,02 m nicht mehr
    expect(autoFrontMeters(s([{ kind: 'rect', x: 0, y: 0, w: 0.5, h: 0.9975, rot: 0 }, { kind: 'rect', x: 0.5, y: 0, w: 0.5, h: 0.5, rot: 0 }]))).toBe(5);
    expect(autoFrontMeters(s([{ kind: 'rect', x: 0, y: 0, w: 0.5, h: 0.995, rot: 0 }, { kind: 'rect', x: 0.5, y: 0.5, w: 0.5, h: 0.5, rot: 0 }]))).toBe(5);
    // gedrehter Teil, der mit einer Ecke die Vorderseite berührt: seine volle Projektion (wie §4)
    const diamond = createStand({ cx: 0, cy: 0, w: 2 * Math.SQRT2, d: 2 * Math.SQRT2, rot: 0 }, { parts: [{ kind: 'rect', x: (1 - 1 / Math.SQRT2) / 2, y: (1 - 1 / Math.SQRT2) / 2, w: 1 / Math.SQRT2, h: 1 / Math.SQRT2, rot: 45 }] });
    expect(autoFrontMeters(diamond)).toBeCloseTo(2.83, 9);
  });

  it('Überschreiben: Feld „Frontmeter“ gilt bei Belegung wie gezeichnet; Standgeld und Kennzahlen rechnen damit', () => {
    const pricing = { perMeter: 10, roundUpMeters: false, vatRate: 19 };
    expect(standFee(b06(), undefined, pricing)).toMatchObject({ net: 200, meters: 20 });
    expect(standFee(b06({ frontOverride: 24 }), undefined, pricing)).toMatchObject({ net: 240, meters: 24 });
    expect(standFee(hull(), undefined, pricing)).toMatchObject({ net: 250, meters: 25 });
    // ohne Belegung wie gezeichnet wirkt ein gespeicherter Wert nicht
    expect(frontMeters({ ...hull(), frontOverride: 3 })).toBe(25);
    expect(sumFront([b06(), b06({ frontOverride: 24 }), box(0, 0, 4.3, 3)])).toBe(48.3);
    expect(categoryFigures([b06()], new Set())['']!.frontM).toBe(20);
  });
});

describe('Formvorlage mit „belegt wie gezeichnet“', () => {
  const tpl = (occupies: boolean): ShapeTemplate => ({ id: 't', name: 'B-06', w: 25, d: 12, parts: B06_PARTS, occupies });

  it('setzt die Teile der Vorlage ein; ohne Schalter bleibt alles beim Hüllrechteck (gleiche Liste)', () => {
    const s = createStand({ cx: 0, cy: 0, w: 25, d: 12, rot: 0 }, { shapeTemplateId: 't' });
    const list = [s, box(30, 0, 3, 3)];
    expect(occupancyStands(list, [tpl(false)])).toBe(list);
    const templates = [tpl(true)];
    const out = occupancyStands(list, templates);
    expect(out[0]!.parts).toBe(B06_PARTS);
    expect(out[1]).toBe(list[1]);
    // gleiche Eingaben → gleiche Liste und gleiche Objekte (Zwischenspeicher)
    expect(occupancyStands(list, templates)).toBe(out);
    expect(occupancyStands([...list], templates)[0]).toBe(out[0]);
    expect(pointInFootprint(out[0]!, CORNER)).toBe(false);
    expect(frontMeters(out[0]!)).toBe(20);
    // eigene Form hat Vorrang vor der Vorlage
    const own = { ...s, parts: [{ kind: 'rect' as const, x: 0, y: 0, w: 1, h: 1, rot: 0 }] };
    expect(occupancyStands([own], templates)[0]).toBe(own);
  });
});

describe('Eigene Form bearbeiten, zusammenfassen, auflösen', () => {
  it('refitStand: Teil verschieben – B × T passt sich an, die übrigen Teile bleiben auf dem Plan', () => {
    const s = b06();
    const meters = standPartsInMeters(s);
    expect(meters[1]).toMatchObject({ x: 0, y: 2.5, w: 2.5, h: 7 });
    // rechten Ausleger 2 m weiter nach rechts
    meters[2] = { ...meters[2]!, x: meters[2]!.x + 2 };
    const fit = refitStand(s, meters)!;
    expect(fit.rect).toMatchObject({ cx: 1, cy: 0, w: 27, d: 12, rot: 0 });
    const moved = { ...s, ...fit.rect, parts: fit.parts };
    expect(footprint(moved).polys[0]!.map((p) => Math.round(p.x * 100) / 100)).toEqual(footprint(s).polys[0]!.map((p) => Math.round(p.x * 100) / 100));
    expect(Math.max(...footprint(moved).polys[2]!.map((p) => p.x))).toBeCloseTo(14.5, 9);
    expect(refitStand(s, [])).toBeNull();
  });

  it('Zusammenfassen: B-06 und zwei Ausleger → ein Stand 25 × 12 m, Daten vom größten', () => {
    const main = createStand({ cx: 0, cy: 0, w: 20, d: 12, rot: 0 }, { nr: 'B-06', name: 'Hip-Hop Fly', powerKw: 63 });
    const left = createStand({ cx: -11.25, cy: 0, w: 2.5, d: 7, rot: 0 });
    // rechter Ausleger als um 90° gedrehter Stand (7 breit, 2,5 tief)
    const right = createStand({ cx: 11.25, cy: 0, w: 7, d: 2.5, rot: 90 }, { name: 'Ausleger' });
    const m = mergeStands([left, main, right], new Map())!;
    expect(m.removed.toSorted()).toEqual([left.id, right.id].toSorted());
    expect(m.stand).toMatchObject({ id: main.id, nr: 'B-06', name: 'Hip-Hop Fly', powerKw: 63, cx: 0, cy: 0, w: 25, d: 12, rot: 0, shapeTemplateId: null });
    expect(m.stand.parts).toHaveLength(3);
    expect(m.stand.parts![2]!.rot).toBe(90);
    expect(autoFrontMeters(m.stand)).toBe(20);
    expect(pointInFootprint(m.stand, CORNER)).toBe(false);
    // gleiche Fläche: der zuerst ausgewählte gewinnt
    const a = box(0, 0, 2, 2);
    const b = box(5, 0, 2, 2);
    expect(mergeStands([b, a], new Map())!.stand.id).toBe(b.id);
    expect(mergeStands([a], new Map())).toBeNull();
  });

  it('Zusammenfassen nimmt Vorlage und Kreis/Oval mit', () => {
    const t: ShapeTemplate = { id: 't', name: 'L', w: 4, d: 4, occupies: false, parts: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 0.5, rot: 0 }, { kind: 'rect', x: 0, y: 0.5, w: 0.5, h: 0.5, rot: 0 }] };
    const withTpl = createStand({ cx: 0, cy: 0, w: 4, d: 4, rot: 0 }, { shapeTemplateId: 't' });
    const oval = createStand({ cx: 4, cy: 0, w: 2, d: 2, rot: 0 }, { shape: 'ellipse' });
    const m = mergeStands([withTpl, oval], new Map([[t.id, t]]))!;
    expect(m.stand.parts!.map((p) => p.kind)).toEqual(['rect', 'rect', 'ellipse']);
    expect(m.stand).toMatchObject({ w: 7, d: 4 });
  });

  it('Auflösen: jeder Teil ein Stand; der größte behält ID und Daten', () => {
    const s = b06({ categoryId: 'c', frontOverride: 24 });
    const pieces = dissolveStand(s);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toMatchObject({ id: s.id, nr: 'B-06', cx: 0, cy: 0, w: 20, d: 12, parts: null, frontOverride: null });
    expect(pieces[1]).toMatchObject({ cx: -11.25, cy: 0, w: 2.5, d: 7, nr: '', categoryId: 'c', parts: null });
    expect(pieces[1]!.id).not.toBe(s.id);
    // Zusammenfassen und wieder auflösen ergibt dieselben Rechtecke
    const again = mergeStands(pieces, new Map())!.stand;
    expect(again).toMatchObject({ cx: 0, cy: 0, w: 25, d: 12 });
  });
});
