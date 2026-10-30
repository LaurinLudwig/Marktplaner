import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { blankedPlaceholders, BUILTIN_PROFILES, exportFileName, loadProfiles, normalizeProfile, profileLayers, redactProject, STAND_FIELDS } from '../exportProfiles';
import { formatLabel } from '../label';
import { createPage, createProject } from '../model/defaults';
import { createStand } from '../objects';
import { pagePaper } from '../paper';
import { fitIntoFreeArea, paperSize, sheetFrame, type PaperRect } from '../sheet';
import { areaPrims, standLabelPrim, standPrim, standPrims, warnKind } from './objects';
import { pageScene } from './page';
import { NORTH_ARROW_SIZE, northArrowPrims, scaleBarLayout } from './paper';
import { PAPER_STYLE } from './paperStyle';
import type { StyleKey } from './prims';

/** Gemeinsame Szene (M8-02), Maßstabsbalken und Nordpfeil (M8-03), Einpassen (M8-04), Profile (M8-07). */

describe('Szene: Stilschlüssel', () => {
  it('jeder Stilschlüssel hat eine Papier-Stilangabe und eine CSS-Regel der Zeichenfläche', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'theme', 'app.css'), 'utf8');
    const keys = Object.keys(PAPER_STYLE) as StyleKey[];
    expect(keys.length).toBeGreaterThan(20);
    // Raster: auf dem Bildschirm in Bildschirmkoordinaten (Canvas.tsx), gleiche Klassen
    const missing = keys.filter((k) => !new RegExp(`\\.${k}\\b`).test(css));
    expect(missing).toEqual([]);
  });
});

describe('Szene: Bausteine', () => {
  it('Grundfläche: Polygon und Vorderseite an Kante 2', () => {
    const [body, front] = areaPrims({ id: 'a', name: '', cx: 0, cy: 0, w: 10, d: 4, rot: 0 });
    expect(body.pts).toHaveLength(4);
    expect([front.a.y, front.b.y]).toEqual([2, 2]);
  });

  it('Stand: Warnvariante und Datenfarbe', () => {
    const s = createStand({ cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    expect(standPrim(s, '#123456', 'overlap')).toMatchObject({ s: 'stand', v: 'warn-overlap', color: '#123456' });
    expect(warnKind({ outside: false, overlap: false, duplicate: false, infra: true, distance: false })).toBe('overlap');
    expect(warnKind({ outside: false, overlap: false, duplicate: true, infra: false, distance: false })).toBe('outside');
    expect(warnKind({ outside: false, overlap: false, duplicate: false, infra: false, distance: true })).toBe('outside');
  });

  it('Beschriftung: gesperrte Platzhalter bleiben leer, ihre Zeilen entfallen', () => {
    const s = { ...createStand({ cx: 0, cy: 0, w: 3, d: 2, rot: 0 }), nr: '7', name: 'Bäcker', owner: 'Müller' };
    expect(formatLabel('{nr}\n{eigentuemer}\n{breite}×{tiefe} m', s, '', new Set(['eigentuemer', 'breite', 'tiefe']))).toEqual(['7']);
    expect(standLabelPrim(s, '{nr} {name}', 0.6, '')!.lines).toEqual(['7 Bäcker']);
  });
});

describe('Maßstabsbalken und Nordpfeil (M8-03)', () => {
  it.each([
    [500, 20, 40],
    [200, 10, 50],
    [1000, 50, 50],
    [60, 2, 33.3],
    [10000, 500, 50],
  ])('1:%i → %i m, %f mm', (n, meters, mm) => {
    const l = scaleBarLayout(n);
    expect(l.meters).toBe(meters);
    expect(l.mm).toBeCloseTo(mm, 1);
    expect(l.mm).toBeLessThanOrEqual(80 + 1e-9);
    expect(l.mm).toBeGreaterThanOrEqual(32 - 1e-9);
  });

  it('jeder Maßstab ergibt 32–80 mm und runde Werte 1/2/5 × 10^k', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 100_000 }), (n) => {
        const l = scaleBarLayout(n);
        const lead = l.meters / 10 ** Math.floor(Math.log10(l.meters) + 1e-9);
        return l.mm <= 80 + 1e-9 && l.mm >= 32 - 1e-9 && [1, 2, 5].some((f) => Math.abs(lead - f) < 1e-6);
      }),
    );
  });

  it('Nordpfeil dreht mit der Nordrichtung, „N“ steht an der Spitze', () => {
    const up = northArrowPrims(0);
    const right = northArrowPrims(90);
    const n0 = up.find((p) => p.t === 'text')!;
    const n90 = right.find((p) => p.t === 'text')!;
    const c = NORTH_ARROW_SIZE.w / 2;
    expect(n0.t === 'text' && n0.x).toBeCloseTo(c);
    expect(n90.t === 'text' && n90.x).toBeGreaterThan(c + 4);
  });
});

describe('An Seite anpassen mit freigehaltenen Papier-Elementen (M8-04, E-49)', () => {
  const A3 = { w: 420, h: 297 };

  it('ohne Elemente wie bisher: ganzes Papier mit 10 mm Rand', () => {
    const r = fitIntoFreeArea({ minX: 0, minY: 0, maxX: 400, maxY: 100 }, A3, []);
    expect(r.rect).toEqual({ x: 10, y: 10, w: 400, h: 277 });
    expect(r.n).toBeCloseTo(1000);
  });

  it('Schriftfeld unten rechts: Inhalt weicht in den freien Bereich aus', () => {
    const tb: PaperRect = { x: 230, y: 260, w: 180, h: 27 };
    const r = fitIntoFreeArea({ minX: 0, minY: 0, maxX: 100, maxY: 70 }, A3, [tb]);
    const inter = r.rect.x < tb.x + tb.w && tb.x < r.rect.x + r.rect.w && r.rect.y < tb.y + tb.h && tb.y < r.rect.y + r.rect.h;
    expect(inter).toBe(false);
  });

  it('Eigenschaft: Der eingepasste Inhalt schneidet kein Element und liegt im Rand', () => {
    const rect = fc.record({ x: fc.integer({ min: 0, max: 380 }), y: fc.integer({ min: 0, max: 260 }), w: fc.integer({ min: 10, max: 200 }), h: fc.integer({ min: 10, max: 120 }) });
    fc.assert(
      fc.property(fc.array(rect, { maxLength: 4 }), fc.integer({ min: 5, max: 500 }), fc.integer({ min: 5, max: 500 }), (obs, cw, ch) => {
        const page = createPage('P');
        page.sheet = { format: 'A3', orientation: 'landscape', scale: null, cx: 0, cy: 0 };
        page.areas.push({ id: 'a', name: '', cx: cw / 2, cy: ch / 2, w: cw, d: ch, rot: 0 });
        const f = sheetFrame(page, null, obs);
        const toMm = (x: number, y: number) => ({ x: ((x - f.bounds.minX) * 1000) / f.scale, y: ((y - f.bounds.minY) * 1000) / f.scale });
        const a = toMm(0, 0);
        const b = toMm(cw, ch);
        const eps = 1e-6;
        if (a.x < 10 - eps || a.y < 10 - eps || b.x > A3.w - 10 + eps || b.y > A3.h - 10 + eps) return false;
        const fit = fitIntoFreeArea({ minX: 0, minY: 0, maxX: cw, maxY: ch }, paperSize(page.sheet), obs);
        // Wurde der freie Bereich gewählt (nicht der Rückfall aufs ganze Papier), schneidet der Inhalt kein Element (mit 3 mm Abstand)
        if (fit.rect.w === 400 && fit.rect.h === 277) return true;
        return obs.every((o) => b.x <= o.x - 3 + eps || a.x >= o.x + o.w + 3 - eps || b.y <= o.y - 3 + eps || a.y >= o.y + o.h + 3 - eps || o.x + o.w + 3 <= 10 || o.y + o.h + 3 <= 10 || o.x - 3 >= 410 || o.y - 3 >= 287);
      }),
      { numRuns: 300 },
    );
  });

  it('Seite: angepasstes Blatt lässt Platz für Schriftfeld, Legende, Maßstabsbalken und Nordpfeil', () => {
    const p = createProject('P');
    const pg = p.pages[0]!;
    pg.areas.push({ id: 'G', name: '', cx: 0, cy: 0, w: 100, d: 60, rot: 0 });
    const pp = pagePaper(pg, p);
    const k = 1000 / pp.frame.scale;
    const content = { minX: (-50 - pp.frame.bounds.minX) * k, minY: (-30 - pp.frame.bounds.minY) * k, maxX: (50 - pp.frame.bounds.minX) * k, maxY: (30 - pp.frame.bounds.minY) * k };
    for (const el of [pp.titleBlock, pp.legend!, pp.scaleBar, pp.northArrow]) {
      const tl = { x: (el.topLeft.x - pp.frame.bounds.minX) * k, y: (el.topLeft.y - pp.frame.bounds.minY) * k };
      const apart = content.maxX <= tl.x + 1e-6 || content.minX >= tl.x + el.layout.w - 1e-6 || content.maxY <= tl.y + 1e-6 || content.minY >= tl.y + el.layout.h - 1e-6;
      expect(apart).toBe(true);
    }
  });
});

describe('Export-Profile (M8-07)', () => {
  it('mitgeliefert: Intern alles außer Standgeld (#5), Sanität ohne Eigentümer/Strom/Anschluss/Notiz, Händler nur Nummer und Name', () => {
    const [intern, safety, vendor] = BUILTIN_PROFILES;
    expect(intern!.fields).toEqual(STAND_FIELDS.filter((f) => f !== 'fee'));
    expect(BUILTIN_PROFILES.some((p) => p.fields.includes('fee'))).toBe(false);
    expect(safety!.fields).not.toContain('owner');
    expect(safety!.fields).not.toContain('power');
    expect(safety!.fields).not.toContain('connection');
    expect(safety!.fields).not.toContain('note');
    expect(safety!.warnings).toBe('safety');
    expect(vendor!.fields).toEqual(['nr', 'name']);
    expect(vendor!.layers.free).toBe(false);
    expect(Object.values(vendor!.appendix).some(Boolean)).toBe(false);
  });

  it('Laden: fehlende Angaben gelten als nicht erlaubt, kaputte Daten → mitgelieferte Profile mit Meldung', () => {
    expect(normalizeProfile({ id: 'own', name: 'Eigen' })).toMatchObject({ fields: [], warnings: 'none', builtin: false, layers: { stands: false } });
    expect(loadProfiles(undefined).profiles.map((p) => p.id)).toEqual(['internal', 'safety', 'vendor']);
    const broken = loadProfiles('kaputt');
    expect(broken.error).toMatch(/beschädigt/);
    expect(broken.profiles).toHaveLength(3);
    const edited = loadProfiles([{ ...BUILTIN_PROFILES[1], name: 'Sanität 2027', fields: ['nr'] }, { id: 'own', name: 'Eigen', fields: ['nr', 'unbekannt'] }, 42]);
    expect(edited.profiles.map((p) => p.name)).toEqual(['Intern', 'Sanität 2027', 'Händler', 'Eigen']);
    expect(edited.profiles[3]!.fields).toEqual(['nr']);
    expect(edited.error).toBeDefined();
  });

  it('Schwärzen: nicht erlaubte Felder sind leer, Maße und Kategorie bleiben, Händlerliste entfällt', () => {
    const p = createProject('P');
    p.pages[0]!.stands.push({ ...createStand({ cx: 0, cy: 0, w: 3, d: 2, rot: 0 }), nr: '1', name: 'N', owner: 'O', ware: 'W', note: 'X', powerKw: 5, connection: 'CEE16', categoryId: 'c' });
    p.unplaced.push({ id: 'v', name: 'Händler', owner: 'Privat', ware: '', w: 3, d: 3, powerKw: 0, connection: null, note: '' });
    const r = redactProject(p, BUILTIN_PROFILES[2]!);
    expect(r.pages[0]!.stands[0]).toMatchObject({ nr: '1', name: 'N', owner: '', ware: '', note: '', powerKw: 0, connection: null, w: 3, d: 2, categoryId: 'c' });
    expect(r.unplaced).toEqual([]);
    expect(p.pages[0]!.stands[0]!.owner).toBe('O');
    expect([...blankedPlaceholders(BUILTIN_PROFILES[2]!)].toSorted()).toEqual(['anschluss', 'breite', 'eigentuemer', 'kategorie', 'strom', 'tiefe', 'ware']);
  });

  it('Stände: eigene Farbe > Kategorie > Standardfarbe des Projekts (#3), auch in der Legende', () => {
    const p = createProject('P');
    p.settings.defaultStandColor = '#123abc';
    p.categories.push({ id: 'c', name: 'Imbiss', color: '#f0a35e', minDistance: null, price: null });
    const pg = p.pages[0]!;
    pg.stands.push(
      createStand({ cx: 0, cy: 0, w: 3, d: 3, rot: 0 }),
      createStand({ cx: 5, cy: 0, w: 3, d: 3, rot: 0 }, { categoryId: 'c' }),
      createStand({ cx: 10, cy: 0, w: 3, d: 3, rot: 0 }, { categoryId: 'c', color: '#ffffff' }),
    );
    const s = pageScene(pg, p, BUILTIN_PROFILES[0]!);
    const stands = s.layers.find((l) => l.id === 'stands')!.prims;
    expect(stands.map((x) => (x as { color?: string }).color)).toEqual(['#123abc', '#f0a35e', '#ffffff']);
    expect(JSON.stringify(s.paper.find((e) => e.kind === 'legend')!.prims)).toContain('#123abc');
  });

  it('Profil-Ebenen statt Ebenen der Zeichenfläche; Legende folgt ihnen', () => {
    const p = createProject('P');
    const pg = p.pages[0]!;
    pg.areas.push({ id: 'G', name: '', cx: 0, cy: 0, w: 50, d: 10, rot: 0 });
    pg.stands.push(createStand({ cx: 0, cy: 0, w: 3, d: 3, rot: 0 }));
    pg.layers.stands.visible = false; // auf der Zeichenfläche ausgeblendet
    const s = pageScene(pg, p, BUILTIN_PROFILES[0]!);
    expect(s.layers.map((l) => l.id)).toEqual(['grid', 'areas', 'free', 'stands', 'labels']);
    expect(profileLayers(BUILTIN_PROFILES[2]!).free.visible).toBe(false);
    const vendor = pageScene(pg, p, BUILTIN_PROFILES[2]!);
    expect(vendor.layers.map((l) => l.id)).not.toContain('free');
    const legend = vendor.paper.find((e) => e.kind === 'legend')!;
    expect(JSON.stringify(legend.prims)).not.toContain('Freifläche');
  });

  it('Dateiname: Projekt – (Festplatz –) Profil – Datum, ohne unzulässige Zeichen', () => {
    const d = new Date(2026, 9, 12);
    expect(exportFileName('Schelmenmarkt 2027', 'Sanität/Ordnungsamt', d)).toBe('Schelmenmarkt 2027 – Sanität-Ordnungsamt – 2026-10-12.pdf');
    expect(exportFileName('Schelmenmarkt 2027', 'Händler', d, 'Kirchplatz')).toBe('Schelmenmarkt 2027 – Kirchplatz – Händler – 2026-10-12.pdf');
    expect(exportFileName(' ', 'A:B', d)).toBe('Projekt – A-B – 2026-10-12.pdf');
  });
});

describe('Geschäftsformen in der Szene (M12, #9)', () => {
  const tpl = { id: 't', name: 'Karussell', w: 10, d: 12, parts: [{ kind: 'ellipse' as const, x: 0, y: 0, w: 1, h: 10 / 12 }, { kind: 'rect' as const, x: 0.35, y: 0.75, w: 0.3, h: 0.25 }] };

  it('Rechteck wie bisher, Kreis/Oval als ein Pfad aus Bögen mit Stil „stand“ und Warnvariante', () => {
    const r = createStand({ cx: 0, cy: 0, w: 4, d: 2, rot: 0 });
    expect(standPrims(r, '#123456', null)).toEqual([standPrim(r, '#123456', null)]);
    const [e] = standPrims({ ...r, shape: 'ellipse' }, '#123456', 'outside');
    expect(e).toMatchObject({ t: 'path', s: 'stand', v: 'warn-outside', color: '#123456' });
    expect((e as unknown as { d: string }).d.match(/A/g)).toHaveLength(4);
  });

  it('Vorlage: gemeinsame Füllung (ein Pfad) und Kontur nur außen, Warnvariante an der Kontur', () => {
    const s = createStand({ cx: 0, cy: 0, w: 10, d: 12, rot: 0 }, { shapeTemplateId: 't' });
    const [fill, outline] = standPrims(s, '#abcdef', 'overlap', tpl);
    expect(fill).toMatchObject({ t: 'path', s: 'stand-fill', color: '#abcdef' });
    expect((fill as { d: string }).d.match(/M/g)).toHaveLength(2);
    // Kontur: ein Bogenzug um den Kreis (ohne den Abschnitt über der Kasse) und ein Linienzug der Kasse
    expect((outline as { d: string }).d.match(/M/g)).toHaveLength(2);
    expect(outline).toMatchObject({ t: 'path', s: 'stand-outline', v: 'warn-overlap' });
  });

  it('PDF-Szene zeichnet die Form ohne Hitbox; Stände ohne Vorlage bleiben Rechtecke', () => {
    const p = createProject('P');
    p.shapeTemplates.push(tpl);
    const pg = p.pages[0]!;
    pg.stands.push(
      createStand({ cx: 0, cy: 0, w: 3, d: 3, rot: 0 }),
      createStand({ cx: 10, cy: 0, w: 4, d: 4, rot: 0 }, { shape: 'ellipse' }),
      createStand({ cx: 25, cy: 0, w: 10, d: 12, rot: 0 }, { shapeTemplateId: 't' }),
    );
    const sc = pageScene(pg, p, BUILTIN_PROFILES[0]!);
    const stands = sc.layers.find((l) => l.id === 'stands')!.prims;
    expect(stands.map((x) => `${x.t}:${x.s}`)).toEqual(['poly:stand', 'path:stand', 'path:stand-fill', 'path:stand-outline']);
    expect(JSON.stringify(sc)).not.toContain('stand-hitbox');
  });
});
