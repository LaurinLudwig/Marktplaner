import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, type ExportProfile } from '../exportProfiles';
import { decodeProjectFile } from '../fileFormat';
import { createPage, createProject } from '../model/defaults';
import type { Project } from '../model/types';
import { createStand } from '../objects';
import { buildExport } from './exportDoc';
import { pathBoxes, pdfjs, rawContains, readPdf, testFonts, testIconPath } from './pdf.testutil';
import { METERS_PER_PDF_POINT } from '../background';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { mmToPt, writePdf } from './writePdf';

/**
 * PDF-Export (M8-05, M8-07, M8-08, M8-10): Die erzeugten PDFs werden mit pdf.js wieder ausgelesen (Seitenzahl,
 * Seitengrößen, Maßstab, Text) und für jedes Profil auf nicht erlaubte Felder durchsucht (Datenschutz, spec.md §9).
 */

const fonts = testFonts();
const profile = (id: string): ExportProfile => structuredClone(BUILTIN_PROFILES.find((p) => p.id === id)!);

async function exportPdf(project: Project, prof: ExportProfile, pageIds: string[] | null = null, appendix = { stands: true, free: true, infra: true }, bgBytes?: Uint8Array) {
  const c = buildExport(project, prof, { pageIds, appendix });
  const pages = c.scenes.map((scene) => ({ scene, background: scene.background && bgBytes ? { kind: 'pdf' as const, key: scene.background.assetId, bytes: bgBytes } : null }));
  return writePdf({ title: c.title, projectName: c.projectName, pages, appendix: c.appendix, fonts, iconPath: testIconPath });
}

/** Ein Festplatz mit Blatt `format` quer, fester Maßstab 1:n um (0,0), ein Stand 10 × 4 m bei (0,0). */
function oneStand(format: 'A1' | 'A3' | 'A4', n: number): Project {
  const p = createProject('Maßstabstest');
  const pg = p.pages[0]!;
  pg.sheet = { format, orientation: 'landscape', scale: n, cx: 0, cy: 0 };
  pg.stands.push({ ...createStand({ cx: 0, cy: 0, w: 10, d: 4, rot: 0 }), name: 'Probe' });
  for (const k of ['titleBlock', 'legend', 'scaleBar', 'northArrow'] as const) pg[k].visible = false;
  return p;
}
const standsOnly: ExportProfile = { ...profile('internal'), layers: { background: false, grid: false, areas: false, free: false, stands: true, infra: false, labels: false }, warnings: 'none' };

describe('PDF: Seitengröße und Maßstab', () => {
  it.each([
    ['A1', 500, 841, 594],
    ['A3', 200, 420, 297],
  ] as const)('%s quer bei 1:%i: Seite exakt in mm, 10 m Stand = 10000/n mm', async (format, n, wMm, hMm) => {
    const bytes = await exportPdf(oneStand(format, n), standsOnly, null, { stands: false, free: false, infra: false });
    const pdf = await readPdf(bytes);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]!.w).toBeCloseTo(mmToPt(wMm), 2);
    expect(pdf.pages[0]!.h).toBeCloseTo(mmToPt(hMm), 2);
    // Der Stand ist der einzige Pfad außer dem Clip-Rechteck der Seite
    const boxes = (await pathBoxes(bytes)).filter((b) => b.maxX - b.minX < pdf.pages[0]!.w - 1);
    expect(boxes).toHaveLength(1);
    const b = boxes[0]!;
    const tolPt = mmToPt(0.01);
    expect(Math.abs(b.maxX - b.minX - mmToPt(10000 / n))).toBeLessThan(tolPt);
    expect(Math.abs(b.maxY - b.minY - mmToPt(4000 / n))).toBeLessThan(tolPt);
    // Mitte des Stands = Mitte des Blatts
    expect(Math.abs((b.minX + b.maxX) / 2 - mmToPt(wMm) / 2)).toBeLessThan(tolPt);
    expect(Math.abs((b.minY + b.maxY) / 2 - mmToPt(hMm) / 2)).toBeLessThan(tolPt);
  });

  it('Geschäftsformen (M12): Oval und Vorlage im Maßstab, ohne Hitbox', async () => {
    const p = oneStand('A3', 200);
    p.shapeTemplates.push({ id: 't', name: 'K', w: 10, d: 12, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 10 / 12 }, { kind: 'rect', x: 0.35, y: 0.75, w: 0.3, h: 0.25 }] });
    const pg = p.pages[0]!;
    pg.stands[0]!.shape = 'ellipse';
    pg.stands.push(createStand({ cx: 20, cy: 0, w: 10, d: 12, rot: 0 }, { shapeTemplateId: 't' }));
    const bytes = await exportPdf(p, standsOnly, null, { stands: false, free: false, infra: false });
    const pdf = await readPdf(bytes);
    const boxes = (await pathBoxes(bytes)).filter((b) => b.maxX - b.minX < pdf.pages[0]!.w - 1);
    // Oval (ein Pfad), Vorlage: Füllung und Kontur (zwei Pfade); keine gestrichelte Hitbox
    expect(boxes).toHaveLength(3);
    // Pfade stehen unter einer eigenen Abbildung (cm); ihr Hüllrechteck ist in Metern der Szene
    const [oval, fill, outline] = boxes as [(typeof boxes)[0], (typeof boxes)[0], (typeof boxes)[0]];
    for (const [v, e] of [[oval.minX, -5], [oval.maxX, 5], [oval.maxY - oval.minY, 4]] as const) expect(v).toBeCloseTo(e, 2);
    for (const b of [fill, outline]) for (const [v, e] of [[b.minX, 15], [b.maxX, 25], [b.maxY - b.minY, 12]] as const) expect(v).toBeCloseTo(e, 2);
  });

  it('gemischte Formate in einem PDF, Pages in Tab-Reihenfolge, Lesezeichen je Page', async () => {
    const p = oneStand('A1', 500);
    const second = createPage('Zweiter Platz');
    second.sheet = { format: 'A4', orientation: 'portrait', scale: 200, cx: 0, cy: 0 };
    p.pages.push(second);
    p.pages[0]!.name = 'Erster Platz';
    const pdf = await readPdf(await exportPdf(p, profile('internal'), null, { stands: false, free: false, infra: false }));
    expect(pdf.pages.map((x) => [Math.round(x.w), Math.round(x.h)])).toEqual([
      [Math.round(mmToPt(841)), Math.round(mmToPt(594))],
      [Math.round(mmToPt(210)), Math.round(mmToPt(297))],
    ]);
    expect(pdf.outline).toEqual(['Erster Platz', 'Zweiter Platz']);
    // Auswahl einer Page
    const only = await readPdf(await exportPdf(p, profile('internal'), [second.id], { stands: false, free: false, infra: false }));
    expect(only.pages).toHaveLength(1);
  });
});

describe('PDF: Hintergrund als Vektor', () => {
  it('PDF-Plan 1:1000 wird als Form-XObject eingebettet (kein Bild) und bei 1:500 doppelt so groß gezeichnet', async () => {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'plan-1zu1000.pdf')));
    const p = oneStand('A3', 500);
    const mpp = 1000 * METERS_PER_PDF_POINT;
    p.pages[0]!.background = {
      assetId: 'plan.pdf',
      kind: 'pdf',
      fileName: 'plan-1zu1000.pdf',
      pxSize: { w: 842, h: 595 },
      transform: { x: -421 * mpp, y: -297.5 * mpp, metersPerPx: mpp, rot: 0 },
      opacity: 0.6,
      locked: true,
    };
    const out = await exportPdf(p, profile('internal'), null, { stands: false, free: false, infra: false }, bytes);
    const doc = await PDFDocument.load(out);
    const subtypes: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects())
      if (obj instanceof PDFRawStream) subtypes.push(String(obj.dict.get(PDFName.of('Subtype')) ?? ''));
    expect(subtypes).toContain('/Form');
    expect(subtypes).not.toContain('/Image');
    // Abbildung Form-Raum → Seite: 1 pt des Plans (1:1000) = 2 pt auf dem Blatt (1:500)
    const lib = await pdfjs();
    const pd = await lib.getDocument({ data: out.slice() }).promise;
    const ops = await (await pd.getPage(1)).getOperatorList();
    const i = ops.fnArray.indexOf(lib.OPS.paintFormXObjectBegin);
    expect(i).toBeGreaterThan(0);
    const t = [...ops.fnArray.slice(0, i).keys()].toReversed().find((j) => ops.fnArray[j] === lib.OPS.transform)!;
    const [a, b, c, d] = ops.argsArray[t] as number[];
    expect(a).toBeCloseTo(2, 6);
    expect(d).toBeCloseTo(2, 6);
    expect(b).toBeCloseTo(0, 9);
    expect(c).toBeCloseTo(0, 9);
  });
});

describe('PDF: Text', () => {
  it('Schriftfeld, Beschriftung und Umlaute sind als Text auslesbar', async () => {
    const p = oneStand('A3', 200);
    p.pages[0]!.titleBlock.visible = true;
    p.pages[0]!.stands[0]!.name = 'Süßwaren Größe';
    const pdf = await readPdf(await exportPdf(p, profile('internal'), null, { stands: false, free: false, infra: false }));
    const text = pdf.pages[0]!.text;
    expect(text).toContain('Süßwaren Größe');
    expect(text).toContain('Maßstabstest');
    expect(text).toContain('Maßstab 1:200 bei Druck in Originalgröße (A3 quer)');
    expect(pdf.info.Title).toBe('Maßstabstest – Intern');
    // Version aus package.json, von Vite eingesetzt (#5)
    const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(pdf.info.Creator).toBe(`Marktplaner ${version} – Laurin Ludwig, https://github.com/LaurinLudwig`);
    expect(pdf.info.Producer).toBe(`Marktplaner ${version}`);
    expect(pdf.info.Author ?? '').toBe('');
    expect(pdf.xmp).toBeNull();
    // Gegenprobe für die Rohdatensuche des Datenschutztests: Titel (UTF-16, hex) wird gefunden
    expect(rawContains(pdf.raw, 'Maßstabstest – Intern')).toBe(true);
    expect(rawContains(pdf.raw, 'nicht-vorhanden-xyz')).toBe(false);
  });
});

describe('PDF: Vermerk (#5)', () => {
  it('jede Seite, auch der Anhang, trägt „Marktplaner, Version …, Laurin Ludwig, Link“ am unteren Rand', async () => {
    const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    const note = `Marktplaner, Version ${version}, Laurin Ludwig, https://github.com/LaurinLudwig`;
    const p = oneStand('A3', 200);
    const pdf = await readPdf(await exportPdf(p, profile('internal')));
    expect(pdf.pages.length).toBeGreaterThan(1);
    for (const pg of pdf.pages) {
      const item = pg.items.find((x) => x.str === note);
      expect(item, pg.text).toBeDefined();
      // unterer Rand: Grundlinie 3 mm über der Unterkante (pdf.js: y nach oben), mittig
      expect(item!.y).toBeCloseTo(mmToPt(3), 0);
      expect(item!.x).toBeLessThan(pg.w / 2);
    }
  });
});

describe('PDF: Datenschutz je Profil (Kanarienwerte)', () => {
  const OWNER = 'KANARIE-EIGENTÜMER-Ölmühle';
  const NOTE = 'KANARIE-NOTIZ-7731';
  const POWER = '77,7';
  const WARE = 'KANARIE-WARE-Brezel';

  function canaryProject(): Project {
    const { project } = decodeProjectFile(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v4-m7.schelme'))));
    // Vorlage mit allen Platzhaltern, Kanarienwerte an jedem Stand der ersten Page
    project.settings.labelTemplate = '{nr}\n{name}\n{eigentuemer}\n{ware}\n{strom} kW {anschluss}\n{breite}×{tiefe} m';
    const pg = project.pages[0]!;
    pg.stands = pg.stands.slice(0, 30).map((s, i) => ({ ...s, owner: `${OWNER}-${i}`, note: NOTE, powerKw: 77.7, connection: 'CEE32', ware: WARE }));
    pg.infra = pg.infra.map((o) => ({ ...o, note: NOTE, powerKw: o.powerKw }));
    project.pages = [pg];
    return project;
  }

  const hidden = (pdf: Awaited<ReturnType<typeof readPdf>>, s: string) => {
    const where: string[] = [];
    if (pdf.pages.some((p) => p.text.includes(s))) where.push('Textlayer');
    if (JSON.stringify(pdf.info).includes(s)) where.push('Metadaten');
    if (pdf.xmp?.includes(s)) where.push('XMP');
    if (pdf.outline.some((t) => t.includes(s))) where.push('Lesezeichen');
    if (rawContains(pdf.raw, s)) where.push('Rohdaten');
    return where;
  };

  it('„Intern“ enthält die Kanarienwerte (Gegenprobe)', async () => {
    const pdf = await readPdf(await exportPdf(canaryProject(), profile('internal')));
    expect(hidden(pdf, OWNER)).toContain('Textlayer');
    expect(hidden(pdf, NOTE)).toContain('Textlayer');
    expect(pdf.pages.some((p) => p.text.includes(`${POWER} kW`))).toBe(true);
  });

  it.each(['safety', 'vendor'])('„%s“: Eigentümer, Strom, Anschluss und Notiz kommen nirgends vor', async (id) => {
    const pdf = await readPdf(await exportPdf(canaryProject(), profile(id)));
    expect(hidden(pdf, 'KANARIE-EIGENTÜMER')).toEqual([]);
    expect(hidden(pdf, 'Ölmühle')).toEqual([]);
    expect(hidden(pdf, NOTE)).toEqual([]);
    expect(hidden(pdf, `${POWER} kW`)).toEqual([]);
    expect(hidden(pdf, 'CEE 32 A')).toEqual([]);
    expect(pdf.pages.every((p) => p.annotations === 0)).toBe(true);
    if (id === 'vendor') expect(hidden(pdf, WARE)).toEqual([]);
    else expect(hidden(pdf, WARE)).toContain('Textlayer');
  });

  it('eigenes Profil ohne Name: auch Standnamen fehlen; fehlende Angaben gelten als nicht erlaubt', async () => {
    const own: ExportProfile = { ...profile('internal'), id: 'x', builtin: false, name: 'Nur Nummern', fields: ['nr'] };
    const p = canaryProject();
    p.pages[0]!.stands[0]!.name = 'KANARIE-NAME';
    const pdf = await readPdf(await exportPdf(p, own));
    expect(hidden(pdf, 'KANARIE-NAME')).toEqual([]);
    expect(hidden(pdf, 'KANARIE-EIGENTÜMER')).toEqual([]);
  });
});

describe('PDF: Anhang', () => {
  it('Standliste mit erlaubten Spalten, mehrseitig mit Seitenzahl, Lesezeichen', async () => {
    const { project } = decodeProjectFile(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'format-v4-m7.schelme'))));
    const bytes = await exportPdf(project, profile('safety'));
    const pdf = await readPdf(bytes);
    // 4 Festplätze + Standliste (500 Zeilen) + Infrastrukturliste
    expect(pdf.pages.length).toBeGreaterThan(4 + 10);
    expect(pdf.outline).toEqual(['Obermarkt', 'Untermarkt', 'Am Ziegelturm', 'Schifftor', 'Standliste', 'Infrastrukturliste']);
    const appendix = pdf.pages.slice(4).map((p) => p.text).join('\n');
    expect(appendix).toContain('Standliste');
    expect(appendix).toMatch(/Anhang – Seite 1 von \d+/);
    expect(appendix).not.toContain('Eigentümer');
    expect(appendix).not.toContain('Jürgen Müller');
    expect(appendix).toContain('Süßwaren Größe');
    expect(appendix).toContain('Treffpunkt Sanität');
    expect(pdf.pages[4]!.w).toBeCloseTo(mmToPt(297), 2);
  }, 30_000);
});
