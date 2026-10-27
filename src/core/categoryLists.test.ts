import { describe, expect, it } from 'vitest';
import {
  applyCategoryList,
  BUILTIN_CATEGORY_LISTS,
  builtinList,
  categoryListFileName,
  DEFAULT_LIST_ID,
  encodeCategoryListFile,
  listFromCategories,
  loadOwnLists,
  parseCategoryListFile,
  uniqueListName,
  type CategoryList,
} from './categoryLists';
import { UserError } from './errors';
import { createProject } from './model/defaults';
import { parseProjectFile, toProjectFile } from './model/schema';
import type { Category } from './model/types';

const list = (names: [string, string][]): CategoryList => ({ id: 'x', name: 'Test', builtin: false, entries: names.map(([name, color]) => ({ name, color })) });
const cat = (id: string, name: string, color = '#000000'): Category => ({ id, name, color });

describe('#1 Mitgelieferte Kategorielisten', () => {
  it('Namen sind je Liste eindeutig, Farben gültig, Kategorien gut unterscheidbar (keine doppelte Farbe)', () => {
    for (const l of BUILTIN_CATEGORY_LISTS) {
      const names = l.entries.map((e) => e.name.toLowerCase());
      expect(new Set(names).size, l.name).toBe(names.length);
      expect(new Set(l.entries.map((e) => e.color)).size, l.name).toBe(l.entries.length);
      for (const e of l.entries) expect(e.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(builtinList(DEFAULT_LIST_ID)?.entries.map((e) => e.name)).toEqual([
      'Kinderfahrgeschäft',
      'Großfahrgeschäft',
      'Laufgeschäft',
      'Spielgeschäft/Verlosung',
      'Süßwaren',
      'Imbiss',
      'Ausschank',
      'Festzelt',
      'Krammarkt/Waren',
      'Kunsthandwerk',
      'Verein/Info',
    ]);
  });

  it('neues Projekt übernimmt die Liste mit eigenen IDs; ohne Liste leer; übersteht die Prüfung beim Öffnen', () => {
    const l = builtinList('jahrmarkt-gross')!;
    const p = createProject('Markt', l);
    expect(p.categories.map((c) => [c.name, c.color])).toEqual(l.entries.map((e) => [e.name, e.color]));
    expect(new Set(p.categories.map((c) => c.id)).size).toBe(l.entries.length);
    expect(createProject('Markt', l).categories[0]!.id).not.toBe(p.categories[0]!.id);
    expect(createProject('Markt').categories).toEqual([]);
    expect(parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(p)))).categories).toEqual(p.categories);
  });

  it('ergänzen: nur fehlende Namen (ohne Rücksicht auf Groß-/Kleinschreibung), Bestehendes unverändert', () => {
    const current = [cat('a', 'Imbiss', '#111111'), cat('b', 'Eigene')];
    const r = applyCategoryList(current, list([['imbiss ', '#222222'], ['Ausschank', '#333333']]), 'merge');
    expect(r.removed).toEqual([]);
    expect(r.categories.slice(0, 2)).toEqual(current);
    expect(r.categories.slice(2).map((c) => [c.name, c.color])).toEqual([['Ausschank', '#333333']]);
  });

  it('ersetzen: gleichnamige behalten ID und bekommen die Listenfarbe, andere entfallen; Reihenfolge der Liste', () => {
    const current = [cat('a', 'Eigene'), cat('b', 'Imbiss', '#111111')];
    const r = applyCategoryList(current, list([['Ausschank', '#333333'], ['IMBISS', '#222222'], ['Imbiss', '#444444']]), 'replace');
    expect(r.removed).toEqual(['a']);
    expect(r.categories.map((c) => c.name)).toEqual(['Ausschank', 'IMBISS']);
    expect(r.categories[1]).toEqual({ id: 'b', name: 'IMBISS', color: '#222222' });
    expect(r.categories[0]!.id).not.toBe('a');
  });
});

describe('#2 Eigene Kategorielisten', () => {
  it('aus dem Projekt speichern, als Datei exportieren und wieder importieren (neue ID, gleicher Inhalt)', () => {
    const own = listFromCategories('Schelmenmarkt', [cat('a', 'Imbiss', '#F0A35E'), cat('b', 'Ausschank', '#f2d15c')]);
    expect(own.builtin).toBe(false);
    const text = encodeCategoryListFile(own);
    expect(JSON.parse(text)).toMatchObject({ format: 'marktplaner-kategorien', version: 1, name: 'Schelmenmarkt' });
    const back = parseCategoryListFile(text);
    expect(back.id).not.toBe(own.id);
    expect(back.name).toBe('Schelmenmarkt');
    expect(back.entries).toEqual([
      { name: 'Imbiss', color: '#f0a35e' },
      { name: 'Ausschank', color: '#f2d15c' },
    ]);
    expect(parseCategoryListFile(`\uFEFF${text}`).entries).toHaveLength(2);
    expect(categoryListFileName({ ...own, name: 'Markt: 2027/neu' })).toBe('Kategorien Markt- 2027-neu.json');
  });

  it('ungültige Dateien und neuere Formatversionen werden mit deutscher Meldung abgewiesen', () => {
    const file = (o: object) => JSON.stringify({ format: 'marktplaner-kategorien', version: 1, name: 'X', categories: [{ name: 'A', color: '#aabbcc' }], ...o });
    const cases: [string, RegExp][] = [
      ['kein json', /kein gültiges JSON/],
      ['{"format":"schelmeplaner"}', /keine Kategorieliste/],
      ['[]', /keine Kategorieliste/],
      [file({ version: '1' }), /keine gültige Formatversion/],
      [file({ version: 2 }), /neueren Version.*Format 2/],
      [file({ categories: [{ name: '', color: '#aabbcc' }, { name: 'B', color: 'rot' }] }), /keine gültige Kategorie/],
    ];
    for (const [text, msg] of cases) {
      expect(() => parseCategoryListFile(text)).toThrow(UserError);
      expect(() => parseCategoryListFile(text)).toThrow(msg);
    }
    // Ungültige Einträge fallen weg, doppelte Namen zählen einmal, fehlender Name wird ersetzt
    const ok = parseCategoryListFile(file({ name: ' ', categories: [{ name: 'A', color: '#aabbcc' }, { name: 'a', color: '#000000' }, { name: 'B' }] }));
    expect(ok.name).toBe('Importierte Liste');
    expect(ok.entries).toEqual([{ name: 'A', color: '#aabbcc' }]);
  });

  it('gespeicherte Listen: Beschädigtes fällt mit Hinweis weg, mitgelieferte IDs sind tabu', () => {
    const good = { id: 'l1', name: 'Eigene', builtin: false, entries: [{ name: 'A', color: '#aabbcc' }] };
    expect(loadOwnLists(undefined)).toEqual({ lists: [] });
    expect(loadOwnLists([good])).toEqual({ lists: [good] });
    expect(loadOwnLists('kaputt').error).toMatch(/beschädigt/);
    const r = loadOwnLists([good, { ...good }, { ...good, id: DEFAULT_LIST_ID }, { id: 'l2', name: 'Leer', entries: [] }, 7]);
    expect(r.lists).toEqual([good]);
    expect(r.error).toMatch(/Einige/);
  });

  it('Namen werden eindeutig gemacht, auch gegenüber den mitgelieferten', () => {
    const lists = [...BUILTIN_CATEGORY_LISTS, { ...BUILTIN_CATEGORY_LISTS[0]!, id: 'o', name: 'Markt', builtin: false }];
    expect(uniqueListName('Neu', lists)).toBe('Neu');
    expect(uniqueListName('jahrmarkt klein', lists)).toBe('jahrmarkt klein (2)');
    expect(uniqueListName(' Markt ', lists)).toBe('Markt (2)');
    expect(uniqueListName('  ', lists)).toBe('Eigene Liste');
  });
});
