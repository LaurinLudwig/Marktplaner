/**
 * Darstellung von Hintergrundplänen (DOM, außerhalb von core).
 *
 * PDF: pdf.js rendert in zwei Stufen.
 *   1. Grundbild der ganzen Seite, höchstens BASE_MAX_PIXELS (Safari/WKWebView erlauben
 *      höchstens 16,7 MP pro Canvas). Steht sofort für Zoom und Pan bereit.
 *   2. Detailbild nur des sichtbaren Ausschnitts in Bildschirmauflösung, sobald die Ansicht kurz
 *      ruht und stärker vergrößert ist, als das Grundbild hergibt (siehe BackgroundLayer.tsx).
 *      Die Kosten hängen von der Fenstergröße ab, nicht von der Plangröße.
 * SVG, PNG, JPEG: direkt als <image>; SVG zeichnet der Browser als Vektor.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { mimeForAsset } from '../../../core/assets';
import { UserError } from '../../../core/errors';
import { checkJpeg, checkPng } from '../../../core/imageCheck';
import type { Bounds } from '../../../core/viewport';

export const BASE_MAX_PIXELS = 8_000_000;
export const DETAIL_MAX_PIXELS = 12_000_000;
const MAX_SCALE = 6;

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js erst bei Bedarf laden (spart Startzeit); Zusatzdateien liegen lokal unter /pdfjs/. */
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return lib;
  });
  return pdfjsPromise;
}

const assetBase = `${import.meta.env.BASE_URL}pdfjs/`;

/** Deutsche Meldung für Fehler von pdf.js (dessen Texte sind englisch). */
export function pdfErrorMessage(e: unknown): UserError {
  if (e instanceof UserError) return e;
  console.warn('PDF-Fehler', e);
  const name = e instanceof Error ? e.name : '';
  if (name === 'PasswordException') return new UserError('Das PDF ist kennwortgeschützt. Bitte eine Fassung ohne Kennwortschutz exportieren.');
  return new UserError('Die PDF-Datei ist beschädigt oder unvollständig und kann nicht gelesen werden.');
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  // pdf.js übergibt die Daten an den Worker und macht den Puffer unbrauchbar → Kopie übergeben.
  return lib
    .getDocument({
    data: bytes.slice(),
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
    enableXfa: false,
    })
    .promise.catch((e: unknown) => {
      throw pdfErrorMessage(e);
    });
}

/** Größe einer Seite in PDF-Punkten (inkl. Seitendrehung). */
export function pageSize(page: PDFPageProxy): { w: number; h: number } {
  const vp = page.getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height };
}

async function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new UserError('Das gerenderte Bild konnte nicht erzeugt werden.');
  return URL.createObjectURL(blob);
}

export interface RenderedImage {
  url: string;
  /** Ausschnitt in Quell-Einheiten (PDF-Punkte), den das Bild abdeckt. */
  region: Bounds;
  /** Pixel pro Quell-Einheit. */
  scale: number;
}

/** Rendert einen Ausschnitt (oder die ganze Seite) mit `scale` Pixeln pro Punkt. */
export async function renderPdfRegion(
  page: PDFPageProxy,
  region: Bounds,
  scale: number,
  isCancelled: () => boolean = () => false,
): Promise<RenderedImage | null> {
  const w = Math.max(1, Math.ceil((region.maxX - region.minX) * scale));
  const h = Math.max(1, Math.ceil((region.maxY - region.minY) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const viewport = page.getViewport({ scale });
  const task = page.render({
    canvas,
    viewport,
    // Ausschnitt an den Canvas-Ursprung verschieben
    transform: [1, 0, 0, 1, -region.minX * scale, -region.minY * scale],
    background: '#ffffff',
  });
  try {
    await task.promise;
  } catch (e) {
    if (isCancelled()) return null;
    throw e;
  }
  if (isCancelled()) return null;
  const url = await canvasToUrl(canvas);
  canvas.width = canvas.height = 0; // Speicher sofort freigeben
  return { url, region, scale };
}

/** Pixel pro Punkt für ein Bild mit höchstens `maxPixels`. */
export function scaleForBudget(size: { w: number; h: number }, maxPixels: number, wanted = MAX_SCALE): number {
  return Math.min(wanted, MAX_SCALE, Math.sqrt(maxPixels / Math.max(size.w * size.h, 1)));
}

// ---------- Cache je eingebetteter Datei ----------

interface PdfEntry {
  doc: Promise<PDFDocumentProxy>;
  page: Promise<PDFPageProxy>;
  base: Promise<RenderedImage> | null;
}
const pdfCache = new Map<string, PdfEntry>();
const urlCache = new Map<string, string>();

export function pdfEntry(assetId: string, bytes: Uint8Array): PdfEntry {
  let e = pdfCache.get(assetId);
  if (!e) {
    const doc = openPdf(bytes);
    e = { doc, page: doc.then((d) => d.getPage(1)), base: null };
    pdfCache.set(assetId, e);
  }
  return e;
}

/** Grundbild der ganzen PDF-Seite (einmal pro Datei). */
export function pdfBase(assetId: string, bytes: Uint8Array): Promise<RenderedImage> {
  const e = pdfEntry(assetId, bytes);
  e.base ??= e.page.then(async (page) => {
    const size = pageSize(page);
    const img = await renderPdfRegion(page, { minX: 0, minY: 0, maxX: size.w, maxY: size.h }, scaleForBudget(size, BASE_MAX_PIXELS));
    return img!;
  });
  return e.base;
}

/** Objekt-URL für SVG/PNG/JPEG (einmal pro Datei). */
export function imageUrl(assetId: string, bytes: Uint8Array): string {
  let url = urlCache.get(assetId);
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeForAsset(assetId) }));
    urlCache.set(assetId, url);
  }
  return url;
}

/**
 * Größe einer SVG/PNG/JPEG-Datei in Quell-Einheiten. SVGs ohne width/height werden über ihre
 * viewBox vermessen.
 */
export async function imageSize(bytes: Uint8Array, mime: string): Promise<{ w: number; h: number }> {
  if (mime === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new UserError('Die SVG-Datei ist ungültig.');
    const parseLen = (v: string | null) => {
      if (!v || v.trim().endsWith('%')) return NaN;
      const n = Number.parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : NaN;
    };
    const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const w = parseLen(svg.getAttribute('width'));
    const h = parseLen(svg.getAttribute('height'));
    if (w > 0 && h > 0) return { w, h };
    if (vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) return { w: vb[2]!, h: vb[3]! };
    throw new UserError('Die SVG-Datei hat weder Breite/Höhe noch eine viewBox.');
  }
  // Vorab Struktur prüfen: abgeschnittene Dateien abweisen (WebKit würde ein Teilbild zeigen)
  if (mime === 'image/png') checkPng(bytes);
  else checkJpeg(bytes);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    console.warn('Bild nicht dekodierbar', e);
    throw new UserError('Das Bild kann nicht gelesen werden (beschädigt oder unvollständig).');
  }
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return size;
}
