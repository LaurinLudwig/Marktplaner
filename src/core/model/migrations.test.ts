import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeProjectFile, encodeProjectFile } from '../fileFormat';
import { CURRENT_SCHEMA_VERSION, migrate, MIGRATIONS } from './migrations';
import { parseProjectFile, ProjectFileError } from './schema';
import type { Project } from './types';

/**
 * Felder aus Formatversion 8 (M12) prüfen und entfernen, damit die Tests älterer Migrationen ihre Version vergleichen:
 * Nach der Migration ist jeder Stand ein Rechteck ohne Vorlage, und es gibt keine Formvorlagen.
 */
function withoutV8(project: Project): Project {
  expect(project.shapeTemplates).toEqual([]);
  const { shapeTemplates: _t, ...rest } = project;
  return {
    ...rest,
    pages: project.pages.map((pg) => ({
      ...pg,
      stands: pg.stands.map(({ shape, shapeTemplateId, ...st }) => {
        expect({ shape, shapeTemplateId }).toEqual({ shape: 'rect', shapeTemplateId: null });
        return st;
      }),
    })),
  } as unknown as Project;
}

/**
 * Versionierung des Dateiformats. Regel (CONTRIBUTING.md): Jede Änderung am Dateiformat erhöht die Version
 * und bringt eine Migration mit Test mit.
 */

describe('Formatversionen', () => {
  it('es gibt für jeden Versionssprung bis zur aktuellen Version eine Migration', () => {
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) expect(MIGRATIONS[v], `Migration ${v} → ${v + 1}`).toBeTypeOf('function');
  });

  it('neuere Versionen werden mit deutscher Meldung abgewiesen, nicht still geladen', () => {
    expect(() => parseProjectFile({ format: 'schelmeplaner', schemaVersion: CURRENT_SCHEMA_VERSION + 1, project: { id: 'x', pages: [] } })).toThrow(ProjectFileError);
    expect(() => parseProjectFile({ format: 'schelmeplaner', schemaVersion: CURRENT_SCHEMA_VERSION + 1, project: { id: 'x', pages: [] } })).toThrow(
      /neueren Version von Marktplaner/,
    );
  });

  it('Speichern schreibt die aktuelle Version', () => {
    const project = withoutV8(decodeProjectFile(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v1-m3.schelme'))).project);
    const json = JSON.parse(strFromU8(unzipSync(encodeProjectFile({ project, assets: {} }))['project.json']!));
    expect(json.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('Migration 1 → 2 (M4: Warnungen)', () => {
  it('ergänzt suppressOverlapWarning und warnOverlap, ändert die Eingabe nicht und überschreibt keine vorhandenen Werte', () => {
    const v1 = {
      id: 'p',
      settings: { warnOutside: false },
      pages: [{ id: 'a', stands: [{ id: 's1', suppressOutsideWarning: true }, { id: 's2', suppressOverlapWarning: true }] }],
    };
    const before = structuredClone(v1);
    const v2 = MIGRATIONS[1]!(v1) as any;
    expect(v1).toEqual(before);
    expect(v2.settings).toEqual({ warnOutside: false, warnOverlap: true });
    expect(v2.pages[0].stands).toEqual([
      { id: 's1', suppressOutsideWarning: true, suppressOverlapWarning: false },
      { id: 's2', suppressOverlapWarning: true },
    ]);
    // kaputte Strukturen bleiben für die Prüfung in schema.ts unverändert
    expect((MIGRATIONS[1]!({ id: 'x', pages: 'kaputt' }) as any).pages).toBe('kaputt');
    expect(migrate(null, 1)).toBeNull();
  });

  it('echte Datei aus M3 (Version 1, tests/fixtures/format-v1-m3.schelme) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v1-m3.schelme')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.project.pages[0].stands[0]).not.toHaveProperty('suppressOverlapWarning');
    expect(raw.project.settings).not.toHaveProperty('warnOverlap');

    const project = withoutV8(decodeProjectFile(bytes).project);
    expect(project.settings.warnOverlap).toBe(true);
    expect(project.settings.warnOutside).toBe(raw.project.settings.warnOutside);
    expect(project.categories).toEqual(raw.project.categories);
    expect(project.pages).toHaveLength(4);
    expect(project.pages.reduce((n, p) => n + p.stands.length, 0)).toBe(500);
    project.pages.forEach((p, i) => {
      expect(p.name).toBe(raw.project.pages[i].name);
      expect(p.areas).toEqual(raw.project.pages[i].areas);
      // alle bisherigen Felder unverändert, die neuen Felder (M4, M5) ergänzt
      expect(p.stands).toEqual(raw.project.pages[i].stands.map((s: object) => ({ ...s, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false })));
    });
  });
});

describe('Migration 2 → 3 (M5: Nummerierung)', () => {
  it('ergänzt Stellenzahl, warnDuplicateNr und suppressDuplicateWarning, ohne vorhandene Werte zu überschreiben', () => {
    const v2 = {
      id: 'p',
      settings: { numbering: { scope: 'global', start: 100 }, warnOverlap: false },
      pages: [{ id: 'a', stands: [{ id: 's1', nr: '7' }, { id: 's2', suppressDuplicateWarning: true }] }],
    };
    const before = structuredClone(v2);
    const v3 = MIGRATIONS[2]!(v2) as any;
    expect(v2).toEqual(before);
    expect(v3.settings).toEqual({ numbering: { scope: 'global', start: 100, digits: 1 }, warnOverlap: false, warnDuplicateNr: true });
    expect(v3.pages[0].stands).toEqual([
      { id: 's1', nr: '7', suppressDuplicateWarning: false },
      { id: 's2', suppressDuplicateWarning: true },
    ]);
    expect((MIGRATIONS[2]!({ id: 'x', settings: 'kaputt', pages: 'kaputt' }) as any).settings).toBe('kaputt');
  });

  it('echte Datei aus M4 (Version 2, tests/fixtures/format-v2-m4.schelme) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v2-m4.schelme')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(2);
    expect(raw.project.settings.numbering).not.toHaveProperty('digits');
    expect(raw.project.settings).not.toHaveProperty('warnDuplicateNr');
    expect(raw.project.pages[0].stands[0]).not.toHaveProperty('suppressDuplicateWarning');

    const project = withoutV8(decodeProjectFile(bytes).project);
    expect(project.settings.numbering).toEqual({ ...raw.project.settings.numbering, digits: 1 });
    expect(project.settings.warnDuplicateNr).toBe(true);
    expect(project.settings.warnOverlap).toBe(raw.project.settings.warnOverlap ?? true);
    expect(project.categories).toEqual(raw.project.categories);
    expect(project.pages.reduce((n, p) => n + p.stands.length, 0)).toBe(500);
    project.pages.forEach((p, i) => {
      const rp = raw.project.pages[i];
      expect(p.name).toBe(rp.name);
      expect(p.prefix).toBe(rp.prefix);
      expect(p.numberingMode).toBe(rp.numberingMode);
      expect(p.powerLimitKw).toBe(rp.powerLimitKw);
      expect(p.areas).toEqual(rp.areas);
      expect(p.stands).toEqual(rp.stands.map((s: object) => ({ ...s, suppressDuplicateWarning: false, suppressInfraWarning: false })));
    });
  });
});

describe('Migration 3 → 4 (M7: Infrastruktur, Blatt, Schriftfeld, Legende)', () => {
  it('ergänzt Warnungen und Felder, benennt Infrastruktur-Felder um, entfernt alte Typen und titleBlockPos', () => {
    const v3 = {
      id: 'p',
      settings: { warnOverlap: false, minPassageWidth: 4 },
      infraTypes: [{ type: 'toilet', label: 'Toilette', color: '#3a86c8', icon: 'wc', occupiesArea: true }],
      pages: [
        {
          id: 'a',
          titleBlockPos: { x: 3, y: 4 },
          stands: [{ id: 's1' }, { id: 's2', suppressInfraWarning: true }],
          infra: [{ id: 'i1', type: 'marker', text: 'Treffpunkt', cx: 1, cy: 2, w: 0, d: 0, rot: 0 }],
        },
      ],
    };
    const before = structuredClone(v3);
    const v4 = MIGRATIONS[3]!(v3) as any;
    expect(v3).toEqual(before);
    expect(v4).not.toHaveProperty('infraTypes');
    expect(v4.settings).toEqual({ warnOverlap: false, warnInfra: true, warnPassageWidth: true, minPassageWidth: 4 });
    expect(v4.pages[0]).not.toHaveProperty('titleBlockPos');
    expect(v4.pages[0].stands).toEqual([
      { id: 's1', suppressInfraWarning: false },
      { id: 's2', suppressInfraWarning: true },
    ]);
    expect(v4.pages[0].infra).toEqual([{ id: 'i1', typeId: 'marker', label: 'Treffpunkt', cx: 1, cy: 2, w: 0, d: 0, rot: 0 }]);
    expect((MIGRATIONS[3]!({ id: 'x', settings: 'kaputt', pages: 'kaputt' }) as any).pages).toBe('kaputt');

    // Laden ergänzt Standards: feste Typen, Blatt, Anker; das migrierte Objekt bleibt erhalten
    const project = parseProjectFile({ format: 'schelmeplaner', schemaVersion: 3, project: v3 });
    expect(project.infraTypes.map((t) => t.id)).toEqual(['barrierMobile', 'barrierFixed', 'medical', 'ambulance', 'toilet', 'waste', 'narrowPassage', 'marker']);
    expect(project.pages[0]!.infra).toEqual([
      { id: 'i1', typeId: 'marker', label: 'Treffpunkt', note: '', powerKw: 0, connection: null, suppressWidthWarning: false, cx: 1, cy: 2, w: 0, d: 0, rot: 0 },
    ]);
    expect(project.pages[0]!.sheet).toEqual({ format: 'A3', orientation: 'landscape', scale: null, cx: 0, cy: 0 });
    expect(project.pages[0]!.titleBlock).toEqual({ visible: true, corner: 'br', dx: 10, dy: 10 });
    expect(project.pages[0]!.legend).toEqual({ visible: true, corner: 'bl', dx: 10, dy: 10 });
    expect(project.pages[0]!.layers.sheet).toEqual({ visible: true, locked: false });
  });

  it('echte Datei aus M6 (Version 3, tests/fixtures/format-v3-m6.schelme) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v3-m6.schelme')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(3);
    expect(raw.project.settings).not.toHaveProperty('warnInfra');
    expect(raw.project.pages[0]).toHaveProperty('titleBlockPos');
    expect(raw.project.infraTypes[0]).toHaveProperty('type');

    const project = withoutV8(decodeProjectFile(bytes).project);
    // snapGap, defaultStandColor: spätere Migration 5 → 6
    const { warnInfra, warnPassageWidth, minPassageWidth, snapGap: _g, defaultStandColor: _c, ...settings } = project.settings;
    expect(settings).toEqual(raw.project.settings);
    expect([warnInfra, warnPassageWidth, minPassageWidth]).toEqual([true, true, 3.5]);
    expect(project.categories).toEqual(raw.project.categories);
    expect(project.titleBlock).toEqual(raw.project.titleBlock);
    expect(project.infraTypes.every((t) => t.builtin)).toBe(true);
    expect(project.pages.reduce((n, p) => n + p.stands.length, 0)).toBe(500);
    project.pages.forEach((p, i) => {
      const rp = raw.project.pages[i];
      // hiddenFree: spätere Migration 6 → 7
      const { infra, sheet, titleBlock, legend, layers, stands, scaleBar: _sb, northArrow: _na, hiddenFree: _hf, ...rest } = p;
      const { titleBlockPos: _pos, layers: rawLayers, stands: rawStands, infra: rawInfra, ...rawRest } = rp;
      expect(rest).toEqual(rawRest);
      expect(layers).toEqual({ ...rawLayers, sheet: { visible: true, locked: false } });
      expect(stands).toEqual(rawStands.map((s: object) => ({ ...s, suppressInfraWarning: false })));
      expect(infra).toEqual(rawInfra);
      expect(sheet.scale).toBeNull();
      expect([titleBlock.corner, legend.corner]).toEqual(['br', 'bl']);
    });
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.pages[0]!.powerLimitKw).toBe(100);
    expect(project.pages[0]!.stands[0]!.nr).toBe('A-07');
    expect(project.pages[1]!.clockwise).toEqual({ center: { x: 50, y: 40 }, startAngle: 90 });
  });
});

describe('Migration 4 → 5 (M8: Maßstabsbalken, Nordpfeil, Export-Profile pro Rechner)', () => {
  it('ergänzt die Anker, behält vorhandene und entfernt exportProfiles', () => {
    const v4 = {
      id: 'p',
      exportProfiles: [{ id: 'x', name: 'alt', layers: [], hiddenFields: ['owner'] }],
      pages: [{ id: 'a' }, { id: 'b', scaleBar: { visible: false, corner: 'br', dx: 5, dy: 6 } }],
    };
    const before = structuredClone(v4);
    const v5 = MIGRATIONS[4]!(v4) as any;
    expect(v4).toEqual(before);
    expect(v5).not.toHaveProperty('exportProfiles');
    expect(v5.pages[0].scaleBar).toEqual({ visible: true, corner: 'tl', dx: 10, dy: 10 });
    expect(v5.pages[0].northArrow).toEqual({ visible: true, corner: 'tr', dx: 10, dy: 10 });
    expect(v5.pages[1].scaleBar).toEqual({ visible: false, corner: 'br', dx: 5, dy: 6 });
    expect((MIGRATIONS[4]!({ id: 'x', pages: 'kaputt' }) as any).pages).toBe('kaputt');
  });

  it('echte Datei aus M7 (Version 4, tests/fixtures/format-v4-m7.schelme) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v4-m7.schelme')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(4);
    expect(raw.project.exportProfiles).toEqual([]);
    expect(raw.project.pages[0]).not.toHaveProperty('scaleBar');

    const project = withoutV8(decodeProjectFile(bytes).project);
    expect(project).not.toHaveProperty('exportProfiles');
    const { exportProfiles: _p, pages: _pages, ...rawRest } = raw.project;
    // snapGap, defaultStandColor: spätere Migration 5 → 6
    const { pages, settings: { snapGap: _g, defaultStandColor: _c, ...settings }, ...rest } = project;
    expect({ ...rest, settings }).toEqual(rawRest);
    pages.forEach((p, i) => {
      // hiddenFree: spätere Migration 6 → 7
      const { scaleBar, northArrow, hiddenFree, ...pageRest } = p;
      expect(pageRest).toEqual(raw.project.pages[i]);
      expect(hiddenFree).toEqual([]);
      expect(scaleBar).toEqual({ visible: true, corner: 'tl', dx: 10, dy: 10 });
      expect(northArrow).toEqual({ visible: true, corner: 'tr', dx: 10, dy: 10 });
    });
    // Werte, die in der Datei gezielt gesetzt waren
    expect(pages[0]!.sheet).toMatchObject({ format: 'A1', orientation: 'landscape', scale: 500 });
    expect(pages[0]!.legend).toEqual({ visible: true, corner: 'tr', dx: 12, dy: 15 });
    expect(pages[0]!.infra).toHaveLength(4);
    expect(pages[0]!.stands[0]!.owner).toBe('Jürgen Müller');
    expect(pages[1]!.titleBlock.visible).toBe(false);
    expect(project.titleBlock).toEqual({ dateText: '12.10.2026', version: '2' });
  });

  it('5 → 6 (M10): Fang-Abstand 0,3 m und bisheriges Grau als Standardfarbe; vorhandene Werte bleiben', () => {
    const v6 = MIGRATIONS[5]!({ id: 'x', settings: { minFreeWidth: 0.5 }, pages: [] }) as any;
    expect(v6.settings).toEqual({ minFreeWidth: 0.5, snapGap: 0.3, defaultStandColor: '#a7adb3' });
    const kept = MIGRATIONS[5]!({ id: 'x', settings: { snapGap: 0, defaultStandColor: '#123456' }, pages: [] }) as any;
    expect(kept.settings).toEqual({ snapGap: 0, defaultStandColor: '#123456' });
    expect((MIGRATIONS[5]!({ id: 'x', settings: 'kaputt' }) as any).settings).toBe('kaputt');
  });

  it('echte Datei aus M8 (Version 5, tests/fixtures/format-v5-m8.schelme) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v5-m8.schelme')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(5);
    expect(raw.project.settings).not.toHaveProperty('snapGap');
    expect(raw.project.settings).not.toHaveProperty('defaultStandColor');

    const project = withoutV8(decodeProjectFile(bytes).project);
    const { settings: rawSettings, pages: rawPages, ...rawRest } = raw.project;
    const { settings, pages, ...rest } = project;
    expect(rest).toEqual(rawRest);
    // hiddenFree: spätere Migration 6 → 7
    expect(pages.map(({ hiddenFree: _hf, ...pg }) => pg)).toEqual(rawPages);
    expect(settings).toEqual({ ...rawSettings, snapGap: 0.3, defaultStandColor: '#a7adb3' });
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 5 (M8)');
    expect(settings.snap.grid).toBe(true);
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('6 → 7 (M11): noch keine ausgeblendete Freifläche; vorhandene Liste bleibt', () => {
    const v7 = MIGRATIONS[6]!({ id: 'x', pages: [{ id: 'p' }, 'kaputt'] }) as any;
    expect(v7.pages).toEqual([{ id: 'p', hiddenFree: [] }, 'kaputt']);
    const kept = MIGRATIONS[6]!({ id: 'x', pages: [{ id: 'p', hiddenFree: [{ key: 'a|^|$', start: 0, end: 5 }] }] }) as any;
    expect(kept.pages[0].hiddenFree).toHaveLength(1);
  });

  it('echte Datei aus M10 (Version 6, tests/fixtures/format-v6-m10.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v6-m10.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(6);
    expect(raw.project.pages[0]).not.toHaveProperty('hiddenFree');

    const project = withoutV8(decodeProjectFile(bytes).project);
    const { pages: rawPages, ...rawRest } = raw.project;
    const { pages, ...rest } = project;
    expect(rest).toEqual(rawRest);
    expect(pages.map(({ hiddenFree: _hf, ...pg }) => pg)).toEqual(rawPages);
    expect(pages.every((p) => p.hiddenFree.length === 0)).toBe(true);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 6 (M10)');
    expect(project.settings).toMatchObject({ snapGap: 0.5, defaultStandColor: '#8a6d3b' });
    expect(pages.flatMap((p) => p.stands)).toHaveLength(500);
  });
});

describe('Migration 7 → 8 (M12: Geschäftsformen)', () => {
  it('7 → 8: Stände werden Rechtecke ohne Vorlage, keine Formvorlagen; vorhandene Werte bleiben', () => {
    const v8 = MIGRATIONS[7]!({ id: 'x', pages: [{ id: 'p', stands: [{ id: 's' }, 'kaputt'] }, 'kaputt'] }) as any;
    expect(v8.shapeTemplates).toEqual([]);
    expect(v8.pages).toEqual([{ id: 'p', stands: [{ id: 's', shape: 'rect', shapeTemplateId: null }, 'kaputt'] }, 'kaputt']);
    const kept = MIGRATIONS[7]!({ id: 'x', shapeTemplates: [{ id: 't' }], pages: [{ id: 'p', stands: [{ id: 's', shape: 'ellipse' }] }] }) as any;
    expect(kept.shapeTemplates).toEqual([{ id: 't' }]);
    expect(kept.pages[0].stands[0].shape).toBe('ellipse');
  });

  it('echte Datei aus M11 (Version 7, tests/fixtures/format-v7-m11.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v7-m11.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(7);
    expect(raw.project).not.toHaveProperty('shapeTemplates');
    expect(raw.project.pages[0].stands[0]).not.toHaveProperty('shape');

    const project = withoutV8(decodeProjectFile(bytes).project);
    expect(project).toEqual(raw.project);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 7 (M11)');
    expect(project.pages[0]!.hiddenFree).toEqual([{ key: 'obermarkt-a1|^|obermarkt-s1-r1', start: 0, end: 0.5 }]);
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Formvorlagen: unbrauchbare Teile und Vorlagen entfallen, unbekannte Vorlage am Stand wird null', () => {
    const file = {
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: {
        id: 'x',
        shapeTemplates: [
          { id: 't1', name: 'Karussell', w: 8, d: 6, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 1 }, { kind: 'stern', x: 0, y: 0, w: 1, h: 1 }, { kind: 'rect', x: 0, y: 0, w: 0, h: 1 }] },
          { id: 't2', name: 'leer', w: 3, d: 3, parts: [] },
          { id: 't1', name: 'doppelt', w: 3, d: 3, parts: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
          { id: 't3', name: 'ohne Maß', w: 0, d: 3, parts: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
        ],
        pages: [{ id: 'p', stands: [
          { id: 'a', cx: 0, cy: 0, w: 3, d: 3, shape: 'ellipse', shapeTemplateId: 't1' },
          { id: 'b', cx: 5, cy: 0, w: 3, d: 3, shape: 'dreieck', shapeTemplateId: 't2' },
        ] }],
      },
    };
    const p = parseProjectFile(file);
    expect(p.shapeTemplates).toEqual([{ id: 't1', name: 'Karussell', w: 8, d: 6, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 1 }] }]);
    expect(p.pages[0]!.stands.map((s) => [s.shape, s.shapeTemplateId])).toEqual([['ellipse', 't1'], ['rect', null]]);
  });
});
