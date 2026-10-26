/**
 * Geschätzte Dateigröße eines PDF-Exports (M8-Nacharbeit, spec.md §9), angezeigt im Export-Dialog vor dem Export.
 *
 * - Grundanteil: Schriften (Teilmengen) und je Page der Vektorinhalt (Stände mit Beschriftung, Freiflächen, Legende,
 *   Schriftfeld); Anhang je Zeile.
 * - PDF-Hintergrund: Größe der eingebetteten Datei, einmal je Datei.
 * - Rasterhintergrund: unverändert eingebettet = Größe der Datei; sonst Ausgabepixel × Bytes je Pixel. Bei JPEG geht
 *   das Verhältnis der Quelldatei ein, umgerechnet von ihrer Qualität (aus der Quantisierungstabelle) auf die
 *   Zielqualität; bei PNG das Verhältnis der Quelle; bei „E-Mail“ aus PNG/SVG ein Erfahrungswert für JPEG 60.
 *
 * Eine Schätzung, kein Versprechen: Bildinhalt und Kompression schwanken.
 */
import { mimeForAsset } from '../core/assets';
import { rasterQuality, type AppendixPart, type ExportDpi, type ExportProfile } from '../core/exportProfiles';
import type { Id, Project } from '../core/model/types';
import { pagePaper } from '../core/paper';
import { dqtLumaSum, ijgLumaSum, outputFormat, rasterPlan } from './pdfBackground';

const FONTS = 120_000;
const PER_PAGE = 30_000;
const PER_OBJECT = 250;
const PER_APPENDIX_ROW = 80;
/** Bytes je Pixel für JPEG 60 aus Strichplänen (PNG/SVG) und für gerasterte SVG als PNG. */
const JPEG60_LINEART = 0.12;
const SVG_PNG = 0.3;

/**
 * Relative Größe einer JPEG-Datei je libjpeg-Qualität (gemessen an einem Strichplan, Qualität 85 = 1). Zwischenwerte
 * linear.
 */
const JPEG_SIZE: readonly [number, number][] = [
  [10, 0.3],
  [50, 0.56],
  [60, 0.63],
  [75, 0.8],
  [85, 1],
  [90, 1.2],
  [95, 1.54],
  [98, 1.85],
  [100, 2.3],
];
export function jpegSizeFactor(q: number): number {
  const i = JPEG_SIZE.findIndex(([x]) => x >= q);
  if (i <= 0) return JPEG_SIZE[Math.max(0, i)]![1];
  const [x0, y0] = JPEG_SIZE[i - 1]!;
  const [x1, y1] = JPEG_SIZE[i]!;
  return y0 + ((q - x0) / (x1 - x0)) * (y1 - y0);
}

/** libjpeg-Qualität einer JPEG-Datei aus ihrer Quantisierungstabelle (die nächstliegende); ohne Tabelle 85. */
export function jpegQualityOf(file: Uint8Array): number {
  const sum = dqtLumaSum(file);
  if (sum === null) return 85;
  let best = 85;
  for (let q = 1; q <= 100; q++) if (Math.abs(ijgLumaSum(q) - sum) < Math.abs(ijgLumaSum(best) - sum)) best = q;
  return best;
}

export function estimateExportBytes(
  project: Project,
  profile: ExportProfile,
  pageIds: readonly Id[] | null,
  appendix: Record<AppendixPart, boolean>,
  quality: ExportDpi | number,
  assets: Readonly<Record<string, Uint8Array>>,
): number {
  const pages = pageIds ? project.pages.filter((p) => pageIds.includes(p.id)) : project.pages;
  const q = rasterQuality(quality);
  let bytes = FONTS;
  const pdfAssets = new Set<string>();
  for (const page of pages) {
    bytes += PER_PAGE + PER_OBJECT * (page.stands.length + page.infra.length + page.areas.length);
    const bg = profile.layers.background ? page.background : null;
    const file = bg ? assets[bg.assetId] : undefined;
    if (!bg || !file) continue;
    if (bg.kind === 'pdf') {
      pdfAssets.add(bg.assetId);
      continue;
    }
    const frame = pagePaper(page, project).frame;
    const plan = rasterPlan(bg, frame, quality);
    if (!plan) continue;
    const format = outputFormat(bg, quality);
    const source = mimeForAsset(bg.assetId);
    if (bg.kind === 'image' && plan.unchanged && (source === 'image/jpeg') === (format === 'jpg')) {
      bytes += file.length;
      continue;
    }
    const sourceBpp = file.length / (bg.pxSize.w * bg.pxSize.h);
    let bpp: number;
    if (bg.kind === 'svg') bpp = format === 'jpg' ? JPEG60_LINEART : SVG_PNG;
    else if (source === 'image/jpeg') bpp = (sourceBpp * jpegSizeFactor(q.jpeg)) / jpegSizeFactor(jpegQualityOf(file));
    else bpp = format === 'jpg' ? Math.min(JPEG60_LINEART, sourceBpp) : sourceBpp;
    bytes += plan.outPx * bpp;
  }
  for (const id of pdfAssets) bytes += assets[id]?.length ?? 0;
  const rows = (appendix.stands && profile.appendix.stands ? pages.reduce((n, p) => n + p.stands.length, 0) : 0) + (appendix.infra && profile.appendix.infra ? pages.reduce((n, p) => n + p.infra.length, 0) : 0);
  bytes += rows * PER_APPENDIX_ROW + (appendix.free && profile.appendix.free ? pages.length * 2000 : 0);
  return bytes;
}

/** „ca. 12 MB“, „ca. 450 KB“ (gerundet auf zwei geltende Stellen). */
export function sizeText(bytes: number): string {
  const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('de-DE');
  return bytes >= 1e6 ? `ca. ${round(bytes / 1e6)} MB` : `ca. ${Math.max(1, Math.round(bytes / 1e3)).toLocaleString('de-DE')} KB`;
}
