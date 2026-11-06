/**
 * Blatt und Papier-Elemente (M7, spec.md §8).
 *
 * Das Blatt einer Page ist ein achsenparalleles Rechteck in Metern: Papiermaß × n (Maßstab 1:n). Papier-Elemente
 * (Schriftfeld, Legende) haben Maße in mm und hängen an einer Ecke des Blatts (Abstand in mm von den beiden
 * Rändern dieser Ecke). Auf dem Plan ist 1 mm = n/1000 m; so sind sie im PDF bei jedem Maßstab gleich groß.
 *
 * Seit #13 gibt es neben A4–A0 Blätter ohne festes Papierformat: „Plan“ (Inhalt plus Rand; das Blatt wächst um die
 * Papier-Elemente) und „Ausschnitt“ (frei aufgezogenes Rechteck). Ihr Papiermaß folgt aus Inhalt bzw. Ausschnitt und
 * Maßstab; der Maßstab ist fest (1:n) oder ergibt sich aus einer Zielbreite in mm.
 */
import { bgCorners } from './background';
import { boundsOfRects } from './geometry/rect';
import { fmt } from './format';
import { PAPER_FORMATS, type Corner, type FestplatzPage, type FreeFormat, type PaperAnchor, type PaperFormat, type Sheet, type SheetFormat, type SheetRegion, type Vec } from './model/types';
import { SCALE_LIMITS } from './model/schema';
import { activeAreas, type AreasOf } from './pageAreas';
import type { Bounds } from './viewport';

/** Papiermaße in mm, hoch (Breite × Höhe). */
export const PAPER_MM: Record<PaperFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

/** Papierrand beim Anpassen an den Inhalt (mm). */
export const FIT_MARGIN_MM = 10;
/** Blatt ohne Inhalt und ohne Hintergrund: so viele Meter um den Ursprung. */
const EMPTY_SIZE_M = 100;

/** Namen der Formate in Auswahllisten (#13). */
export const SHEET_FORMAT_LABEL: Record<SheetFormat, string> = { plan: 'Plan (Inhalt + Rand)', region: 'Ausschnitt', A4: 'A4', A3: 'A3', A2: 'A2', A1: 'A1', A0: 'A0' };

export const isFreeFormat = (f: SheetFormat): f is FreeFormat => f === 'plan' || f === 'region';

/** Papiermaß eines DIN-Formats in mm. */
export function paperSize(sheet: { format: PaperFormat; orientation: Sheet['orientation'] }): { w: number; h: number } {
  const p = PAPER_MM[sheet.format];
  return sheet.orientation === 'landscape' ? { w: p.h, h: p.w } : { ...p };
}

export type SheetKind = 'din' | FreeFormat;

/** Blatt auf dem Plan: Maßstab 1:n, Mitte und Ausdehnung in Metern. */
export interface SheetFrame {
  scale: number;
  /** Papiermaß in mm. */
  paper: { w: number; h: number };
  bounds: Bounds;
  /** Der Maßstab ergibt sich von selbst: DIN „an Seite anpassen“, Plan und Ausschnitt aus der Zielbreite (#13). */
  fit: boolean;
  /** DIN-Format, „Plan“ oder „Ausschnitt“ (#13). */
  kind: SheetKind;
  /** Rahmen lässt sich ziehen: DIN mit festem Maßstab und Ausschnitt; ein Plan folgt dem Inhalt. */
  movable: boolean;
  /** Blatthöhe in mm, nach der die Legende in Spalten umbricht (Plan: ohne die Bänder der Papier-Elemente). */
  layoutHeight: number;
  /** Plan: wirksamer Rand in mm; sonst null. */
  margin: number | null;
  /**
   * Plan mit Zielbreite: Die Papier-Elemente (mit Abstand und Rand) sind breiter als die Zielbreite; das Blatt wird
   * so schmal wie möglich, aber breiter als die Zielbreite (#13). Sonst nicht gesetzt.
   */
  targetTooNarrow?: boolean;
}

/** mm auf dem Papier → Meter auf dem Plan. */
export const mmToM = (mm: number, scale: number) => (mm * scale) / 1000;
export const mToMm = (m: number, scale: number) => (m * 1000) / scale;

/**
 * Hüllrechteck aller Grundflächen, Geschäfte und Infrastruktur-Objekte; ohne sie das des Hintergrunds. Ausgeblendete
 * Grundflächen einer Page ohne Grundflächen (#17) zählen nicht.
 */
export function contentBounds(page: AreasOf & Pick<FestplatzPage, 'stands' | 'infra'>, background: Bounds | null): Bounds | null {
  return boundsOfRects([...activeAreas(page), ...page.stands, ...page.infra]) ?? background;
}

/** Maßstab, bei dem `b` mit Papierrand auf das Papier passt, auf volle 10 aufgerundet (1:440). */
export function fitScale(b: Bounds, paper: { w: number; h: number }): number {
  return roundScale(scaleFor(b, paper.w - 2 * FIT_MARGIN_MM, paper.h - 2 * FIT_MARGIN_MM));
}

/** Maßstabszahl n, bei der `b` genau in w × h mm passt (ungerundet). */
const scaleFor = (b: Bounds, wMm: number, hMm: number) => Math.max(((b.maxX - b.minX) * 1000) / wMm, ((b.maxY - b.minY) * 1000) / hMm);
const roundScale = (n: number) => Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, Math.ceil(n / 10 - 1e-9) * 10));

/** Achsenparalleles Rechteck auf dem Papier in mm (x, y = linke obere Ecke). */
export interface PaperRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Abstand des Inhalts zu Papier-Elementen beim Anpassen (mm). */
export const FIT_GAP_MM = 3;
/** Ist der freie Bereich kleiner als dieser Anteil des Papiers, gilt das ganze Papier (§8). */
const FIT_MIN_SHARE = 0.25;

/**
 * „An Seite anpassen“ mit freigehaltenen Papier-Elementen (M8, E-49): das freie achsenparallele Rechteck des
 * Papiers (ohne 10 mm Rand, ohne die Elemente mit 3 mm Abstand), in dem der Inhalt am größten erscheint. Kandidaten
 * sind alle Rechtecke, deren Kanten auf Rändern des nutzbaren Bereichs oder der Elemente liegen. Liefert die
 * ungerundete Maßstabszahl und das Rechteck in mm.
 */
export function fitIntoFreeArea(content: Bounds, paper: { w: number; h: number }, obstacles: readonly PaperRect[]): { n: number; rect: PaperRect } {
  const m = FIT_MARGIN_MM;
  const usable: PaperRect = { x: m, y: m, w: paper.w - 2 * m, h: paper.h - 2 * m };
  const whole = { n: scaleFor(content, usable.w, usable.h), rect: usable };
  const g = FIT_GAP_MM;
  const obs = obstacles
    .map((o) => ({ x0: o.x - g, y0: o.y - g, x1: o.x + o.w + g, y1: o.y + o.h + g }))
    .filter((o) => o.x1 > usable.x && o.x0 < usable.x + usable.w && o.y1 > usable.y && o.y0 < usable.y + usable.h);
  if (!obs.length) return whole;
  const clampX = (v: number) => Math.min(usable.x + usable.w, Math.max(usable.x, v));
  const clampY = (v: number) => Math.min(usable.y + usable.h, Math.max(usable.y, v));
  const xs = [...new Set([usable.x, usable.x + usable.w, ...obs.flatMap((o) => [clampX(o.x0), clampX(o.x1)])])].toSorted((a, b) => a - b);
  const ys = [...new Set([usable.y, usable.y + usable.h, ...obs.flatMap((o) => [clampY(o.y0), clampY(o.y1)])])].toSorted((a, b) => a - b);
  const eps = 1e-9;
  let best: { n: number; rect: PaperRect; area: number } | null = null;
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++)
      for (let k = 0; k < ys.length; k++)
        for (let l = k + 1; l < ys.length; l++) {
          const r = { x: xs[i]!, y: ys[k]!, w: xs[j]! - xs[i]!, h: ys[l]! - ys[k]! };
          if (obs.some((o) => o.x0 < r.x + r.w - eps && o.x1 > r.x + eps && o.y0 < r.y + r.h - eps && o.y1 > r.y + eps)) continue;
          const n = scaleFor(content, r.w, r.h);
          const area = r.w * r.h;
          if (!best || n < best.n - eps || (Math.abs(n - best.n) <= eps && area > best.area)) best = { n, rect: r, area };
        }
  if (!best || best.area < FIT_MIN_SHARE * paper.w * paper.h) return whole;
  return { n: best.n, rect: best.rect };
}

/** Papier-Element für die Blattberechnung: Ecke, Abstand und Größe auf dem Papier (mm). */
export interface SheetElement {
  corner: Corner;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

/**
 * Sichtbare Papier-Elemente für das Blatt. Die Größe der Legende hängt von der Blatthöhe ab (Spaltenumbruch); deshalb
 * auch als Funktion der Blatthöhe in mm.
 */
export type SheetElements = readonly SheetElement[] | ((layoutHeight: number) => readonly SheetElement[]);

const elementsAt = (els: SheetElements, layoutHeight: number) => (typeof els === 'function' ? els(layoutHeight) : els);
const EMPTY_HALF = EMPTY_SIZE_M / 2;
const EMPTY_BOUNDS: Bounds = { minX: -EMPTY_HALF, minY: -EMPTY_HALF, maxX: EMPTY_HALF, maxY: EMPTY_HALF };

/**
 * Lage des Blatts (§8): DIN bei festem Maßstab aus Mitte und n, sonst aus dem Inhalt; Plan aus Inhalt, Rand und den
 * Papier-Elementen; Ausschnitt aus dem aufgezogenen Rechteck (#13). `elements` = sichtbare Papier-Elemente; beim
 * Anpassen eines DIN-Blatts bleibt ihr Bereich frei (M8, E-49), um einen Plan wächst das Blatt.
 */
export function sheetFrame(page: AreasOf & Pick<FestplatzPage, 'sheet' | 'stands' | 'infra'>, background: Bounds | null, elements: SheetElements = []): SheetFrame {
  const s = page.sheet;
  if (s.format === 'plan') return planFrame(s, contentBounds(page, background) ?? EMPTY_BOUNDS, elements);
  if (s.format === 'region') return regionFrame(s, s.region ?? regionOf(contentBounds(page, background) ?? EMPTY_BOUNDS));
  const paper = paperSize({ format: s.format, orientation: s.orientation });
  let scale: number;
  let c: Vec;
  if (s.scale !== null) {
    scale = s.scale;
    c = { x: s.cx, y: s.cy };
  } else {
    const b = contentBounds(page, background) ?? EMPTY_BOUNDS;
    const obstacles = elementsAt(elements, paper.h).map((e) => ({ ...shownOnPaper(e, e, paper), w: e.w, h: e.h }));
    const fit = fitIntoFreeArea(b, paper, obstacles);
    scale = roundScale(fit.n);
    // Inhalt mittig im freien Rechteck: Blattmitte = Inhaltsmitte − Versatz des Rechtecks zur Papiermitte
    const offX = mmToM(fit.rect.x + fit.rect.w / 2 - paper.w / 2, scale);
    const offY = mmToM(fit.rect.y + fit.rect.h / 2 - paper.h / 2, scale);
    c = { x: (b.minX + b.maxX) / 2 - offX, y: (b.minY + b.maxY) / 2 - offY };
  }
  const hw = mmToM(paper.w, scale) / 2;
  const hh = mmToM(paper.h, scale) / 2;
  const bounds = { minX: c.x - hw, minY: c.y - hh, maxX: c.x + hw, maxY: c.y + hh };
  return { scale, paper, bounds, fit: s.scale === null, kind: 'din', movable: s.scale !== null, layoutHeight: paper.h, margin: null };
}

// ---------- Freies Blatt (#13) ----------

/** Rand eines Plans: 3 % der längeren Seite des Inhalts auf dem Papier, auf volle mm gerundet, mindestens 10 mm. */
export const PLAN_MARGIN_SHARE = 0.03;
export const autoMargin = (contentMm: { w: number; h: number }) => Math.max(FIT_MARGIN_MM, Math.round(PLAN_MARGIN_SHARE * Math.max(contentMm.w, contentMm.h)));

/** Papiermaß eines Plans in mm: Inhalt mit den Bändern links, oben, rechts und unten. */
export interface PlanPaper {
  w: number;
  h: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  margin: number;
  layoutHeight: number;
}

/**
 * Papier eines Plans bei Maßstab 1:n (#13): Inhalt plus Rand; jedes sichtbare Papier-Element bekommt ein Band an
 * seiner Ecke, damit es keinen Inhalt verdeckt. Ein Element wächst entweder oben/unten (Band = Abstand + Höhe + 3 mm)
 * oder links/rechts (Abstand + Breite + 3 mm); gewählt wird die Verteilung mit der kleinsten Papierfläche, bei
 * der sich keine Elemente überdecken (bei Gleichstand oben/unten). Elemente an derselben Blattkante müssen
 * nebeneinander passen, sonst wird das Blatt breiter bzw. höher (Inhalt bleibt mittig). Das Maß wird auf volle mm
 * aufgerundet; der Rest verteilt sich auf beide Seiten.
 */
export function planPaper(content: Bounds, n: number, margin: number | null, elements: SheetElements = []): PlanPaper {
  const cw = mToMm(content.maxX - content.minX, n);
  const ch = mToMm(content.maxY - content.minY, n);
  const m = margin ?? autoMargin({ w: cw, h: ch });
  const layoutHeight = ch + 2 * m;
  const els = elementsAt(elements, layoutHeight);
  const g = FIT_GAP_MM;
  const needX = (e: SheetElement) => e.dx + e.w;
  const needY = (e: SheetElement) => e.dy + e.h;
  // Elemente an derselben Kante (oben: tl und tr, links: tl und bl, …) müssen nebeneinander passen
  const pair = (a: Corner, b: Corner, need: (e: SheetElement) => number) => {
    const na = Math.max(0, ...els.filter((e) => e.corner === a).map(need));
    const nb = Math.max(0, ...els.filter((e) => e.corner === b).map(need));
    return na && nb ? na + nb + g : Math.max(na, nb);
  };
  const minW = Math.max(pair('tl', 'tr', needX), pair('bl', 'br', needX));
  const minH = Math.max(pair('tl', 'bl', needY), pair('tr', 'br', needY));
  let best: PlanPaper | null = null;
  for (let mask = 0; mask < 1 << els.length; mask++) {
    let left = m;
    let top = m;
    let right = m;
    let bottom = m;
    els.forEach((e, i) => {
      if ((mask >> i) & 1) {
        if (isRight(e.corner)) right = Math.max(right, needX(e) + g);
        else left = Math.max(left, needX(e) + g);
      } else if (isBottom(e.corner)) bottom = Math.max(bottom, needY(e) + g);
      else top = Math.max(top, needY(e) + g);
    });
    const w = Math.ceil(Math.max(left + cw + right, minW) - 1e-6);
    const h = Math.ceil(Math.max(top + ch + bottom, minH) - 1e-6);
    const ex = (w - (left + cw + right)) / 2;
    const ey = (h - (top + ch + bottom)) / 2;
    // Elemente an verschiedenen Ecken dürfen sich nicht überdecken (z. B. hohe Legende rechts neben einem breiten
    // Maßstabsbalken oben bei schmalem Inhalt). Alles oben/unten (mask 0) überdeckt sich nie, gibt es also immer.
    if (mask && overlapping(els, { w, h })) continue;
    if (!best || w * h < best.w * best.h - 1e-9) best = { w, h, left: left + ex, right: right + ex, top: top + ey, bottom: bottom + ey, margin: m, layoutHeight };
  }
  return best!;
}

/** Überdecken sich zwei Papier-Elemente an verschiedenen Ecken auf dem Papier `paper` (mm)? */
function overlapping(els: readonly SheetElement[], paper: { w: number; h: number }): boolean {
  const eps = 1e-6;
  const r = els.map((e) => ({ corner: e.corner, ...anchorToPaper(e, e, paper), w: e.w, h: e.h }));
  return r.some((a, i) =>
    r.some((b, j) => j > i && a.corner !== b.corner && a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps),
  );
}

/**
 * Kleinster Maßstab (volle 10), bei dem das Papier höchstens `targetWidth` mm breit ist. Die Breite fällt mit n,
 * bis die Papier-Elemente sie bestimmen; dort ist sie nicht mehr sicher monoton (die Bänder werden nach der kleinsten
 * Fläche verteilt). Ist das Papier dann selbst bei 1:100.000 breiter als das Ziel, wird über ein geometrisches Raster
 * von n gesucht. Reicht keine Breite an die Zielbreite heran (die Elemente mit Abstand und Rand sind breiter), gilt
 * die kleinste erreichbare Breite als Ziel: der kleinste Maßstab, bei dem der Inhalt die neben den Elementen
 * verbleibende Breite füllt, statt still 1:100.000 (`tooNarrow`).
 */
export function scaleForWidth(width: (n: number) => number, targetWidth: number): { scale: number; tooNarrow: boolean } {
  const step = 10;
  const kMin = SCALE_LIMITS.min / step;
  const kMax = SCALE_LIMITS.max / step;
  /** Kleinstes k in (lo, hi] mit width(k · 10) ≤ goal; width(hi · 10) ≤ goal ist bekannt. */
  const search = (lo: number, hi: number, goal: number) => {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (width(mid * step) <= goal) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  if (width(kMin * step) <= targetWidth) return { scale: kMin * step, tooNarrow: false };
  if (width(kMax * step) <= targetWidth) return { scale: search(kMin, kMax, targetWidth) * step, tooNarrow: false };
  const grid: number[] = [];
  for (let k = kMin; k < kMax; k = Math.max(k + 1, Math.round(k * 1.05))) grid.push(k);
  grid.push(kMax);
  const widths = grid.map((k) => width(k * step));
  const narrowest = Math.min(...widths);
  const tooNarrow = narrowest > targetWidth;
  const goal = tooNarrow ? narrowest : targetWidth;
  const i = widths.findIndex((w) => w <= goal);
  return { scale: (i > 0 ? search(grid[i - 1]!, grid[i]!, goal) : grid[i]!) * step, tooNarrow };
}

function planFrame(s: Sheet, content: Bounds, elements: SheetElements): SheetFrame {
  const auto = s.scale === null ? scaleForWidth((n) => planPaper(content, n, s.margin, elements).w, s.targetWidth) : null;
  const scale = s.scale ?? auto!.scale;
  const p = planPaper(content, scale, s.margin, elements);
  const bounds = {
    minX: content.minX - mmToM(p.left, scale),
    minY: content.minY - mmToM(p.top, scale),
    maxX: content.maxX + mmToM(p.right, scale),
    maxY: content.maxY + mmToM(p.bottom, scale),
  };
  const frame: SheetFrame = { scale, paper: { w: p.w, h: p.h }, bounds, fit: s.scale === null, kind: 'plan', movable: false, layoutHeight: p.layoutHeight, margin: p.margin };
  if (auto?.tooNarrow) frame.targetTooNarrow = true;
  return frame;
}

/** Kleinster Ausschnitt in Metern. */
export const REGION_MIN_M = 1;

/** Ausschnitt aus einem Hüllrechteck (Meter, auf 0,01 m gerundet, mindestens 1 m). */
export function regionOf(b: Bounds): SheetRegion {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { cx: r((b.minX + b.maxX) / 2), cy: r((b.minY + b.maxY) / 2), w: Math.max(REGION_MIN_M, r(b.maxX - b.minX)), h: Math.max(REGION_MIN_M, r(b.maxY - b.minY)) };
}

export const regionBounds = (r: SheetRegion): Bounds => ({ minX: r.cx - r.w / 2, minY: r.cy - r.h / 2, maxX: r.cx + r.w / 2, maxY: r.cy + r.h / 2 });

/** Griff (hx, hy) eines Rechtecks in Metern: Ecken und Kantenmitten (Ausschnitt, #13). */
export const boundsHandle = (b: Bounds, hx: -1 | 0 | 1, hy: -1 | 0 | 1): Vec => ({
  x: hx < 0 ? b.minX : hx > 0 ? b.maxX : (b.minX + b.maxX) / 2,
  y: hy < 0 ? b.minY : hy > 0 ? b.maxY : (b.minY + b.maxY) / 2,
});

/** Ausschnitt am Griff (hx, hy) auf den Punkt `p` ziehen: Die Gegenseite bleibt, mindestens 1 m (#13). */
export function resizeBounds(b: Bounds, hx: -1 | 0 | 1, hy: -1 | 0 | 1, p: Vec): Bounds {
  const m = REGION_MIN_M;
  return {
    minX: hx < 0 ? Math.min(p.x, b.maxX - m) : b.minX,
    maxX: hx > 0 ? Math.max(p.x, b.minX + m) : b.maxX,
    minY: hy < 0 ? Math.min(p.y, b.maxY - m) : b.minY,
    maxY: hy > 0 ? Math.max(p.y, b.minY + m) : b.maxY,
  };
}

function regionFrame(s: Sheet, region: SheetRegion): SheetFrame {
  // Zielbreite: n auf volle 10 aufgerundet, damit das Papier höchstens so breit ist
  const scale = s.scale ?? roundScale(mToMm(region.w, 1) / s.targetWidth);
  const paper = { w: mToMm(region.w, scale), h: mToMm(region.h, scale) };
  return { scale, paper, bounds: regionBounds(region), fit: s.scale === null, kind: 'region', movable: true, layoutHeight: paper.h, margin: null };
}

/**
 * Größte Seitenlänge, die PDF-Reader zuverlässig zeigen: 200 Zoll = 14 400 pt (Grenze von Acrobat; darüber wird
 * abgeschnitten). Größere Blätter werden trotzdem in Originalgröße geschrieben, mit Warnung (#13).
 */
export const PDF_MAX_MM = 5080;
export const exceedsPdfLimit = (paper: { w: number; h: number }) => paper.w > PDF_MAX_MM + 1e-6 || paper.h > PDF_MAX_MM + 1e-6;

/** „1.236 × 341 mm“ */
export const paperSizeText = (paper: { w: number; h: number }) => `${fmt(paper.w, 0)} × ${fmt(paper.h, 0)} mm`;

/** Format für Schriftfeld und Marke: „A1 quer“, bei freiem Blatt das Papiermaß „1.236 × 341 mm“ (#13). */
export function formatText(sheet: Pick<Sheet, 'format' | 'orientation'>, paper: { w: number; h: number }): string {
  return isFreeFormat(sheet.format) ? paperSizeText(paper) : `${sheet.format} ${sheet.orientation === 'landscape' ? 'quer' : 'hoch'}`;
}

/** „1:500“ (Anzeige mit Tausenderpunkt: „1:1.000“). */
export const scaleText = (n: number) => `1:${fmt(n, 0)}`;

/** Marke des Blatts auf der Zeichenfläche: „A1 quer · 1:500 (angepasst)“ bzw. „1.236 × 341 mm · 1:200“ (#13). */
export const sheetLabel = (sheet: Pick<Sheet, 'format' | 'orientation'>, frame: SheetFrame) =>
  `${formatText(sheet, frame.paper)} · ${scaleText(frame.scale)}${frame.fit && frame.kind === 'din' ? ' (angepasst)' : ''}`;

type DinChoice = { format: PaperFormat; orientation: Sheet['orientation']; factor: number };

/**
 * Druck-Hinweis für ein freies Blatt (#13): das kleinste DIN-Format, auf das es in Originalgröße passt, und das
 * nächstkleinere, auf das es verkleinert passt (bzw. A0, wenn es auf keins passt). Je Format gilt die Ausrichtung mit
 * dem größeren Faktor.
 */
export function dinPrintHint(paper: { w: number; h: number }): { fits: DinChoice | null; reduced: DinChoice | null } {
  const best = (format: PaperFormat): DinChoice =>
    (['portrait', 'landscape'] as const)
      .map((orientation) => {
        const d = paperSize({ format, orientation });
        return { format, orientation, factor: Math.min(d.w / paper.w, d.h / paper.h) };
      })
      .reduce((a, b) => (b.factor > a.factor + 1e-9 ? b : a));
  // PAPER_FORMATS läuft von A4 nach A0
  const all = PAPER_FORMATS.map(best);
  const i = all.findIndex((f) => f.factor >= 1 - 1e-9);
  return { fits: i >= 0 ? all[i]! : null, reduced: i < 0 ? all[all.length - 1]! : i > 0 ? all[i - 1]! : null };
}

// ---------- Ecken-Anker ----------

const isRight = (c: Corner) => c === 'tr' || c === 'br';
const isBottom = (c: Corner) => c === 'bl' || c === 'br';

/** Lage eines Papier-Elements der Größe `size` (mm) auf dem Papier: linke obere Ecke in mm vom Blattrand oben links. */
export function anchorToPaper(anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>, size: { w: number; h: number }, paper: { w: number; h: number }): Vec {
  return {
    x: isRight(anchor.corner) ? paper.w - anchor.dx - size.w : anchor.dx,
    y: isBottom(anchor.corner) ? paper.h - anchor.dy - size.h : anchor.dy,
  };
}

/**
 * Lage auf das Blatt begrenzen: Das Element ragt nie über den Blattrand (QA-M7-01). Ist es größer als das Blatt,
 * liegt es oben links bündig.
 */
export function clampToPaper(p: Vec, size: { w: number; h: number }, paper: { w: number; h: number }): Vec {
  return { x: Math.max(0, Math.min(paper.w - size.w, p.x)), y: Math.max(0, Math.min(paper.h - size.h, p.y)) };
}

/**
 * Angezeigte Lage auf dem Papier: aus Ecke und Abstand, auf das Blatt begrenzt. Der gespeicherte Abstand bleibt
 * unverändert; wird das Blatt wieder größer, steht das Element wieder an seiner alten Stelle.
 */
export const shownOnPaper = (anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>, size: { w: number; h: number }, paper: { w: number; h: number }) =>
  clampToPaper(anchorToPaper(anchor, size, paper), size, paper);

/** Linke obere Ecke eines Papier-Elements auf dem Plan (Meter), auf das Blatt begrenzt. */
export function anchorToWorld(frame: SheetFrame, anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>, size: { w: number; h: number }): Vec {
  const p = shownOnPaper(anchor, size, frame.paper);
  return { x: frame.bounds.minX + mmToM(p.x, frame.scale), y: frame.bounds.minY + mmToM(p.y, frame.scale) };
}

/**
 * Anker aus einer Lage auf dem Papier (linke obere Ecke in mm): Die nächstgelegene Ecke (nach der Mitte des
 * Elements) wird Anker; der Abstand wird auf 1 mm gerundet und so begrenzt, dass das Element ganz auf dem Blatt
 * bleibt (§8).
 */
export function paperToAnchor(topLeft: Vec, size: { w: number; h: number }, paper: { w: number; h: number }): Pick<PaperAnchor, 'corner' | 'dx' | 'dy'> {
  const x = Math.min(Math.max(0, paper.w - size.w), Math.max(0, topLeft.x));
  const y = Math.min(Math.max(0, paper.h - size.h), Math.max(0, topLeft.y));
  const right = x + size.w / 2 > paper.w / 2;
  const bottom = y + size.h / 2 > paper.h / 2;
  const corner: Corner = bottom ? (right ? 'br' : 'bl') : right ? 'tr' : 'tl';
  const dx = Math.max(0, Math.round(right ? paper.w - size.w - x : x));
  const dy = Math.max(0, Math.round(bottom ? paper.h - size.h - y : y));
  return { corner, dx, dy };
}

/** Lage auf dem Papier (mm) aus einer Lage auf dem Plan (Meter). */
export const worldToPaper = (frame: SheetFrame, w: Vec): Vec => ({ x: mToMm(w.x - frame.bounds.minX, frame.scale), y: mToMm(w.y - frame.bounds.minY, frame.scale) });
export const paperToWorld = (frame: SheetFrame, p: Vec): Vec => ({ x: frame.bounds.minX + mmToM(p.x, frame.scale), y: frame.bounds.minY + mmToM(p.y, frame.scale) });

/** Anker aus einer Lage auf dem Plan (linke obere Ecke in Metern). */
export function worldToAnchor(frame: SheetFrame, topLeft: Vec, size: { w: number; h: number }): Pick<PaperAnchor, 'corner' | 'dx' | 'dy'> {
  return paperToAnchor(worldToPaper(frame, topLeft), size, frame.paper);
}

/** Standardrand der Papier-Elemente zum Blattrand (mm); auch Fangabstand an den Ecken. */
export const PAPER_MARGIN_MM = 10;

/**
 * Fang an den Blattecken beim Ziehen eines Papier-Elements (QA-M7-01): Liegt eine Ecke des Elements höchstens
 * `tolMm` von einer Blattecke entfernt – bündig (0 mm) oder mit Standardrand (10 mm) –, rastet sie dort ein. Das
 * Ergebnis ist auf das Blatt begrenzt. `corner` = die Ecke, an der eingerastet wurde, sonst null.
 */
export function snapToPaperCorners(topLeft: Vec, size: { w: number; h: number }, paper: { w: number; h: number }, tolMm: number): { p: Vec; corner: Corner | null } {
  let best: { p: Vec; corner: Corner; d: number } | null = null;
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    for (const m of [0, PAPER_MARGIN_MM]) {
      const q = anchorToPaper({ corner, dx: m, dy: m }, size, paper);
      const d = Math.max(Math.abs(q.x - topLeft.x), Math.abs(q.y - topLeft.y));
      if (d <= tolMm && (!best || d < best.d)) best = { p: q, corner, d };
    }
  }
  return best ? { p: clampToPaper(best.p, size, paper), corner: best.corner } : { p: clampToPaper(topLeft, size, paper), corner: null };
}

/** Pfeiltasten: um (dx, dy) mm auf dem Papier verschieben (rechts/unten positiv), Ecke wird neu bestimmt. */
export function nudgeAnchor(anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>, dxMm: number, dyMm: number, size: { w: number; h: number }, paper: { w: number; h: number }) {
  const p = shownOnPaper(anchor, size, paper);
  return paperToAnchor({ x: p.x + dxMm, y: p.y + dyMm }, size, paper);
}

// ---------- Schriftfeld ----------

/** Breite des Schriftfelds in mm (ISO 7200). */
export const TITLE_BLOCK_WIDTH = 180;
export const TITLE_BLOCK_MAX_TEXT_LINES = 4;
const PAD = 3;

export interface PaperText {
  text: string;
  /** Schrifthöhe in mm. */
  size: number;
  /** Grundlinie in mm vom oberen Rand des Elements. */
  y: number;
  x: number;
  weight?: 600;
}

export interface TitleBlockLayout {
  w: number;
  h: number;
  texts: PaperText[];
  /** Waagerechte Trennlinien (y in mm). */
  rules: number[];
  /** Freitext hatte mehr als 4 Zeilen; der Rest fehlt. */
  truncated: boolean;
}

export interface TitleBlockFields {
  projectName: string;
  pageName: string;
  scale: number;
  /** „A1 quer“ bzw. „1.236 × 341 mm“ (`formatText`). */
  format: string;
  dateText: string;
  version: string;
  freeText: string;
}

/**
 * Inhalt der dritten Zeile: „Maßstab 1:500 bei Druck in Originalgröße (A1 quer) · 12.10.2026 · Version 3“; leere
 * Angaben entfallen. Der Zusatz warnt davor, im Druckdialog „an Seite anpassen“ zu wählen (M8, §8).
 */
export function titleBlockMeta(f: Pick<TitleBlockFields, 'scale' | 'format' | 'dateText' | 'version'>): string {
  return [`Maßstab ${scaleText(f.scale)} bei Druck in Originalgröße (${f.format})`, f.dateText.trim(), f.version.trim() && `Version ${f.version.trim()}`]
    .filter(Boolean)
    .join(' · ');
}

/** Einheitliches Layout des Schriftfelds (§8): drei feste Zeilen, darunter bis zu 4 Zeilen Freitext. */
export function titleBlockLayout(f: TitleBlockFields): TitleBlockLayout {
  const texts: PaperText[] = [];
  const rules: number[] = [];
  let y = PAD;
  const line = (text: string, size: number, lead: number, weight?: 600) => {
    texts.push({ text, size, x: PAD, y: y + size, ...(weight ? { weight } : {}) });
    y += size + lead;
  };
  line(f.projectName.trim() || 'Projekt', 5, 2, 600);
  line(f.pageName.trim() || 'Festplatz', 3.5, 1.5);
  rules.push(y);
  y += 1.5;
  line(titleBlockMeta(f), 2.5, 1.5);
  const all = f.freeText.split('\n').map((l) => l.trimEnd());
  while (all.length && !all[all.length - 1]) all.pop();
  if (all.length) {
    rules.push(y);
    y += 1.5;
    for (const l of all.slice(0, TITLE_BLOCK_MAX_TEXT_LINES)) line(l, 2.5, 1.1);
  }
  return { w: TITLE_BLOCK_WIDTH, h: Math.round((y - 1 + PAD) * 10) / 10, texts, rules, truncated: all.length > TITLE_BLOCK_MAX_TEXT_LINES };
}

/** Hüllrechteck des Hintergrunds in Metern (für „an Seite anpassen“ ohne Objekte). */
export function backgroundBounds(page: Pick<FestplatzPage, 'background'>): Bounds | null {
  const bg = page.background;
  if (!bg) return null;
  const c = bgCorners(bg.transform, bg.pxSize);
  return { minX: Math.min(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxX: Math.max(...c.map((p) => p.x)), maxY: Math.max(...c.map((p) => p.y)) };
}
