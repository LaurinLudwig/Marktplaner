/**
 * Blatt und Papier-Elemente (M7, spec.md §8).
 *
 * Das Blatt einer Page ist ein achsenparalleles Rechteck in Metern: Papiermaß × n (Maßstab 1:n). Papier-Elemente
 * (Schriftfeld, Legende) haben Maße in mm und hängen an einer Ecke des Blatts (Abstand in mm von den beiden
 * Rändern dieser Ecke). Auf dem Plan ist 1 mm = n/1000 m; so sind sie im PDF bei jedem Maßstab gleich groß.
 */
import { bgCorners } from './background';
import { boundsOfRects } from './geometry/rect';
import { fmt } from './format';
import type { Corner, FestplatzPage, PaperAnchor, PaperFormat, Sheet, Vec } from './model/types';
import { SCALE_LIMITS } from './model/schema';
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

export function paperSize(sheet: Pick<Sheet, 'format' | 'orientation'>): { w: number; h: number } {
  const p = PAPER_MM[sheet.format];
  return sheet.orientation === 'landscape' ? { w: p.h, h: p.w } : { ...p };
}

/** Blatt auf dem Plan: Maßstab 1:n, Mitte und Ausdehnung in Metern. */
export interface SheetFrame {
  scale: number;
  /** Papiermaß in mm. */
  paper: { w: number; h: number };
  bounds: Bounds;
  /** Der Maßstab ergibt sich aus dem Inhalt („an Seite anpassen“). */
  fit: boolean;
}

/** mm auf dem Papier → Meter auf dem Plan. */
export const mmToM = (mm: number, scale: number) => (mm * scale) / 1000;
export const mToMm = (m: number, scale: number) => (m * 1000) / scale;

/** Hüllrechteck aller Grundflächen, Geschäfte und Infrastruktur-Objekte; ohne sie das des Hintergrunds. */
export function contentBounds(page: Pick<FestplatzPage, 'areas' | 'stands' | 'infra'>, background: Bounds | null): Bounds | null {
  return boundsOfRects([...page.areas, ...page.stands, ...page.infra]) ?? background;
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

/**
 * Lage des Blatts: bei festem Maßstab aus Mitte und n, sonst aus dem Inhalt (§8). `obstacles` = sichtbare
 * Papier-Elemente auf dem Papier (mm); beim Anpassen bleibt ihr Bereich frei (M8, E-49).
 */
export function sheetFrame(page: Pick<FestplatzPage, 'sheet' | 'areas' | 'stands' | 'infra'>, background: Bounds | null, obstacles: readonly PaperRect[] = []): SheetFrame {
  const paper = paperSize(page.sheet);
  let scale: number;
  let c: Vec;
  if (page.sheet.scale !== null) {
    scale = page.sheet.scale;
    c = { x: page.sheet.cx, y: page.sheet.cy };
  } else {
    const h = EMPTY_SIZE_M / 2;
    const b = contentBounds(page, background) ?? { minX: -h, minY: -h, maxX: h, maxY: h };
    const fit = fitIntoFreeArea(b, paper, obstacles);
    scale = roundScale(fit.n);
    // Inhalt mittig im freien Rechteck: Blattmitte = Inhaltsmitte − Versatz des Rechtecks zur Papiermitte
    const offX = mmToM(fit.rect.x + fit.rect.w / 2 - paper.w / 2, scale);
    const offY = mmToM(fit.rect.y + fit.rect.h / 2 - paper.h / 2, scale);
    c = { x: (b.minX + b.maxX) / 2 - offX, y: (b.minY + b.maxY) / 2 - offY };
  }
  const hw = mmToM(paper.w, scale) / 2;
  const hh = mmToM(paper.h, scale) / 2;
  return { scale, paper, bounds: { minX: c.x - hw, minY: c.y - hh, maxX: c.x + hw, maxY: c.y + hh }, fit: page.sheet.scale === null };
}

export const FORMAT_TEXT = (sheet: Pick<Sheet, 'format' | 'orientation'>) => `${sheet.format} ${sheet.orientation === 'landscape' ? 'quer' : 'hoch'}`;
/** „1:500“ (Anzeige mit Tausenderpunkt: „1:1.000“). */
export const scaleText = (n: number) => `1:${fmt(n, 0)}`;

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
  sheet: Pick<Sheet, 'format' | 'orientation'>;
  dateText: string;
  version: string;
  freeText: string;
}

/**
 * Inhalt der dritten Zeile: „Maßstab 1:500 bei Druck in Originalgröße (A1 quer) · 12.10.2026 · Version 3“; leere
 * Angaben entfallen. Der Zusatz warnt davor, im Druckdialog „an Seite anpassen“ zu wählen (M8, §8).
 */
export function titleBlockMeta(f: Pick<TitleBlockFields, 'scale' | 'sheet' | 'dateText' | 'version'>): string {
  return [`Maßstab ${scaleText(f.scale)} bei Druck in Originalgröße (${FORMAT_TEXT(f.sheet)})`, f.dateText.trim(), f.version.trim() && `Version ${f.version.trim()}`]
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
