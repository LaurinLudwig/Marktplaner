/**
 * Bausteine der Papier-Elemente (M8): Schriftfeld, Legende, Maßstabsbalken und Nordpfeil in mm, relativ zur linken
 * oberen Ecke des Elements. Die Zeichenfläche zeichnet sie in einer Gruppe mit `translate(topLeft) scale(n/1000)`,
 * das PDF direkt in mm auf dem Papier.
 */
import { fmt } from '../format';
import { LEGEND_SWATCH, LEGEND_TEXT, type LegendEntry, type LegendLayout } from '../legend';
import type { TitleBlockLayout } from '../sheet';
import { iconPrim, type Prim, type TextPrim } from './prims';

const text = (lines: string[], x: number, y: number, size: number, weight: 400 | 500 | 600 = 400, anchor: TextPrim['anchor'] = 'start'): TextPrim => ({
  t: 'text',
  s: 'paper-text',
  x,
  y,
  lines,
  size,
  lineHeight: size * 1.2,
  anchor,
  weight,
});

// ---------- Schriftfeld ----------

export function titleBlockPrims(layout: TitleBlockLayout): Prim[] {
  return [
    { t: 'rect', s: 'paper-box', x: 0, y: 0, w: layout.w, h: layout.h },
    ...layout.rules.map((y): Prim => ({ t: 'line', s: 'paper-rule', a: { x: 0, y }, b: { x: layout.w, y } })),
    ...layout.texts.map((t) => text([t.text], t.x, t.y - t.size * 0.18, t.size, t.weight ?? 400)),
  ];
}

// ---------- Legende ----------

/** Abstand des Farbfelds vom linken Rand einer Spalte und des Texts dahinter (mm). */
const SW_X = 3;
const SW_Y = -0.5;

/** Farbfeld 8 × 4 mm je Eintrag, so wie das Objekt auf dem Plan aussieht. */
export function swatchPrims(e: LegendEntry, ox: number, oy: number): Prim[] {
  const { w, h } = LEGEND_SWATCH;
  const x = ox + SW_X;
  const y = oy + SW_Y;
  if (e.kind === 'area') return [{ t: 'rect', s: 'sw-area', x, y, w, h }];
  if (e.kind === 'free') return [{ t: 'rect', s: 'sw-free', x, y, w, h }];
  if (e.kind === 'infra') {
    const icon = iconPrim(e.icon ?? 'info', { x: x + w / 2, y: y + h / 2 }, h, 'infra-icon', e.color);
    if (e.geometry === 'line') return [{ t: 'line', s: 'sw-infra-line', a: { x, y: y + h / 2 }, b: { x: x + w, y: y + h / 2 }, color: e.color }];
    if (e.geometry === 'point') return [icon];
    return [{ t: 'rect', s: 'sw-infra-body', x, y, w, h, color: e.color }, icon];
  }
  return [{ t: 'rect', s: 'sw-stand', x, y, w, h, color: e.color }];
}

/** Rahmen und Titel der Legende. */
export const legendFramePrims = (layout: LegendLayout): Prim[] => [
  { t: 'rect', s: 'paper-box', x: 0, y: 0, w: layout.w, h: layout.h },
  text([layout.title.text], layout.title.x, layout.title.y, layout.title.size, 600),
];

/** Eine Zeile: Farbfeld bzw. Symbol und Text. */
export const legendRowPrims = (r: LegendLayout['rows'][number]): Prim[] => [
  ...swatchPrims(r.entry, r.x, r.y),
  text([r.text], r.x + SW_X + LEGEND_SWATCH.w + 2, r.y + LEGEND_TEXT * 1.15, LEGEND_TEXT),
];

export const legendPrims = (layout: LegendLayout): Prim[] => [...legendFramePrims(layout), ...layout.rows.flatMap(legendRowPrims)];

// ---------- Maßstabsbalken (M8, §8) ----------

/** Feste Größe, damit die Lage auf dem Papier nicht vom Maßstab abhängt (Anker, „an Seite anpassen“). */
export const SCALE_BAR_SIZE = { w: 92, h: 14 };
const SB_PAD = 3;
const SB_MAX_MM = 80;
const SB_BAR_H = 2.5;
const SB_TEXT = 2.5;

export interface ScaleBarLayout {
  w: number;
  h: number;
  /** Länge in Metern und auf dem Papier (mm). */
  meters: number;
  mm: number;
  /** Feldgrenzen in mm ab Balkenanfang. */
  fields: number[];
}

/**
 * Länge 1, 2 oder 5 × 10^k m: die längste, die höchstens 80 mm auf dem Papier ergibt (damit mindestens 32 mm). Bei
 * 1 und 5 fünf Felder, bei 2 vier Felder.
 */
export function scaleBarLayout(scale: number): ScaleBarLayout {
  const mmPerM = 1000 / scale;
  const maxM = SB_MAX_MM / mmPerM;
  let k = 10 ** Math.floor(Math.log10(maxM));
  let lead = 1;
  for (const f of [5, 2, 1]) {
    if (f * k <= maxM * (1 + 1e-9)) {
      lead = f;
      break;
    }
  }
  if (lead * k > maxM * (1 + 1e-9)) {
    k /= 10;
    lead = 5;
  }
  const meters = Number((lead * k).toPrecision(6));
  const mm = meters * mmPerM;
  const n = lead === 2 ? 4 : 5;
  return { ...SCALE_BAR_SIZE, meters, mm, fields: Array.from({ length: n + 1 }, (_, i) => (mm * i) / n) };
}

/** Meterangabe ohne überflüssige Nachkommastellen („0,5“, „20“, „1.000“). */
const meterText = (m: number) => fmt(m, m < 1 ? 2 : m < 10 ? 1 : 0).replace(/,0+$/, '').replace(/(,\d*?)0+$/, '$1');

export function scaleBarPrims(layout: ScaleBarLayout, scale: number): Prim[] {
  const x0 = SB_PAD;
  const yBar = SB_PAD + SB_TEXT + 1;
  const out: Prim[] = [{ t: 'rect', s: 'paper-white', x: 0, y: 0, w: layout.w, h: layout.h }];
  layout.fields.slice(0, -1).forEach((a, i) => {
    out.push({ t: 'rect', s: i % 2 ? 'paper-white' : 'paper-ink', x: x0 + a, y: yBar, w: layout.fields[i + 1]! - a, h: SB_BAR_H });
  });
  out.push({ t: 'rect', s: 'paper-rule', x: x0, y: yBar, w: layout.mm, h: SB_BAR_H });
  const yText = yBar - 1;
  out.push(text(['0'], x0, yText, SB_TEXT, 400, 'middle'));
  out.push(text([meterText(layout.meters / 2)], x0 + layout.mm / 2, yText, SB_TEXT, 400, 'middle'));
  out.push(text([`${meterText(layout.meters)} m`], x0 + layout.mm, yText, SB_TEXT, 400, 'middle'));
  out.push(text([`1:${fmt(scale, 0)}`], x0, yBar + SB_BAR_H + 1 + SB_TEXT, SB_TEXT));
  return out;
}

// ---------- Nordpfeil (M8, §8) ----------

/** Wie der Nordpfeil der Zeichenfläche (40 Einheiten), auf dem Papier 20 × 20 mm. */
export const NORTH_ARROW_SIZE = { w: 20, h: 20 };

/** `angle` = Richtung Norden in Grad im Uhrzeigersinn ab „oben“ (Nordrichtung der Page, §1). */
export function northArrowPrims(angle: number): Prim[] {
  const k = NORTH_ARROW_SIZE.w / 40;
  const c = { x: NORTH_ARROW_SIZE.w / 2, y: NORTH_ARROW_SIZE.h / 2 };
  const rad = (angle * Math.PI) / 180;
  const rot = (x: number, y: number) => ({ x: c.x + k * (x * Math.cos(rad) - y * Math.sin(rad)), y: c.y + k * (x * Math.sin(rad) + y * Math.cos(rad)) });
  const n = rot(0, -10.5);
  return [
    { t: 'path', s: 'paper-box', d: circleD(c.x, c.y, 18 * k) },
    { t: 'poly', s: 'paper-ink', pts: [rot(0, -4), rot(4.5, 13), rot(0, 10), rot(-4.5, 13)] },
    // „N“ steht aufrecht an der Spitze (lesbar bei jeder Nordrichtung); Grundlinie um eine halbe Versalhöhe tiefer
    text(['N'], n.x, n.y + 9 * k * 0.36, 9 * k, 600, 'middle'),
  ];
}

const circleD = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
