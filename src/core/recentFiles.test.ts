import { describe, expect, it } from 'vitest';
import { addRecent, folderOf, parseRecent, RECENT_MAX, removeRecent, type RecentFile } from './recentFiles';

const f = (path: string, at = '2026-10-23T10:00:00.000Z'): RecentFile => ({ path, name: path.split(/[\\/]/).pop()!, openedAt: at });

describe('Zuletzt geöffnet (#11)', () => {
  it('neueste zuerst; derselbe Pfad wandert nach oben statt doppelt', () => {
    let l = addRecent([], f('/a/eins.mplan'));
    l = addRecent(l, f('/a/zwei.mplan'));
    l = addRecent(l, f('/a/eins.mplan', '2026-10-24T08:00:00.000Z'));
    expect(l.map((x) => x.path)).toEqual(['/a/eins.mplan', '/a/zwei.mplan']);
    expect(l[0]!.openedAt).toBe('2026-10-24T08:00:00.000Z');
  });

  it('Windows-Pfade ohne Groß-/Kleinschreibung, macOS-Pfade mit', () => {
    expect(addRecent([f('C:\\Pläne\\Markt.mplan')], f('c:\\pläne\\markt.mplan'))).toHaveLength(1);
    expect(addRecent([f('/Users/a/Markt.mplan')], f('/Users/a/markt.mplan'))).toHaveLength(2);
  });

  it(`höchstens ${RECENT_MAX} Einträge, der älteste fällt weg`, () => {
    let l: RecentFile[] = [];
    for (let i = 0; i < RECENT_MAX + 3; i++) l = addRecent(l, f(`/p/${i}.mplan`));
    expect(l).toHaveLength(RECENT_MAX);
    expect(l[0]!.path).toBe(`/p/${RECENT_MAX + 2}.mplan`);
    expect(l.some((x) => x.path === '/p/0.mplan')).toBe(false);
  });

  it('entfernen', () => {
    expect(removeRecent([f('/a.mplan'), f('/b.mplan')], '/a.mplan').map((x) => x.path)).toEqual(['/b.mplan']);
  });

  it('kaputte Daten ergeben eine leere Liste bzw. entfallen', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('kein json')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([f('/a.mplan'), { path: 3 }, null, { path: '/b.schelme', name: 'b.schelme' }]))).toEqual([
      f('/a.mplan'),
      { path: '/b.schelme', name: 'b.schelme', openedAt: '' },
    ]);
  });

  it('Ordner zur Anzeige', () => {
    expect(folderOf('/Users/a/Märkte/2026.mplan')).toBe('/Users/a/Märkte');
    expect(folderOf('C:\\Pläne\\2026.mplan')).toBe('C:\\Pläne');
    expect(folderOf('2026.mplan')).toBe('');
  });
});
