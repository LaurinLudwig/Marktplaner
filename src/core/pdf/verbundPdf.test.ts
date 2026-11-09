import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { METERS_PER_PDF_POINT } from '../background';
import { BUILTIN_PROFILES, normalizeProfile, type ExportProfile } from '../exportProfiles';
import { createPage, createProject, createVerbund, LEGACY_SHEET } from '../model/defaults';
import type { Area, Background, FestplatzPage, Project, Stand } from '../model/types';
import { createArea, createStand } from '../objects';
import { pagePaper } from '../paper';
import { createInfra } from '../infra';
import { FADED_OPACITY, pageScene } from '../scene/page';
import type { TextPrim } from '../scene/prims';
import { mergedPage, verbundRef } from '../verbund';
import { pageView } from '../verbundView';
import { buildExport, entryPages, exportEntries, selectedEntries } from './exportDoc';
import { pdfjs, readPdf, testFonts, testIconPath } from './pdf.testutil';
import { mmToPt, writePdf } from './writePdf';

/**
 * #15 Teil c: PDF der Gesamtansicht eines Verbunds (Blatt des Verbunds, Objekte aller Mitglieder, ein Hintergrund je
 * Mitglied) und Nachbarn im PDF einer Einzelansicht (Ebene „Nachbarn“ des Profils).
 */

const area = (id: string, cx: number, cy: number, w: number, d: number): Area => ({ ...createArea({ cx, cy, w, d, rot: 0 }), id });
const stand = (id: string, cx: number, cy: number, extra: Partial<Stand> = {}): Stand => ({ ...createStand({ cx, cy, w: 3, d: 3, rot: 0 }), id, ...extra });
const profile = (id: string): ExportProfile => structuredClone(BUILTIN_PROFILES.find((p) => p.id === id)!);
const REF = verbundRef('g');

/** PDF-Hintergrund 842 × 595 pt (plan-1zu1000.pdf) bei 1:1000, linke obere Ecke bei (x, y). */
const pdfBg = (assetId: string, x: number, y: number): Background => {
  const mpp = 1000 * METERS_PER_PDF_POINT;
  return { assetId, kind: 'pdf', fileName: assetId, pxSize: { w: 842, h: 595 }, transform: { x, y, metersPerPx: mpp, rot: 0 }, opacity: 1, locked: true };
};

/**
 * Müllerwiese (A, Grundfläche x 0…20) und Ziegelturm (B, x 15…35) im Verbund „Unterstadt“, Escher (C) für sich. SE-02
 * steht auf B im Überschneidungsbereich (x 18,5), ist also Nachbar von A. Kategorien: „Imbiss“ auf A, „Süßwaren“ auf B.
 */
function setup(): Project {
  const p = createProject('Schelmenmarkt');
  const [imbiss, suess] = [
    { id: 'imbiss', name: 'Imbiss', color: '#cc3333', minDistance: null },
    { id: 'suess', name: 'Süßwaren', color: '#3366cc', minDistance: null },
  ];
  p.categories = [imbiss, suess] as Project['categories'];
  const a: FestplatzPage = { ...createPage('Müllerwiese'), id: 'A', areas: [area('aA', 10, 5, 20, 10)], stands: [stand('sA', 5, 5, { nr: 'M-01', name: 'Waffeln', categoryId: 'imbiss' })] };
  const b: FestplatzPage = {
    ...createPage('Ziegelturm'),
    id: 'B',
    areas: [area('aB', 25, 5, 20, 10)],
    stands: [stand('se2', 18.5, 5, { nr: 'SE-02', name: 'Crêpes', categoryId: 'suess' }), stand('sB', 30, 5, { nr: 'Z-11', name: 'Lebkuchen', categoryId: 'suess' })],
  };
  const c: FestplatzPage = { ...createPage('Escher'), id: 'C', areas: [area('aC', 200, 5, 20, 10)] };
  for (const pg of [a, b, c]) pg.sheet = { ...LEGACY_SHEET };
  return { ...p, pages: [a, c, b], groups: [{ ...createVerbund('Unterstadt', ['A', 'B']), id: 'g' }] };
}

const texts = (prims: readonly { t: string }[]) => prims.filter((x): x is TextPrim => x.t === 'text').flatMap((x) => x.lines);

describe('#15 c: Szene der Gesamtansicht', () => {
  it('mergedPage: Objekte aller Mitglieder, ein Hintergrund je Mitglied in der Reihenfolge des Verbunds, keine Nachbarn', () => {
    const p = setup();
    p.pages[0]!.background = pdfBg('a.pdf', -50, -50);
    p.pages[2]!.background = pdfBg('b.pdf', 0, -50);
    const g = p.groups[0]!;
    const s = pageScene(mergedPage(p, g), p, profile('internal'), 'Unterstadt (gesamt)');
    expect(s.pageId).toBe(REF);
    expect(s.name).toBe('Unterstadt (gesamt)');
    expect(s.backgrounds.map((b) => [b.pageId, b.background.assetId])).toEqual([
      ['A', 'a.pdf'],
      ['B', 'b.pdf'],
    ]);
    expect(s.layers.map((l) => l.id)).not.toContain('neighbours');
    const stands = s.layers.find((l) => l.id === 'stands')!;
    // drei Stände (je ein Polygon), aus beiden Plätzen
    expect(stands.prims.filter((x) => x.t === 'poly')).toHaveLength(3);
    const labels = texts(s.layers.find((l) => l.id === 'labels')!.prims).join(' ');
    for (const nr of ['M-01', 'SE-02', 'Z-11']) expect(labels).toContain(nr);
    expect(labels).not.toContain('·');
    // ohne Hintergrund-Ebene keine Hintergründe
    expect(pageScene(mergedPage(p, g), p, { ...profile('internal'), layers: { ...profile('internal').layers, background: false } }).backgrounds).toEqual([]);
  });

  it('Blatt, Schriftfeld und Legende des Verbunds; Legende über alle Mitglieder; Nordpfeil vom ersten Mitglied', () => {
    const p = setup();
    const g = p.groups[0]!;
    g.sheet = { ...LEGACY_SHEET, format: 'A2', orientation: 'landscape', scale: 500, cx: 17.5, cy: 5 };
    g.titleBlockText = 'Übersichtsplan';
    p.pages[0]!.northAngle = 20;
    p.pages[2]!.northAngle = 99;
    const s = pageScene(mergedPage(p, g), p, profile('internal'));
    expect(s.frame.paper).toEqual({ w: 594, h: 420 });
    expect(s.frame.scale).toBe(500);
    expect(s.frame.bounds.minX).toBeCloseTo(17.5 - 148.5, 6);
    const tb = s.paper.find((e) => e.kind === 'titleBlock')!;
    const tbText = texts(tb.prims).join(' | ');
    expect(tbText).toContain('Schelmenmarkt');
    // Festplatz-Zeile: der Name des Verbunds
    expect(tbText).toContain('Unterstadt');
    expect(tbText).toContain('Übersichtsplan');
    const legend = texts(s.paper.find((e) => e.kind === 'legend')!.prims);
    expect(legend).toEqual(expect.arrayContaining(['Imbiss', 'Süßwaren', 'Grundfläche']));
    // Nordpfeil: Nordrichtung des ersten Mitglieds (A)
    expect(pagePaper(mergedPage(p, g), p).northArrow.layout.angle).toBe(20);
    // Sichtbarkeit der Papier-Elemente des Verbunds
    g.legend.visible = false;
    expect(pageScene(mergedPage(p, g), p, profile('internal')).paper.map((e) => e.kind)).not.toContain('legend');
  });

  it('Warnungen wie auf der Zeichenfläche: Infrastruktur warnt nur an Ständen desselben Platzes (pageEnv.owners)', () => {
    const p = setup();
    const medical = p.infraTypes.find((t) => t.id === 'medical')!;
    // Sanitätsdienst von A über SE-02 (gehört B) und über M-01 (gehört A)
    p.pages[0]!.infra = [createInfra(medical, { cx: 18.5, cy: 5, w: 2, d: 2, rot: 0 }), createInfra(medical, { cx: 5, cy: 5, w: 2, d: 2, rot: 0 })];
    const s = pageScene(mergedPage(p, p.groups[0]!), p, profile('internal'));
    const warn = s.layers.find((l) => l.id === 'warnings')!.prims;
    // Warnsymbol an der rechten oberen Ecke des Stands (Mitte + 1,5 m)
    const at = (cx: number) => warn.some((w) => w.t === 'rect' && w.s === 'warn-icon-mark' && Math.abs(w.x - (cx + 1.5)) < 0.5);
    expect(at(5)).toBe(true);
    expect(at(18.5)).toBe(false);
  });

  it('„Plan“ und „an Seite anpassen“: Inhalt sind alle Mitglieder, ohne Objekte ihre Hintergründe', () => {
    const p = setup();
    const g = p.groups[0]!;
    // Vorgabe eines neuen Verbunds: „Plan“
    const plan = pageScene(mergedPage(p, g), p, profile('internal')).frame;
    expect(plan.kind).toBe('plan');
    expect(plan.bounds.minX).toBeLessThan(0);
    expect(plan.bounds.maxX).toBeGreaterThan(35);
    g.sheet = { ...LEGACY_SHEET };
    const fit = pageScene(mergedPage(p, g), p, profile('internal')).frame;
    expect(fit.bounds.minX).toBeLessThan(0);
    expect(fit.bounds.maxX).toBeGreaterThan(35);
    // Escher (C) gehört nicht dazu
    expect(fit.bounds.maxX).toBeLessThan(190);
    // Ohne Objekte: die Hintergründe beider Mitglieder (Zeichenfläche: Sicht ohne eigenen Hintergrund)
    // neue Page-Objekte (wie nach einer Änderung im Store; die Gesamtansicht ist je Mitgliederliste zwischengespeichert)
    p.pages = p.pages.map((pg) => ({ ...pg, areas: [], stands: [], background: pg.id === 'A' ? pdfBg('a.pdf', -400, 0) : pg.id === 'B' ? pdfBg('b.pdf', 400, 0) : null }));
    const empty = pagePaper(pageView(p, REF)!, p).frame;
    expect(empty.bounds.minX).toBeLessThanOrEqual(-400);
    expect(empty.bounds.maxX).toBeGreaterThanOrEqual(400 + 842 * 1000 * METERS_PER_PDF_POINT - 1e-6);
  });
});

describe('#15 c: Export mit Gesamtansicht', () => {
  it('Gesamtplan: Gesamtansicht vor ihrem ersten Mitglied in Tab-Reihenfolge; Anhang zählt jedes Objekt einmal', () => {
    const p = setup();
    expect(exportEntries(p).map((e) => [e.ref, e.name])).toEqual([
      [REF, 'Unterstadt (gesamt)'],
      ['A', 'Müllerwiese'],
      ['C', 'Escher'],
      ['B', 'Ziegelturm'],
    ]);
    const all = buildExport(p, profile('internal'), { pageIds: null, appendix: { stands: true, free: false, infra: false } });
    expect(all.scenes.map((s) => s.name)).toEqual(['Unterstadt (gesamt)', 'Müllerwiese', 'Escher', 'Ziegelturm']);
    expect(all.appendix[0]!.rows).toHaveLength(3);
    // Nur die Gesamtansicht: Anhang mit den Ständen beider Mitglieder, je einmal
    const only = buildExport(p, profile('internal'), { pageIds: [REF], appendix: { stands: true, free: false, infra: false } });
    expect(only.scenes).toHaveLength(1);
    expect(only.appendix[0]!.rows.map((r) => r[0])).toEqual(['Müllerwiese', 'Ziegelturm', 'Ziegelturm']);
    // Gesamtansicht und ein Mitglied: dieselben drei Zeilen
    const both = buildExport(p, profile('internal'), { pageIds: ['B', REF], appendix: { stands: true, free: false, infra: false } });
    expect(both.scenes.map((s) => s.pageId)).toEqual([REF, 'B']);
    expect(both.appendix[0]!.rows).toHaveLength(3);
    expect(entryPages(p, selectedEntries(p, ['C'])).map((x) => x.id)).toEqual(['C']);
  });

  it('PDF: Seite exakt im Blattmaß des Verbunds, beide PDF-Hintergründe als Form-XObject eingebettet und gezeichnet', async () => {
    const p = setup();
    p.pages[0]!.background = pdfBg('a.pdf', -60, -40);
    p.pages[2]!.background = pdfBg('b.pdf', 0, -40);
    p.groups[0]!.sheet = { ...LEGACY_SHEET, format: 'A3', orientation: 'landscape', scale: 1000, cx: 17.5, cy: 5 };
    const plan = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'plan-1zu1000.pdf')));
    const plan2 = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'plan-2seiten.pdf')));
    const files: Record<string, Uint8Array> = { 'a.pdf': plan, 'b.pdf': plan2 };
    const c = buildExport(p, profile('internal'), { pageIds: [REF], appendix: {} });
    const pages = c.scenes.map((scene) => ({ scene, backgrounds: scene.backgrounds.map(({ background: bg }) => ({ kind: 'pdf' as const, key: bg.assetId, bytes: files[bg.assetId]! })) }));
    const out = await writePdf({ title: c.title, projectName: c.projectName, pages, appendix: [], fonts: testFonts(), iconPath: testIconPath });
    const pdf = await readPdf(out);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]!.w).toBeCloseTo(mmToPt(420), 2);
    expect(pdf.pages[0]!.h).toBeCloseTo(mmToPt(297), 2);
    expect(pdf.outline).toEqual(['Unterstadt (gesamt)']);
    // zwei verschiedene Dateien → zwei eingebettete Seiten (Form-XObjects), beide auf der Seite gezeichnet
    const doc = await PDFDocument.load(out);
    const forms = [...doc.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Form');
    expect(forms.length).toBeGreaterThanOrEqual(2);
    const lib = await pdfjs();
    const pd = await lib.getDocument({ data: out.slice() }).promise;
    const ops = await (await pd.getPage(1)).getOperatorList();
    // Formen der Hintergründe auf oberster Ebene (eingebettete Seiten können selbst Formen enthalten)
    expect(ops.fnArray.filter((f: number) => f === lib.OPS.paintFormXObjectBegin).length).toBeGreaterThanOrEqual(2);
    // Text der Gesamtansicht: Schriftfeld mit dem Verbund, Stände beider Plätze
    for (const t of ['Unterstadt', 'M-01', 'Z-11']) expect(pdf.pages[0]!.text).toContain(t);
  });

  it('dieselbe Datei als Hintergrund zweier Mitglieder wird nur einmal eingebettet', async () => {
    const p = setup();
    p.pages[0]!.background = pdfBg('plan.pdf', -60, -40);
    p.pages[2]!.background = pdfBg('plan.pdf', 0, -40);
    const plan = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'plan-1zu1000.pdf')));
    const c = buildExport(p, profile('internal'), { pageIds: [REF], appendix: {} });
    const pages = c.scenes.map((scene) => ({ scene, backgrounds: scene.backgrounds.map(({ background: bg }) => ({ kind: 'pdf' as const, key: bg.assetId, bytes: plan })) }));
    const out = await writePdf({ title: c.title, projectName: c.projectName, pages, appendix: [], fonts: testFonts(), iconPath: testIconPath });
    const doc = await PDFDocument.load(out);
    const forms = [...doc.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Form');
    expect(forms).toHaveLength(1);
  });
});

describe('#15 c: Nachbarn im PDF der Einzelansicht', () => {
  it('blass mit „Nr · Platz“ unter den eigenen Ständen; nicht in der Legende und ohne Warnung', () => {
    const p = setup();
    const s = pageScene(p.pages[0]!, p, profile('internal'));
    const ids = s.layers.map((l) => l.id);
    expect(ids.indexOf('neighbours')).toBeGreaterThan(-1);
    expect(ids.indexOf('neighbours')).toBeLessThan(ids.indexOf('stands'));
    const nb = s.layers.find((l) => l.id === 'neighbours')!;
    expect(nb.faded).toBe(true);
    // SE-02 (im Überschneidungsbereich); Z-11 (x 30) ist zwar Nachbar, liegt aber nicht auf dem Blatt von A
    expect(nb.prims.filter((x) => x.t === 'poly')).toHaveLength(1);
    const labels = s.layers.find((l) => l.id === 'labels')!.prims.filter((x): x is TextPrim => x.t === 'text' && x.s === 'neighbour-label');
    expect(labels.map((x) => x.lines[0])).toEqual(['SE-02 · Ziegelturm']);
    expect(labels[0]!.x).toBe(18.5);
    // Legende: nur die eigenen (Imbiss), kein Eintrag für Nachbarn
    expect(texts(s.paper.find((e) => e.kind === 'legend')!.prims)).not.toContain('Süßwaren');
    expect(FADED_OPACITY).toBeLessThan(1);
  });

  it('Ebene „Nachbarn“ aus: keine Nachbarn, Freiflächen rechnen weiter mit ihnen', () => {
    const p = setup();
    const on = pageScene(p.pages[0]!, p, profile('internal'));
    const offProfile = { ...profile('internal'), layers: { ...profile('internal').layers, neighbours: false } };
    const off = pageScene(p.pages[0]!, p, offProfile);
    expect(off.layers.map((l) => l.id)).not.toContain('neighbours');
    expect(off.layers.find((l) => l.id === 'labels')!.prims.some((x) => x.s === 'neighbour-label')).toBe(false);
    expect(off.layers.find((l) => l.id === 'free')!.prims).toEqual(on.layers.find((l) => l.id === 'free')!.prims);
    // Ohne „Geschäfte“ keine Nachbarstände; ohne „Beschriftung“ keine „Nr · Platz“
    const noStands = pageScene(p.pages[0]!, p, { ...profile('internal'), layers: { ...profile('internal').layers, stands: false } });
    expect(noStands.layers.map((l) => l.id)).not.toContain('neighbours');
    const noLabels = pageScene(p.pages[0]!, p, { ...profile('internal'), layers: { ...profile('internal').layers, labels: false } });
    expect(noLabels.layers.find((l) => l.id === 'neighbours')).toBeTruthy();
    expect(noLabels.layers.map((l) => l.id)).not.toContain('labels');
  });

  it('Profile: mitgeliefert an; Händler zeigt nur erlaubte Felder (ohne Nummer der Name, sonst „Stand“); alte Profile folgen „Geschäfte“', () => {
    for (const b of BUILTIN_PROFILES) expect(b.layers.neighbours, b.name).toBe(true);
    const p = setup();
    const vendor = buildExport(p, { ...profile('vendor'), fields: ['name'] }, { pageIds: ['A'], appendix: {} }).scenes[0]!;
    const cap = vendor.layers.find((l) => l.id === 'labels')!.prims.filter((x): x is TextPrim => x.s === 'neighbour-label');
    expect(cap.map((x) => x.lines[0])).toEqual(['Crêpes · Ziegelturm']);
    const none = buildExport(p, { ...profile('vendor'), fields: [] }, { pageIds: ['A'], appendix: {} }).scenes[0]!;
    expect(none.layers.find((l) => l.id === 'labels')!.prims.filter((x): x is TextPrim => x.s === 'neighbour-label')[0]!.lines[0]).toBe('Stand · Ziegelturm');
    // gespeichert vor #15 Teil c (ohne „neighbours“): wie „Geschäfte“
    const old = { id: 'x', name: 'Alt', layers: { stands: true }, fields: ['nr'], appendix: {} };
    expect(normalizeProfile(old)!.layers.neighbours).toBe(true);
    expect(normalizeProfile({ ...old, layers: { stands: false } })!.layers.neighbours).toBe(false);
    expect(normalizeProfile({ ...old, layers: { stands: true, neighbours: false } })!.layers.neighbours).toBe(false);
  });

  it('PDF: Nachbarn mit Ebene erscheinen als Text „SE-02 · Ziegelturm“, ohne Ebene nicht', async () => {
    const p = setup();
    const write = async (prof: ExportProfile) => {
      const c = buildExport(p, prof, { pageIds: ['A'], appendix: {} });
      return readPdf(await writePdf({ title: c.title, projectName: c.projectName, pages: c.scenes.map((scene) => ({ scene })), appendix: [], fonts: testFonts(), iconPath: testIconPath }));
    };
    const on = await write(profile('internal'));
    expect(on.pages[0]!.text).toContain('SE-02 · Ziegelturm');
    const off = await write({ ...profile('internal'), layers: { ...profile('internal').layers, neighbours: false } });
    expect(off.pages[0]!.text).not.toContain('SE-02');
    expect(off.pages[0]!.text).toContain('M-01');
  });
});
