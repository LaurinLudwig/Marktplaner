/**
 * Legende (M7, spec.md §8): Einträge automatisch aus dem, was auf der Page sichtbar vorkommt, und ihr Layout in mm.
 * Ab M8 nutzt der PDF-Export dieselbe Funktion mit den Ebenen des Export-Profils.
 */
import { approxTextWidth } from './label';
import type { Category, FestplatzPage, InfraGeometry, InfraTypeDef, LayerId, LayerState } from './model/types';

export type LegendKind = 'area' | 'free' | 'category' | 'noCategory' | 'infra';

export interface LegendEntry {
  key: string;
  kind: LegendKind;
  label: string;
  color: string;
  /** Nur Infrastruktur: Symbol und Geometrie (Darstellung des Farbfelds). */
  icon?: string;
  geometry?: InfraGeometry;
}

/**
 * Einträge in fester Reihenfolge: Grundfläche, Freifläche, Kategorien (Projektreihenfolge), „Geschäft ohne
 * Kategorie“, Infrastruktur-Typen (Reihenfolge der Typen). Ausgeblendete Ebenen fehlen. Kategorien zählen nur über
 * Stände ohne eigene Farbe (ein Stand mit eigener Farbe zeigt die Kategoriefarbe nicht).
 */
export function legendEntries(
  page: Pick<FestplatzPage, 'areas' | 'stands' | 'infra'>,
  project: { categories: readonly Category[]; infraTypes: readonly InfraTypeDef[]; settings: { defaultStandColor: string } },
  layers: Record<LayerId, LayerState>,
  freeShown: boolean,
): LegendEntry[] {
  const out: LegendEntry[] = [];
  if (layers.areas.visible && page.areas.length) {
    out.push({ key: 'area', kind: 'area', label: 'Grundfläche', color: '' });
    if (layers.free.visible && freeShown) out.push({ key: 'free', kind: 'free', label: 'Freifläche', color: '' });
  }
  if (layers.stands.visible) {
    const plain = page.stands.filter((s) => s.color === null);
    const used = new Set(plain.map((s) => s.categoryId));
    for (const c of project.categories) if (used.has(c.id)) out.push({ key: `cat:${c.id}`, kind: 'category', label: c.name, color: c.color });
    if (used.has(null)) out.push({ key: 'nocat', kind: 'noCategory', label: 'Geschäft ohne Kategorie', color: project.settings.defaultStandColor });
  }
  if (layers.infra.visible) {
    const used = new Set(page.infra.map((o) => o.typeId));
    for (const t of project.infraTypes)
      if (used.has(t.id)) out.push({ key: `infra:${t.id}`, kind: 'infra', label: t.label, color: t.color, icon: t.icon, geometry: t.geometry });
  }
  return out;
}

// ---------- Layout (mm) ----------

export const LEGEND_COLUMN = 60;
const PAD = 3;
const TITLE_SIZE = 3.5;
const TITLE_H = 7;
export const LEGEND_ROW = 5;
export const LEGEND_SWATCH = { w: 8, h: 4 };
export const LEGEND_TEXT = 2.5;
/** Rand, der beim Spaltenumbruch zur Blatthöhe frei bleibt. */
const SHEET_RESERVE = 20;

export interface LegendLayout {
  w: number;
  h: number;
  title: { text: string; size: number; x: number; y: number };
  rows: { entry: LegendEntry; text: string; x: number; y: number }[];
}

/** Kürzt einen Namen mit „…“, bis er in `maxMm` passt (geschätzte Textbreite wie bei den Beschriftungen). */
export function fitText(text: string, size: number, maxMm: number): string {
  if (approxTextWidth(text, size) <= maxMm) return text;
  let t = text;
  while (t.length > 1 && approxTextWidth(`${t}…`, size) > maxMm) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Spalten von 60 mm; reicht die Blatthöhe (abzüglich 20 mm) nicht, beginnt die nächste Spalte. */
export function legendLayout(entries: readonly LegendEntry[], paperHeight: number): LegendLayout {
  const perColumn = Math.max(1, Math.floor((paperHeight - SHEET_RESERVE - 2 * PAD - TITLE_H) / LEGEND_ROW));
  const columns = Math.max(1, Math.ceil(entries.length / perColumn));
  const rowsInFirst = Math.min(entries.length, perColumn);
  const textX = PAD + LEGEND_SWATCH.w + 2;
  const maxText = LEGEND_COLUMN - textX - 2;
  return {
    w: columns * LEGEND_COLUMN,
    h: PAD + TITLE_H + rowsInFirst * LEGEND_ROW + PAD - 1,
    title: { text: 'Legende', size: TITLE_SIZE, x: PAD, y: PAD + TITLE_SIZE },
    rows: entries.map((entry, i) => {
      const col = Math.floor(i / perColumn);
      const row = i % perColumn;
      return { entry, text: fitText(entry.label, LEGEND_TEXT, maxText), x: col * LEGEND_COLUMN, y: PAD + TITLE_H + row * LEGEND_ROW };
    }),
  };
}
