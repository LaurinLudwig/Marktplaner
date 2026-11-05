import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPage, DEFAULT_SETTINGS } from './model/defaults';
import type { Area, FestplatzPage, NumberingScope, Rect, Stand } from './model/types';
import {
  cachedDuplicates,
  defaultClockwiseCenter,
  defaultDirection,
  defaultRenumberMode,
  directionAxes,
  findDuplicates,
  FIXED_AXES,
  formatNr,
  nrKey,
  nrLockTargets,
  nrNumber,
  numberingIssue,
  orderAlong,
  orderClockwise,
  orderLeftToRight,
  orderStands,
  planRenumber,
  renumberIssue,
  sameNr,
} from './numbering';
import { createStand } from './objects';

/**
 * M5: Standnummern (spec.md §5). Standardszene wie in M4: Grundfläche 50 × 10 m, Vorderseite bei y = 0
 * von x = 0 bis 50, Inneres bei y < 0.
 */

const area = (id: string, r: Partial<Rect> = {}): Area => ({ id, name: id, cx: 25, cy: -5, w: 50, d: 10, rot: 0, ...r });
/** Stand 2 × 2 m mit Mitte (x, y). */
const st = (id: string, x: number, y = -1.5, extra: Partial<Stand> = {}): Stand => ({ ...createStand({ cx: x, cy: y, w: 2, d: 2, rot: 0 }), id, ...extra });
const ids = (stands: readonly Stand[]) => stands.map((s) => s.id);

const page = (id: string, fields: Partial<FestplatzPage> = {}): FestplatzPage => ({ ...createPage(id), id, ...fields });
const project = (pages: FestplatzPage[], numbering: Partial<{ scope: NumberingScope; start: number; digits: number }> = {}) => ({
  pages,
  settings: { ...DEFAULT_SETTINGS, numbering: { ...DEFAULT_SETTINGS.numbering, ...numbering } },
});

describe('M5 Format und Vergleich', () => {
  it('Präfix, Zahl und führende Nullen', () => {
    expect(formatNr('A-', 1, 2)).toBe('A-01');
    expect(formatNr('', 7, 1)).toBe('7');
    expect(formatNr('', 123, 2)).toBe('123');
    expect(formatNr('B', 5, 4)).toBe('B0005');
  });

  it('„12“ = „012“, Groß/Klein und Leerzeichen am Rand egal, leere Nummern nie gleich', () => {
    expect(sameNr('12', '012')).toBe(true);
    expect(sameNr(' a-07 ', 'A-7')).toBe(true);
    expect(sameNr('A-10', 'A-1')).toBe(false);
    // das Präfix gehört zur Nummer
    expect(sameNr('A-12', 'A-012')).toBe(true);
    expect(sameNr('A-12', 'B-12')).toBe(false);
    expect(sameNr('0', '00')).toBe(true);
    expect(sameNr('', '')).toBe(false);
    expect(nrKey('  ')).toBe('');
  });
});

describe('M5 Reihenfolge links → rechts (über den ganzen Festplatz)', () => {
  it('nach der x-Lage der Standmitte, unabhängig von den Grundflächen und ihrer Reihenfolge', () => {
    // A oben, B darunter; die Stände beider Flächen werden gemeinsam von links nach rechts durchlaufen
    const stands = [st('a2', 30), st('b1', 5, -31.5), st('a1', 10), st('b2', 20, -31.5)];
    expect(ids(orderLeftToRight(stands))).toEqual(['b1', 'a1', 'b2', 'a2']);
    const p = (areas: Area[]) => page('p', { areas, stands });
    const A = area('A');
    const B = area('B', { cx: 25, cy: -35 });
    expect(ids(orderStands(p([A, B])))).toEqual(ids(orderStands(p([B, A]))));
  });

  it('Stände außerhalb von Grundflächen zählen genauso; gedrehte Grundflächen ändern nichts', () => {
    const G = area('G', { rot: 180 });
    expect(ids(orderStands(page('p', { areas: [G], stands: [st('in2', 40, -8), st('draussen', 25, 20), st('in1', 10, -8)] })))).toEqual(['in1', 'draussen', 'in2']);
  });

  it('ohne Toleranz: auf 0,01 m gerundet; kleineres x zuerst, bei exakt gleichem x der obere, dann nach ID', () => {
    // 0,01 m weiter rechts ist nicht „gleich“: links zuerst, auch wenn der andere weiter oben steht
    expect(ids(orderLeftToRight([st('r', 20, 0), st('lu', 0, 10), st('lo', 0.01, -10)]))).toEqual(['lu', 'lo', 'r']);
    // exakt gleiches x (nach Rundung auf 0,01 m): der obere zuerst
    expect(ids(orderLeftToRight([st('lu', 0, 10), st('lo', 0.004, -10)]))).toEqual(['lo', 'lu']);
    // exakt gleiche Position: nach ID
    expect(ids(orderLeftToRight([st('b', 3, 3), st('a', 3, 3)]))).toEqual(['a', 'b']);
  });

  it('1-cm-Treppe aus QA-M5-01: jede Anlegereihenfolge ergibt unten, mitte, oben (links zuerst)', () => {
    const stair = [st('unten', 0, 10), st('mitte', 0.01, 5), st('oben', 0.02, 0)];
    for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      expect(ids(orderLeftToRight(perm.map((i) => stair[i]!)))).toEqual(['unten', 'mitte', 'oben']);
    }
  });
});

describe('M5 Reihenfolge im Uhrzeigersinn', () => {
  const N = st('N', 0, -10);
  const E = st('E', 10, 0);
  const S = st('S', 0, 10);
  const W = st('W', -10, 0);
  const all = [W, S, E, N];
  const cw = (startAngle = 0) => ({ center: { x: 0, y: 0 }, startAngle });

  it('ab Norden (oben) im Uhrzeigersinn', () => {
    expect(ids(orderClockwise(all, cw(), 0))).toEqual(['N', 'E', 'S', 'W']);
  });

  it('Startrichtung relativ zum Norden der Page', () => {
    expect(ids(orderClockwise(all, cw(180), 0))).toEqual(['S', 'W', 'N', 'E']);
    // Norden zeigt nach rechts: Start rechts
    expect(ids(orderClockwise(all, cw(), 90))).toEqual(['E', 'S', 'W', 'N']);
    expect(ids(orderClockwise(all, cw(90), 90))).toEqual(['S', 'W', 'N', 'E']);
  });

  it('gleicher Winkel (auf 0,1° gerundet): näher am Mittelpunkt zuerst; knapp vor dem Startstrahl zählt als Start', () => {
    const near = st('near', 0, -5);
    const tiny = st('tiny', -0.001, -20);
    expect(ids(orderClockwise([N, E, near, tiny], cw(), 0))).toEqual(['near', 'N', 'tiny', 'E']);
  });

  it('ohne gesetzten Mittelpunkt: Mitte aller Grundflächen und Stände', () => {
    const p = page('p', { numberingMode: 'clockwise', stands: all });
    expect(defaultClockwiseCenter(p)).toEqual({ x: 0, y: 0 });
    expect(ids(orderStands(p))).toEqual(['N', 'E', 'S', 'W']);
    expect(defaultClockwiseCenter(page('leer'))).toBeNull();
  });

  it('Modus „manuell“ liefert keine Reihenfolge', () => {
    expect(orderStands(page('p', { numberingMode: 'manual', stands: all }))).toEqual([]);
  });
});

describe('M5 Reihenfolge: unabhängig von der Anlegereihenfolge (Eigenschaften, QA-M5-01)', () => {
  /** Stände auf einem engen Raster (1 cm), damit gleiche und fast gleiche Lagen häufig vorkommen. */
  const standsArb = fc
    .uniqueArray(fc.record({ x: fc.integer({ min: -30, max: 30 }), y: fc.integer({ min: -30, max: 30 }) }), { minLength: 1, maxLength: 25, selector: (p) => `${p.x}|${p.y}` })
    .map((pts) => pts.map((p, i) => st(`s${i}`, p.x / 100, p.y / 100)));
  /** 1-cm-Treppen: Spalten aus Ständen, die je 0,01 m nach rechts und nach oben versetzt sind. */
  const stairArb = fc.integer({ min: 2, max: 12 }).map((n) => Array.from({ length: n }, (_, i) => st(`t${i}`, i * 0.01, 10 - i * 0.5)));
  const permuted = <T,>(arb: fc.Arbitrary<T[]>) => arb.chain((list) => fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }).map((perm) => [list, perm] as const));

  it('links → rechts: jede Permutation ergibt dieselbe Reihenfolge', () => {
    fc.assert(
      fc.property(permuted(fc.oneof(standsArb, stairArb)), ([list, perm]) => {
        expect(ids(orderLeftToRight(perm))).toEqual(ids(orderLeftToRight(list)));
      }),
      { numRuns: 500 },
    );
  });

  it('Uhrzeigersinn: jede Permutation ergibt dieselbe Reihenfolge (auch dicht am Startstrahl und auf einem Strahl)', () => {
    // Stände auf einem Strahl mit je 0,06° Versatz (Beispiel aus QA-M5-01) und dicht um den Mittelpunkt
    const rayArb = fc.integer({ min: 2, max: 8 }).map((n) =>
      Array.from({ length: n }, (_, i) => {
        const a = (i * 0.06 * Math.PI) / 180;
        return st(`r${i}`, Math.sin(a) * 20, -Math.cos(a) * 20);
      }),
    );
    fc.assert(
      fc.property(permuted(fc.oneof(standsArb, rayArb)), fc.integer({ min: 0, max: 359 }), fc.integer({ min: 0, max: 359 }), ([list, perm], startAngle, north) => {
        const cw = { center: { x: 0, y: 0 }, startAngle };
        expect(ids(orderClockwise(perm, cw, north))).toEqual(ids(orderClockwise(list, cw, north)));
      }),
      { numRuns: 500 },
    );
  });
});

describe('#12 Weitere Richtungen (feste Richtungen an den Achsen der Zeichenfläche)', () => {
  // Gitter 3 × 2: Spalten x = 0, 10, 20; Zeilen y = 0 (oben) und 10 (unten)
  const grid = [st('lo', 0, 0), st('mo', 10, 0), st('ro', 20, 0), st('lu', 0, 10), st('mu', 10, 10), st('ru', 20, 10)];
  const mode = (numberingMode: FestplatzPage['numberingMode'], stands = grid) => ids(orderStands(page('p', { numberingMode, stands })));

  it('links → rechts: kleineres x zuerst, bei gleichem x kleineres y (wie bisher)', () => {
    expect(mode('frontLtr')).toEqual(['lo', 'lu', 'mo', 'mu', 'ro', 'ru']);
    expect(ids(orderAlong(grid, FIXED_AXES.frontLtr))).toEqual(ids(orderLeftToRight(grid)));
  });

  it('rechts → links: größeres x zuerst, bei gleichem x kleineres y', () => {
    expect(mode('rightToLeft')).toEqual(['ro', 'ru', 'mo', 'mu', 'lo', 'lu']);
  });

  it('oben → unten: kleineres y zuerst, bei gleichem y kleineres x', () => {
    expect(mode('topToBottom')).toEqual(['lo', 'mo', 'ro', 'lu', 'mu', 'ru']);
  });

  it('unten → oben: größeres y zuerst, bei gleichem y kleineres x', () => {
    expect(mode('bottomToTop')).toEqual(['lu', 'mu', 'ru', 'lo', 'mo', 'ro']);
  });

  it('Gleichstand auf der Hauptachse ohne Toleranz: 0,01 m Unterschied zählt, unter 0,005 m ist gleich, danach nach ID', () => {
    // rechts → links: 0,01 m weiter rechts kommt zuerst, auch wenn er weiter unten steht
    expect(mode('rightToLeft', [st('a', 5, -10), st('b', 5.01, 10)])).toEqual(['b', 'a']);
    // gleiches x nach Rundung: der obere zuerst
    expect(mode('rightToLeft', [st('u', 5, 10), st('o', 5.004, -10)])).toEqual(['o', 'u']);
    // oben → unten / unten → oben: gleiches y nach Rundung → der linke zuerst
    expect(mode('topToBottom', [st('r', 10, 2), st('l', -10, 2.003)])).toEqual(['l', 'r']);
    expect(mode('bottomToTop', [st('r', 10, 2), st('l', -10, 2.003)])).toEqual(['l', 'r']);
    expect(mode('topToBottom', [st('o', 10, 1.99), st('u', -10, 2)])).toEqual(['o', 'u']);
    expect(mode('bottomToTop', [st('o', 10, 1.99), st('u', -10, 2)])).toEqual(['u', 'o']);
    // gleiche Position: nach ID
    expect(mode('bottomToTop', [st('b', 3, 3), st('a', 3, 3)])).toEqual(['a', 'b']);
  });

  it('unabhängig von den Grundflächen: Stände außerhalb zählen genauso', () => {
    expect(ids(orderStands(page('p', { numberingMode: 'topToBottom', areas: [area('G')], stands: [st('drin', 10, -5), st('draussen', 60, 20), st('oben', -40, -30)] })))).toEqual(['oben', 'drin', 'draussen']);
  });
});

describe('#12 Gegen den Uhrzeigersinn', () => {
  const N = st('N', 0, -10);
  const E = st('E', 10, 0);
  const S = st('S', 0, 10);
  const W = st('W', -10, 0);
  const all = [E, S, W, N];
  const cw = (startAngle = 0) => ({ center: { x: 0, y: 0 }, startAngle });

  it('ab Norden mit absteigendem Winkel: N, W, S, E', () => {
    expect(ids(orderClockwise(all, cw(), 0, -1))).toEqual(['N', 'W', 'S', 'E']);
    expect(ids(orderStands(page('p', { numberingMode: 'counterClockwise', clockwise: cw(), stands: all })))).toEqual(['N', 'W', 'S', 'E']);
  });

  it('Startrichtung relativ zum Norden der Page, wie im Uhrzeigersinn', () => {
    expect(ids(orderClockwise(all, cw(90), 0, -1))).toEqual(['E', 'N', 'W', 'S']);
    // Norden zeigt nach rechts, Start 90° → Süden zuerst, dann gegen den Uhrzeigersinn
    expect(ids(orderClockwise(all, cw(90), 90, -1))).toEqual(['S', 'E', 'N', 'W']);
  });

  it('gleicher Winkel: näher am Mittelpunkt zuerst; knapp rechts vom Startstrahl kommt zuletzt', () => {
    const near = st('near', 0, -5);
    // 0,001 m links von Norden: gerundet auf 0,01 m genau auf dem Startstrahl
    const tiny = st('tiny', -0.001, -20);
    // 1 m rechts von Norden auf 20 m: knapp 3° im Uhrzeigersinn → gegen den Uhrzeigersinn ganz am Ende
    const right = st('right', 1, -20);
    expect(ids(orderClockwise([N, E, near, tiny, right], cw(), 0, -1))).toEqual(['near', 'N', 'tiny', 'E', 'right']);
  });

  it('ohne gesetzten Mittelpunkt: Mitte aller Grundflächen und Stände', () => {
    expect(ids(orderStands(page('p', { numberingMode: 'counterClockwise', stands: all })))).toEqual(['N', 'W', 'S', 'E']);
  });

  it('jede Anlegereihenfolge ergibt dieselbe Reihenfolge', () => {
    const list = [N, E, S, W, st('a', 3, -3), st('b', 3.01, -3), st('c', -0.01, -7), st('d', 0, -14), st('m', 0, 0)];
    const expected = ids(orderClockwise(list, cw(), 0, -1));
    for (let k = 0; k < list.length; k++) {
      const rotated = [...list.slice(k), ...list.slice(0, k)];
      expect(ids(orderClockwise(rotated, cw(), 0, -1))).toEqual(expected);
      expect(ids(orderClockwise(rotated.toReversed(), cw(), 0, -1))).toEqual(expected);
    }
  });
});

describe('#12 Eigene Richtung über zwei Punkte', () => {
  const dirPage = (direction: FestplatzPage['direction'], stands: Stand[]) => page('p', { numberingMode: 'direction', ...(direction ? { direction } : {}), stands });

  it('waagrecht A → B entspricht links → rechts; andere Richtungen: bei Gleichstand der Stand links vom Pfeil zuerst', () => {
    const grid = [st('lo', 0, 0), st('ro', 20, 0), st('lu', 0, 10), st('ru', 20, 10)];
    const ltr = { from: { x: -5, y: 5 }, to: { x: 30, y: 5 } };
    expect(ids(orderStands(dirPage(ltr, grid)))).toEqual(ids(orderLeftToRight(grid)));
    // nach links: links vom Pfeil liegt unten auf dem Bildschirm
    expect(ids(orderStands(dirPage({ from: ltr.to, to: ltr.from }, grid)))).toEqual(['ru', 'ro', 'lu', 'lo']);
    // nach unten: links vom Pfeil liegt rechts auf dem Bildschirm
    expect(ids(orderStands(dirPage({ from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }, grid)))).toEqual(['ro', 'lo', 'ru', 'lu']);
  });

  it('nur die Richtung zählt: Stände vor A und hinter B zählen genauso, die Lage von A und B verschiebt nichts', () => {
    const stands = [st('hinter', 80, 0), st('vor', -50, 0), st('mitte', 5, 0)];
    expect(ids(orderStands(dirPage({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, stands)))).toEqual(['vor', 'mitte', 'hinter']);
    expect(ids(orderStands(dirPage({ from: { x: 300, y: 77 }, to: { x: 301, y: 77 } }, stands)))).toEqual(['vor', 'mitte', 'hinter']);
  });

  it('schräg (30°): nach der Projektion auf A → B; Gleichstand links vor rechts, dann nach ID', () => {
    // Richtung 30° unter der x-Achse nach rechts unten (Bildschirm, y nach unten), 20 m lang
    const u = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
    const dir = { from: { x: 0, y: 0 }, to: { x: Math.round(u.x * 2000) / 100, y: Math.round(u.y * 2000) / 100 } };
    expect(directionAxes(dir)).toEqual({ main: { x: 1732, y: 1000 }, cross: { x: -1000, y: 1732 } });
    const n = { x: -u.y, y: u.x }; // rechts vom Pfeil
    const at = (id: string, along: number, side = 0) => st(id, Math.round((u.x * along + n.x * side) * 100) / 100, Math.round((u.y * along + n.y * side) * 100) / 100);
    // „b“ liegt 4 m rechts, „d“ 6 m links der Linie; maßgeblich ist nur die Lage entlang der Richtung
    const stands = [at('c', 30), at('a', -5), at('b', 12, 4), at('d', 45, -6)];
    expect(ids(orderStands(dirPage(dir, stands)))).toEqual(['a', 'b', 'c', 'd']);
    // gleiche Lage entlang der Richtung (Senkrechte durch einen Punkt; Richtung 4 : 3, Senkrechte 3 : 4 ganzzahlig)
    const d43 = { from: { x: 0, y: 0 }, to: { x: 4, y: 3 } };
    const tie = [st('rechts', 7, 14), st('mitte2', 10, 10), st('links', 13, 6), st('mitte', 10, 10)];
    expect(ids(orderStands(dirPage(d43, tie)))).toEqual(['links', 'mitte', 'mitte2', 'rechts']);
  });

  it('ganzzahlig in Zentimetern: Standmitten und Punkte auf 0,01 m gerundet, unabhängig von der Anlegereihenfolge', () => {
    // A wird auf (0, 0) gerundet: Richtung (1000 cm, 1 cm), also 1 cm Steigung auf 10 m
    const dir = { from: { x: 0.004, y: 0 }, to: { x: 10, y: 0.01 } };
    expect(directionAxes(dir)).toEqual({ main: { x: 1000, y: 1 }, cross: { x: -1, y: 1000 } });
    // Stände auf x = 0 übereinander: der untere liegt entlang der Richtung weiter vorn
    const stands = [st('unten', 0, 0.02), st('oben', 0.001, 0), st('mitte', 0, 0.01)];
    const order = ids(orderStands(dirPage(dir, stands)));
    expect(order).toEqual(['oben', 'mitte', 'unten']);
    for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      expect(ids(orderStands(dirPage(dir, perm.map((i) => stands[i]!))))).toEqual(order);
    }
  });

  it('A = B (nach Rundung auf 0,01 m) ist ungültig: Hinweis, keine Reihenfolge, Neu nummerieren gesperrt', () => {
    const dir = { from: { x: 5, y: 5 }, to: { x: 5.004, y: 4.996 } };
    expect(directionAxes(dir)).toBeNull();
    const p = dirPage(dir, [st('a', 0, 0), st('b', 10, 0)]);
    expect(orderStands(p)).toEqual([]);
    expect(numberingIssue(p)).toMatch(/Start- und Zielpunkt/);
    expect(renumberIssue(project([p]), 'p')).toEqual({ pageId: 'p', pageName: 'p', message: numberingIssue(p) });
    // global auch von einer anderen Page aus gesperrt; pro Festplatz nur auf der Page selbst; „manuell“ zählt nicht
    const ok = page('q', { stands: [st('c', 0, 0)] });
    expect(renumberIssue(project([ok, p], { scope: 'global' }), 'q')?.pageId).toBe('p');
    expect(renumberIssue(project([ok, p]), 'q')).toBeNull();
    expect(renumberIssue(project([ok, { ...p, numberingMode: 'manual' }], { scope: 'global' }), 'q')).toBeNull();
    expect(numberingIssue({ ...p, direction: { from: { x: 5, y: 5 }, to: { x: 5.01, y: 5 } } })).toBeNull();
  });

  it('Vorgabe beim ersten Umschalten: waagrecht durch die Mitte aller Stände, nummeriert wie links → rechts', () => {
    const stands = [st('a', 10, 4), st('b', -6, -8), st('c', 30, 20)];
    // Hülle der Stände (2 × 2 m): x −7 … 31, y −9 … 21 → y = 6
    expect(defaultDirection(page('p', { stands }))).toEqual({ from: { x: -7, y: 6 }, to: { x: 31, y: 6 } });
    expect(ids(orderStands(dirPage(undefined, stands)))).toEqual(ids(orderLeftToRight(stands)));
    // ohne Stände über die Grundflächen, ohne beides keine Vorgabe
    expect(defaultDirection(page('p', { areas: [area('G')] }))).toEqual({ from: { x: 0, y: -5 }, to: { x: 50, y: -5 } });
    expect(defaultDirection(page('leer'))).toBeNull();
  });

  it('Neu nummerieren in eigener Richtung; fixierte Nummern werden übersprungen', () => {
    const stands = [st('s1', 0, 0), st('s2', 0, 10, { nr: '1', nrLocked: true }), st('s3', 0, 20)];
    const p = dirPage({ from: { x: 0, y: 30 }, to: { x: 0, y: -30 } }, stands);
    const plan = planRenumber(project([p]), 'p');
    expect(plan.changes.map((c) => [c.standId, c.next])).toEqual([
      ['s3', '2'],
      ['s1', '3'],
    ]);
    expect(plan.fixed).toBe(1);
  });
});

describe('#12 Grenzfälle', () => {
  it('große Koordinaten (100 km) und lange Richtung bleiben ganzzahlig exakt, 0,01 m entscheidet weiter', () => {
    // Skalarprodukt bis ca. 2 · 10⁷ cm · 10⁷ cm = 2 · 10¹⁴, weit unter 2⁵³
    const dir = { from: { x: -100_000, y: -100_000 }, to: { x: 100_000, y: 99_999.99 } };
    const axes = directionAxes(dir)!;
    expect(axes.main).toEqual({ x: 20_000_000, y: 19_999_999 });
    const a = st('a', 50_000, 50_000);
    const b = st('b', 50_000.01, 50_000);
    const c = st('c', 50_000, 50_000.01);
    for (const list of [[a, b, c], [c, b, a], [b, a, c]]) expect(ids(orderAlong(list, axes))).toEqual(['a', 'c', 'b']);
    expect(ids(orderAlong([b, a], FIXED_AXES.rightToLeft))).toEqual(['b', 'a']);
  });

  it('Stand genau im Mittelpunkt: in beiden Drehsinnen zuerst; Gleichstand im Winkel in beiden Drehsinnen gleich aufgelöst', () => {
    const cw = { center: { x: 0, y: 0 }, startAngle: 0 };
    const list = [st('E', 10, 0), st('m', 0.004, 0), st('W', -10, 0), st('Wfern', -20, 0)];
    expect(ids(orderClockwise(list, cw, 0, 1))).toEqual(['m', 'E', 'W', 'Wfern']);
    expect(ids(orderClockwise(list, cw, 0, -1))).toEqual(['m', 'W', 'Wfern', 'E']);
  });

  it('gegen den Uhrzeigersinn: Neu nummerieren mit Startnummer und fixierter Nummer', () => {
    const cw = { center: { x: 0, y: 0 }, startAngle: 0 };
    const stands = [st('N', 0, -10), st('E', 10, 0, { nr: '11', nrLocked: true }), st('S', 0, 10), st('W', -10, 0)];
    const plan = planRenumber(project([page('p', { numberingMode: 'counterClockwise', clockwise: cw, stands })], { start: 10 }), 'p');
    expect(plan.changes.map((c) => [c.standId, c.next])).toEqual([
      ['N', '10'],
      ['W', '12'],
      ['S', '13'],
    ]);
    expect(plan.fixed).toBe(1);
  });

  it('eigene Richtung ohne gesetzte Punkte: Vorgabe aus den Ständen, auch für gedrehte Stände über ihre Hülle', () => {
    const r = st('r', 10, 0, { w: 4, d: 2, rot: 90 });
    expect(defaultDirection(page('p', { stands: [r, st('a', 0, 0)] }))).toEqual({ from: { x: -1, y: 0 }, to: { x: 11, y: 0 } });
    // ohne Objekte: keine Reihenfolge, aber auch kein Hinweis (nichts zu nummerieren)
    const empty = page('leer', { numberingMode: 'direction' });
    expect(orderStands(empty)).toEqual([]);
    expect(numberingIssue(empty)).toBeNull();
  });
});

describe('#12 Reihenfolge: Eigenschaften (QA-M5-01) für alle Richtungen und Drehsinne', () => {
  const standsArb = fc
    .uniqueArray(fc.record({ x: fc.integer({ min: -30, max: 30 }), y: fc.integer({ min: -30, max: 30 }) }), { minLength: 1, maxLength: 25, selector: (p) => `${p.x}|${p.y}` })
    .map((pts) => pts.map((p, i) => st(`s${i}`, p.x / 100, p.y / 100)));
  const ptArb = fc.record({ x: fc.integer({ min: -2000, max: 2000 }), y: fc.integer({ min: -2000, max: 2000 }) }).map((p) => ({ x: p.x / 100, y: p.y / 100 }));
  const permuted = standsArb.chain((list) => fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }).map((perm) => [list, perm] as const));

  it('jede Permutation ergibt dieselbe Reihenfolge; ohne Gleichstände ist B → A die Umkehrung von A → B', () => {
    fc.assert(
      fc.property(permuted, ptArb, ptArb, fc.integer({ min: 0, max: 359 }), ([list, perm], from, to, startAngle) => {
        for (const axes of Object.values(FIXED_AXES)) expect(ids(orderAlong(perm, axes))).toEqual(ids(orderAlong(list, axes)));
        const cw = { center: from, startAngle };
        expect(ids(orderClockwise(perm, cw, 0, -1))).toEqual(ids(orderClockwise(list, cw, 0, -1)));
        const axes = directionAxes({ from, to });
        if (!axes) return;
        expect(ids(orderAlong(perm, axes))).toEqual(ids(orderAlong(list, axes)));
        const back = directionAxes({ from: to, to: from })!;
        const key = (s: Stand) => Math.round(s.cx * 100) * axes.main.x + Math.round(s.cy * 100) * axes.main.y;
        if (new Set(list.map(key)).size === list.length) expect(ids(orderAlong(list, back))).toEqual(ids(orderAlong(list, axes)).toReversed());
      }),
      { numRuns: 300 },
    );
  });
});

describe('M5 Neu nummerieren', () => {
  const G = area('G');
  const row = (pageId: string, n: number, extra: (i: number) => Partial<Stand> = () => ({})) =>
    Array.from({ length: n }, (_, i) => st(`${pageId}${i + 1}`, 5 + i * 5, -1.5, extra(i)));

  it('pro Festplatz: Präfix, Startnummer, Stellen; nur die aktive Page', () => {
    const p1 = page('p1', { prefix: 'A-', areas: [G], stands: row('p1', 3) });
    const p2 = page('p2', { areas: [G], stands: row('p2', 2) });
    const plan = planRenumber(project([p1, p2], { start: 1, digits: 2 }), 'p1');
    expect(plan.pageIds).toEqual(['p1']);
    expect(plan.changes.map((c) => [c.standId, c.old, c.next])).toEqual([
      ['p11', '', 'A-01'],
      ['p12', '', 'A-02'],
      ['p13', '', 'A-03'],
    ]);
    expect(plan.fixed).toBe(0);
    expect(plan.unchanged).toBe(0);
  });

  it('fixierte Stände werden übersprungen, ihre Nummer nicht noch einmal vergeben', () => {
    const stands = row('p', 4, (i) => (i === 1 ? { nr: '3', nrLocked: true } : {}));
    const plan = planRenumber(project([page('p', { areas: [G], stands })]), 'p');
    expect(plan.changes.map((c) => [c.standId, c.next])).toEqual([
      ['p1', '1'],
      ['p3', '2'],
      ['p4', '4'],
    ]);
    expect(plan.fixed).toBe(1);
  });

  it('fixierte Nummer im anderen Format („03“) gilt als gleich', () => {
    const stands = row('p', 3, (i) => (i === 2 ? { nr: '02', nrLocked: true } : {}));
    const plan = planRenumber(project([page('p', { areas: [G], stands })], { digits: 2 }), 'p');
    expect(plan.changes.map((c) => c.next)).toEqual(['01', '03']);
  });

  it('unveränderte Nummern sind keine Änderung', () => {
    const stands = row('p', 3, (i) => ({ nr: String(i + 1) }));
    stands[2] = { ...stands[2]!, nr: '9' };
    const plan = planRenumber(project([page('p', { areas: [G], stands })]), 'p');
    expect(plan.unchanged).toBe(2);
    expect(plan.changes).toEqual([{ pageId: 'p', standId: 'p3', old: '9', next: '3' }]);
  });

  it('global: durchgehend in Tab-Reihenfolge, manuelle Pages ausgelassen und ihre Nummern belegt', () => {
    const p1 = page('p1', { areas: [G], stands: row('a', 2) });
    const man = page('man', { numberingMode: 'manual', stands: [st('m', 0, 0, { nr: '4' })] });
    const p2 = page('p2', { areas: [G], stands: row('b', 3) });
    const plan = planRenumber(project([p1, man, p2], { scope: 'global', start: 1 }), 'man');
    expect(plan.pageIds).toEqual(['p1', 'p2']);
    expect(plan.changes.map((c) => [c.standId, c.next])).toEqual([
      ['a1', '1'],
      ['a2', '2'],
      ['b1', '3'],
      ['b2', '5'],
      ['b3', '6'],
    ]);
  });

  it('global: eine fixierte Nummer auf einer anderen Page wird nicht vergeben', () => {
    const p1 = page('p1', { areas: [G], stands: row('a', 2) });
    const p2 = page('p2', { areas: [G], stands: [st('b1', 10, -1.5, { nr: '1', nrLocked: true })] });
    expect(planRenumber(project([p1, p2], { scope: 'global' }), 'p1').changes.map((c) => c.next)).toEqual(['2', '3']);
    // pro Festplatz zählt die fixierte Nummer der anderen Page nicht
    expect(planRenumber(project([p1, p2], { scope: 'perPage' }), 'p1').changes.map((c) => c.next)).toEqual(['1', '2']);
  });

  it('pro Festplatz im Modus „manuell“: nichts zu tun', () => {
    const plan = planRenumber(project([page('p', { numberingMode: 'manual', areas: [G], stands: row('p', 2) })]), 'p');
    expect(plan.pageIds).toEqual([]);
    expect(plan.changes).toEqual([]);
  });

  it('nennt doppelte Nummern, die nach dem Übernehmen bleiben', () => {
    const stands = row('p', 3, (i) => (i < 2 ? { nr: '7', nrLocked: true } : {}));
    const plan = planRenumber(project([page('p', { areas: [G], stands })]), 'p');
    expect(plan.changes.map((c) => c.next)).toEqual(['1']);
    expect([...plan.duplicates.keys()].toSorted()).toEqual(['p1', 'p2']);
  });
});

describe('M5 Neu nummerieren: nur Stände ohne Nummer', () => {
  const G = area('G');
  const row = (pageId: string, nrList: string[], extra: (i: number) => Partial<Stand> = () => ({})) =>
    nrList.map((nr, i) => st(`${pageId}${i + 1}`, 5 + i * 5, -1.5, { nr, ...extra(i) }));

  it('Zahl einer Nummer ist die letzte Ziffernfolge', () => {
    expect(nrNumber('A-012')).toBe(12);
    expect(nrNumber('12a')).toBe(12);
    expect(nrNumber('B')).toBeNull();
    expect(nrNumber('')).toBeNull();
  });

  it('bestehende Nummern bleiben, Stände ohne Nummer bekommen fortlaufende Nummern ab der höchsten, in Modus-Reihenfolge', () => {
    const p = page('p', { prefix: 'A-', areas: [G], stands: row('p', ['', 'A-07', '', 'A-03', '']) });
    const plan = planRenumber(project([p], { digits: 2 }), 'p', 'missing');
    expect(plan.mode).toBe('missing');
    expect(plan.changes.map((c) => [c.standId, c.old, c.next])).toEqual([
      ['p1', '', 'A-08'],
      ['p3', '', 'A-09'],
      ['p5', '', 'A-10'],
    ]);
    expect(plan.unchanged).toBe(2);
  });

  it('ohne vorhandene Nummern ab der Startnummer; fixiert und leer bleibt leer; vorhandene Nummern werden übersprungen', () => {
    const p = page('p', { areas: [G], stands: row('p', ['', '', ''], (i) => (i === 1 ? { nrLocked: true } : {})) });
    expect(planRenumber(project([p], { start: 100 }), 'p', 'missing').changes.map((c) => c.next)).toEqual(['100', '101']);
    // „X5“ zählt als 5 → weiter mit 6; die vorhandene „7“ wird übersprungen
    const q = page('q', { areas: [G], stands: row('q', ['X5', '', '7', '']) });
    expect(planRenumber(project([q]), 'q', 'missing').changes.map((c) => c.next)).toEqual(['8', '9']);
  });

  it('global: höchste Nummer im ganzen Projekt (auch manuelle Pages), fortlaufend über die Pages in Tab-Reihenfolge', () => {
    const p1 = page('p1', { prefix: 'A-', areas: [G], stands: row('a', ['A-2', ''] ) });
    const man = page('man', { numberingMode: 'manual', stands: [st('m', 0, 0, { nr: '40' })] });
    const p2 = page('p2', { prefix: 'B-', areas: [G], stands: row('b', ['', 'B-5']) });
    const plan = planRenumber(project([p1, man, p2], { scope: 'global' }), 'p1', 'missing');
    expect(plan.changes.map((c) => [c.standId, c.next])).toEqual([
      ['a2', 'A-41'],
      ['b1', 'B-42'],
    ]);
  });

  it('Vorauswahl: „nur ohne Nummer“, sobald im Nummernkreis ein Stand eine Nummer hat', () => {
    const empty = page('p1', { stands: row('a', ['', '']) });
    const numbered = page('p2', { stands: row('b', ['', '3']) });
    expect(defaultRenumberMode(project([empty, numbered]), 'p1')).toBe('all');
    expect(defaultRenumberMode(project([empty, numbered]), 'p2')).toBe('missing');
    expect(defaultRenumberMode(project([empty, numbered], { scope: 'global' }), 'p1')).toBe('missing');
  });
});

describe('M5 Doppelte Nummern', () => {
  const p1 = page('p1', { stands: [st('a', 0, 0, { nr: '12' }), st('b', 5, 0, { nr: '012' }), st('c', 9, 0, { nr: '13' }), st('d', 12, 0)] });
  const p2 = page('p2', { stands: [st('e', 0, 0, { nr: '13' }), st('f', 4, 0)] });

  it('je Nummernkreis: pro Festplatz nur auf derselben Page, global im ganzen Projekt', () => {
    const per = findDuplicates([p1, p2], 'perPage');
    expect([...per.keys()].toSorted()).toEqual(['a', 'b']);
    expect(per.get('a')).toEqual([{ pageId: 'p1', standId: 'b' }]);
    const glob = findDuplicates([p1, p2], 'global');
    expect([...glob.keys()].toSorted()).toEqual(['a', 'b', 'c', 'e']);
    expect(glob.get('e')).toEqual([{ pageId: 'p1', standId: 'c' }]);
  });

  it('kopierte Page (E-25) ist bei „global“ doppelt', () => {
    const copy = { ...p2, id: 'p2b', stands: p2.stands.map((s) => ({ ...s, id: `${s.id}2` })) };
    expect(findDuplicates([p2, copy], 'global').has('e2')).toBe(true);
    expect(findDuplicates([p2, copy], 'perPage').size).toBe(0);
  });

  it('Zwischenspeicher je Liste der Pages und Nummernkreis', () => {
    const pages = [p1, p2];
    const a = cachedDuplicates(pages, 'perPage');
    expect(cachedDuplicates(pages, 'perPage')).toBe(a);
    expect(cachedDuplicates(pages, 'global')).not.toBe(a);
  });
});

describe('#14 Alle Fixierungen lösen / alle Nummern fixieren', () => {
  const pages = () => [
    page('A', { stands: [st('a1', 0, -1.5, { nr: '1', nrLocked: true }), st('a2', 5, -1.5, { nr: '2' }), st('a3', 10, -1.5, { nr: '', nrLocked: true }), st('a4', 15)] }),
    page('B', { numberingMode: 'manual', stands: [st('b1', 0, -1.5, { nr: '7', nrLocked: true }), st('b2', 5, -1.5, { nr: '8' })] }),
  ];
  const refs = (r: { pageId: string; standId: string }[]) => r.map((x) => `${x.pageId}/${x.standId}`);

  it('pro Festplatz: nur die Page; auch im Modus „manuell“', () => {
    const p = project(pages());
    expect(refs(nrLockTargets(p, 'A', false))).toEqual(['A/a1', 'A/a3']);
    expect(refs(nrLockTargets(p, 'B', false))).toEqual(['B/b1']);
    expect(refs(nrLockTargets(p, 'B', true))).toEqual(['B/b2']);
  });

  it('global: alle Pages, auch manuelle (anders als „Neu nummerieren“)', () => {
    const p = project(pages(), { scope: 'global' });
    expect(refs(nrLockTargets(p, 'A', false))).toEqual(['A/a1', 'A/a3', 'B/b1']);
    expect(refs(nrLockTargets(p, 'B', true))).toEqual(['A/a2', 'B/b2']);
  });

  it('ohne Page (Start-Page): alle Pages, unabhängig vom Nummernkreis', () => {
    const p = project(pages(), { scope: 'perPage' });
    expect(refs(nrLockTargets(p, null, false))).toEqual(['A/a1', 'A/a3', 'B/b1']);
  });

  it('fixieren lässt Stände ohne Nummer (auch nur Leerzeichen) aus; fixiert und leer wird trotzdem gelöst', () => {
    const p = project([page('A', { stands: [st('x', 0, -1.5, { nr: '  ' }), st('y', 5, -1.5, { nr: '', nrLocked: true }), st('z', 10, -1.5, { nr: 'A-1' })] })]);
    expect(refs(nrLockTargets(p, 'A', true))).toEqual(['A/z']);
    expect(refs(nrLockTargets(p, 'A', false))).toEqual(['A/y']);
  });

  it('nichts zu tun: leere Liste; unbekannte Page bei „pro Festplatz“ ebenso', () => {
    const p = project([page('A', { stands: [st('a', 0, -1.5, { nr: '1', nrLocked: true })] })]);
    expect(nrLockTargets(p, 'A', true)).toEqual([]);
    expect(nrLockTargets(p, 'X', false)).toEqual([]);
  });
});
