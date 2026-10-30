/**
 * Platzierung der Standbeschriftung (#9, spec.md §3 „Beschriftung“). Jeder Stand zeigt dieselben Angaben (die volle
 * Vorlage); nichts wird gekürzt oder verkleinert, nur der Ort ändert sich:
 *
 * 1. **auf dem Stand:** jede Zeile an Leerzeichen und Bindestrichen auf die Breite des Stands umbrochen; passt der
 *    Block in den Stand, steht er wie bisher mittig darauf;
 * 2. sonst **ausgelagert** mit Führungslinie, umbrochen auf `OUTSIDE_WRAP_EM` Schriftgrößen (mindestens Standbreite): zuerst **hinter** dem Stand (gegenüber der Vorderseite
 *    der Grundfläche, weg von der Gasse), dort auch seitlich versetzt und weiter weg; erst wenn hinter dem Stand
 *    nichts frei ist **davor** (ebenso gestaffelt). „Frei“ heißt: kein anderer Stand, kein Infrastruktur-Objekt, keine
 *    Grundflächen-Beschriftung und keine schon gesetzte Beschriftung im Weg, auch nicht für die Führungslinie; gibt
 *    es das nicht, genügt ein Platz, an dem der Text frei ist; sonst steht sie direkt hinter dem Stand;
 * 3. **von Hand verschoben** (`Stand.labelOffset`): an dieser Stelle, umbrochen wie ausgelagert, mit Führungslinie.
 *
 * Text ist immer horizontal; Breiten werden geschätzt (`approxTextWidth`). Reine Logik ohne UI; Zeichenfläche und PDF
 * nutzen dasselbe Ergebnis.
 */
import { fromLocal, rectCorners } from './geometry/rect';
import { approxTextWidth, formatLabel } from './label';
import type { Area, Category, Id, InfraObject, Rect, Stand, Vec } from './model/types';
import type { Bounds } from './viewport';

/** Zeilenabstand in Schriftgrößen (wie `LINE` in scene/objects.ts). */
const LINE = 1.2;
/** Luft um den Textblock (Rand der Schrift) und Abstand zum Stand, in Schriftgrößen. */
const PAD = 0.15;
const GAP = 0.4;
/** Weiter-weg-Suche: so viele Stufen nach außen, je mit diesen seitlichen Versätzen (in Blockbreiten). */
const FAR_STEPS = 6;
const LATERAL = [0, -0.6, 0.6, -1.2, 1.2] as const;
/** Breite ausgelagerter Beschriftungen in Schriftgrößen (≈ 20 Zeichen), damit lange Zeilen nicht quer über die Reihe laufen. */
const OUTSIDE_WRAP_EM = 11.5;

export type LabelMode = 'inside' | 'behind' | 'front' | 'far' | 'fallback' | 'manual';

export interface LabelPlacement {
  lines: string[];
  /** Mitte des Textblocks (Meter). */
  cx: number;
  cy: number;
  /** Größe des Textblocks (Meter). */
  w: number;
  h: number;
  mode: LabelMode;
  /** Führungslinie vom Stand zum Block; null, wenn die Beschriftung auf dem Stand steht. */
  leader: { a: Vec; b: Vec } | null;
}

/** Steht die Beschriftung neben dem Stand (ziehbar, mit Führungslinie)? */
export const isOutside = (p: LabelPlacement) => p.mode !== 'inside';

export const labelBounds = (p: Pick<LabelPlacement, 'cx' | 'cy' | 'w' | 'h'>): Bounds => ({ minX: p.cx - p.w / 2, minY: p.cy - p.h / 2, maxX: p.cx + p.w / 2, maxY: p.cy + p.h / 2 });

// ---------- Text ----------

/** Breite eines Blocks aus Zeilen inklusive Rand. */
const blockW = (lines: readonly string[], fs: number) => Math.max(0, ...lines.map((l) => approxTextWidth(l, fs))) + 2 * PAD * fs;
const blockH = (n: number, fs: number) => n * LINE * fs;

/**
 * Bricht eine Zeile auf `maxW` (Meter) um: nach Leerzeichen und nach Bindestrichen innerhalb eines Worts
 * („Wurf-“ / „und“). Ein einzelnes zu langes Stück bleibt ganz (der Aufrufer prüft, ob es passt).
 */
export function wrapLine(line: string, maxW: number, fs: number): string[] {
  const pieces = line.match(/\S*?-(?=\S)|\S+\s*|\s+/g) ?? [line];
  const out: string[] = [];
  let cur = '';
  for (const piece of pieces) {
    const next = cur + piece;
    if (cur && approxTextWidth(next.trimEnd(), fs) > maxW) {
      out.push(cur.trimEnd());
      cur = piece.trimStart();
    } else cur = next;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out.length ? out : [line];
}

const wrapAll = (lines: readonly string[], maxW: number, fs: number) => lines.flatMap((l) => wrapLine(l, maxW, fs));

/**
 * Halbe Breite, die ein horizontaler Block der halben Höhe `bh` im (gedrehten) Stand höchstens haben darf: Ein Block
 * mit Halbachsen (bw, bh) passt mittig genau dann, wenn bw·|cos|+bh·|sin| ≤ w/2 und bw·|sin|+bh·|cos| ≤ d/2.
 */
function maxHalfWidth(r: Rect, bh: number): number {
  const a = (r.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  // Hängt eine Bedingung nicht von bw ab (Faktor 0), gilt sie nur für bh: erfüllt → keine Grenze, sonst passt nichts
  const limit = (half: number, k: number, rest: number) => (k > 1e-9 ? (half - rest) / k : rest <= half + 1e-9 ? Infinity : -1);
  return Math.min(limit(r.w / 2, c, bh * s), limit(r.d / 2, s, bh * c));
}

/** Umbrochener Block, wenn er mittig in den Stand passt; sonst null. */
export function fitInside(stand: Rect, lines: readonly string[], fs: number): { lines: string[]; w: number; h: number } | null {
  let bh = blockH(lines.length, fs) / 2;
  for (let i = 0; i < 4; i++) {
    const half = maxHalfWidth(stand, bh);
    if (half <= 0) return null;
    const wrapped = wrapAll(lines, 2 * (half - PAD * fs), fs);
    const w = blockW(wrapped, fs);
    const h = blockH(wrapped.length, fs);
    if (w / 2 <= maxHalfWidth(stand, h / 2) + 1e-9 && h / 2 <= bh + 1e-9) return { lines: wrapped, w, h };
    bh = h / 2;
  }
  return null;
}

// ---------- Geometrie ----------

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const axes = (r: Rect): [Vec, Vec] => {
  const a = (r.rot * Math.PI) / 180;
  return [
    { x: Math.cos(a), y: Math.sin(a) },
    { x: -Math.sin(a), y: Math.cos(a) },
  ];
};
/** Halbe Ausdehnung eines gedrehten Rechtecks in Richtung `dir` (Stützfunktion). */
const rectExtent = (r: Rect, dir: Vec) => {
  const [ux, uy] = axes(r);
  return (r.w / 2) * Math.abs(dot(dir, ux)) + (r.d / 2) * Math.abs(dot(dir, uy));
};
const boxExtent = (w: number, h: number, dir: Vec) => (w / 2) * Math.abs(dir.x) + (h / 2) * Math.abs(dir.y);

/** Überschneiden sich Block (achsenparallel) und gedrehtes Rechteck? Trennachsentest. */
function boxHitsRect(b: Bounds, r: Rect): boolean {
  const pts = rectCorners(r);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  if (maxX <= b.minX || minX >= b.maxX || maxY <= b.minY || minY >= b.maxY) return false;
  const box = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  for (const ax of axes(r)) {
    const pr = pts.map((p) => dot(p, ax));
    const pb = box.map((p) => dot(p, ax));
    if (Math.max(...pr) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pr)) return false;
  }
  return true;
}
const boxesHit = (a: Bounds, b: Bounds) => a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;

/** Schneidet die Strecke a–b das Innere des achsenparallelen Rechtecks (Halbachsen hx, hy um den Ursprung)? */
function segmentHitsBox(a: Vec, b: Vec, hx: number, hy: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = { x: b.x - a.x, y: b.y - a.y };
  for (const [p, q, h] of [
    [a.x, d.x, hx],
    [a.y, d.y, hy],
  ] as const) {
    if (Math.abs(q) < 1e-12) {
      if (p <= -h || p >= h) return false;
      continue;
    }
    let lo = (-h - p) / q;
    let hi = (h - p) / q;
    if (lo > hi) [lo, hi] = [hi, lo];
    t0 = Math.max(t0, lo);
    t1 = Math.min(t1, hi);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-9;
}
const segmentHitsBounds = (a: Vec, b: Vec, r: Bounds) => {
  const c = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
  return segmentHitsBox({ x: a.x - c.x, y: a.y - c.y }, { x: b.x - c.x, y: b.y - c.y }, (r.maxX - r.minX) / 2, (r.maxY - r.minY) / 2);
};
const segmentHitsRect = (a: Vec, b: Vec, r: Rect) => {
  const [ux, uy] = axes(r);
  const loc = (p: Vec) => ({ x: dot({ x: p.x - r.cx, y: p.y - r.cy }, ux), y: dot({ x: p.x - r.cx, y: p.y - r.cy }, uy) });
  return segmentHitsBox(loc(a), loc(b), r.w / 2, r.d / 2);
};

/** Punkt, an dem der Strahl von der Mitte des Rechtecks in Richtung `to` dessen Rand verlässt. */
function exitRect(r: Rect, to: Vec): Vec {
  const [ux, uy] = axes(r);
  const d = { x: to.x - r.cx, y: to.y - r.cy };
  const lx = dot(d, ux);
  const ly = dot(d, uy);
  const t = Math.min(Math.abs(lx) > 1e-12 ? r.w / 2 / Math.abs(lx) : Infinity, Math.abs(ly) > 1e-12 ? r.d / 2 / Math.abs(ly) : Infinity, 1);
  return fromLocal(r, { x: lx * t, y: ly * t });
}
/** Punkt, an dem der Strahl von der Blockmitte zu `from` den Blockrand verlässt. */
function exitBox(cx: number, cy: number, w: number, h: number, from: Vec): Vec {
  const dx = from.x - cx;
  const dy = from.y - cy;
  const t = Math.min(Math.abs(dx) > 1e-12 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-12 ? h / 2 / Math.abs(dy) : Infinity, 1);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Richtung „hinter dem Stand“: gegenüber der Vorderseite der Grundfläche, auf der seine Mitte steht (Vorderseite =
 * lokale Unterkante, also lokal −y); ohne Grundfläche gilt die Vorderseite des Stands.
 */
export function behindDir(stand: Rect, areas: readonly Area[]): Vec {
  const c = { x: stand.cx, y: stand.cy };
  const area = areas.find((a) => {
    const [ux, uy] = axes(a);
    const d = { x: c.x - a.cx, y: c.y - a.cy };
    return Math.abs(dot(d, ux)) <= a.w / 2 && Math.abs(dot(d, uy)) <= a.d / 2;
  });
  const [, uy] = axes(area ?? stand);
  return { x: -uy.x, y: -uy.y };
}

// ---------- Hindernisse (Raster für schnelle Suche) ----------

class Obstacles {
  private cells = new Map<string, number[]>();
  private items: ({ kind: 'rect'; r: Rect; owner: Id | null } | { kind: 'box'; b: Bounds })[] = [];
  constructor(private cell: number) {}
  private keys(b: Bounds): string[] {
    const out: string[] = [];
    const c = this.cell;
    for (let x = Math.floor(b.minX / c); x <= Math.floor(b.maxX / c); x++) for (let y = Math.floor(b.minY / c); y <= Math.floor(b.maxY / c); y++) out.push(`${x},${y}`);
    return out;
  }
  private add(item: Obstacles['items'][number], b: Bounds) {
    const i = this.items.push(item) - 1;
    for (const k of this.keys(b)) {
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    }
  }
  addRect(r: Rect, owner: Id | null) {
    const pts = rectCorners(r);
    this.add({ kind: 'rect', r, owner }, { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) });
  }
  addBox(b: Bounds) {
    this.add({ kind: 'box', b }, b);
  }
  /** Sind Block und Führungslinie frei (der eigene Stand `self` zählt nicht)? */
  free(b: Bounds, self: Id, leader: { a: Vec; b: Vec } | null): boolean {
    const seen = new Set<number>();
    const area = leader
      ? { minX: Math.min(b.minX, leader.a.x), minY: Math.min(b.minY, leader.a.y), maxX: Math.max(b.maxX, leader.a.x), maxY: Math.max(b.maxY, leader.a.y) }
      : b;
    for (const k of this.keys(area))
      for (const i of this.cells.get(k) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const it = this.items[i]!;
        if (it.kind === 'rect') {
          if (it.owner === self) continue;
          if (boxHitsRect(b, it.r) || (leader && segmentHitsRect(leader.a, leader.b, it.r))) return false;
        } else if (boxesHit(b, it.b) || (leader && segmentHitsBounds(leader.a, leader.b, it.b))) return false;
      }
    return true;
  }
}

// ---------- Platzierung ----------

export interface LabelLayoutInput {
  stands: readonly Stand[];
  areas: readonly Area[];
  /** Infrastruktur-Objekte als Hindernisse (Punkte/Marker ohne Fläche zählen nicht). */
  infra: readonly InfraObject[];
  fontSize: number;
  /** Zeilen der Beschriftung eines Stands (Vorlage schon eingesetzt). */
  linesOf: (s: Stand) => string[];
  /** Weitere belegte Bereiche, z. B. die Beschriftungen der Grundflächen. */
  blocked?: readonly Bounds[];
}

function outsidePlacement(stand: Stand, lines: string[], w: number, h: number, cx: number, cy: number, mode: LabelMode): LabelPlacement {
  const a = exitRect(stand, { x: cx, y: cy });
  const b = exitBox(cx, cy, w, h, { x: stand.cx, y: stand.cy });
  return { lines, cx, cy, w, h, mode, leader: Math.hypot(b.x - a.x, b.y - a.y) > 1e-6 ? { a, b } : null };
}

/** Beschriftung aller Stände einer Page; Stände ohne Zeilen fehlen in der Map. */
export function layoutStandLabels({ stands, areas, infra, fontSize: fs, linesOf, blocked = [] }: LabelLayoutInput): Map<Id, LabelPlacement> {
  const out = new Map<Id, LabelPlacement>();
  const obstacles = new Obstacles(Math.max(5, fs * 10));
  for (const s of stands) obstacles.addRect(s, s.id);
  for (const b of blocked) obstacles.addBox(b);
  for (const o of infra) if (o.w > 0) obstacles.addRect({ ...o, d: Math.max(o.d, 0.05) }, null);

  const lines = new Map<Id, string[]>();
  for (const s of stands) {
    const l = linesOf(s);
    if (l.length) lines.set(s.id, l);
  }
  /** Ausgelagerter Block: umbrochen auf OUTSIDE_WRAP_EM, mindestens auf die horizontale Ausdehnung des Stands. */
  const outsideBlock = (s: Stand, l: string[]) => {
    const wrapped = wrapAll(l, Math.max(OUTSIDE_WRAP_EM * fs, 2 * rectExtent(s, { x: 1, y: 0 })), fs);
    return { lines: wrapped, w: blockW(wrapped, fs), h: blockH(wrapped.length, fs) };
  };

  // 1. Von Hand gesetzte zuerst: Sie sind Hindernisse für die automatischen
  for (const s of stands) {
    const l = lines.get(s.id);
    if (!l || !s.labelOffset) continue;
    const { lines: ml, w, h } = outsideBlock(s, l);
    const p = outsidePlacement(s, ml, w, h, s.cx + s.labelOffset.x, s.cy + s.labelOffset.y, 'manual');
    out.set(s.id, p);
    obstacles.addBox(labelBounds(p));
  }
  // 2. Auf dem Stand, wenn der umbrochene Block passt
  const outside: Stand[] = [];
  for (const s of stands) {
    const l = lines.get(s.id);
    if (!l || out.has(s.id)) continue;
    const fit = fitInside(s, l, fs);
    if (fit) out.set(s.id, { ...fit, cx: s.cx, cy: s.cy, mode: 'inside', leader: null });
    else outside.push(s);
  }
  // 3. Auslagern: hinter, vor, weiter weg; sonst direkt hinter dem Stand
  for (const s of outside) {
    const { lines: l, w, h } = outsideBlock(s, lines.get(s.id)!);
    const back = behindDir(s, areas);
    const front = { x: -back.x, y: -back.y };
    const at = (dir: Vec, k: number, lat: number) => {
      const perp = { x: -dir.y, y: dir.x };
      const dist = rectExtent(s, dir) + GAP * fs + boxExtent(w, h, dir) + k * (boxExtent(w, h, dir) * 2 + GAP * fs);
      return { x: s.cx + dir.x * dist + perp.x * lat * w, y: s.cy + dir.y * dist + perp.y * lat * w };
    };
    // Erst alle Plätze hinter dem Stand (direkt, seitlich versetzt, weiter weg), dann dieselben davor
    const candidates: [Vec, LabelMode][] = [];
    for (const [dir, mode] of [
      [back, 'behind'],
      [front, 'front'],
    ] as const)
      for (let k = 0; k <= FAR_STEPS; k++) for (const lat of LATERAL) candidates.push([at(dir, k, lat), k === 0 && lat === 0 ? mode : 'far']);
    // Zuerst Text und Führungslinie frei, sonst wenigstens der Text
    let p: LabelPlacement | null = null;
    for (const strict of [true, false]) {
      for (const [c, mode] of candidates) {
        const q = outsidePlacement(s, l, w, h, c.x, c.y, mode);
        if (obstacles.free(labelBounds(q), s.id, strict ? q.leader : null)) {
          p = q;
          break;
        }
      }
      if (p) break;
    }
    if (!p) {
      const c = at(back, 0, 0);
      p = outsidePlacement(s, l, w, h, c.x, c.y, 'fallback');
    }
    out.set(s.id, p);
    obstacles.addBox(labelBounds(p));
  }
  return out;
}

/** Erste Grundlinie eines Blocks (für TextPrim: y der ersten Zeile). */
export const firstBaseline = (p: Pick<LabelPlacement, 'cy' | 'lines'>, fs: number, baseline: number) => p.cy - ((p.lines.length - 1) * LINE * fs) / 2 + baseline * fs;

// ---------- Zwischenspeicher ----------

export interface StandLabelSource {
  stands: readonly Stand[];
  areas: readonly Area[];
  infra: readonly InfraObject[];
  template: string;
  fontSize: number;
  categories: readonly Category[];
  /** Platzhalter, die leer bleiben (Export-Profil, M8). */
  blank?: ReadonlySet<string>;
  /** Weitere belegte Bereiche (Beschriftungen der Grundflächen); Teil des Schlüssels, also stabil übergeben. */
  blocked?: readonly Bounds[];
}

const labelCache = new WeakMap<readonly Stand[], { src: StandLabelSource; result: Map<Id, LabelPlacement> }>();

/** Platzierung je Liste der Stände; gültig, solange Grundflächen, Infrastruktur, Vorlage usw. dieselben sind. */
export function cachedStandLabels(src: StandLabelSource): Map<Id, LabelPlacement> {
  const hit = labelCache.get(src.stands);
  const same = (a: StandLabelSource) =>
    a.areas === src.areas && a.infra === src.infra && a.template === src.template && a.fontSize === src.fontSize && a.categories === src.categories && a.blank === src.blank && a.blocked === src.blocked;
  if (hit && same(hit.src)) return hit.result;
  const names = new Map(src.categories.map((c) => [c.id, c.name]));
  const result = layoutStandLabels({
    stands: src.stands,
    areas: src.areas,
    infra: src.infra,
    fontSize: src.fontSize,
    linesOf: (s) => formatLabel(src.template, s, (s.categoryId && names.get(s.categoryId)) || '', src.blank),
    blocked: src.blocked,
  });
  labelCache.set(src.stands, { src, result });
  return result;
}

/** Platzierung um (dx, dy) verschoben (Stand wird gerade gezogen: die Beschriftung folgt starr, #9). */
export const movedPlacement = (p: LabelPlacement, dx: number, dy: number): LabelPlacement =>
  dx === 0 && dy === 0
    ? p
    : {
        ...p,
        cx: p.cx + dx,
        cy: p.cy + dy,
        leader: p.leader && { a: { x: p.leader.a.x + dx, y: p.leader.a.y + dy }, b: { x: p.leader.b.x + dx, y: p.leader.b.y + dy } },
      };
