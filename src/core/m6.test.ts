import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { csvCell, safeFileName, toCsv, withExportNote } from './csv';
import { createFreeSpaceCache, pageFreeSpaces, type AreaFreeSpaces } from './freeSpace';
import { filterFreeSpaces, fitsStand, freeSpaceRows, sortFreeSpaces, sumFreeSpaces, usableDepth } from './freeSpaceList';
import { createPage, createProject } from './model/defaults';
import type { Area, FestplatzPage, Project, Stand } from './model/types';
import { createArea, createStand } from './objects';
import { compareNr, EMPTY_STAND_FILTER, filterRows, normalizeSearch, sortRows, standRows, sumRows, toggleSort } from './standTable';
import { freeFrontMeters, projectStats, sumWidths } from './stats';

/** M6: Start-Page (spec.md §7) – Kennzahlen, Geschäftstabelle, Freiflächenliste, CSV. */

const st = (cx: number, w: number, fields: Partial<Omit<Stand, 'id'>> = {}, d = 3) => createStand({ cx, cy: 0, w, d, rot: 0 }, fields);
const area = (name: string, cx: number, w: number, d: number, cy = 0): Area => createArea({ cx, cy, w, d, rot: 0 }, name);
const pg = (name: string, stands: Stand[], areas: Area[] = [], limit: number | null = null): FestplatzPage => ({ ...createPage(name), stands, areas, powerLimitKw: limit });
const noFree = () => [];
const proj = (pages: FestplatzPage[], patch: Partial<Project> = {}): Project => ({ ...createProject('Test'), pages, ...patch });

describe('M6 Kennzahlen', () => {
  it('Anzahl, Frontmeter (Summe der Breiten, ohne Gleitkomma-Reste), Strom und Anschlussarten je Page und gesamt', () => {
    const p1 = pg('A', [st(0, 0.1, { powerKw: 1.1, connection: '230V' }), st(10, 0.2, { powerKw: 2.2, connection: 'CEE16' })], [], 3);
    const p2 = pg('B', [st(0, 8, { powerKw: 0.7 })]);
    const s = projectStats(proj([p1, p2]), noFree);
    expect(s.pages.map((p) => [p.name, p.stands, p.frontM])).toEqual([
      ['A', 2, 0.3],
      ['B', 1, 8],
    ]);
    expect(s.pages[0]!.power.level).toBe('over');
    expect(s.total).toMatchObject({ stands: 3, frontM: 8.3, sumKw: 4 });
    expect(s.total.byConnection).toEqual({ '230V': { count: 1, kw: 1.1 }, CEE16: { count: 1, kw: 2.2 }, CEE32: { count: 0, kw: 0 }, none: { count: 1, kw: 0.7 } });
    expect(sumWidths([{ w: 0.1 }, { w: 0.2 }])).toBe(0.3);
  });

  it('Warnzahl je Page und gesamt (Überlappung, außerhalb, doppelte Nummer; Einstellungen gelten)', () => {
    const a = area('G', 10, 20, 5);
    const p1 = pg('A', [st(2, 3, { nr: '1' }), st(3, 3, { nr: '2' }), st(50, 3, { nr: '1' })], [a]);
    const s = projectStats(proj([p1]), noFree);
    expect(s.pages[0]!.warnings).toEqual({ stands: 3, overlap: 2, outside: 1, duplicate: 2, infra: 0, narrow: 0 });
    const off = projectStats(proj([p1], { settings: { ...createProject().settings, warnOverlap: false, warnDuplicateNr: false } }), noFree);
    expect(off.total.warnings).toEqual({ stands: 1, overlap: 0, outside: 1, duplicate: 0, infra: 0, narrow: 0 });
  });
});

describe('M6-11 Freie Frontmeter', () => {
  const freeOf = (p: FestplatzPage) => pageFreeSpaces(p.areas, p.stands, 0.5, createFreeSpaceCache());

  it('Summe der angezeigten Freiflächen je Page und gesamt; schmaler als die Mindestbreite zählt nicht', () => {
    // §4: 50 × 10 m mit 8-m-Stand bei 20 m → 20 + 22 = 42 m frei
    const nord = pg('A', [createStand({ cx: 24, cy: 1.5, w: 8, d: 3, rot: 0 })], [area('G', 25, 50, 10, 5)]);
    // 10 m breit: Stände 0–4,7 und 5–10 → Lücke 0,3 m unter der Mindestbreite 0,5 m
    const sued = pg('B', [createStand({ cx: 2.35, cy: 1.5, w: 4.7, d: 3, rot: 0 }), createStand({ cx: 7.5, cy: 1.5, w: 5, d: 3, rot: 0 })], [area('H', 5, 10, 10, 5)]);
    const s = projectStats(proj([nord, sued]), freeOf);
    expect(s.pages.map((p) => p.freeFrontM)).toEqual([42, 0]);
    expect(s.total.freeFrontM).toBe(42);
  });

  it('ohne Gleitkomma-Reste; leere Page 0', () => {
    expect(freeFrontMeters([{ areaId: 'x', occupied: [], gaps: [], free: [{ width: 0.1 }, { width: 0.2 }] as never, hidden: [] }])).toBe(0.3);
    expect(projectStats(proj([pg('Leer', [])]), freeOf).total.freeFrontM).toBe(0);
  });
});

describe('M6 Geschäftstabelle', () => {
  const cat = { id: 'c1', name: 'Imbiss', color: '#fff' };
  const rowsOf = () => {
    const p1 = pg('Festplatz 1', [
      st(0, 3, { nr: 'A-10', name: 'Bratwurst Müller', owner: 'Hans Müller', ware: 'Wurst', categoryId: 'c1', connection: 'CEE16', powerKw: 5 }),
      st(10, 4, { nr: 'A-2', name: 'Café Süß', owner: 'Erika', ware: 'Kuchen' }),
      st(20, 2, { nr: '', name: 'Losbude', owner: 'Kai', ware: 'Lose', powerKw: 0.5 }),
    ]);
    const p2 = pg('Festplatz 2', [st(0, 6, { nr: 'B-1', name: 'Karussell', owner: 'Fa. Strauß', ware: 'Fahrgeschäft', connection: 'CEE32', powerKw: 20 })]);
    return standRows(proj([p1, p2], { categories: [cat] }));
  };

  it('Zeilen über alle Pages mit Kategoriename und Page-Index', () => {
    const rows = rowsOf();
    expect(rows.map((r) => [r.pageIndex, r.stand.name, r.categoryName])).toEqual([
      [0, 'Bratwurst Müller', 'Imbiss'],
      [0, 'Café Süß', null],
      [0, 'Losbude', null],
      [1, 'Karussell', null],
    ]);
  });

  it('Suche ohne Groß-/Kleinschreibung und Akzente, jedes Wort in Name, Eigentümer oder Ware', () => {
    const rows = rowsOf();
    const names = (search: string) => filterRows(rows, { ...EMPTY_STAND_FILTER, search }).map((r) => r.stand.name);
    expect(names('cafe')).toEqual(['Café Süß']);
    expect(names('MUELLER')).toEqual([]);
    expect(names('müller wurst')).toEqual(['Bratwurst Müller']);
    expect(names('strauss')).toEqual(['Karussell']);
    expect(names('  ')).toHaveLength(4);
    expect(normalizeSearch('  Ärger  Straße ')).toBe('arger strasse');
  });

  it('Filter Festplatz, Kategorie (auch „ohne“), Anschlussart (auch „ohne Angabe“), ohne Nummer, mit Warnung', () => {
    const rows = rowsOf();
    const names = (f: Partial<typeof EMPTY_STAND_FILTER>) => filterRows(rows, { ...EMPTY_STAND_FILTER, ...f }).map((r) => r.stand.name);
    expect(names({ pages: [rows[3]!.pageId] })).toEqual(['Karussell']);
    expect(names({ categories: ['c1'] })).toEqual(['Bratwurst Müller']);
    expect(names({ categories: [null] })).toEqual(['Café Süß', 'Losbude', 'Karussell']);
    expect(names({ connections: ['none'] })).toEqual(['Café Süß', 'Losbude']);
    expect(names({ connections: ['CEE16', 'CEE32'] })).toEqual(['Bratwurst Müller', 'Karussell']);
    expect(names({ withoutNr: true })).toEqual(['Losbude']);
    expect(names({ withWarning: true })).toEqual(['Bratwurst Müller', 'Café Süß', 'Losbude', 'Karussell']);
  });

  it('Natürliche Nummern: A-2 vor A-10, 012 = 12, Ziffern vor Text', () => {
    expect(['A-10', 'A-2', 'a-1', '12', '3', 'B-1'].toSorted(compareNr)).toEqual(['3', '12', 'a-1', 'A-2', 'A-10', 'B-1']);
    expect(compareNr('012', '12')).toBe(0);
  });

  it('Sortierung: leere Werte immer am Ende, Richtung umkehrbar, Gleichstand nach Festplatz und Nummer', () => {
    const rows = rowsOf();
    const by = (col: Parameters<typeof toggleSort>[1], dir: 'asc' | 'desc' = 'asc') => sortRows(rows, [{ col: col as never, dir }]).map((r) => r.stand.nr || '–');
    expect(by('nr')).toEqual(['A-2', 'A-10', 'B-1', '–']);
    expect(by('nr', 'desc')).toEqual(['B-1', 'A-10', 'A-2', '–']);
    expect(by('w', 'desc')).toEqual(['B-1', 'A-2', 'A-10', '–']);
    expect(by('category')).toEqual(['A-10', 'A-2', '–', 'B-1']);
    expect(by('connection')).toEqual(['A-10', 'B-1', 'A-2', '–']);
  });

  it('Spaltenkopf: Klick setzt bzw. kehrt um, Shift fügt eine Stufe hinzu', () => {
    expect(toggleSort([{ col: 'page', dir: 'asc' }], 'name', false)).toEqual([{ col: 'name', dir: 'asc' }]);
    expect(toggleSort([{ col: 'name', dir: 'asc' }], 'name', false)).toEqual([{ col: 'name', dir: 'desc' }]);
    expect(toggleSort([{ col: 'name', dir: 'asc' }], 'w', true)).toEqual([
      { col: 'name', dir: 'asc' },
      { col: 'w', dir: 'asc' },
    ]);
  });

  it('Summenzeile über die gefilterten Zeilen, ohne Gleitkomma-Reste', () => {
    const rows = rowsOf();
    expect(sumRows(rows)).toEqual({ count: 4, frontM: 15, powerKw: 25.5, byConnection: { '230V': 0, CEE16: 1, CEE32: 1, none: 2 } });
    const tiny = standRows(proj([pg('P', [st(0, 0.1, { powerKw: 0.1 }), st(5, 0.2, { powerKw: 0.2 })])]));
    expect(sumRows(tiny)).toMatchObject({ frontM: 0.3, powerKw: 0.3 });
  });

  it('Eigenschaft: Filtern und Sortieren behalten genau die passenden Zeilen', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ nr: fc.stringMatching(/^[AB]?-?\d{0,3}$/), name: fc.string({ maxLength: 6 }), w: fc.integer({ min: 1, max: 900 }) }), { maxLength: 40 }), (specs) => {
        const rows = standRows(proj([pg('P', specs.map((s, i) => st(i * 10, s.w / 100, { nr: s.nr, name: s.name })))]));
        const filtered = filterRows(rows, { ...EMPTY_STAND_FILTER, withoutNr: false });
        const sorted = sortRows(filtered, [{ col: 'nr', dir: 'desc' }]);
        expect(new Set(sorted.map((r) => r.stand.id))).toEqual(new Set(rows.map((r) => r.stand.id)));
        expect(sortRows(sorted.toReversed(), [{ col: 'nr', dir: 'desc' }]).map((r) => r.stand.id)).toEqual(sorted.map((r) => r.stand.id));
      }),
    );
  });
});

describe('M6 Freiflächenliste', () => {
  const freeOf = (p: FestplatzPage): AreaFreeSpaces[] => pageFreeSpaces(p.areas, p.stands, 0.5, createFreeSpaceCache());

  it('Beispiel §4: 50 × 10 m mit einem 8-m-Stand bei 20 m → 20 × 10 und 22 × 10; Passt-Filter mit Toleranz 0,01 m', () => {
    const g = area('Nord', 25, 50, 10, 5);
    const p = pg('A', [createStand({ cx: 24, cy: 1.5, w: 8, d: 3, rot: 0 })], [g]);
    const rows = freeSpaceRows(proj([p]), freeOf);
    expect(rows.map((r) => [r.areaName, r.width, r.depth, r.size])).toEqual([
      ['Nord', 20, 10, 200],
      ['Nord', 22, 10, 220],
    ]);
    expect(rows.every((r) => r.ref.pageId === p.id && r.ref.areaId === g.id)).toBe(true);
    expect(fitsStand(rows[0]!, 20.01, 10.01)).toBe(true);
    expect(fitsStand(rows[0]!, 20.02, 4)).toBe(false);
    expect(filterFreeSpaces(rows, { pages: null, minW: 21, minD: null }).map((r) => r.width)).toEqual([22]);
    expect(filterFreeSpaces(rows, { pages: null, minW: 8, minD: 11 })).toEqual([]);
    expect(sortFreeSpaces(rows, [{ col: 'w', dir: 'asc' }]).map((r) => r.width)).toEqual([20, 22]);
    expect(sortFreeSpaces(rows, [{ col: 'w', dir: 'desc' }]).map((r) => r.width)).toEqual([22, 20]);
    expect(sumFreeSpaces(rows)).toEqual({ count: 2, widthM: 42 });
  });

  it('Angeschnittene Freifläche (L-Form): Hüllmaße, aber nutzbare Tiefe ist die kleinste durchgehende', () => {
    // Frühere Fläche (0..10 × 0..4) überdeckt die hintere linke Ecke der späteren (0..20 × 0..10, Vorderseite unten bei y = 10)
    const early = area('Früh', 5, 10, 4, 2);
    const late = area('Spät', 10, 20, 10, 5);
    const p = pg('A', [], [early, late]);
    const rows = freeSpaceRows(proj([p]), freeOf).filter((r) => r.areaName === 'Spät');
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.clipped).toBe(true);
    expect([r.width, r.depth]).toEqual([20, 10]);
    expect(r.usableDepth).toBeCloseTo(6, 6);
    expect(fitsStand(r, 8, 6)).toBe(true);
    expect(fitsStand(r, 8, 7)).toBe(false);
  });

  it('Ohne Anschnitt ist die nutzbare Tiefe die Tiefe', () => {
    const a = area('G', 0, 10, 4);
    expect(usableDepth(a, { start: 0, end: 10, depth: 4, polygons: [], clipped: false })).toBe(4);
  });
});

describe('M6 CSV', () => {
  it('BOM, Semikolon, CRLF, Zahlen mit Komma, Anführungszeichen bei Sonderzeichen', () => {
    const csv = toCsv(['Nr', 'Name', 'Breite'], [
      ['A-1', 'Müller; Söhne', 3.5],
      ['', 'Sag "Hallo"\nzweite Zeile', 1234.567],
      [null, 'x', null],
    ]);
    expect(csv).toBe('﻿Nr;Name;Breite\r\nA-1;"Müller; Söhne";3,5\r\n;"Sag ""Hallo""\nzweite Zeile";1234,567\r\n;x;\r\n');
  });

  it('Vermerk „erstellt mit“ nach einer Leerzeile am Ende (#5)', () => {
    const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    const csv = withExportNote(toCsv(['Nr'], [['1']]));
    expect(csv).toBe(`﻿Nr\r\n1\r\n\r\nMarktplaner, Version ${version}, Laurin Ludwig, https://github.com/LaurinLudwig\r\n`);
  });

  it('Formelschutz für Text, nicht für Zahlen', () => {
    expect(csvCell('=SUMME(A1)')).toBe("'=SUMME(A1)");
    expect(csvCell('+49 170')).toBe("'+49 170");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('A=1')).toBe('A=1');
  });

  it('Dateiname ohne verbotene Zeichen', () => {
    expect(safeFileName('Markt 2027: Liste/neu')).toBe('Markt 2027- Liste-neu');
    expect(safeFileName('  ')).toBe('Export');
  });
});
