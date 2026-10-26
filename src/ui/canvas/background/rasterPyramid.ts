/**
 * Große Rasterbilder (PNG/JPEG) in Auflösungsstufen und Kacheln (QA-M2-03).
 *
 * WebKit (= WKWebView der macOS-App) ruckelt, wenn ein einzelnes 48- oder 108-MP-Bild bei jedem
 * Zoomschritt neu skaliert werden muss. Stattdessen:
 *   - Übersicht: das ganze Bild verkleinert auf höchstens OVERVIEW_MAX Pixel Kantenlänge, liegt immer unten.
 *   - Stufe k: Bild verkleinert um 2^k, zerlegt in TILE × TILE Pixel große Kacheln. Gezeichnet werden
 *     nur die sichtbaren Kacheln der Stufe, deren Auflösung zum Zoom passt (siehe chooseLevel).
 * Kacheln entstehen erst bei Bedarf direkt aus dem dekodierten Original (kein Zwischen-Canvas über
 * 16,7 MP, das WebKit nicht erlaubt) und werden zwischengespeichert.
 */
import { mimeForAsset } from '../../../core/assets';
import type { Bounds } from '../../../core/viewport';

export const TILE = 512;
export const OVERVIEW_MAX = 2048;
/** Ab dieser Größe wird gekachelt; kleinere Bilder zeigt der Browser direkt. */
export const PYRAMID_MIN_PIXELS = 16_000_000;
export const PYRAMID_MIN_SIDE = 4096;
const MAX_CACHED_TILES = 400;

export const needsPyramid = (size: { w: number; h: number }) =>
  size.w * size.h > PYRAMID_MIN_PIXELS || Math.max(size.w, size.h) > PYRAMID_MIN_SIDE;

export interface Pyramid {
  w: number;
  h: number;
  /** Verkleinerungsfaktor der Übersicht (Potenz von 2). */
  overviewFactor: number;
  overview: Promise<string>;
  /** Anzahl der Kachelstufen 0 … maxLevel (Stufe maxLevel+1 wäre die Übersicht). */
  maxLevel: number;
  source: Promise<ImageBitmap>;
  mime: string;
}

export interface Tile {
  key: string;
  url: string;
  /** Bereich in Quellpixeln. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const pyramids = new Map<string, Pyramid>();
const tileCache = new Map<string, Promise<string>>();

function encode(canvas: HTMLCanvasElement, mime: string): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Kachel konnte nicht erzeugt werden.'))),
      mime === 'image/png' ? 'image/png' : 'image/jpeg',
      0.9,
    ),
  );
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Zeichenfläche für Kacheln nicht verfügbar.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Übersicht in Halbierungsschritten (bessere Qualität als ein einziger großer Verkleinerungsschritt). */
async function buildOverview(source: ImageBitmap, factor: number, mime: string): Promise<string> {
  let current: CanvasImageSource = source;
  let cw = source.width;
  let ch = source.height;
  let remaining = factor;
  // Erster Schritt: kleinste Verkleinerung (Potenz von 2), bei der das Zwischenbild unter der
  // WebKit-Grenze von 16,7 MP bleibt; danach jeweils halbieren
  let step = 1;
  while (step < remaining && (cw / step) * (ch / step) > 16_000_000) step *= 2;
  if (step === 1) step = Math.min(2, remaining);
  for (;;) {
    const nw = Math.max(1, Math.round(cw / step));
    const nh = Math.max(1, Math.round(ch / step));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    context(canvas).drawImage(current, 0, 0, nw, nh);
    current = canvas;
    cw = nw;
    ch = nh;
    remaining /= step;
    if (remaining <= 1) return encode(canvas, mime);
    step = 2;
  }
}

export function pyramidFor(assetId: string, bytes: Uint8Array, size: { w: number; h: number }): Pyramid {
  let p = pyramids.get(assetId);
  if (!p) {
    const mime = mimeForAsset(assetId);
    const source = createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    let overviewFactor = 1;
    while (Math.max(size.w, size.h) / overviewFactor > OVERVIEW_MAX) overviewFactor *= 2;
    p = {
      w: size.w,
      h: size.h,
      overviewFactor,
      overview: source.then((s) => buildOverview(s, overviewFactor, mime)),
      maxLevel: Math.max(0, Math.log2(overviewFactor) - 1),
      source,
      mime,
    };
    pyramids.set(assetId, p);
  }
  return p;
}

/**
 * Stufe für `screenPerSource` Bildschirmpixel je Quellpixel (inkl. Retina-Faktor): die gröbste Stufe,
 * die noch mindestens so fein ist wie der Bildschirm. null = Übersicht reicht.
 */
export function chooseLevel(p: Pyramid, screenPerSource: number): number | null {
  if (screenPerSource <= 1 / p.overviewFactor) return null;
  const level = Math.floor(Math.log2(1 / Math.max(screenPerSource, 1e-9)));
  return Math.min(p.maxLevel, Math.max(0, level));
}

/** Sichtbare Kacheln einer Stufe für einen Ausschnitt in Quellpixeln. */
export function tilesFor(p: Pyramid, level: number, region: Bounds): { tx: number; ty: number; x: number; y: number; w: number; h: number }[] {
  const span = TILE * 2 ** level; // Quellpixel je Kachel
  const out = [];
  for (let ty = Math.floor(region.minY / span); ty * span < Math.min(region.maxY, p.h); ty++) {
    for (let tx = Math.floor(region.minX / span); tx * span < Math.min(region.maxX, p.w); tx++) {
      const x = tx * span;
      const y = ty * span;
      out.push({ tx, ty, x, y, w: Math.min(span, p.w - x), h: Math.min(span, p.h - y) });
    }
  }
  return out;
}

export function tileUrl(assetId: string, p: Pyramid, level: number, t: { tx: number; ty: number; x: number; y: number; w: number; h: number }): Promise<string> {
  const key = `${assetId}/${level}/${t.tx}/${t.ty}`;
  let url = tileCache.get(key);
  if (!url) {
    url = p.source.then((src) => {
      const f = 2 ** level;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(t.w / f));
      canvas.height = Math.max(1, Math.round(t.h / f));
      context(canvas).drawImage(src, t.x, t.y, t.w, t.h, 0, 0, canvas.width, canvas.height);
      return encode(canvas, p.mime);
    });
    tileCache.set(key, url);
    // Einfache Begrenzung: älteste Kacheln verwerfen
    if (tileCache.size > MAX_CACHED_TILES) {
      const [oldKey, oldUrl] = tileCache.entries().next().value as [string, Promise<string>];
      tileCache.delete(oldKey);
      void oldUrl.then((u) => setTimeout(() => URL.revokeObjectURL(u), 2000));
    }
  }
  return url;
}
