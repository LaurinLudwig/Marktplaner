/**
 * CSV-Export der Start-Page-Tabellen (M6, spec.md §7) für Excel in Deutschland: UTF-8 mit BOM, Semikolon als
 * Trenner, CRLF, Zahlen mit Dezimalkomma ohne Tausenderpunkt. Textzellen, die mit = + - @ (oder Tab/CR)
 * beginnen, bekommen ein ' vorangestellt, damit Excel sie nicht als Formel ausführt.
 */
import { exportNote } from './appInfo';
import { fmtInput } from './format';

/** Zahl = als Zahl exportiert; null = leere Zelle. */
export type CsvCell = string | number | null;

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell, digits = 3): string {
  if (v === null) return '';
  const text = typeof v === 'number' ? fmtInput(v, digits) : FORMULA_START.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return BOM + [header.map((h) => csvCell(h)), ...rows.map((r) => r.map((c) => csvCell(c)))].map((r) => r.join(';')).join('\r\n') + '\r\n';
}

/** Vermerk „erstellt mit“ (#5) nach einer Leerzeile am Ende, damit die Tabelle selbst sauber bleibt. */
export const withExportNote = (csv: string): string => `${csv}\r\n${csvCell(exportNote())}\r\n`;

/** Dateiname ohne Zeichen, die Windows oder macOS nicht erlauben. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Export';
