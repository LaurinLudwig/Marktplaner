/**
 * Stile der Szene auf Papier (PDF, M8): Farben des hellen Designs, Strichstärken in mm auf dem Papier, unabhängig vom
 * Maßstab. Gegenstück zu den CSS-Klassen der Zeichenfläche (src/ui/theme/app.css); ein Test prüft, dass es zu jedem
 * Stilschlüssel beide gibt.
 */
import type { StyleKey, StyleVariant } from './prims';

/** `data` = Datenfarbe des Primitivs (Kategorie, eigene Farbe, Typfarbe). */
export type PaperColor = string | 'data';

export interface PaperStyle {
  fill?: PaperColor;
  fillOpacity?: number;
  stroke?: PaperColor;
  strokeOpacity?: number;
  /** Strichstärke in mm auf dem Papier; `geom` = Stärke aus dem Primitiv (Sperre in ihrer Stärke, Meter). */
  width?: number | 'geom';
  /** Strichmuster in mm auf dem Papier (sofern das Primitiv keins mitbringt). */
  dash?: readonly number[];
  /** Text: weißer Rand um die Schrift (E-23). */
  halo?: boolean;
}

const INK = '#1a1a1a';
const WARN = '#d4761a';
const ERR = '#d23c3c';
const FREE = '#2b8549';

export const PAPER_STYLE: Record<StyleKey, PaperStyle> = {
  'area-body': { fill: '#000000', fillOpacity: 0.05, stroke: '#000000', strokeOpacity: 0.55, width: 0.25, dash: [1.2, 0.7] },
  'area-front': { stroke: '#d97a00', width: 0.8 },
  stand: { fill: 'data', fillOpacity: 0.88, stroke: '#000000', strokeOpacity: 0.65, width: 0.2 },
  /** Zusammengesetzte Form (M12): Füllung und äußere Kontur getrennt. */
  'stand-fill': { fill: 'data', fillOpacity: 0.88 },
  'stand-outline': { stroke: '#000000', strokeOpacity: 0.65, width: 0.2 },
  /** Nur Zeichenfläche (Auswahl); der Export zeichnet die Hitbox nie. */
  'stand-hitbox': { stroke: '#000000', strokeOpacity: 0.5, width: 0.15, dash: [1, 0.6] },
  'free-space': { fill: FREE, fillOpacity: 0.12 },
  'free-hatch': { stroke: FREE, strokeOpacity: 0.38, width: 0.18 },
  'overlap-region': { fill: ERR, fillOpacity: 0.45, stroke: ERR, width: 0.2 },
  'warn-icon': { fill: WARN },
  'warn-icon-mark': { fill: '#ffffff' },
  'stand-label': { fill: '#141414', halo: true },
  'area-label': { fill: INK, halo: true },
  'free-label': { fill: '#1f6b39' },
  'infra-label': { fill: INK, halo: true },
  'infra-body': { fill: 'data', fillOpacity: 0.3, stroke: 'data', width: 0.3 },
  'infra-icon': { fill: 'data', fillOpacity: 0.9 },
  'infra-stroke': { stroke: 'data', strokeOpacity: 0.55, width: 'geom' },
  'infra-hair': { stroke: 'data', width: 0.4 },
  'infra-dim': { stroke: 'data', width: 0.3 },
  'grid-minor': { stroke: '#000000', strokeOpacity: 0.08, width: 0.1 },
  'grid-major': { stroke: '#000000', strokeOpacity: 0.18, width: 0.15 },
  'paper-box': { fill: '#ffffff', stroke: INK, width: 0.35 },
  'paper-rule': { stroke: INK, width: 0.25 },
  'paper-text': { fill: INK },
  /** Vermerk „erstellt mit“ am Blattrand (#5), nur im PDF. */
  'paper-note': { fill: '#8a9096' },
  'paper-ink': { fill: INK },
  'paper-white': { fill: '#ffffff' },
  'paper-shade': { fill: '#eef0f2' },
  'sw-area': { fill: '#e3e6e9', stroke: '#6b7178', width: 0.3, dash: [1, 0.6] },
  'sw-free': { fill: '#d6f0d2', stroke: '#6bb562', width: 0.3 },
  'sw-stand': { fill: 'data', stroke: '#555555', width: 0.2 },
  'sw-infra-body': { fill: 'data', fillOpacity: 0.3, stroke: 'data', width: 0.3 },
  'sw-infra-line': { stroke: 'data', width: 0.8 },
};

/** Abweichungen je Variante (zweite CSS-Klasse auf der Zeichenfläche). */
export const PAPER_VARIANT: Partial<Record<`${StyleKey}.${StyleVariant}`, PaperStyle>> = {
  'stand.warn-outside': { stroke: WARN, strokeOpacity: 1, width: 0.5 },
  'stand.warn-overlap': { stroke: ERR, strokeOpacity: 1, width: 0.5 },
  'stand-outline.warn-outside': { stroke: WARN, strokeOpacity: 1, width: 0.5 },
  'stand-outline.warn-overlap': { stroke: ERR, strokeOpacity: 1, width: 0.5 },
  'warn-icon.outside': { fill: WARN },
  'warn-icon.overlap': { fill: ERR },
  'infra-hair.dashed': { dash: [1.2, 0.8] },
  'infra-dim.warn-narrow': { stroke: ERR, width: 0.6 },
};

export function paperStyle(s: StyleKey, v?: StyleVariant): PaperStyle {
  const base = PAPER_STYLE[s];
  const extra = v ? PAPER_VARIANT[`${s}.${v}`] : undefined;
  return extra ? { ...base, ...extra } : base;
}

/** Linienabstand der Freiflächen-Schraffur auf dem Papier (mm). */
export const PAPER_HATCH_MM = 2.5;
