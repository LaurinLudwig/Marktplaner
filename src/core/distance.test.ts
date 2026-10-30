import { describe, expect, it } from 'vitest';
import { applyCategoryList, encodeCategoryListFile, listFromCategories, parseCategoryListFile } from './categoryLists';
import { rectGap } from './geometry/polygon';
import { createProject } from './model/defaults';
import type { Category, Rect, Stand } from './model/types';
import { createStand } from './objects';
import { standRows } from './standTable';
import { projectStats } from './stats';
import { activeWarnings, cachedDistanceWarnings, countWarnings, distanceConflicts, fmtGap, pageWarnings } from './warnings';

/** #3: Abstandsprüfung für Stände gleicher Kategorie (Konkurrenzschutz). */

const r = (cx: number, cy: number, w = 4, d = 3, rot = 0): Rect => ({ cx, cy, w, d, rot });
const cat = (id: string, minDistance: number | null): Category => ({ id, name: id, color: '#aabbcc', minDistance });
const st = (id: string, rect: Rect, categoryId: string | null, fields: Partial<Stand> = {}): Stand => ({ ...createStand(rect, { categoryId, ...fields }), id });

describe('#3 Abstand Kante zu Kante', () => {
  it('nebeneinander, versetzt (Ecke zu Ecke), überschneidend', () => {
    // 4 × 3 m: rechte Kante bei x = 2, linke Kante des zweiten bei x = 12 → 10 m
    expect(rectGap(r(0, 0), r(14, 0)).dist).toBeCloseTo(10, 9);
    // Ecke (2, 1,5) zu Ecke (5, 5,5): 3 und 4 → 5 m
    expect(rectGap(r(0, 0), r(7, 7)).dist).toBeCloseTo(5, 9);
    expect(rectGap(r(0, 0), r(3, 0)).dist).toBe(0);
    // Kreuz: keine Ecke liegt im anderen Rechteck, trotzdem Überschneidung
    expect(rectGap(r(0, 0, 10, 1), r(0, 0, 1, 10)).dist).toBe(0);
  });

  it('gedreht: gemessen wird die Hitbox, nächste Punkte liegen auf den Kanten', () => {
    // um 45° gedrehtes Quadrat 2 × 2: Ecke bei x = √2; Abstand zur Kante x = 10 des zweiten
    const g = rectGap(r(0, 0, 2, 2, 45), r(12, 0, 4, 4));
    expect(g.dist).toBeCloseTo(10 - Math.SQRT2, 9);
    expect(g.from.x).toBeCloseTo(Math.SQRT2, 9);
    expect(g.to).toEqual({ x: 10, y: expect.closeTo(0, 9) });
    // symmetrisch
    expect(rectGap(r(12, 0, 4, 4), r(0, 0, 2, 2, 45)).dist).toBeCloseTo(g.dist, 9);
  });

  it('Eigenschaft: nie größer als der Abstand der Mittelpunkte; getrennt = Abstand der beiden nächsten Punkte', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const a = r(rnd() * 40, rnd() * 40, 1 + rnd() * 9, 1 + rnd() * 6, rnd() * 360);
      const b = r(rnd() * 40, rnd() * 40, 1 + rnd() * 9, 1 + rnd() * 6, rnd() * 360);
      const g = rectGap(a, b);
      expect(g.dist).toBeLessThanOrEqual(Math.hypot(a.cx - b.cx, a.cy - b.cy) + 1e-9);
      if (g.dist > 0) expect(g.dist).toBeCloseTo(Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y), 9);
    }
  });
});

describe('#3 Warnung „Abstand“', () => {
  const cats = [cat('suess', 50), cat('imbiss', null), cat('wein', 10)];

  it('nur gleiche Kategorie mit Mindestabstand; Grenze: genau der Mindestabstand ist erlaubt; auf 0,01 m gerundet', () => {
    const stands = [
      st('a', r(0, 0), 'suess'),
      st('b', r(30, 0), 'suess'), // 26 m → zu nah
      st('c', r(84, 0), 'suess'), // zu b: 50 m → genau erlaubt
      st('d', r(10, 0), 'imbiss'), // ohne Mindestabstand
      st('e', r(20, 0), 'imbiss'),
      st('f', r(5, 10), null),
      st('g', r(100, 0), 'wein'),
      st('h', r(113.995, 0), 'wein'), // 9,995 m → gerundet 10,00 → erlaubt
    ];
    const w = distanceConflicts(stands, cats);
    expect([...w.keys()].toSorted()).toEqual(['a', 'b']);
    expect(w.get('a')).toEqual([{ id: 'b', dist: 26, from: { x: 2, y: expect.any(Number) }, to: { x: 28, y: expect.any(Number) } }]);
    expect(w.get('b')!.map((c) => [c.id, c.dist])).toEqual([['a', 26]]);
    expect(fmtGap(23.4)).toBe('23,40 m');
  });

  it('mehrere zu nahe Stände nach Abstand sortiert; Überschneidung zählt als 0 m', () => {
    const stands = [st('a', r(0, 0), 'wein'), st('b', r(9, 0), 'wein'), st('c', r(3, 0), 'wein')];
    const w = distanceConflicts(stands, cats);
    expect(w.get('a')!.map((c) => [c.id, c.dist])).toEqual([['c', 0], ['b', 5]]);
  });

  it('Anzeige: projektweit abschaltbar, pro Stand ignorierbar; zählt bei Warnungen und in den Kennzahlen', () => {
    const settings = { warnOutside: false, warnOverlap: false, warnDuplicateNr: false, warnInfra: false, warnPassageWidth: false, warnDistance: true };
    const stands = [st('a', r(0, 0), 'suess'), st('b', r(30, 0), 'suess', { suppressDistanceWarning: true })];
    const dw = distanceConflicts(stands, cats);
    expect(activeWarnings(undefined, stands[0]!, settings, false, false, dw.has('a')).distance).toBe(true);
    expect(activeWarnings(undefined, stands[1]!, settings, false, false, dw.has('b')).distance).toBe(false);
    expect(activeWarnings(undefined, stands[0]!, { ...settings, warnDistance: false }, false, false, true).distance).toBe(false);
    expect(countWarnings(pageWarnings([], stands), stands, settings, undefined, undefined, dw)).toMatchObject({ stands: 1, distance: 1 });

    const p = createProject('T');
    p.categories = cats;
    p.settings.warnOutside = false;
    p.pages[0]!.stands = stands;
    expect(projectStats(p, () => []).total.warnings).toMatchObject({ stands: 1, distance: 1 });
    const rows = standRows(p);
    expect(rows.map((x) => [x.stand.id, x.warnings.distance, x.tooClose.map((c) => c.id)])).toEqual([
      ['a', true, ['b']],
      ['b', false, []],
    ]);
  });

  it('Zwischenspeicher je Liste der Stände und Kategorien; ohne Mindestabstand nichts zu rechnen', () => {
    const stands = [st('a', r(0, 0), 'suess'), st('b', r(30, 0), 'suess')];
    expect(cachedDistanceWarnings(stands, cats)).toBe(cachedDistanceWarnings(stands, cats));
    expect(cachedDistanceWarnings(stands, [cat('suess', null)]).size).toBe(0);
  });

  it('Lasttest: 500 Stände einer Kategorie mit 50 m Mindestabstand schnell genug fürs Ziehen', () => {
    const stands = Array.from({ length: 500 }, (_, i) => st(`s${i}`, r((i % 25) * 6, Math.floor(i / 25) * 8), 'suess'));
    const t = performance.now();
    for (let k = 0; k < 5; k++) distanceConflicts([...stands], cats);
    expect((performance.now() - t) / 5).toBeLessThan(100);
  });
});

describe('#3 Mindestabstand in Kategorielisten', () => {
  it('kommt beim Speichern, Exportieren, Importieren und Ersetzen mit; Ergänzen lässt Bestehendes unverändert', () => {
    const list = listFromCategories('Markt', [{ id: 'x', name: 'Süßwaren', color: '#f06292', minDistance: 50 }, { id: 'y', name: 'Imbiss', color: '#f0a35e', minDistance: null }]);
    const back = parseCategoryListFile(encodeCategoryListFile(list));
    expect(back.entries.map((e) => e.minDistance)).toEqual([50, null]);
    const current = [{ id: 's', name: 'süßwaren', color: '#000000', minDistance: 10 }];
    expect(applyCategoryList(current, back, 'replace').categories[0]).toEqual({ id: 's', name: 'Süßwaren', color: '#f06292', minDistance: 50 });
    expect(applyCategoryList(current, back, 'merge').categories).toEqual([current[0], { id: expect.any(String), name: 'Imbiss', color: '#f0a35e', minDistance: null }]);
  });
});
