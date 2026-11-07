import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeProjectFile, encodeProjectFile } from '../fileFormat';
import { CURRENT_SCHEMA_VERSION, migrate, MIGRATIONS } from './migrations';
import { parseProjectFile, ProjectFileError } from './schema';
import { PAPER_FORMATS, type Project } from './types';

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
 * Felder aus Formatversion 9 (#3) prüfen und entfernen, danach die aus Version 8: Nach der Migration hat keine Kategorie
 * einen Mindestabstand, kein Stand ignoriert die Warnung „Abstand“, und die Warnung ist eingeschaltet.
 */
function withoutV9(project: Project): Project {
  const { warnDistance, ...settings } = project.settings;
  expect(warnDistance).toBe(true);
  return withoutV8({
    ...project,
    settings,
    categories: project.categories.map(({ minDistance, ...c }) => {
      expect(minDistance).toBeNull();
      return c;
    }),
    pages: project.pages.map((pg) => ({
      ...pg,
      stands: pg.stands.map(({ suppressDistanceWarning, ...st }) => {
        expect(suppressDistanceWarning).toBe(false);
        return st;
      }),
    })),
  } as unknown as Project);
}

/** Feld aus Formatversion 11 (#9) prüfen und entfernen: Nach der Migration ist keine Beschriftung von Hand verschoben. */
function withoutLabelOffset(project: Project): Project {
  return {
    ...project,
    pages: project.pages.map((pg) => ({
      ...pg,
      stands: pg.stands.map(({ labelOffset, ...st }) => {
        expect(labelOffset).toBeNull();
        return st;
      }),
    })),
  } as unknown as Project;
}

/**
 * Felder aus Formatversion 14 (#13) prüfen und entfernen: Nach der Migration bleibt jedes Blatt DIN, Rand automatisch,
 * Zielbreite 841 mm, kein Ausschnitt.
 */
function withoutFreeSheet(project: Project): Project {
  return {
    ...project,
    pages: project.pages.map((pg) => {
      const { margin, targetWidth, region, ...sheet } = pg.sheet;
      expect({ margin, targetWidth, region }).toEqual({ margin: null, targetWidth: 841, region: null });
      expect(PAPER_FORMATS).toContain(sheet.format);
      return { ...pg, sheet };
    }),
  } as unknown as Project;
}

/**
 * Felder aus Formatversion 10 (#5) prüfen und entfernen, danach die aus Version 9: Nach der Migration ist kein Preis
 * festgelegt, MwSt-Satz 19 %, Meter exakt.
 */
function withoutV10(project: Project): Project {
  const { pricing, ...settings } = project.settings;
  expect(pricing).toEqual({ perMeter: null, roundUpMeters: false, vatRate: 19 });
  return withoutV9({
    ...project,
    settings,
    categories: project.categories.map(({ price, ...c }) => {
      expect(price).toBeNull();
      return c;
    }),
  } as unknown as Project);
}

/**
 * Felder aus Formatversion 15 (#16) prüfen und entfernen, damit die Tests älterer Migrationen ihre Version vergleichen:
 * Nach der Migration hat kein Stand eine eigene Form oder Frontmeter von Hand, keine Vorlage belegt wie gezeichnet und
 * kein Teil ist gedreht.
 */
function withoutCompound(project: Project): Project {
  return {
    ...project,
    shapeTemplates: project.shapeTemplates.map(({ occupies, parts, ...t }) => {
      expect(occupies).toBe(false);
      return {
        ...t,
        parts: parts.map(({ rot, ...q }) => {
          expect(rot).toBe(0);
          return q;
        }),
      };
    }),
    pages: project.pages.map((pg) => ({
      ...pg,
      stands: pg.stands.map(({ parts, frontOverride, ...st }) => {
        expect({ parts, frontOverride }).toEqual({ parts: null, frontOverride: null });
        return st;
      }),
    })),
  } as unknown as Project;
}

/**
 * Feld aus Formatversion 16 (#15) prüfen und entfernen, damit die Tests älterer Migrationen ihre Version vergleichen:
 * Nach der Migration gibt es keinen Festplatz-Verbund.
 */
function withoutGroups(project: Project): Project {
  expect(project.groups).toEqual([]);
  const { groups: _g, ...rest } = project;
  return rest as unknown as Project;
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
    const project = withoutV10(withoutLabelOffset(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v1-m3.schelme'))).project)))));
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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
    // seit #13 mit Rand, Zielbreite und Ausschnitt; alte Blätter bleiben A3 quer (angepasst vom Entwickler)
    expect(project.pages[0]!.sheet).toEqual({ format: 'A3', orientation: 'landscape', scale: null, cx: 0, cy: 0, margin: null, targetWidth: 841, region: null });
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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

    const project = withoutV10(withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))))));
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
    expect(p.shapeTemplates).toEqual([{ id: 't1', name: 'Karussell', w: 8, d: 6, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 1, rot: 0 }], occupies: false }]);
    expect(p.pages[0]!.stands.map((s) => [s.shape, s.shapeTemplateId])).toEqual([['ellipse', 't1'], ['rect', null]]);
  });
});

describe('Migration 8 → 9 (#3: Abstandsprüfung)', () => {
  it('8 → 9: Kategorien ohne Mindestabstand, Warnung eingeschaltet, kein Stand ignoriert sie; vorhandene Werte bleiben', () => {
    const v8 = { id: 'x', settings: { warnOutside: false }, categories: [{ id: 'c' }, 'kaputt'], pages: [{ id: 'p', stands: [{ id: 's' }, 'kaputt'] }, 'kaputt'] };
    const before = structuredClone(v8);
    const v9 = MIGRATIONS[8]!(v8) as any;
    expect(v8).toEqual(before);
    expect(v9.settings).toEqual({ warnOutside: false, warnDistance: true });
    expect(v9.categories).toEqual([{ id: 'c', minDistance: null }, 'kaputt']);
    expect(v9.pages).toEqual([{ id: 'p', stands: [{ id: 's', suppressDistanceWarning: false }, 'kaputt'] }, 'kaputt']);
    const kept = MIGRATIONS[8]!({ id: 'x', settings: { warnDistance: false }, categories: [{ id: 'c', minDistance: 5 }], pages: [] }) as any;
    expect(kept.settings.warnDistance).toBe(false);
    expect(kept.categories[0].minDistance).toBe(5);
  });

  it('echte Datei aus M12 (Version 8, tests/fixtures/format-v8-m12.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v8-m12.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(8);
    expect(raw.project.categories[0]).not.toHaveProperty('minDistance');
    expect(raw.project.pages[0].stands[0]).not.toHaveProperty('suppressDistanceWarning');
    expect(raw.project.settings).not.toHaveProperty('warnDistance');

    const { settings: { pricing: _p, ...v9Settings }, categories: v10Categories, ...v10Rest } = withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project)))));
    const project = { ...v10Rest, settings: v9Settings, categories: v10Categories.map(({ price: _price, ...c }) => c) };
    expect(project.settings.warnDistance).toBe(true);
    expect(project.categories.every((c) => c.minDistance === null)).toBe(true);
    const { settings: { warnDistance: _w, ...settings }, categories, pages, ...rest } = project;
    const { settings: rawSettings, categories: rawCategories, pages: rawPages, ...rawRest } = raw.project;
    expect(rest).toEqual(rawRest);
    expect(settings).toEqual(rawSettings);
    expect(categories).toEqual(rawCategories.map((c: object) => ({ ...c, minDistance: null })));
    expect(pages).toEqual(rawPages.map((pg: any) => ({ ...pg, stands: pg.stands.map((s: object) => ({ ...s, suppressDistanceWarning: false })) })));
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 8 (M12)');
    expect(pages[0]!.stands[0]!.shape).toBe('ellipse');
    expect(pages[0]!.stands[1]!.shapeTemplateId).toBe('tpl-karussell');
    expect(pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Mindestabstand: auf 0,1–1000 m begrenzt und auf 0,01 m gerundet; 0, negativ oder kein Wert = keine Prüfung', () => {
    const file = (minDistance: unknown) => ({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', pages: [], categories: [{ id: 'c', name: 'A', color: '#aabbcc', minDistance }] },
    });
    const md = (v: unknown) => parseProjectFile(file(v)).categories[0]!.minDistance;
    expect(md(50)).toBe(50);
    expect(md(12.345)).toBe(12.35);
    expect(md(0.01)).toBe(0.1);
    expect(md(5000)).toBe(1000);
    expect([md(0), md(-3), md(null), md('50'), md(undefined), md(Number.NaN)]).toEqual([null, null, null, null, null, null]);
  });
});

describe('Migration 9 → 10 (#5: Standgeld)', () => {
  it('ergänzt Preise ohne Wert, MwSt-Satz 19 %, Meter exakt; vorhandene Werte bleiben', () => {
    const v10 = MIGRATIONS[9]!({ id: 'x', settings: { warnOutside: false }, categories: [{ id: 'c' }, 'kaputt'], pages: [] }) as any;
    expect(v10.settings).toEqual({ warnOutside: false, pricing: { perMeter: null, roundUpMeters: false, vatRate: 19 } });
    expect(v10.categories).toEqual([{ id: 'c', price: null }, 'kaputt']);
    const kept = MIGRATIONS[9]!({ id: 'x', settings: { pricing: { perMeter: 20 } }, categories: [{ id: 'c', price: { kind: 'flat', amount: 50 } }] }) as any;
    expect(kept.settings.pricing).toEqual({ perMeter: 20 });
    expect(kept.categories[0].price).toEqual({ kind: 'flat', amount: 50 });
  });

  it('echte Datei aus #3 (Version 9, tests/fixtures/format-v9-abstand.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v9-abstand.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(9);
    expect(raw.project.settings).not.toHaveProperty('pricing');
    expect(raw.project.categories[0]).not.toHaveProperty('price');

    const project = withoutLabelOffset(withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project)))));
    expect(project.settings.pricing).toEqual({ perMeter: null, roundUpMeters: false, vatRate: 19 });
    const { settings: { pricing: _p, ...settings }, categories, ...rest } = project;
    const { settings: rawSettings, categories: rawCategories, ...rawRest } = raw.project;
    expect(rest).toEqual(rawRest);
    expect(settings).toEqual(rawSettings);
    expect(categories).toEqual(rawCategories.map((c: object) => ({ ...c, price: null })));
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 9 (#3)');
    expect(categories[0]!.minDistance).toBe(25);
    expect(project.pages[0]!.stands[0]!.suppressDistanceWarning).toBe(true);
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Preise: 0–1.000.000 € auf Cent gerundet, MwSt-Satz 0–100 %; Ungültiges = kein Preis bzw. 19 %', () => {
    const file = (pricing: unknown, price: unknown) => ({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', pages: [], settings: { pricing }, categories: [{ id: 'c', name: 'A', color: '#aabbcc', price }] },
    });
    const pr = (v: unknown) => parseProjectFile(file(v, null)).settings.pricing;
    expect(pr({ perMeter: 12.345, roundUpMeters: true, vatRate: 7 })).toEqual({ perMeter: 12.35, roundUpMeters: true, vatRate: 7 });
    expect(pr({ perMeter: 0, vatRate: 0 })).toEqual({ perMeter: 0, roundUpMeters: false, vatRate: 0 });
    expect(pr({ perMeter: -1, vatRate: 250 })).toEqual({ perMeter: null, roundUpMeters: false, vatRate: 100 });
    expect(pr('kaputt')).toEqual({ perMeter: null, roundUpMeters: false, vatRate: 19 });
    expect(pr({ perMeter: 5e9 }).perMeter).toBe(1_000_000);
    const cp = (v: unknown) => parseProjectFile(file(null, v)).categories[0]!.price;
    expect(cp({ kind: 'flat', amount: 500 })).toEqual({ kind: 'flat', amount: 500 });
    expect(cp({ kind: 'perMeter', amount: 30.004 })).toEqual({ kind: 'perMeter', amount: 30 });
    expect([cp({ kind: 'flat' }), cp({ kind: 'sonst', amount: 5 }), cp({ kind: 'flat', amount: -5 }), cp(null), cp(undefined)]).toEqual([null, null, null, null, null]);
  });
});

describe('Migration 10 → 11 (#9: Beschriftung)', () => {
  it('ergänzt labelOffset = null; vorhandene Werte bleiben; Ungültiges wird null, Werte begrenzt und gerundet', () => {
    const v11 = MIGRATIONS[10]!({ id: 'x', pages: [{ id: 'p', stands: [{ id: 's' }, { id: 't', labelOffset: { x: 1, y: 2 } }, 'kaputt'] }, 'kaputt'] }) as any;
    expect(v11.pages[0].stands).toEqual([{ id: 's', labelOffset: null }, { id: 't', labelOffset: { x: 1, y: 2 } }, 'kaputt']);
    const file = (labelOffset: unknown) => ({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', pages: [{ id: 'p', name: 'P', stands: [{ id: 's', cx: 0, cy: 0, w: 4, d: 3, rot: 0, labelOffset }] }] },
    });
    const lo = (v: unknown) => parseProjectFile(file(v)).pages[0]!.stands[0]!.labelOffset;
    expect(lo({ x: 1.234, y: -5 })).toEqual({ x: 1.23, y: -5 });
    expect(lo({ x: 5000, y: 0 })).toEqual({ x: 1000, y: 0 });
    expect([lo(null), lo({ x: 1 }), lo({ x: 'a', y: 1 }), lo({ x: Number.NaN, y: 1 }), lo(undefined)]).toEqual([null, null, null, null, null]);
  });

  it('echte Datei aus #5 (Version 10, tests/fixtures/format-v10-standgeld.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v10-standgeld.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(10);
    expect(raw.project.pages[0].stands[0]).not.toHaveProperty('labelOffset');

    const project = withoutUseAreas(withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project))));
    const { pages, ...rest } = withoutLabelOffset(project);
    const { pages: rawPages, ...rawRest } = raw.project;
    expect(rest).toEqual(rawRest);
    expect(pages).toEqual(rawPages);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 10 (#5)');
    expect(project.settings.pricing).toEqual({ perMeter: 25, roundUpMeters: true, vatRate: 7 });
    expect(project.categories[4]!.price).toEqual({ kind: 'flat', amount: 500 });
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });
});

/**
 * Feld aus Formatversion 12 (#17) prüfen und entfernen, damit die Tests älterer Migrationen ihre Version vergleichen:
 * Nach der Migration verwendet jede Page Grundflächen.
 */
function withoutUseAreas(project: Project): Project {
  return {
    ...project,
    pages: project.pages.map(({ useAreas, ...pg }) => {
      expect(useAreas).toBe(true);
      return pg;
    }),
  } as unknown as Project;
}

describe('Migration 11 → 12 (#17: ohne Grundflächen)', () => {
  it('ergänzt useAreas = true, auch ohne Grundflächen; vorhandene Werte bleiben; Ungültiges wird true', () => {
    const v12 = MIGRATIONS[11]!({ id: 'x', pages: [{ id: 'p', areas: [] }, { id: 'q', useAreas: false }, 'kaputt'] }) as any;
    expect(v12.pages).toEqual([{ id: 'p', areas: [], useAreas: true }, { id: 'q', useAreas: false }, 'kaputt']);
    const file = (useAreas: unknown) => ({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', pages: [{ id: 'p', name: 'P', useAreas, areas: [{ id: 'a', cx: 0, cy: 0, w: 20, d: 8, rot: 0 }] }] },
    });
    const ua = (v: unknown) => parseProjectFile(file(v)).pages[0]!;
    expect(ua(false).useAreas).toBe(false);
    // Ausgeschaltet bleiben die Grundflächen gespeichert
    expect(ua(false).areas).toHaveLength(1);
    expect([ua(true), ua(undefined), ua('nein'), ua(0)].map((p) => p.useAreas)).toEqual([true, true, true, true]);
  });

  it('echte Datei aus #9 (Version 11, tests/fixtures/format-v11-beschriftung.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v11-beschriftung.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(11);
    expect(raw.project.pages[0]).not.toHaveProperty('useAreas');

    const project = withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project)));
    expect(project.pages.map((p) => p.useAreas)).toEqual([true, true, true, true]);
    expect(withoutUseAreas(project)).toEqual(raw.project);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 11 (#9)');
    const ober = project.pages.find((p) => p.name === 'Obermarkt')!;
    expect(ober.areas[0]!.name).toBe('Brunnenseite');
    expect(ober.stands[0]!.labelOffset).toEqual({ x: 2.5, y: -4 });
    // Page ohne eine einzige Grundfläche: verwendet nach der Migration trotzdem Grundflächen (nichts ändert sich)
    expect(project.pages.find((p) => p.name === 'Schifftor')!.areas).toEqual([]);
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });
});

describe('Migration 12 → 13 (#12: Nummerierung in weiteren Richtungen)', () => {
  it('12 → 13: nichts zu ergänzen; Eingabe unverändert, bisherige Modi behalten ihre Bedeutung', () => {
    const v12 = { id: 'x', pages: [{ id: 'p', numberingMode: 'frontLtr', useAreas: true }, { id: 'q', numberingMode: 'clockwise', clockwise: { center: { x: 1, y: 2 }, startAngle: 90 } }, 'kaputt'] };
    const before = JSON.stringify(v12);
    const v13 = MIGRATIONS[12]!(v12);
    expect(v13).toEqual(v12);
    expect(v13).not.toBe(v12);
    expect(JSON.stringify(v12)).toBe(before);
  });

  it('echte Datei aus #17 (Version 12, tests/fixtures/format-v12-ohne-grundflaechen.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v12-ohne-grundflaechen.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(12);
    expect(raw.project.pages.map((p: { numberingMode: string }) => p.numberingMode)).toEqual(['frontLtr', 'clockwise', 'clockwise', 'manual']);
    for (const p of raw.project.pages) expect(p).not.toHaveProperty('direction');

    // Version 13 ergänzt nichts: Nach dem Lesen ist das Projekt gleich dem Inhalt der Datei (ohne die Felder aus 14)
    const project = withoutFreeSheet(withoutCompound(withoutGroups(decodeProjectFile(bytes).project)));
    expect(project).toEqual(raw.project);
    // Werte, die in der Datei gezielt gesetzt waren; die bisherigen Modi behalten ihre Bedeutung
    expect(project.name).toBe('Formatversion 12 (#17)');
    expect(project.pages.map((p) => p.name)).toEqual(['Obermarkt', 'Untermarkt', 'Am Ziegelturm', 'Schifftor']);
    expect(project.pages[1]).toMatchObject({ numberingMode: 'clockwise', clockwise: { center: { x: 50, y: 40 }, startAngle: 90 } });
    // Am Ziegelturm: Uhrzeigersinn ohne gesetzten Mittelpunkt, Grundflächen ausgeschaltet (aber gespeichert)
    expect(project.pages[2]).toMatchObject({ numberingMode: 'clockwise', useAreas: false });
    expect(project.pages[2]!.clockwise).toBeUndefined();
    expect(project.pages[2]!.areas).toHaveLength(6);
    expect(project.pages[3]!.numberingMode).toBe('manual');
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Lesen: alte und neue Modi, eigene Richtung auf 0,01 m gerundet; Unbrauchbares entfällt, A = B bleibt', () => {
    const file = (version: number, pg: Record<string, unknown>) => ({
      format: 'schelmeplaner',
      schemaVersion: version,
      project: { id: 'x', pages: [{ id: 'p', name: 'P', ...pg }] },
    });
    const read = (pg: Record<string, unknown>, version = CURRENT_SCHEMA_VERSION) => parseProjectFile(file(version, pg)).pages[0]!;
    // Version 12: `frontLtr`, `clockwise` und `manual` bleiben gültig, eine Richtung gibt es noch nicht
    expect(read({ numberingMode: 'frontLtr' }, 12).numberingMode).toBe('frontLtr');
    expect(read({ numberingMode: 'clockwise', clockwise: { center: { x: 1, y: 2 }, startAngle: 90 } }, 12)).toMatchObject({ numberingMode: 'clockwise', clockwise: { center: { x: 1, y: 2 }, startAngle: 90 } });
    expect(read({ numberingMode: 'manual' }, 12).numberingMode).toBe('manual');
    expect(read({}, 12)).not.toHaveProperty('direction');
    // neue Modi; Unbekanntes wird „links → rechts“
    for (const m of ['rightToLeft', 'topToBottom', 'bottomToTop', 'direction', 'counterClockwise'] as const) expect(read({ numberingMode: m }).numberingMode).toBe(m);
    expect(read({ numberingMode: 'kreuz und quer' }).numberingMode).toBe('frontLtr');
    // eigene Richtung
    expect(read({ numberingMode: 'direction', direction: { from: { x: 1.234, y: -5 }, to: { x: 20, y: 3.456 } } }).direction).toEqual({ from: { x: 1.23, y: -5 }, to: { x: 20, y: 3.46 } });
    expect(read({ direction: { from: { x: 4, y: 4 }, to: { x: 4, y: 4 } } }).direction).toEqual({ from: { x: 4, y: 4 }, to: { x: 4, y: 4 } });
    for (const direction of [null, 'a', { from: { x: 1, y: 2 } }, { from: { x: 1, y: 2 }, to: { x: 'a', y: 1 } }, { from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 } }]) {
      expect(read({ direction })).not.toHaveProperty('direction');
    }
  });

  it('Speichern und Laden behält Modus und eigene Richtung', () => {
    const project = parseProjectFile({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', pages: [{ id: 'p', name: 'P', numberingMode: 'direction', direction: { from: { x: 0, y: 0 }, to: { x: 17.32, y: 10 } } }] },
    });
    const again = decodeProjectFile(encodeProjectFile({ project, assets: {} })).project;
    expect(again.pages[0]).toMatchObject({ numberingMode: 'direction', direction: { from: { x: 0, y: 0 }, to: { x: 17.32, y: 10 } } });
  });
});

describe('Migration 13 → 14 (#13: Blatt ohne festes Papierformat)', () => {
  it('bestehende Blätter bleiben DIN; ohne Format gilt der alte Standard A3 quer; vorhandene Werte bleiben', () => {
    const v13 = {
      id: 'x',
      pages: [
        { id: 'a', sheet: { format: 'A1', orientation: 'portrait', scale: 500, cx: 3, cy: 4 } },
        { id: 'b' },
        { id: 'c', sheet: { format: 'plan', margin: 20, targetWidth: 1000, region: { cx: 1, cy: 2, w: 3, h: 4 } } },
        'kaputt',
        { id: 'd', sheet: { format: 'A5', orientation: 'portrait', scale: 250 } },
      ],
    };
    const before = structuredClone(v13);
    const v14 = MIGRATIONS[13]!(v13) as any;
    expect(v13).toEqual(before);
    expect(v14.pages[0].sheet).toEqual({ format: 'A1', orientation: 'portrait', scale: 500, cx: 3, cy: 4, margin: null, targetWidth: 841, region: null });
    expect(v14.pages[1].sheet).toEqual({ format: 'A3', orientation: 'landscape', scale: null, cx: 0, cy: 0, margin: null, targetWidth: 841, region: null });
    // Vor Version 14 gab es nur DIN: Ein anderes Format wird wie vor #13 zu A3 (nicht zum neuen Standard „Plan“; vom Tester)
    expect(v14.pages[2].sheet).toMatchObject({ format: 'A3', margin: 20, targetWidth: 1000, region: { cx: 1, cy: 2, w: 3, h: 4 } });
    expect(v14.pages[3]).toBe('kaputt');
    expect(v14.pages[4].sheet).toEqual({ format: 'A3', orientation: 'portrait', scale: 250, cx: 0, cy: 0, margin: null, targetWidth: 841, region: null });
    const loaded = parseProjectFile({ format: 'schelmeplaner', schemaVersion: 13, project: { id: 'x', pages: [{ id: 'p', name: 'P', sheet: { format: 'A5', orientation: 'portrait', scale: 250, cx: 1, cy: 2 } }] } });
    expect(loaded.pages[0]!.sheet).toEqual({ format: 'A3', orientation: 'portrait', scale: 250, cx: 1, cy: 2, margin: null, targetWidth: 841, region: null });
    expect((MIGRATIONS[13]!({ id: 'x', pages: 'kaputt' }) as any).pages).toBe('kaputt');
  });

  it('echte Datei aus #12 (Version 13, tests/fixtures/format-v13-nummerierung.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v13-nummerierung.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(13);
    for (const p of raw.project.pages) for (const k of ['margin', 'targetWidth', 'region']) expect(p.sheet).not.toHaveProperty(k);

    const project = withoutCompound(withoutGroups(decodeProjectFile(bytes).project));
    // Blätter bleiben DIN, wie sie in der Datei standen; die neuen Felder sind ergänzt
    expect(project.pages.map((p) => p.sheet)).toEqual(raw.project.pages.map((p: { sheet: object }) => ({ ...p.sheet, margin: null, targetWidth: 841, region: null })));
    // alles andere unverändert
    expect(withoutFreeSheet(project)).toEqual(raw.project);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 13 (#12)');
    expect(project.pages[0]!.sheet).toMatchObject({ format: 'A1', orientation: 'landscape', scale: 500, cx: 85, cy: 40 });
    expect(project.pages[1]!.sheet).toMatchObject({ format: 'A2', orientation: 'portrait', scale: null });
    expect(project.pages[2]!.useAreas).toBe(false);
    expect(project.pages[2]!.areas).toHaveLength(6);
    expect(project.pages[3]).toMatchObject({ numberingMode: 'direction', direction: { from: { x: 10, y: 5 }, to: { x: 150, y: 45 } } });
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Laden: Format, Rand, Zielbreite und Ausschnitt geprüft, begrenzt und gerundet; Ungültiges = Standard', () => {
    const file = (sheet: unknown) => ({ format: 'schelmeplaner', schemaVersion: CURRENT_SCHEMA_VERSION, project: { id: 'x', pages: [{ id: 'p', name: 'P', sheet }] } });
    const sh = (v: unknown) => parseProjectFile(file(v)).pages[0]!.sheet;
    expect(sh({ format: 'region', margin: 12.4, targetWidth: 1000.6, region: { cx: 1.234, cy: -2, w: 50.006, h: 0.2 } })).toMatchObject({
      format: 'region',
      margin: 12,
      targetWidth: 1001,
      region: { cx: 1.23, cy: -2, w: 50.01, h: 1 },
    });
    expect(sh({ format: 'plan', margin: 2, targetWidth: 50 })).toMatchObject({ margin: 10, targetWidth: 100 });
    expect(sh({ format: 'plan', margin: 9999, targetWidth: 1e9 })).toMatchObject({ margin: 500, targetWidth: 20000 });
    expect(sh({ format: 'A5', margin: 'x', targetWidth: null, region: { cx: 0, cy: 0, w: -1, h: 3 } })).toMatchObject({ format: 'plan', margin: null, targetWidth: 841, region: null });
    expect(sh(undefined)).toEqual({ format: 'plan', orientation: 'landscape', scale: null, cx: 0, cy: 0, margin: null, targetWidth: 841, region: null });
  });
});

describe('Migration 14 → 15 (#16: zusammengesetzte Form)', () => {
  it('14 → 15: keine eigene Form, keine Frontmeter von Hand, Vorlagen belegen nicht, Teile ungedreht; vorhandene Werte bleiben', () => {
    const v14 = {
      id: 'x',
      shapeTemplates: [{ id: 't', parts: [{ kind: 'rect' }, { kind: 'ellipse', rot: 30 }, 'kaputt'] }, { id: 'u', occupies: true, parts: 'kaputt' }, 'kaputt'],
      pages: [{ id: 'p', stands: [{ id: 's' }, { id: 'r', parts: [], frontOverride: 12 }, 'kaputt'] }, 'kaputt'],
    };
    const before = structuredClone(v14);
    const v15 = MIGRATIONS[14]!(v14) as any;
    expect(v14).toEqual(before);
    expect(v15.shapeTemplates).toEqual([
      { id: 't', occupies: false, parts: [{ kind: 'rect', rot: 0 }, { kind: 'ellipse', rot: 30 }, 'kaputt'] },
      { id: 'u', occupies: true, parts: 'kaputt' },
      'kaputt',
    ]);
    expect(v15.pages).toEqual([{ id: 'p', stands: [{ id: 's', parts: null, frontOverride: null }, { id: 'r', parts: [], frontOverride: 12 }, 'kaputt'] }, 'kaputt']);
    // Ohne Feld `shapeTemplates` wird nichts ergänzt (das macht 7 → 8)
    expect(MIGRATIONS[14]!({ id: 'x', pages: [] })).toEqual({ id: 'x', pages: [] });
  });

  it('echte Datei aus #13 (Version 14, tests/fixtures/format-v14-formen.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v14-formen.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(14);
    expect(raw.project.shapeTemplates[0]).not.toHaveProperty('occupies');
    expect(raw.project.shapeTemplates[0].parts[0]).not.toHaveProperty('rot');
    expect(raw.project.pages[0].stands[0]).not.toHaveProperty('parts');

    const project = withoutGroups(decodeProjectFile(bytes).project);
    // Die Vorlage belegt nicht wie gezeichnet, ihre Teile sind ungedreht; kein Stand hat eine eigene Form
    expect(project.shapeTemplates).toEqual([
      {
        id: 'tpl-ausleger',
        name: 'Ausleger',
        w: 8,
        d: 4,
        occupies: false,
        parts: [
          { kind: 'rect', x: 0.1875, y: 0, w: 0.625, h: 1, rot: 0 },
          { kind: 'rect', x: 0, y: 0.25, w: 1, h: 0.5, rot: 0 },
        ],
      },
    ]);
    expect(project.pages.flatMap((p) => p.stands).every((s) => s.parts === null && s.frontOverride === null)).toBe(true);
    // alles andere unverändert
    expect(withoutCompound(project)).toEqual(raw.project);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 14 (#13)');
    const ober = project.pages[0]!;
    expect(ober.name).toBe('Obermarkt');
    expect(ober.stands[0]).toMatchObject({ shape: 'ellipse', shapeTemplateId: null });
    expect(ober.stands[1]!.shapeTemplateId).toBe('tpl-ausleger');
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Laden: eigene Form (Vorlage entfällt), Drehung je Teil auf 0,1°, Frontmeter begrenzt und gerundet; Unbrauchbares = null', () => {
    const file = (stand: Record<string, unknown>, templates: unknown[] = []) => ({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', shapeTemplates: templates, pages: [{ id: 'p', name: 'P', stands: [{ id: 's', cx: 0, cy: 0, w: 25, d: 12, rot: 0, ...stand }] }] },
    });
    const tpl = { id: 't', name: 'T', w: 2, d: 2, occupies: true, parts: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1, rot: -45.04 }] };
    const st = (stand: Record<string, unknown>, templates?: unknown[]) => parseProjectFile(file(stand, templates)).pages[0]!.stands[0]!;
    const parts = [
      { kind: 'rect', x: 0.1, y: 0, w: 0.8, h: 1, rot: 0 },
      { kind: 'ellipse', x: 0, y: 0.2, w: 0.1, h: 0.58, rot: 370.04 },
      { kind: 'stern', x: 0, y: 0, w: 1, h: 1 },
    ];
    const s = st({ parts, shapeTemplateId: 't', frontOverride: 24.006 }, [tpl]);
    expect(s.parts).toEqual([
      { kind: 'rect', x: 0.1, y: 0, w: 0.8, h: 1, rot: 0 },
      { kind: 'ellipse', x: 0, y: 0.2, w: 0.1, h: 0.58, rot: 10 },
    ]);
    expect(s.shapeTemplateId).toBeNull();
    expect(s.frontOverride).toBe(24.01);
    expect(parseProjectFile(file({}, [tpl])).shapeTemplates[0]).toMatchObject({ occupies: true, parts: [{ rot: 315 }] });
    expect(st({ frontOverride: 5000 }).frontOverride).toBe(1000);
    for (const v of [[], 'a', [{ kind: 'rect', x: 0, y: 0, w: 0, h: 1 }], null, undefined]) expect(st({ parts: v }).parts).toBeNull();
    for (const v of [-1, 'a', null, Number.NaN, undefined]) expect(st({ frontOverride: v }).frontOverride).toBeNull();
    // Speichern und Laden behält alles
    const project = parseProjectFile(file({ parts: parts.slice(0, 2), frontOverride: 24 }));
    expect(decodeProjectFile(encodeProjectFile({ project, assets: {} })).project.pages[0]!.stands[0]).toMatchObject({ parts: s.parts, frontOverride: 24 });
  });
});

describe('Migration 15 → 16 (#15: Festplatz-Verbund)', () => {
  it('15 → 16: noch kein Verbund; vorhandene Werte bleiben, die Eingabe bleibt unverändert', () => {
    const v15 = { id: 'x', pages: [{ id: 'p' }] };
    const before = structuredClone(v15);
    expect(MIGRATIONS[15]!(v15)).toEqual({ id: 'x', groups: [], pages: [{ id: 'p' }] });
    expect(v15).toEqual(before);
    expect((MIGRATIONS[15]!({ id: 'x', pages: [], groups: 'kaputt' }) as any).groups).toBe('kaputt');
  });

  it('echte Datei aus #16 (Version 15, tests/fixtures/format-v15-verbund.mplan) wird vollständig migriert', () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v15-verbund.mplan')));
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(raw.schemaVersion).toBe(15);
    expect(raw.project).not.toHaveProperty('groups');

    const project = decodeProjectFile(bytes).project;
    expect(project.groups).toEqual([]);
    // alles andere unverändert
    expect(withoutGroups(project)).toEqual(raw.project);
    // Werte, die in der Datei gezielt gesetzt waren
    expect(project.name).toBe('Formatversion 15 (#16)');
    const s = project.pages[0]!.stands.find((x) => x.id === 'obermarkt-s1-r1')!;
    expect(s.parts).toEqual([
      { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rot: 0 },
      { kind: 'ellipse', x: 0.25, y: 0.1, w: 0.5, h: 0.4, rot: 30 },
    ]);
    expect(s).toMatchObject({ shapeTemplateId: null, frontOverride: 7.5 });
    expect(project.pages.flatMap((p) => p.stands)).toHaveLength(500);
  });

  it('Laden: Mitglieder nur vorhandene Pages, jede höchstens einmal und in höchstens einem Verbund; Unbrauchbares entfällt', () => {
    const groups = [
      {
        id: 'g1',
        name: '  Unterstadt ',
        pageIds: ['a', 'b', 'a', 'gibt-es-nicht', 7],
        sheet: { format: 'A1', orientation: 'portrait', scale: 1000, cx: 1, cy: 2 },
        titleBlockText: 'Übersicht',
        legend: { visible: false, corner: 'tr', dx: 5, dy: 6 },
        layers: { free: { visible: false, locked: true } },
        view: { scale: 3, tx: 4, ty: 5 },
      },
      // Page b gehört schon zu g1
      { id: 'g2', name: 'Oberstadt', pageIds: ['b', 'c'] },
      // doppelte ID, fehlende ID, kein Objekt
      { id: 'g1', name: 'doppelt', pageIds: ['d'] },
      { name: 'ohne ID', pageIds: ['d'] },
      'kaputt',
      // ohne Mitglieder und ohne Namen: bleibt erhalten
      { id: 'g3', pageIds: 'kaputt' },
    ];
    const project = parseProjectFile({
      format: 'schelmeplaner',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: { id: 'x', pages: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })), groups },
    });
    expect(project.groups.map((g) => [g.id, g.name, g.pageIds])).toEqual([
      ['g1', 'Unterstadt', ['a', 'b']],
      ['g2', 'Oberstadt', ['c']],
      ['g3', 'Verbund', []],
    ]);
    const g1 = project.groups[0]!;
    expect(g1.sheet).toMatchObject({ format: 'A1', orientation: 'portrait', scale: 1000, cx: 1, cy: 2, margin: null, targetWidth: 841, region: null });
    expect(g1.titleBlockText).toBe('Übersicht');
    expect(g1.legend).toEqual({ visible: false, corner: 'tr', dx: 5, dy: 6 });
    expect(g1.titleBlock).toEqual({ visible: true, corner: 'br', dx: 10, dy: 10 });
    expect(g1.layers.free).toEqual({ visible: false, locked: true });
    expect(g1.layers.stands).toEqual({ visible: true, locked: false });
    expect(g1.view).toEqual({ scale: 3, tx: 4, ty: 5 });
    // Vorgaben wie bei einer neuen Page: Blatt „Plan“, keine Ansicht
    expect(project.groups[2]).toMatchObject({ sheet: { format: 'plan', targetWidth: 841 }, titleBlockText: '', view: null });
    // Ohne Feld oder kaputt: keine Verbünde
    expect(parseProjectFile({ format: 'schelmeplaner', schemaVersion: CURRENT_SCHEMA_VERSION, project: { id: 'x', pages: [], groups: 'kaputt' } }).groups).toEqual([]);
    // Speichern und Laden behält alles
    expect(decodeProjectFile(encodeProjectFile({ project, assets: {} })).project.groups).toEqual(project.groups);
  });
});
