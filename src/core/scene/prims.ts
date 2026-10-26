/**
 * Gemeinsame Szenenbeschreibung für Zeichenfläche und PDF (M8, spec.md §9).
 *
 * Bausteine je Objekt liefern Grundformen („Primitive“) mit Stilschlüssel. Die Geometrie steckt nur hier; die
 * Zeichenfläche setzt den Stilschlüssel als CSS-Klasse um (Design hell/dunkel), das PDF über `PAPER_STYLE`
 * (paperStyle.ts). Einheiten: Planobjekte in Metern, Papier-Elemente in mm relativ zu ihrer linken oberen Ecke.
 * y zeigt nach unten (wie auf der Zeichenfläche).
 */
import type { Vec } from '../model/types';

/** Stilschlüssel; entspricht der CSS-Klasse auf der Zeichenfläche (siehe `src/ui/canvas/scene/Prim.tsx`). */
export type StyleKey =
  | 'area-body'
  | 'area-front'
  | 'stand'
  | 'stand-fill'
  | 'stand-outline'
  | 'stand-hitbox'
  | 'free-space'
  | 'free-hatch'
  | 'overlap-region'
  | 'warn-icon'
  | 'warn-icon-mark'
  | 'stand-label'
  | 'area-label'
  | 'free-label'
  | 'infra-label'
  | 'infra-body'
  | 'infra-icon'
  | 'infra-stroke'
  | 'infra-hair'
  | 'infra-dim'
  | 'grid-minor'
  | 'grid-major'
  | 'paper-box'
  | 'paper-rule'
  | 'paper-text'
  | 'paper-note'
  | 'paper-ink'
  | 'paper-white'
  | 'paper-shade'
  | 'sw-area'
  | 'sw-free'
  | 'sw-stand'
  | 'sw-infra-body'
  | 'sw-infra-line';

/**
 * Variante eines Stils (zweite CSS-Klasse), z. B. Warnfarbe am Stand oder gestrichelte Sperre. Im PDF wird zuerst
 * `stil.variante` gesucht, dann `stil`.
 */
export type StyleVariant = 'warn-outside' | 'warn-overlap' | 'outside' | 'overlap' | 'dashed' | 'warn-narrow';

interface Base {
  s: StyleKey;
  v?: StyleVariant;
  /** Datenfarbe (Kategorie, eigene Farbe, Typfarbe); der Stil sagt, ob sie Füllung oder Linie färbt. */
  color?: string;
}

/** Geschlossenes Polygon. */
export interface PolyPrim extends Base {
  t: 'poly';
  pts: readonly Vec[];
}

/** Pfad in SVG-Syntax (auch Symbole der Material Symbols mit relativen Befehlen und Bögen). */
export interface PathPrim extends Base {
  t: 'path';
  d: string;
  /** Linienstärke in den Einheiten der Szene (Meter bzw. mm), nur wenn sie zur Geometrie gehört (Sperre). */
  width?: number;
  /** Strichmuster in den Einheiten der Szene, nur wenn es zur Geometrie gehört. */
  dash?: readonly number[];
  /**
   * Transformation des Pfads (Symbole: Material Symbols haben 960 Einheiten, Ursprung oben links bei (0, −960)).
   * Punkt p im Pfad landet bei (x + k·p.x, y + k·p.y), gedreht um `rot` Grad im Uhrzeigersinn um (x, y).
   */
  at?: { x: number; y: number; k: number; rot?: number };
}

export interface LinePrim extends Base {
  t: 'line';
  a: Vec;
  b: Vec;
  /** Linienstärke in Einheiten der Szene, wenn sie zur Geometrie gehört (Sperre in ihrer Stärke). */
  width?: number;
  dash?: readonly number[];
}

export interface RectPrim extends Base {
  t: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export interface TextPrim extends Base {
  t: 'text';
  /** Bezugspunkt der ersten Zeile: x nach `anchor`, y = Grundlinie. */
  x: number;
  y: number;
  lines: readonly string[];
  /** Schriftgröße (Einheiten der Szene) und Zeilenabstand von Grundlinie zu Grundlinie. */
  size: number;
  lineHeight: number;
  anchor: TextAnchor;
  weight: 400 | 500 | 600;
}

export type Prim = PolyPrim | PathPrim | LinePrim | RectPrim | TextPrim;

/** Material Symbols: 960 Einheiten je Symbol, Ursprung oben links bei (0, −960). */
export const ICON_UNITS = 960;

/** Symbol `name` zentriert auf `c`, `size` hoch (Pfaddaten löst der Renderer über den Namen auf). */
export function iconPrim(name: string, c: Vec, size: number, s: StyleKey, color?: string): PathPrim & { icon: string } {
  return { t: 'path', s, d: '', icon: name, at: { x: c.x - size / 2, y: c.y + size / 2, k: size / ICON_UNITS }, ...(color ? { color } : {}) };
}

/** Pfad-Primitive, deren Daten ein Symbol sind, tragen dessen Namen (der Renderer setzt die Pfaddaten ein). */
export const isIcon = (p: Prim): p is PathPrim & { icon: string } => p.t === 'path' && 'icon' in p;

export const polyD = (pts: readonly Vec[]) => (pts.length ? `M${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('L')}Z` : '');
