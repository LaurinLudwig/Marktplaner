/**
 * Zahlenformate.
 *
 * Regel (QA-M2-01): Eingabefelder zeigen KEINE Tausendertrennzeichen (`fmtInput`), reine Anzeigen
 * schon (`fmt`). Beim Eingeben gilt Komma als Dezimaltrenner, ein Punkt wird ebenfalls als
 * Dezimaltrenner akzeptiert (`parseNum`). Damit gilt parseNum(fmtInput(x)) === x für alle Werte mit
 * höchstens `digits` Nachkommastellen.
 */

const roundTo = (n: number, digits: number): number => {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Math.abs(r) < 0.5 / f ? 0 : r;
};

/** Anzeige im deutschen Format mit Tausenderpunkt, höchstens `digits` Nachkommastellen, ohne „-0“. */
export function fmt(n: number, digits = 2): string {
  return roundTo(n, digits).toLocaleString('de-DE', { maximumFractionDigits: digits });
}

/** Für Eingabefelder: deutsches Dezimalkomma, KEIN Tausendertrennzeichen. */
export function fmtInput(n: number, digits = 2): string {
  return roundTo(n, digits).toLocaleString('de-DE', { maximumFractionDigits: digits, useGrouping: false });
}

/**
 * Liest Eingaben: „1,5“, „1.5“, „ 2 “, „-0,25“. Genau ein Dezimaltrenner (Komma oder Punkt),
 * keine Tausendertrennzeichen. Liefert NaN bei ungültiger Eingabe.
 */
export function parseNum(s: string): number {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}
