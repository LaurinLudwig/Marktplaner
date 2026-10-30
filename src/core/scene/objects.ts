/**
 * Bausteine der Planobjekte (M8): Grundflächen, Freiflächen, Geschäfte, Warnungen, Infrastruktur und ihre
 * Beschriftung in Weltkoordinaten (Meter). Die Zeichenfläche (ObjectsLayer, InfraLayer) und das PDF nutzen genau
 * diese Funktionen; vorher steckte die Geometrie in den React-Komponenten (M3–M7).
 */
import type { AreaFreeSpaces, FreeSpace } from '../freeSpace';
import { hatchPath } from '../geometry/polygon';
import { fromLocal, rectCorners } from '../geometry/rect';
import { fmt } from '../format';
import { lineEnds, PASSAGE_TYPE_ID } from '../infra';
import { approxTextWidth, areaLabel, formatLabel, freeSpaceLabel } from '../label';
import type { Area, InfraObject, InfraTypeDef, ShapeTemplate, Stand, Vec } from '../model/types';
import { shapePaths } from '../shape';
import type { ActiveWarnings } from '../warnings';
import { iconPrim, type LinePrim, type PathPrim, type PolyPrim, type Prim, type StyleVariant, type TextPrim } from './prims';

/** Zeilenabstand der Beschriftung in Schriftgrößen. */
export const LINE = 1.2;
/** Versatz der Grundlinie, damit eine Zeile optisch auf ihrer Mittellinie sitzt. */
export const BASELINE = 0.35;

/** Art der Markierung am Stand: rot bei Überlappung oder Infrastruktur, sonst orange. */
export type WarnKind = 'outside' | 'overlap' | null;

/** Markierung aus den angezeigten Warnungen eines Stands (§3, §11); „Abstand“ (#3) ist orange. */
export const warnKind = (a: ActiveWarnings): WarnKind => (a.overlap || a.infra ? 'overlap' : a.outside || a.duplicate || a.distance ? 'outside' : null);

// ---------- Grundflächen ----------

export function areaPrims(area: Area): [PolyPrim, LinePrim] {
  const c = rectCorners(area);
  // Vorderseite = Kante 2 (Ecke 2 → Ecke 3)
  return [
    { t: 'poly', s: 'area-body', pts: c },
    { t: 'line', s: 'area-front', a: c[2]!, b: c[3]! },
  ];
}

/** Grundflächen-Beschriftung: horizontal, außerhalb der Fläche vor der Mitte der Vorderseite (§2). */
export function areaLabelPrim(area: Area, fontSize: number): TextPrim {
  const text = areaLabel(area);
  const mid = fromLocal(area, { x: 0, y: area.d / 2 });
  const rad = (area.rot * Math.PI) / 180;
  const n = { x: -Math.sin(rad), y: Math.cos(rad) };
  const hw = approxTextWidth(text, fontSize) / 2;
  const hh = (LINE * fontSize) / 2;
  const reach = Math.abs(n.x) * hw + Math.abs(n.y) * hh + 0.35 * fontSize;
  return label('area-label', [text], mid.x + n.x * reach, mid.y + n.y * reach + BASELINE * fontSize, fontSize);
}

// ---------- Freiflächen ----------

/** Freiflächen einer Grundfläche: getönte Polygone und ein Schraffur-Pfad mit Linienabstand `spacing` (Meter). */
export function freePrims(result: AreaFreeSpaces, spacing: number): Prim[] {
  if (!result.free.length) return [];
  const out: Prim[] = result.free.flatMap((f) => f.polygons.map((pts): PolyPrim => ({ t: 'poly', s: 'free-space', pts })));
  const d = result.free.flatMap((f) => f.polygons.map((poly) => hatchPath(poly, spacing))).join('');
  if (d) out.push({ t: 'path', s: 'free-hatch', d });
  return out;
}

/** Beschriftungstext je Freifläche nur einmal formatieren (`fmt` ist teuer, QA-M4-03). */
const freeText = new WeakMap<FreeSpace, string>();
export function freeLabelText(f: FreeSpace): string {
  let t = freeText.get(f);
  if (t === undefined) freeText.set(f, (t = freeSpaceLabel(f.width, f.depth)));
  return t;
}

/** „Frei 20 × 10 m“: horizontal, mittig. */
export const freeLabelPrim = (f: FreeSpace, fontSize: number): TextPrim => label('free-label', [freeLabelText(f)], f.center.x, f.center.y + BASELINE * fontSize, fontSize);

// ---------- Geschäfte ----------

const warnVariant = (warn: WarnKind): { v?: StyleVariant } => (warn ? { v: warn === 'overlap' ? 'warn-overlap' : 'warn-outside' } : {});

/** Stand als Rechteck B × T (ohne Form). */
export function standPrim(stand: Stand, color: string, warn: WarnKind): PolyPrim {
  return { t: 'poly', s: 'stand', pts: rectCorners(stand), color, ...warnVariant(warn) };
}

/**
 * Stand in seiner Form (M12, §3 „Form“). Rechteck: Vieleck, Kreis/Oval: ein Pfad aus Bögen, beide mit Stil `stand`.
 * Eine Vorlage wird zu einer gemeinsamen Füllung (ein Pfad, alle Teile im selben Umlaufsinn, also ohne doppelte
 * Tönung) und einer Kontur nur außen (`shapePaths`).
 */
export function standPrims(stand: Stand, color: string, warn: WarnKind, template?: ShapeTemplate): Prim[] {
  if (!template && stand.shape !== 'ellipse') return [standPrim(stand, color, warn)];
  const { fill, outline } = shapePaths(stand, template);
  if (!template) return [{ t: 'path', s: 'stand', d: fill, color, ...warnVariant(warn) }];
  return [
    { t: 'path', s: 'stand-fill', d: fill, color },
    { t: 'path', s: 'stand-outline', d: outline, ...warnVariant(warn) },
  ];
}

/** Hitbox eines Stands mit Form: das Rechteck B × T gestrichelt, nur auf der Zeichenfläche bei Auswahl (§3). */
export const standHitboxPrim = (stand: Stand): PolyPrim => ({ t: 'poly', s: 'stand-hitbox', pts: rectCorners(stand) });

/** Standbeschriftung: horizontal, mittig, feste Schriftgröße; darf über den Stand hinausragen (§3). */
export function standLabelPrim(stand: Stand, template: string, fontSize: number, categoryName: string, blank?: ReadonlySet<string>): TextPrim | null {
  const lines = formatLabel(template, stand, categoryName, blank);
  if (!lines.length) return null;
  const top = stand.cy - ((lines.length - 1) * LINE * fontSize) / 2 + BASELINE * fontSize;
  return label('stand-label', lines, stand.cx, top, fontSize);
}

/** Warndreieck an der Ecke oben rechts des Stands (Weltgröße `size`). */
export function warnIconPrims(stand: Stand, kind: 'outside' | 'overlap', size: number): Prim[] {
  const c = fromLocal(stand, { x: stand.w / 2, y: -stand.d / 2 });
  const r = size / 2;
  const P = (x: number, y: number) => `${(c.x + x).toFixed(4)} ${(c.y + y).toFixed(4)}`;
  return [
    { t: 'path', s: 'warn-icon', v: kind, d: `M${P(0, -r)}L${P(r * 1.1, r * 0.85)}L${P(-r * 1.1, r * 0.85)}Z` },
    { t: 'rect', s: 'warn-icon-mark', x: c.x - r * 0.09, y: c.y - r * 0.45, w: r * 0.18, h: r * 0.75 },
    { t: 'rect', s: 'warn-icon-mark', x: c.x - r * 0.09, y: c.y + r * 0.42, w: r * 0.18, h: r * 0.18 },
  ];
}

export const overlapPrim = (polygon: readonly Vec[]): PolyPrim => ({ t: 'poly', s: 'overlap-region', pts: polygon });

// ---------- Infrastruktur (M7, §11) ----------

/**
 * Rechteck: in Typfarbe getönt, mit Rand und Symbol. Linie: Typfarbe in ihrer Stärke plus Haarlinie (mobile Sperre
 * gestrichelt). Enge Durchfahrt bzw. Linie ohne Stärke: Maßlinie mit Endstrichen. Punkt: Symbol mit der Spitze auf
 * dem Punkt.
 */
export function infraPrims(o: InfraObject, t: InfraTypeDef, fontSize: number, markerSize: number, warn: boolean): Prim[] {
  const color = t.color;
  if (t.geometry === 'point') return [iconPrim(t.icon, { x: o.cx, y: o.cy - markerSize / 2 }, markerSize, 'infra-icon', color)];
  if (t.geometry === 'rect') {
    const icon = Math.min(Math.min(o.w, o.d) * 0.7, fontSize * 3);
    return [{ t: 'poly', s: 'infra-body', pts: rectCorners(o), color }, iconPrim(t.icon, { x: o.cx, y: o.cy }, icon, 'infra-icon', color)];
  }
  const [a, b] = lineEnds(o);
  const dashed = t.id === 'barrierMobile';
  if (t.id === PASSAGE_TYPE_ID || o.d <= 0) {
    const ux = (b.x - a.x) / (o.w || 1);
    const uy = (b.y - a.y) / (o.w || 1);
    const k = fontSize * 0.8;
    const tick = (p: Vec) => `M${p.x - uy * k} ${p.y + ux * k}L${p.x + uy * k} ${p.y - ux * k}`;
    const dim: PathPrim = { t: 'path', s: 'infra-dim', d: `M${a.x} ${a.y}L${b.x} ${b.y}${tick(a)}${tick(b)}`, color, ...(warn ? { v: 'warn-narrow' } : {}) };
    return [dim];
  }
  return [
    { t: 'line', s: 'infra-stroke', a, b, color, width: o.d, ...(dashed ? { v: 'dashed', dash: [o.d * 3, o.d * 2] } : {}) },
    { t: 'line', s: 'infra-hair', a, b, color, ...(dashed ? { v: 'dashed' } : {}) },
  ];
}

/** Text eines Objekts: Bezeichnung; bei der Durchfahrt zusätzlich die lichte Breite. */
export function infraLabelText(o: InfraObject, t: InfraTypeDef): string {
  if (t.id === PASSAGE_TYPE_ID) return o.label ? `${o.label} · ${fmt(o.w)} m` : `${fmt(o.w)} m`;
  return o.label;
}

/** Beschriftung: horizontal; Rechtecke unter dem Symbol, Linien über der Mitte, Marker rechts neben dem Symbol. */
export function infraLabelPrim(o: InfraObject, t: InfraTypeDef, fontSize: number, markerSize: number): TextPrim | null {
  const text = infraLabelText(o, t);
  if (!text) return null;
  let x = o.cx;
  let y = o.cy;
  if (t.geometry === 'point') {
    x = o.cx + markerSize * 0.45;
    y = o.cy - markerSize * 0.55;
  } else if (t.geometry === 'rect') {
    y = o.cy + Math.min(Math.min(o.w, o.d) * 0.35, fontSize * 1.5) + fontSize * 0.7;
  } else {
    y = o.cy - fontSize * 0.9 - o.d / 2;
  }
  return { ...label('infra-label', [text], x, y + BASELINE * fontSize, fontSize), anchor: t.geometry === 'point' ? 'start' : 'middle' };
}

const label = (s: TextPrim['s'], lines: string[], x: number, y: number, fontSize: number): TextPrim => ({
  t: 'text',
  s,
  x,
  y,
  lines,
  size: fontSize,
  lineHeight: LINE * fontSize,
  anchor: 'middle',
  weight: 500,
});
