/**
 * Hilfen für Tests des PDF-Exports (nur Vitest, nicht in der App): Schriften und Symbole aus den Dateien laden,
 * PDFs mit pdf.js auslesen und alle Streams für die Datenschutzprüfung entpacken.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePDFRawStream, PDFDocument, PDFRawStream } from 'pdf-lib';
import type { PdfFonts } from './writePdf';

const root = process.cwd();

export function testFonts(): PdfFonts {
  const f = (w: string) => new Uint8Array(readFileSync(join(root, 'src', 'assets', 'fonts', `IBMPlexSans-${w}.woff`)));
  return { regular: f('Regular'), medium: f('Medium'), semibold: f('SemiBold') };
}

const iconCache = new Map<string, string>();
/** Pfaddaten wie `iconPath` der Oberfläche (src/ui/icons/infraIcons.tsx), direkt aus den SVG-Dateien. */
export function testIconPath(name: string): string {
  let d = iconCache.get(name);
  if (d === undefined) {
    let svg = '';
    try {
      svg = readFileSync(join(root, 'node_modules', '@material-symbols', 'svg-400', 'outlined', `${name}.svg`), 'utf8');
    } catch {
      svg = readFileSync(join(root, 'node_modules', '@material-symbols', 'svg-400', 'outlined', 'info.svg'), 'utf8');
    }
    d = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]).join(' ');
    iconCache.set(name, d);
  }
  return d;
}

export async function pdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export interface ReadPdf {
  pages: { w: number; h: number; text: string; items: { str: string; x: number; y: number }[]; annotations: number }[];
  info: Record<string, unknown>;
  xmp: string | null;
  outline: string[];
  /** Alle Streams entpackt plus die übrigen Objekte als Text (Latin-1), zum Durchsuchen. */
  raw: Uint8Array[];
}

export async function readPdf(bytes: Uint8Array): Promise<ReadPdf> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const pages: ReadPdf['pages'] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const [, , w, h] = p.view as number[];
    const tc = await p.getTextContent();
    const items = tc.items.flatMap((it) => ('str' in it ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }] : []));
    pages.push({ w: w!, h: h!, text: items.map((it) => it.str).join('\n'), items, annotations: (await p.getAnnotations()).length });
  }
  const meta = await doc.getMetadata();
  const outline = ((await doc.getOutline()) ?? []).map((o) => o.title);
  await doc.cleanup();

  const raw: Uint8Array[] = [];
  const pl = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, obj] of pl.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        raw.push(decodePDFRawStream(obj).decode());
      } catch {
        raw.push(obj.getContents());
      }
    } else raw.push(new TextEncoder().encode(obj.toString()));
  }
  return { pages, info: meta.info as Record<string, unknown>, xmp: meta.metadata ? String(meta.metadata.getRaw?.() ?? '') : null, outline, raw };
}

/** Kommt `s` irgendwo in den Rohdaten vor (UTF-8, Latin-1, UTF-16 BE/LE)? */
export function rawContains(raw: readonly Uint8Array[], s: string): boolean {
  const variants: Uint8Array[] = [new TextEncoder().encode(s), Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff))];
  const be = new Uint8Array(s.length * 2);
  const le = new Uint8Array(s.length * 2);
  [...s].forEach((c, i) => {
    const code = c.charCodeAt(0);
    be[2 * i] = code >> 8;
    be[2 * i + 1] = code & 0xff;
    le[2 * i] = code & 0xff;
    le[2 * i + 1] = code >> 8;
  });
  variants.push(be, le);
  const find = (hay: Uint8Array, needle: Uint8Array) => {
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  };
  // Hex-Schreibweise in Text-Strings (<4B414E…>), z. B. Titel in den Metadaten
  const hex = (b: Uint8Array) => new TextEncoder().encode([...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase());
  for (const v of variants.slice()) variants.push(hex(v));
  return raw.some((r) => variants.some((v) => find(r, v)));
}

/** Pfade (Füllung/Linie) mit ihrem Hüllrechteck in Punkten (pdf.js `constructPath`, ohne `cm`). */
export async function pathBoxes(bytes: Uint8Array, pageNo = 1): Promise<{ minX: number; minY: number; maxX: number; maxY: number }[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(pageNo);
  const ops = await page.getOperatorList();
  const out: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  ops.fnArray.forEach((fn, i) => {
    if (fn !== lib.OPS.constructPath) return;
    const args = ops.argsArray[i] as unknown[];
    const mm = args[args.length - 1] as ArrayLike<number> | null;
    if (mm && mm.length >= 4) out.push({ minX: mm[0]!, minY: mm[1]!, maxX: mm[2]!, maxY: mm[3]! });
  });
  await doc.cleanup();
  return out;
}
