/**
 * PDF-Schreiber (M8, spec.md §9): Szenen der Pages und Tabellen des Anhangs → PDF-Bytes, mit pdf-lib.
 *
 * - Seitengröße exakt aus dem Papiermaß in mm (1 pt = 25,4/72 mm). Weltkoordinaten (Meter) und Papier-Elemente (mm)
 *   werden über je eine affine Abbildung in Punkte umgerechnet; y zeigt im PDF nach oben.
 * - Schrift: IBM Plex Sans in drei Schnitten, als Teilmenge eingebettet (durchsuchbarer Text, Umlaute).
 * - Hintergrund: PDF als Form-XObject (Vektor), Rasterbilder als vorbereitete Kacheln (siehe app/pdfBackground.ts).
 * - Datenschutz: Das PDF enthält nur, was in der Szene steht; keine optionalen Inhalte, Anmerkungen, Formulare,
 *   Dateianhänge oder XMP. Metadaten: Titel, Ersteller mit Programm, Version und Urheber.
 * - Vermerk „Marktplaner, Version …, Urheber, Link“ klein und grau am unteren Rand jeder Seite (#5).
 *
 * Rein (ohne DOM); läuft im Web Worker und in Vitest.
 */
import fontkit from '@pdf-lib/fontkit';
import { APP_AUTHOR, APP_NAME, APP_URL, APP_VERSION, exportNote } from '../appInfo';
import {
  beginText,
  closePath,
  concatTransformationMatrix,
  drawObject,
  drawSvgPath,
  endPath,
  endText,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  clip,
  rgb,
  setDashPattern,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  stroke,
  LineJoinStyle,
  TextRenderingMode,
  type Color,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { Background } from '../model/types';
import type { PageScene } from '../scene/page';
import { paperStyle, type PaperColor, type PaperStyle } from '../scene/paperStyle';
import { isIcon, type Prim, type TextPrim } from '../scene/prims';
import { UserError } from '../errors';

/** Punkte je mm. */
export const PT_PER_MM = 72 / 25.4;
export const mmToPt = (mm: number) => mm * PT_PER_MM;

export interface PdfFonts {
  regular: Uint8Array;
  medium: Uint8Array;
  semibold: Uint8Array;
}

/** Kachel eines vorbereiteten Rasterbilds; Lage in Quell-Einheiten des Hintergrunds (Pixel, y nach unten). */
export interface RasterTile {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PreparedBackground =
  /** Einseitiges PDF (so liegt es im Projekt); `key` = Asset, damit es nur einmal eingebettet wird. */
  | { kind: 'pdf'; key: string; bytes: Uint8Array }
  | { kind: 'raster'; tiles: RasterTile[] };

export interface PdfPageInput {
  scene: PageScene;
  background?: PreparedBackground | null;
}

export interface AppendixColumn {
  label: string;
  align: 'left' | 'right';
}

export interface AppendixTable {
  title: string;
  columns: AppendixColumn[];
  rows: string[][];
}

export interface PdfInput {
  /** Titel in den Metadaten: „Projektname – Profilname“. */
  title: string;
  /** Kopfzeile des Anhangs. */
  projectName: string;
  pages: PdfPageInput[];
  appendix: AppendixTable[];
  fonts: PdfFonts;
  /** Pfaddaten eines Symbols (Material Symbols, 960 Einheiten). */
  iconPath: (name: string) => string;
  /** Fortschritt: erledigte und gesamte Schritte (Pages + Anhang + Speichern). */
  onProgress?: (done: number, total: number) => void;
  /** Abbruch: liefert true, sobald abgebrochen werden soll. */
  cancelled?: () => boolean;
}

export class ExportCancelled extends Error {
  override name = 'ExportCancelled';
}

// ---------- Hilfen ----------

/** Affine Abbildung [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f (wie der PDF-Operator `cm`). */
type Mat = [number, number, number, number, number, number];
/** Erst `n`, dann `m` (m ∘ n). */
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function hexColor(hex: string): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return rgb(0.5, 0.5, 0.5);
  return rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255);
}
const colorOf = (c: PaperColor | undefined, data: string | undefined): Color | undefined => (c === undefined ? undefined : hexColor(c === 'data' ? (data ?? '#a7adb3') : c));

/** Zeichenkontext einer Seite: Abbildung in Punkte, Schriften, Deckkraft-Zustände. */
class PageWriter {
  private ops: PDFOperator[] = [];
  private gs = new Map<string, PDFName>();
  private fontKeys = new Map<PDFFont, PDFName>();
  private xobjects = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage,
    readonly fonts: Record<400 | 500 | 600, PDFFont>,
    readonly iconPath: (name: string) => string,
  ) {}

  flush() {
    this.page.pushOperators(...this.ops);
    this.ops = [];
  }

  push(...ops: PDFOperator[]) {
    for (const o of ops) this.ops.push(o);
  }

  /** ExtGState für Deckkraft (Füllung, Linie); 1/1 braucht keinen. */
  opacity(fillOp = 1, strokeOp = 1): PDFName | undefined {
    if (fillOp >= 1 && strokeOp >= 1) return undefined;
    const key = `${fillOp.toFixed(3)}/${strokeOp.toFixed(3)}`;
    let name = this.gs.get(key);
    if (!name) {
      const dict = this.doc.context.obj({ Type: 'ExtGState', ca: fillOp, CA: strokeOp });
      name = this.page.node.newExtGState('GS', this.doc.context.register(dict));
      this.gs.set(key, name);
    }
    return name;
  }

  font(weight: 400 | 500 | 600): { font: PDFFont; key: PDFName } {
    const font = this.fonts[weight];
    let key = this.fontKeys.get(font);
    if (!key) {
      key = this.page.node.newFontDictionary(font.name, font.ref);
      this.fontKeys.set(font, key);
    }
    return { font, key };
  }

  xobject(ref: PDFRef): PDFName {
    return this.page.node.newXObject(`X${++this.xobjects}`, ref);
  }

  /**
   * Primitive zeichnen. `m` bildet Szenen-Einheiten auf Punkte ab (gleichmäßige Skalierung `k` pt je Einheit,
   * y gespiegelt); `ptPerMm` rechnet Papier-Strichstärken um.
   */
  prims(prims: readonly Prim[], m: Mat, k: number) {
    for (const p of prims) this.prim(p, m, k);
  }

  private stroked(st: PaperStyle, k: number, geomWidth?: number): number {
    if (st.width === 'geom') return (geomWidth ?? 0) * k;
    return st.width !== undefined ? mmToPt(st.width) : mmToPt(0.25);
  }

  private prim(p: Prim, m: Mat, k: number) {
    const st = paperStyle(p.s, p.v);
    if (p.t === 'text') return this.text(p, m, k, st);
    const fillC = colorOf(st.fill, p.color);
    const strokeC = colorOf(st.stroke, p.color);
    if (!fillC && !strokeC) return;
    const geomWidth = p.t === 'line' || p.t === 'path' ? p.width : undefined;
    const lw = strokeC ? this.stroked(st, k, geomWidth) : 0;
    if (strokeC && !(lw > 0)) return;
    const dashSrc = p.t === 'line' || p.t === 'path' ? p.dash : undefined;
    const dash = dashSrc ? dashSrc.map((d) => d * k) : st.dash?.map(mmToPt);
    const gs = this.opacity(fillC ? (st.fillOpacity ?? 1) : 1, strokeC ? (st.strokeOpacity ?? 1) : 1);

    if (p.t === 'path') {
      // SVG-Pfad (Symbole, Schraffur, Maßlinie) unter einer lokalen Abbildung; Strichstärke in lokalen Einheiten
      const local: Mat = p.at ? mul(m, [p.at.k, 0, 0, p.at.k, p.at.x, p.at.y]) : m;
      const scale = Math.hypot(local[0], local[1]);
      const d = isIcon(p) ? this.iconPath(p.icon) : p.d;
      if (!d) return;
      // drawSvgPath setzt translate(x, y) scale(s, −s); unsere Abbildung spiegelt y bereits → s = scale
      this.push(
        ...drawSvgPath(d, {
          x: local[4],
          y: local[5],
          scale,
          color: fillC,
          borderColor: strokeC,
          borderWidth: strokeC ? lw / scale : 0,
          ...(dash && strokeC ? { borderDashArray: dash.map((x) => x / scale) } : {}),
          ...(gs ? { graphicsState: gs } : {}),
        }),
      );
      return;
    }

    const pts =
      p.t === 'poly'
        ? p.pts.map((q) => apply(m, q.x, q.y))
        : p.t === 'line'
          ? [apply(m, p.a.x, p.a.y), apply(m, p.b.x, p.b.y)]
          : [apply(m, p.x, p.y), apply(m, p.x + p.w, p.y), apply(m, p.x + p.w, p.y + p.h), apply(m, p.x, p.y + p.h)];
    if (pts.length < 2) return;
    const closed = p.t !== 'line';
    this.push(pushGraphicsState());
    if (gs) this.push(setGraphicsState(gs));
    if (fillC && closed) this.push(setFillingColor(fillC));
    if (strokeC) {
      this.push(setStrokingColor(strokeC), setLineWidth(lw));
      if (dash) this.push(setDashPattern(dash, 0));
    }
    this.push(moveTo(pts[0]!.x, pts[0]!.y));
    for (let i = 1; i < pts.length; i++) this.push(lineTo(pts[i]!.x, pts[i]!.y));
    if (closed) this.push(closePath());
    this.push(fillC && closed && strokeC ? fillAndStroke() : fillC && closed ? fill() : stroke());
    this.push(popGraphicsState());
  }

  private text(p: TextPrim, m: Mat, k: number, st: PaperStyle) {
    const { font, key } = this.font(p.weight);
    const size = p.size * k;
    const color = colorOf(st.fill, p.color) ?? rgb(0, 0, 0);
    p.lines.forEach((line, i) => {
      if (!line) return;
      const at = apply(m, p.x, p.y + i * p.lineHeight);
      const w = font.widthOfTextAtSize(line, size);
      const x = p.anchor === 'middle' ? at.x - w / 2 : p.anchor === 'end' ? at.x - w : at.x;
      const hex = font.encodeText(line);
      const run = (mode: TextRenderingMode) => [beginText(), setFontAndSize(key, size), setTextRenderingMode(mode), setTextMatrix(1, 0, 0, 1, x, at.y), showText(hex), endText()];
      this.push(pushGraphicsState());
      if (st.halo) {
        // Weißer Rand zuerst (wie paint-order: stroke auf der Zeichenfläche), dann die Schrift
        this.push(setStrokingColor(rgb(1, 1, 1)), setLineWidth(size * 0.22), setLineJoin(LineJoinStyle.Round), ...run(TextRenderingMode.Outline));
      }
      this.push(setFillingColor(color), ...run(TextRenderingMode.Fill));
      this.push(popGraphicsState());
    });
  }
}

// ---------- Hintergrund ----------

/**
 * Quell-Einheiten des Hintergrunds → Meter (core/background.ts): verschieben, drehen (Grad im Uhrzeigersinn),
 * skalieren mit metersPerPx.
 */
function bgToWorld(bg: Background): Mat {
  const { x, y, metersPerPx: s, rot } = bg.transform;
  const r = (rot * Math.PI) / 180;
  const c = Math.cos(r) * s;
  const n = Math.sin(r) * s;
  return [c, n, -n, c, x, y];
}

/**
 * Form-Raum einer eingebetteten PDF-Seite (BBox = CropBox, Ursprung links unten) → Quell-Pixel wie bei pdf.js
 * (Viewport mit Maßstab 1 und Seitendrehung, y nach unten).
 */
function formToSource(rotate: number, w: number, h: number): Mat {
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, 0, 0];
    case 180:
      return [-1, 0, 0, 1, w, 0];
    case 270:
      return [0, -1, -1, 0, h, w];
    default:
      return [1, 0, 0, -1, 0, h];
  }
}

// ---------- Dokument ----------

export async function writePdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setTitle(input.title, { showInWindowTitleBar: true });
  doc.setCreator(`${APP_NAME} ${APP_VERSION} – ${APP_AUTHOR}, ${APP_URL}`);
  doc.setProducer(`${APP_NAME} ${APP_VERSION}`);
  doc.setLanguage('de-DE');
  const fonts = {
    400: await doc.embedFont(input.fonts.regular, { subset: true }),
    500: await doc.embedFont(input.fonts.medium, { subset: true }),
    600: await doc.embedFont(input.fonts.semibold, { subset: true }),
  } as const;

  const appendixPages = layoutAppendix(input.appendix, fonts[400], fonts[600]);
  const total = input.pages.length + appendixPages.length + 1;
  let done = 0;
  const step = async () => {
    if (input.cancelled?.()) throw new ExportCancelled('abgebrochen');
    input.onProgress?.(++done, total);
    await Promise.resolve();
  };

  const embeddedPdfs = new Map<string, Promise<{ ref: PDFRef; rotate: number; w: number; h: number }>>();
  const outline: { title: string; page: PDFPage }[] = [];

  for (const pin of input.pages) {
    if (input.cancelled?.()) throw new ExportCancelled('abgebrochen');
    const { scene } = pin;
    const { frame } = scene;
    const W = mmToPt(frame.paper.w);
    const H = mmToPt(frame.paper.h);
    const page = doc.addPage([W, H]);
    const pw = new PageWriter(doc, page, fonts, input.iconPath);
    // Welt (Meter) → Punkte: 1 m = 1000/n mm
    const k = mmToPt(1000 / frame.scale);
    const world: Mat = [k, 0, 0, -k, -k * frame.bounds.minX, H + k * frame.bounds.minY];
    // Weißes Papier (Betrachter mit dunklem Grund zeigen sonst Transparenz), dann alles auf das Blatt beschnitten
    pw.push(pushGraphicsState(), setFillingColor(rgb(1, 1, 1)), rectangle(0, 0, W, H), fill(), popGraphicsState());
    pw.push(pushGraphicsState(), rectangle(0, 0, W, H), clip(), endPath());

    const bg = scene.background;
    const prepared = pin.background;
    if (bg && prepared) {
      const toPt = mul(world, bgToWorld(bg));
      const gs = pw.opacity(bg.opacity, bg.opacity);
      pw.push(pushGraphicsState());
      if (gs) pw.push(setGraphicsState(gs));
      if (prepared.kind === 'pdf') {
        let emb = embeddedPdfs.get(prepared.key);
        if (!emb) {
          emb = embedBackgroundPdf(doc, prepared.bytes);
          embeddedPdfs.set(prepared.key, emb);
        }
        const e = await emb;
        // Quell-Pixel des Imports entsprechen den Punkten der Seite (pdf.js, Maßstab 1); die Skalierung steckt in bg
        const m = mul(toPt, formToSource(e.rotate, e.w, e.h));
        pw.push(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(pw.xobject(e.ref)), popGraphicsState());
      } else {
        for (const t of prepared.tiles) {
          const img = t.format === 'jpg' ? await doc.embedJpg(t.bytes) : await doc.embedPng(t.bytes);
          // Bild im Einheitsquadrat (y nach oben) → Kachel in Quell-Pixeln (y nach unten)
          const m = mul(toPt, [t.w, 0, 0, -t.h, t.x, t.y + t.h]);
          pw.push(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(pw.xobject(img.ref)), popGraphicsState());
        }
      }
      pw.push(popGraphicsState());
    }

    for (const layer of scene.layers) pw.prims(layer.prims, world, k);
    // Papier-Elemente in mm auf dem Papier
    const pk = PT_PER_MM;
    for (const el of scene.paper) pw.prims(el.prims, [pk, 0, 0, -pk, pk * el.at.x, H - pk * el.at.y], pk);
    // Vermerk mittig im unteren Rand (Papier-Elemente liegen mit 10 mm Abstand darüber)
    pw.prims([notePrim(frame.paper.w / 2, frame.paper.h - NOTE_BOTTOM, 'middle')], [pk, 0, 0, -pk, 0, H], pk);
    pw.push(popGraphicsState());
    pw.flush();
    outline.push({ title: scene.name, page });
    await step();
  }

  // Anhang
  let firstOfTable = -1;
  appendixPages.forEach((ap, i) => {
    const page = doc.addPage([mmToPt(297), mmToPt(210)]);
    const pw = new PageWriter(doc, page, fonts, input.iconPath);
    const pk = PT_PER_MM;
    const m: Mat = [pk, 0, 0, -pk, 0, mmToPt(210)];
    pw.prims(appendixPrims(ap, input.projectName, i + 1, appendixPages.length, fonts[400], fonts[600]), m, pk);
    pw.flush();
    if (ap.first && ap.table !== firstOfTable) outline.push({ title: input.appendix[ap.table]!.title, page });
    firstOfTable = ap.table;
  });
  for (let i = 0; i < appendixPages.length; i++) await step();

  addOutline(doc, outline);
  const bytes = await doc.save({ useObjectStreams: true, objectsPerTick: 200 });
  await step();
  return bytes;
}

async function embedBackgroundPdf(doc: PDFDocument, bytes: Uint8Array): Promise<{ ref: PDFRef; rotate: number; w: number; h: number }> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new UserError('Der PDF-Hintergrund kann nicht eingebettet werden.');
  }
  const page = src.getPage(0);
  const crop = page.getCropBox();
  const box = { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height };
  const emb = await doc.embedPage(page, box);
  return { ref: emb.ref, rotate: page.getRotation().angle, w: crop.width, h: crop.height };
}

/** Lesezeichen (PDF-Gliederung) je Page und Teil des Anhangs. */
function addOutline(doc: PDFDocument, items: { title: string; page: PDFPage }[]) {
  if (!items.length) return;
  const ctx = doc.context;
  const root = ctx.nextRef();
  const refs = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const dict = ctx.obj({}) as PDFDict;
    dict.set(PDFName.of('Title'), PDFHexString.fromText(it.title));
    dict.set(PDFName.of('Parent'), root);
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]!);
    if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]!);
    const dest = PDFArray.withContext(ctx);
    dest.push(it.page.ref);
    dest.push(PDFName.of('Fit'));
    dict.set(PDFName.of('Dest'), dest);
    ctx.assign(refs[i]!, dict);
  });
  const outlines = ctx.obj({ Type: 'Outlines' }) as PDFDict;
  outlines.set(PDFName.of('First'), refs[0]!);
  outlines.set(PDFName.of('Last'), refs[refs.length - 1]!);
  outlines.set(PDFName.of('Count'), PDFNumber.of(refs.length));
  ctx.assign(root, outlines);
  doc.catalog.set(PDFName.of('Outlines'), root);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Vermerk „erstellt mit“ (#5): 2 mm Schrift (≈ 5,7 pt), Grundlinie `NOTE_BOTTOM` mm über der Unterkante. */
const NOTE_SIZE = 2;
const NOTE_BOTTOM = 3;
const notePrim = (x: number, y: number, anchor: TextPrim['anchor']): TextPrim => ({
  t: 'text',
  s: 'paper-note',
  x,
  y,
  lines: [exportNote()],
  size: NOTE_SIZE,
  lineHeight: NOTE_SIZE * 1.2,
  anchor,
  weight: 400,
});

// ---------- Anhang (A4 quer, mm) ----------

const A4 = { w: 297, h: 210 };
const MARGIN = 12;
const HEAD_H = 10;
const ROW_H = 5;
const TEXT = 2.6;
const FOOT = 8;
const CELL_PAD = 1.5;

interface AppendixPage {
  table: number;
  first: boolean;
  title: string;
  columns: AppendixColumn[];
  rows: string[][];
  widths: number[];
}

const textWidthMm = (font: PDFFont, s: string, sizeMm: number) => font.widthOfTextAtSize(s, mmToPt(sizeMm)) / PT_PER_MM;

/** Spaltenbreiten aus der Schrift (höchstens 32 % je Spalte), notfalls anteilig verkleinert. */
function columnWidths(t: AppendixTable, font: PDFFont, bold: PDFFont): number[] {
  const avail = A4.w - 2 * MARGIN;
  const natural = t.columns.map((c, i) => {
    let w = textWidthMm(bold, c.label, TEXT);
    for (const r of t.rows) w = Math.max(w, textWidthMm(font, r[i] ?? '', TEXT));
    return w + 2 * CELL_PAD;
  });
  const capped = natural.map((w) => Math.min(w, avail * 0.32));
  const sum = capped.reduce((a, b) => a + b, 0);
  return sum > avail ? capped.map((w) => (w * avail) / sum) : capped;
}

function layoutAppendix(tables: readonly AppendixTable[], font: PDFFont, bold: PDFFont): AppendixPage[] {
  const perPage = Math.floor((A4.h - 2 * MARGIN - HEAD_H - FOOT - ROW_H) / ROW_H);
  const out: AppendixPage[] = [];
  tables.forEach((t, ti) => {
    const base = { table: ti, title: t.title, columns: t.columns, widths: columnWidths(t, font, bold) };
    if (!t.rows.length) out.push({ ...base, first: true, rows: [] });
    for (let i = 0; i < t.rows.length; i += perPage) out.push({ ...base, first: i === 0, rows: t.rows.slice(i, i + perPage) });
  });
  return out;
}

/** Zelltext auf die Spaltenbreite kürzen („…“). */
function fitCell(font: PDFFont, s: string, maxMm: number): string {
  if (textWidthMm(font, s, TEXT) <= maxMm) return s;
  let t = s;
  while (t.length > 1 && textWidthMm(font, `${t}…`, TEXT) > maxMm) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function appendixPrims(ap: AppendixPage, projectName: string, n: number, total: number, font: PDFFont, bold: PDFFont): Prim[] {
  const out: Prim[] = [];
  const text = (s: string, x: number, y: number, size: number, weight: 400 | 600 = 400, anchor: TextPrim['anchor'] = 'start'): TextPrim => ({
    t: 'text',
    s: 'paper-text',
    x,
    y,
    lines: [s],
    size,
    lineHeight: size,
    anchor,
    weight,
  });
  out.push(text(`${projectName} – ${ap.title}`, MARGIN, MARGIN + 4, 4, 600));
  let y = MARGIN + HEAD_H;
  const xs: number[] = [];
  let x = MARGIN;
  for (const w of ap.widths) {
    xs.push(x);
    x += w;
  }
  const tableW = x - MARGIN;
  const row = (cells: readonly string[], weight: 400 | 600) => {
    cells.forEach((c, i) => {
      const right = ap.columns[i]!.align === 'right';
      const w = ap.widths[i]!;
      const s = fitCell(weight === 600 ? bold : font, c, w - 2 * CELL_PAD);
      out.push(text(s, right ? xs[i]! + w - CELL_PAD : xs[i]! + CELL_PAD, y + ROW_H - 1.6, TEXT, weight, right ? 'end' : 'start'));
    });
  };
  out.push({ t: 'rect', s: 'paper-shade', x: MARGIN, y, w: tableW, h: ROW_H });
  row(
    ap.columns.map((c) => c.label),
    600,
  );
  y += ROW_H;
  out.push({ t: 'line', s: 'paper-rule', a: { x: MARGIN, y }, b: { x: MARGIN + tableW, y } });
  ap.rows.forEach((r, i) => {
    if (i % 2 === 1) out.push({ t: 'rect', s: 'paper-shade', x: MARGIN, y, w: tableW, h: ROW_H });
    row(r, 400);
    y += ROW_H;
  });
  if (!ap.rows.length) out.push(text('Keine Einträge.', MARGIN + CELL_PAD, y + ROW_H - 1.6, TEXT));
  out.push(text(`Anhang – Seite ${n} von ${total}`, A4.w / 2, A4.h - MARGIN + 2, TEXT, 400, 'middle'));
  out.push(notePrim(A4.w / 2, A4.h - NOTE_BOTTOM, 'middle'));
  return out;
}
