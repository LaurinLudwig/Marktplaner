import { describe, expect, it } from 'vitest';
import { createPage, createProject } from './defaults';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { clonePage, copyName, nextPageName } from './pages';
import { parseProjectFile, ProjectFileError, toProjectFile } from './schema';

describe('parseProjectFile', () => {
  it('liest ein frisch erzeugtes Projekt unverändert zurück', () => {
    const p = createProject('Schelmenmarkt 2027');
    expect(parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(p))))).toEqual(p);
  });

  it('ergänzt fehlende Felder mit Standardwerten', () => {
    const p = parseProjectFile({
      format: 'schelmeplaner',
      schemaVersion: 1,
      project: { id: 'x', name: 'Alt', pages: [{ id: 'p1', name: 'Obermarkt' }] },
    });
    expect(p.settings.minFreeWidth).toBe(0.5);
    expect(p.pages[0]!.name).toBe('Obermarkt');
    expect(p.pages[0]!.layers.stands).toEqual({ visible: true, locked: false });
    expect(p.pages[0]!.stands).toEqual([]);
    expect(p.infraTypes.length).toBe(8);
  });

  it('lehnt fremde Dateien, neuere Versionen und doppelte Page-IDs ab', () => {
    expect(() => parseProjectFile({ foo: 1 })).toThrow(ProjectFileError);
    expect(() =>
      parseProjectFile({ format: 'schelmeplaner', schemaVersion: CURRENT_SCHEMA_VERSION + 1, project: {} }),
    ).toThrow(/neueren Version/);
    expect(() =>
      parseProjectFile({
        format: 'schelmeplaner',
        schemaVersion: 1,
        project: { id: 'x', pages: [{ id: 'a' }, { id: 'a' }] },
      }),
    ).toThrow(/doppelte ID/);
  });
});

describe('Page-Hilfen', () => {
  it('nextPageName überspringt vergebene Namen', () => {
    const pages = [createPage('Festplatz 1'), createPage('Festplatz 2')];
    expect(nextPageName(pages)).toBe('Festplatz 3');
    pages[1]!.name = 'Festplatz 3';
    expect(nextPageName(pages)).toBe('Festplatz 4');
  });

  it('copyName nummeriert Kopien durch', () => {
    const pages = [createPage('Obermarkt'), createPage('Obermarkt (Kopie)')];
    expect(copyName('Obermarkt', pages)).toBe('Obermarkt (Kopie 2)');
    expect(copyName('Obermarkt (Kopie)', pages)).toBe('Obermarkt (Kopie 2)');
    expect(copyName('Untermarkt', pages)).toBe('Untermarkt (Kopie)');
  });

  it('clonePage vergibt neue IDs und teilt keine Objekte', () => {
    const page = createPage('A');
    page.areas.push({ id: 'a1', name: '', cx: 0, cy: 0, w: 10, d: 5, rot: 0 });
    const copy = clonePage(page, 'B');
    expect(copy.id).not.toBe(page.id);
    expect(copy.areas[0]!.id).not.toBe('a1');
    copy.areas[0]!.w = 99;
    expect(page.areas[0]!.w).toBe(10);
  });
});
