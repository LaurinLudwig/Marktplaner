/**
 * Beschriftung (M3). Standbeschriftung aus der projektweiten Vorlage, z. B.
 * "{nr}\n{name}\n{breite}×{tiefe} m". Zeilen, die nach dem Einsetzen leer sind, entfallen; ebenso
 * Zeilen, deren Platzhalter alle leer sind (z. B. "{strom} kW" ohne Stromangabe).
 */
import { fmt } from './format';
import type { Area, Connection, Stand } from './model/types';

export const CONNECTION_LABEL: Record<Connection, string> = { '230V': '230 V', CEE16: 'CEE 16 A', CEE32: 'CEE 32 A' };

export const LABEL_PLACEHOLDERS = ['nr', 'name', 'eigentuemer', 'ware', 'breite', 'tiefe', 'strom', 'anschluss', 'kategorie'] as const;

function values(s: Stand, categoryName: string): Record<string, string> {
  return {
    nr: s.nr,
    name: s.name,
    eigentuemer: s.owner,
    ware: s.ware,
    breite: fmt(s.w),
    tiefe: fmt(s.d),
    strom: s.powerKw ? fmt(s.powerKw) : '',
    anschluss: s.connection ? CONNECTION_LABEL[s.connection] : '',
    kategorie: categoryName,
  };
}

/**
 * Zeilen der Standbeschriftung. `blank` = Platzhalter, die leer bleiben (Export-Profil ohne dieses Feld, M8): Sie
 * zählen wie ein leerer Wert, eine Zeile nur aus ihnen entfällt also.
 */
export function formatLabel(template: string, stand: Stand, categoryName = '', blank?: ReadonlySet<string>): string[] {
  const v = values(stand, categoryName);
  if (blank) for (const k of blank) if (k in v) v[k] = '';
  const out: string[] = [];
  for (const line of template.split(/\r?\n/)) {
    let used = 0;
    let filled = 0;
    const text = line.replace(/\{(\w+)\}/g, (m, key: string) => {
      if (!(key in v)) return m;
      used++;
      const val = v[key]!;
      if (val) filled++;
      return val;
    });
    if (!text.trim() || (used > 0 && filled === 0)) continue;
    out.push(text);
  }
  return out;
}

/** Beschriftung einer Grundfläche: „Name · 50 × 10 m“, ohne Namen nur die Maße. */
export function areaLabel(a: Area): string {
  const dims = `${fmt(a.w)} × ${fmt(a.d)} m`;
  return a.name.trim() ? `${a.name.trim()} · ${dims}` : dims;
}

/** Grobe Textbreite in Schriftgrößen (IBM Plex Sans ≈ 0,56 em pro Zeichen), für die Platzierung. */
export const approxTextWidth = (text: string, fontSize: number) => text.length * 0.56 * fontSize;

/** Beschriftung einer Freifläche: „Frei 20 × 10 m“. */
export const freeSpaceLabel = (width: number, depth: number) => `Frei ${fmt(width)} × ${fmt(depth)} m`;
