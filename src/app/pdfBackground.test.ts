import { describe, expect, it } from 'vitest';
import type { Background } from '../core/model/types';
import type { SheetFrame } from '../core/sheet';
import { BUILTIN_PROFILES } from '../core/exportProfiles';
import { createProject } from '../core/model/defaults';
import { dqtLumaSum, ijgLumaSum, outputFormat, rasterFactor, rasterPlan } from './pdfBackground';
import { estimateExportBytes, sizeText } from './pdfEstimate';

/** Rasterhintergründe im PDF (M8-06): Ausschnitt, Ziel-Auflösung, nie hochrechnen, Kacheln. */

// A3 quer bei 1:1000: 420 × 297 m um (0, 0)
const frame: SheetFrame = { scale: 1000, paper: { w: 420, h: 297 }, bounds: { minX: -210, minY: -148.5, maxX: 210, maxY: 148.5 }, fit: false };
const image = (w: number, h: number, metersPerPx: number, x = 0, y = 0, kind: Background['kind'] = 'image'): Background => ({
  assetId: `bild.${kind === 'svg' ? 'svg' : 'jpg'}`,
  kind,
  fileName: 'bild',
  pxSize: { w, h },
  transform: { x, y, metersPerPx, rot: 0 },
  opacity: 1,
  locked: true,
});

describe('Rasterhintergrund: Ziel-Auflösung', () => {
  it('feiner als 150 dpi → verkleinert; gröber → nie hochgerechnet', () => {
    // 0,05 m je Pixel bei 1:1000 = 0,05 mm auf dem Papier → 508 dpi
    const fine = image(8000, 6000, 0.05, -200, -150);
    expect(rasterFactor(fine, frame, 150)).toBeCloseTo(150 / 508, 3);
    expect(rasterFactor(fine, frame, 'original')).toBe(1);
    // 1 m je Pixel = 1 mm → 25,4 dpi: bleibt
    expect(rasterFactor(image(400, 300, 1), frame, 300)).toBe(1);
  });

  it('SVG ist Vektor: Rastern in der Ziel-Auflösung, auch größer', () => {
    expect(rasterFactor(image(400, 300, 1, 0, 0, 'svg'), frame, 200)).toBeCloseTo(200 / 25.4, 3);
  });

  it('nur der Ausschnitt auf dem Blatt; A3 bei 150 dpi ≈ 2480 × 1754 Pixel', () => {
    // Plan 1000 × 1000 m (20000 × 20000 px), Blatt liegt mittendrin
    const big = image(20000, 20000, 0.05, -500, -500);
    const plan = rasterPlan(big, frame, 150)!;
    expect(plan.region).toEqual({ x: 5799, y: 7029, w: 8402, h: 5942 });
    const outW = plan.tiles.filter((t) => t.src.y === plan.tiles[0]!.src.y).reduce((n, t) => n + t.out.w, 0);
    // Kacheln überlappen um 1 Pixel
    const cols = plan.tiles.filter((t) => t.src.y === plan.tiles[0]!.src.y).length;
    expect(outW - (cols - 1)).toBeGreaterThanOrEqual(2480);
    expect(outW - (cols - 1)).toBeLessThanOrEqual(2485);
    expect(plan.unchanged).toBe(false);
  });

  it('ganz auf dem Blatt und nicht zu fein → unverändert eingebettet', () => {
    const plan = rasterPlan(image(400, 300, 1, -200, -150), frame, 200)!;
    expect(plan.unchanged).toBe(true);
    expect(plan.tiles).toHaveLength(1);
  });

  it('über 16 Megapixel in Kacheln zu höchstens 2049 Pixeln', () => {
    const plan = rasterPlan(image(8000, 6000, 0.05, -200, -150), frame, 'original')!;
    expect(plan.tiles.length).toBeGreaterThan(1);
    expect(Math.max(...plan.tiles.map((t) => Math.max(t.out.w, t.out.h)))).toBeLessThanOrEqual(2049);
  });

  it('Plan neben dem Blatt → kein Bild', () => {
    expect(rasterPlan(image(100, 100, 1, 5000, 5000), frame, 150)).toBeNull();
  });
});

describe('JPEG-Qualität und „E-Mail“ (M8-Nacharbeit)', () => {
  it('libjpeg-Tabelle: Summen wie von Chromium bei 0,85 bzw. 0,6 geschrieben', () => {
    expect(ijgLumaSum(85)).toBe(1109);
    expect(ijgLumaSum(60)).toBe(2952);
    expect(ijgLumaSum(50)).toBeGreaterThan(ijgLumaSum(60));
  });

  it('DQT einer JPEG-Datei auslesen', () => {
    const table = Array.from({ length: 64 }, (_, i) => i + 1);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xdb, 0x00, 0x43, 0x00, ...table, 0xff, 0xda]);
    expect(dqtLumaSum(jpeg)).toBe((64 * 65) / 2);
  });

  it('„E-Mail“: 100 dpi und alles als JPEG; sonst bleibt PNG PNG', () => {
    const png = { ...image(8000, 6000, 0.05, -200, -150), assetId: 'plan.png' };
    expect(rasterFactor(png, frame, 'email')).toBeCloseTo(100 / 508, 3);
    expect(outputFormat(png, 'email')).toBe('jpg');
    expect(outputFormat(png, 200)).toBe('png');
    expect(outputFormat(image(10, 10, 1), 200)).toBe('jpg');
  });
});

describe('Geschätzte Dateigröße (M8-Nacharbeit)', () => {
  it('Raster: Ausgabepixel × Bytes je Pixel der Quelle; „E-Mail“ deutlich kleiner; ohne Hintergrund-Ebene nur Vektor', () => {
    const p = createProject('P');
    const pg = p.pages[0]!;
    pg.sheet = { format: 'A3', orientation: 'landscape', scale: 1000, cx: 0, cy: 0 };
    pg.background = image(8000, 6000, 0.05, -200, -150);
    const assets = { 'bild.jpg': new Uint8Array(4_800_000) }; // 0,1 B/px
    const intern = BUILTIN_PROFILES[0]!;
    const none = { stands: false, free: false, infra: false };
    const at200 = estimateExportBytes(p, intern, null, none, 200, assets);
    const email = estimateExportBytes(p, intern, null, none, 'email', assets);
    // A3 bei 200 dpi ≈ 3307 × 2339 px ≈ 7,7 MP × 0,1 B/px ≈ 0,77 MB
    expect(at200).toBeGreaterThan(700_000);
    expect(at200).toBeLessThan(1_100_000);
    expect(email).toBeLessThan(at200 / 3);
    const vectorOnly = estimateExportBytes(p, { ...intern, layers: { ...intern.layers, background: false } }, null, none, 200, assets);
    expect(vectorOnly).toBeLessThan(200_000);
    expect(sizeText(12_345_678)).toBe('ca. 12 MB');
    expect(sizeText(1_540_000)).toBe('ca. 1,5 MB');
    expect(sizeText(450_000)).toBe('ca. 450 KB');
  });
});
