import { describe, expect, it } from 'vitest';
import { pageFreeSpaces } from './freeSpace';
import { freeSpaceRows, filterFreeSpaces, sumFreeSpaces, EMPTY_FREE_FILTER } from './freeSpaceList';
import { applyHidden, expiredHiddenFree, hiddenEntry, matchesHidden, pageFree, pickFreeSpace, pruneHiddenFree } from './hiddenFree';
import { clonePage, remapFreeKey } from './model/pages';
import { createPage, createProject } from './model/defaults';
import type { Area, FestplatzPage, Project, Stand } from './model/types';
import { createArea, createStand } from './objects';
import { categoryFigures, NO_CATEGORY, projectStats } from './stats';

/** M11: Statistik je Kategorie (#7) und ausgeblendete Freiflächen (#8), spec.md §4, §7. */

const st = (cx: number, w: number, fields: Partial<Omit<Stand, 'id'>> = {}) => createStand({ cx, cy: 3.5, w, d: 3, rot: 0 }, fields);
// Grundfläche 50 × 10 m, Achse x = 0 … 50, Vorderseite unten (y = 5)
const area = (): Area => createArea({ cx: 25, cy: 0, w: 50, d: 10, rot: 0 }, 'G');
const pg = (stands: Stand[], areas: Area[] = [area()], patch: Partial<FestplatzPage> = {}): FestplatzPage => ({ ...createPage('P'), stands, areas, ...patch });
const proj = (pages: FestplatzPage[], patch: Partial<Project> = {}): Project => ({ ...createProject('T'), pages, ...patch });
const ctx = (p: Project) => ({ minFreeWidth: p.settings.minFreeWidth, infraTypes: p.infraTypes });

describe('#7 Kennzahlen je Kategorie', () => {
  const cats = [
    { id: 'imbiss', name: 'Imbiss', color: '#f00', minDistance: null },
    { id: 'ware', name: 'Ware', color: '#0f0', minDistance: null },
  ];

  it('Anzahl, Frontmeter und Strom je Kategorie ohne Gleitkomma-Reste; unbekannte Kategorie zählt als „ohne“', () => {
    const f = categoryFigures(
      [
        { w: 0.1, powerKw: 1.1, categoryId: 'imbiss' },
        { w: 0.2, powerKw: 2.2, categoryId: 'imbiss' },
        { w: 3, powerKw: 0, categoryId: null },
        { w: 4, powerKw: 0.5, categoryId: 'geloescht' },
      ],
      new Set(cats.map((c) => c.id)),
    );
    expect(f).toEqual({ imbiss: { count: 2, frontM: 0.3, kw: 3.3 }, [NO_CATEGORY]: { count: 2, frontM: 7, kw: 0.5 } });
  });

  it('je Page und gesamt; Summe der Anzahlen = Anzahl Geschäfte', () => {
    const p1 = pg([st(5, 3, { categoryId: 'imbiss', powerKw: 2 }), st(15, 4, { categoryId: 'ware' })]);
    const p2 = pg([st(5, 2.5, { categoryId: 'imbiss', powerKw: 1.5 }), st(15, 6)]);
    const s = projectStats(proj([p1, p2], { categories: cats }), () => []);
    expect(s.pages[0]!.byCategory).toEqual({ imbiss: { count: 1, frontM: 3, kw: 2 }, ware: { count: 1, frontM: 4, kw: 0 } });
    expect(s.total.byCategory).toEqual({ imbiss: { count: 2, frontM: 5.5, kw: 3.5 }, ware: { count: 1, frontM: 4, kw: 0 }, [NO_CATEGORY]: { count: 1, frontM: 6, kw: 0 } });
    const sum = Object.values(s.total.byCategory).reduce((n, c) => n + c.count, 0);
    expect(sum).toBe(s.total.stands);
  });
});

describe('#8 Ausgeblendete Freiflächen', () => {
  const s1 = st(24, 8); // belegt 20 … 28
  const page = pg([s1]);
  const p = proj([page]);
  const all = pageFreeSpaces(page.areas, page.stands, 0.5);
  const [left, right] = all[0]!.free;

  it('Ausgangslage: zwei Freiflächen links und rechts des Stands', () => {
    expect([left!.start, left!.end, right!.start, right!.end]).toEqual([0, 20, 28, 50]);
  });

  it('matchesHidden: gleicher Schlüssel, Intervall bis einschließlich 0,01 m verschoben', () => {
    const h = hiddenEntry(left!);
    expect(matchesHidden(left!, h)).toBe(true);
    expect(matchesHidden({ ...left!, end: 20.01 }, h)).toBe(true);
    expect(matchesHidden({ ...left!, end: 19.99 }, h)).toBe(true);
    expect(matchesHidden({ ...left!, end: 20.02 }, h)).toBe(false);
    expect(matchesHidden({ ...left!, key: 'anders' }, h)).toBe(false);
  });

  it('applyHidden verschiebt die Freifläche nach `hidden`; ohne Ausblendung unverändert und identisch', () => {
    expect(applyHidden(all, [])).toBe(all);
    const hidden = [hiddenEntry(left!)];
    const out = applyHidden(all, hidden);
    expect(out[0]!.free).toEqual([right]);
    expect(out[0]!.hidden).toEqual([left]);
    expect(applyHidden(all, hidden)[0]).toBe(out[0]);
  });

  it('pageFree, freie Frontmeter und Freiflächenliste rechnen ohne ausgeblendete', () => {
    const hiddenPage = { ...page, hiddenFree: [hiddenEntry(left!)] };
    const hp = proj([hiddenPage]);
    expect(pageFree(hiddenPage, ctx(hp))[0]!.free).toHaveLength(1);
    const freeOf = (x: FestplatzPage) => pageFree(x, ctx(hp));
    expect(projectStats(hp, freeOf).total.freeFrontM).toBe(22);
    const rows = freeSpaceRows(hp, freeOf);
    expect(rows.map((r) => r.hidden)).toEqual([false, true]);
    expect(filterFreeSpaces(rows, EMPTY_FREE_FILTER)).toHaveLength(1);
    const withHidden = filterFreeSpaces(rows, { ...EMPTY_FREE_FILTER, showHidden: true });
    expect(withHidden).toHaveLength(2);
    expect(sumFreeSpaces(withHidden)).toEqual({ count: 1, widthM: 22 });
  });

  it('pruneHiddenFree: verfällt, wenn der begrenzende Stand verschoben, vergrößert oder gelöscht wird', () => {
    const hidden = [hiddenEntry(left!)];
    const free = (stands: Stand[]) => pageFreeSpaces(page.areas, stands, 0.5);
    expect(pruneHiddenFree(hidden, free([s1]))).toBe(hidden);
    expect(pruneHiddenFree(hidden, free([{ ...s1, cx: 24.01 }]))).toBe(hidden);
    expect(pruneHiddenFree(hidden, free([{ ...s1, cx: 25 }]))).toEqual([]);
    expect(pruneHiddenFree(hidden, free([{ ...s1, w: 9 }]))).toEqual([]);
    expect(pruneHiddenFree(hidden, free([]))).toEqual([]);
    // Neuer Stand in der Lücke: anderer Schlüssel
    expect(pruneHiddenFree(hidden, free([s1, st(5, 3)]))).toEqual([]);
    // Die rechte Lücke ändert sich nicht, wenn nur links etwas passiert
    const hr = [hiddenEntry(right!)];
    expect(pruneHiddenFree(hr, free([s1, st(5, 3)]))).toBe(hr);
  });

  it('expiredHiddenFree prüft nur geänderte Pages und meldet die verbleibenden Einträge', () => {
    const before = proj([{ ...page, hiddenFree: [hiddenEntry(left!), hiddenEntry(right!)] }]);
    const same = { ...before, name: 'Neu' };
    expect(expiredHiddenFree(before, same).size).toBe(0);
    const moved = { ...before, pages: [{ ...before.pages[0]!, stands: [{ ...s1, cx: 30 }] }] };
    expect(expiredHiddenFree(before, moved).get(page.id)).toEqual([]);
    // Nur die Mindestbreite geändert: Freiflächen bleiben, Einträge auch
    const wider = { ...before, settings: { ...before.settings, minFreeWidth: 1 } };
    expect(expiredHiddenFree(before, wider).size).toBe(0);
  });

  it('pickFreeSpace findet die angezeigte Freifläche unter dem Punkt', () => {
    expect(pickFreeSpace(all, { x: 10, y: 0 })).toBe(left);
    expect(pickFreeSpace(all, { x: 40, y: 4.9 })).toBe(right);
    expect(pickFreeSpace(all, { x: 24, y: 0 })).toBeNull();
    expect(pickFreeSpace(all, { x: 10, y: 6 })).toBeNull();
    expect(pickFreeSpace(applyHidden(all, [hiddenEntry(left!)]), { x: 10, y: 0 })).toBeNull();
  });

  it('Page duplizieren übernimmt Ausblendungen mit den neuen IDs', () => {
    expect(remapFreeKey('a|s|$#1', new Map([['a', 'A'], ['s', 'S']]))).toBe('A|S|$#1');
    const copy = clonePage({ ...page, hiddenFree: [hiddenEntry(left!)] }, 'Kopie');
    const copyFree = pageFree(copy, ctx(p));
    expect(copyFree[0]!.free).toHaveLength(1);
    expect(copyFree[0]!.hidden).toHaveLength(1);
  });
});
