/**
 * Hintergründe für den PDF-Export vorbereiten (M8-06, spec.md §9). Läuft im Web Worker (OffscreenCanvas) und, für
 * SVG-Pläne, auf dem Hauptthread.
 *
 * - PDF: bleibt Vektor; der Schreiber bettet die Originalseite ein.
 * - PNG/JPEG: nur der Ausschnitt auf dem Blatt; heruntergerechnet, wenn die Quelle feiner ist als die
 *   Ziel-Auflösung (nie hochgerechnet). JPEG bleibt JPEG (Qualität 85), PNG bleibt PNG. Unverändert eingebettet,
 *   wenn weder beschnitten noch verkleinert wird. Über 16 Megapixel in Kacheln.
 * - SVG: in der Ziel-Auflösung gerastert (PNG; Vektor siehe E-53).
 * - „E-Mail“ (M8-Nacharbeit): 100 dpi, alles als JPEG mit Qualität 60.
 *
 * JPEG-Qualität (M8-Nacharbeit): Die Browser deuten den Wert von `convertToBlob` verschieden (WebKit 0,85 ≈ libjpeg
 * 97, Chromium 0,85 = libjpeg 85). `engineJpegQuality` sucht deshalb einmal je Browser den Wert, dessen
 * Quantisierungstabelle der libjpeg-Tabelle für die gewünschte Qualität am nächsten kommt.
 */
import { visibleSourceRegion } from '../core/background';
import { mimeForAsset } from '../core/assets';
import { DEFAULT_DPI, rasterQuality, type ExportDpi } from '../core/exportProfiles';
import type { Background } from '../core/model/types';
import type { PreparedBackground, RasterTile } from '../core/pdf/writePdf';
import type { SheetFrame } from '../core/sheet';

/** Größte Kachel (Pixel je Seite); 2048² ≈ 4 MP, sicher für alle Leinwandgrenzen. */
const TILE = 2048;
/** Ab dieser Größe (Megapixel) wird in Kacheln gearbeitet. */
const TILE_FROM_PX = 16_000_000;
/** Höchstens so viele Ausgabepixel je Seite bei „Original“ (Speicher). */
const MAX_OUT_PX = 200_000_000;

/**
 * Ausgabe-Pixel je Quell-Pixel für die Ziel-Auflösung. Rasterbilder werden nie hochgerechnet (höchstens 1); SVG ist
 * Vektor und wird in der Ziel-Auflösung gerastert („Original“ = 200 dpi).
 */
export function rasterFactor(bg: Background, frame: SheetFrame, quality: ExportDpi | number): number {
  const mmPerPx = (bg.transform.metersPerPx * 1000) / frame.scale;
  const sourceDpi = 25.4 / mmPerPx;
  const { dpi } = rasterQuality(quality);
  if (bg.kind === 'svg') return (dpi === 'original' ? (DEFAULT_DPI as number) : dpi) / sourceDpi;
  if (dpi === 'original') return 1;
  return Math.min(1, dpi / sourceDpi);
}

export interface RasterCanvas {
  /** Leinwand in Ausgabegröße mit dem Ausschnitt `src` (Quell-Pixel) des Bilds. */
  draw(src: { x: number; y: number; w: number; h: number }, out: { w: number; h: number }): Promise<Uint8Array>;
}

/**
 * Plan für einen Rasterhintergrund: Ausschnitt in Quell-Pixeln (auf ganze Pixel erweitert), Faktor und Kacheln.
 * null = der Plan liegt nicht auf dem Blatt.
 */
export function rasterPlan(bg: Background, frame: SheetFrame, quality: ExportDpi | number) {
  const region = visibleSourceRegion(bg.transform, bg.pxSize, frame.bounds);
  if (!region) return null;
  const x0 = Math.max(0, Math.floor(region.minX) - 1);
  const y0 = Math.max(0, Math.floor(region.minY) - 1);
  const x1 = Math.min(bg.pxSize.w, Math.ceil(region.maxX) + 1);
  const y1 = Math.min(bg.pxSize.h, Math.ceil(region.maxY) + 1);
  let factor = rasterFactor(bg, frame, quality);
  const outPx = (x1 - x0) * (y1 - y0) * factor * factor;
  if (outPx > MAX_OUT_PX) factor *= Math.sqrt(MAX_OUT_PX / outPx);
  const whole = x0 === 0 && y0 === 0 && x1 === bg.pxSize.w && y1 === bg.pxSize.h;
  const unchanged = whole && factor >= 0.999;
  const outW = Math.max(1, Math.round((x1 - x0) * factor));
  const outH = Math.max(1, Math.round((y1 - y0) * factor));
  // Kacheln in Ausgabepixeln; Quellrechteck je Kachel mit 1 Ausgabepixel Überlappung gegen Haarlinien
  const tiled = outW * outH > TILE_FROM_PX;
  const step = tiled ? TILE : Math.max(outW, outH);
  const tiles: { src: { x: number; y: number; w: number; h: number }; out: { w: number; h: number } }[] = [];
  for (let oy = 0; oy < outH; oy += step)
    for (let ox = 0; ox < outW; ox += step) {
      const ow = Math.min(step + (tiled ? 1 : 0), outW - ox);
      const oh = Math.min(step + (tiled ? 1 : 0), outH - oy);
      tiles.push({ src: { x: x0 + ox / factor, y: y0 + oy / factor, w: ow / factor, h: oh / factor }, out: { w: ow, h: oh } });
    }
  return { region: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, factor, unchanged, outPx: outW * outH, tiles };
}

/** Ausgabeformat eines Rasterhintergrunds: JPEG bleibt JPEG, sonst PNG; bei „E-Mail“ immer JPEG. */
export function outputFormat(bg: Background, quality: ExportDpi | number): 'jpg' | 'png' {
  return rasterQuality(quality).allJpeg || mimeForAsset(bg.assetId) === 'image/jpeg' ? 'jpg' : 'png';
}

export type CanvasFactory = (bytes: Uint8Array, mime: string, format: 'jpg' | 'png', jpegQuality: number) => Promise<RasterCanvas>;

/**
 * Hintergrund einer Page vorbereiten. `canvasFor` liefert eine Leinwand für das dekodierte Bild (Worker:
 * OffscreenCanvas mit ImageBitmap; Hauptthread: auch SVG); `jpegQuality` = Wert für `convertToBlob` in diesem Browser.
 */
export async function prepareBackground(
  bg: Background,
  bytes: Uint8Array | undefined,
  frame: SheetFrame,
  quality: ExportDpi | number,
  canvasFor: CanvasFactory,
  jpegQuality: number,
): Promise<PreparedBackground | null> {
  if (!bytes) return null;
  if (bg.kind === 'pdf') return { kind: 'pdf', key: bg.assetId, bytes };
  const plan = rasterPlan(bg, frame, quality);
  if (!plan) return null;
  const mime = mimeForAsset(bg.assetId);
  const format = outputFormat(bg, quality);
  const sourceFormat = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : null;
  if (bg.kind === 'image' && plan.unchanged && sourceFormat === format)
    return { kind: 'raster', tiles: [{ bytes, format, x: 0, y: 0, w: bg.pxSize.w, h: bg.pxSize.h }] };
  const canvas = await canvasFor(bytes, mime, format, jpegQuality);
  const tiles: RasterTile[] = [];
  for (const t of plan.tiles) tiles.push({ bytes: await canvas.draw(t.src, t.out), format, x: t.src.x, y: t.src.y, w: t.src.w, h: t.src.h });
  return { kind: 'raster', tiles };
}

/** Leinwand über OffscreenCanvas (Worker und Hauptthread). */
export const offscreenCanvasFor: CanvasFactory = async (bytes, mime, format, jpegQuality) => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  return bitmapCanvas(bitmap, format, jpegQuality);
};

export function bitmapCanvas(source: CanvasImageSource, format: 'jpg' | 'png', jpegQuality: number): RasterCanvas {
  return {
    async draw(src, out) {
      const c = new OffscreenCanvas(out.w, out.h);
      const g = c.getContext('2d');
      if (!g) throw new Error('2D-Leinwand nicht verfügbar');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      if (format === 'jpg') {
        // JPEG kennt keine Transparenz: auf Weiß
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, out.w, out.h);
      }
      g.drawImage(source, src.x, src.y, src.w, src.h, 0, 0, out.w, out.h);
      const blob = await c.convertToBlob(format === 'jpg' ? { type: 'image/jpeg', quality: jpegQuality } : { type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

// ---------- JPEG-Qualität je Browser angleichen ----------

/** Luminanz-Quantisierungstabelle aus Anhang K der JPEG-Norm (Grundlage der libjpeg-Qualitätsskala). */
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103,
  77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** Summe der libjpeg-Luminanztabelle für Qualität `q` (1–100). */
export function ijgLumaSum(q: number): number {
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return STD_LUMA.reduce((n, t) => n + Math.min(255, Math.max(1, Math.floor((t * scale + 50) / 100))), 0);
}

/** Summe der ersten Quantisierungstabelle (Luminanz) einer JPEG-Datei; null, wenn keine gefunden. */
export function dqtLumaSum(jpeg: Uint8Array): number | null {
  for (let i = 2; i + 4 < jpeg.length; ) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1]!;
    const len = (jpeg[i + 2]! << 8) | jpeg[i + 3]!;
    if (marker === 0xdb) {
      const pq = jpeg[i + 4]! >> 4;
      let sum = 0;
      for (let k = 0; k < 64; k++) sum += pq ? (jpeg[i + 5 + 2 * k]! << 8) | jpeg[i + 6 + 2 * k]! : jpeg[i + 5 + k]!;
      return sum;
    }
    if (marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

const calibrated = new Map<number, Promise<number>>();

/**
 * Wert für `convertToBlob({ quality })`, der in diesem Browser der libjpeg-Qualität `ijg` entspricht: binäre Suche
 * über die Summe der Quantisierungstabelle (fällt mit steigender Qualität). Einmal je Qualität und Browser.
 */
export function engineJpegQuality(ijg: number): Promise<number> {
  let p = calibrated.get(ijg);
  if (!p) {
    p = (async () => {
      const c = new OffscreenCanvas(16, 16);
      const g = c.getContext('2d');
      if (!g) return ijg / 100;
      g.fillStyle = '#808080';
      g.fillRect(0, 0, 16, 16);
      const target = ijgLumaSum(ijg);
      const sumAt = async (q: number) => dqtLumaSum(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer()));
      let lo = 0.01;
      let hi = 1;
      let best = { q: ijg / 100, d: Infinity };
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const s = await sumAt(mid);
        if (s === null) return ijg / 100;
        const d = Math.abs(s - target);
        if (d < best.d) best = { q: mid, d };
        if (s > target) lo = mid;
        else hi = mid;
      }
      return best.q;
    })();
    calibrated.set(ijg, p);
  }
  return p;
}
