/**
 * Restzeit der Exportvorschau (#33). Grundlage ist die Dauer der letzten Vorschau derselben Seite (sonst irgendeiner
 * Seite); ist die schon überschritten oder unbekannt, wird aus dem bisherigen Fortschritt hochgerechnet.
 */

/** Unter dieser Restzeit zeigt die Vorschau keine Zeit an (sie ist dann gleich fertig). */
export const ETA_MIN_MS = 2000;

/** Restzeit in ganzen Sekunden (aufgerundet) oder null, wenn sie unter 2 s liegt oder nicht zu schätzen ist. */
export function remainingSeconds(elapsedMs: number, share: number, lastMs: number | null): number | null {
  let rest: number | null = null;
  if (lastMs !== null && lastMs > elapsedMs) rest = lastMs - elapsedMs;
  // Hochrechnen erst mit etwas Fortschritt und Laufzeit, sonst springt die Zahl wild
  else if (share >= 0.05 && share < 1 && elapsedMs >= 500) rest = (elapsedMs * (1 - share)) / share;
  if (rest === null || rest < ETA_MIN_MS) return null;
  return Math.ceil(rest / 1000);
}

/** Dauer der letzten Vorschau je Seite (Page oder Gesamtansicht), nur für diese Sitzung. */
const durations = new Map<string, number>();
let lastAny: number | null = null;

export function rememberDuration(ref: string, ms: number) {
  durations.set(ref, ms);
  lastAny = ms;
}

export function lastDuration(ref: string): number | null {
  return durations.get(ref) ?? lastAny;
}
