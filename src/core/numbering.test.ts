import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPage, DEFAULT_SETTINGS } from './model/defaults';
import type { Area, FestplatzPage, NumberingScope, Rect, Stand } from './model/types';
import { cachedDuplicates, defaultClockwiseCenter, defaultRenumberMode, findDuplicates, formatNr, nrKey, nrNumber, orderClockwise, orderLeftToRight, orderStands, planRenumber, sameNr } from './numbering';
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
