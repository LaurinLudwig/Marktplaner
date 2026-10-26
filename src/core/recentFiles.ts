/**
 * Liste „Zuletzt geöffnet“ (#11, spec.md §10): Projektdateien dieses Rechners, neueste zuerst. Gespeichert über
 * `platform.writeAppSetting`, nicht in der Projektdatei.
 */
export interface RecentFile {
  path: string;
  /** Dateiname mit Endung, wie in der Dateiliste. */
  name: string;
  /** Zuletzt geöffnet oder gespeichert, ISO-Zeit. */
  openedAt: string;
}

export const RECENT_MAX = 10;

/** Windows-Pfade (Laufwerk `C:` oder Netzwerkpfad `\\`) unterscheiden keine Groß-/Kleinschreibung. */
const isWindowsPath = (p: string) => /^[a-z]:/i.test(p) || p.startsWith('\\\\');
const samePath = (a: string, b: string) => (isWindowsPath(a) ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Eintrag vorn einsetzen; derselbe Pfad wandert nach oben, höchstens `max` Einträge. */
export function addRecent(list: readonly RecentFile[], entry: RecentFile, max = RECENT_MAX): RecentFile[] {
  return [entry, ...list.filter((f) => !samePath(f.path, entry.path))].slice(0, max);
}

export function removeRecent(list: readonly RecentFile[], path: string): RecentFile[] {
  return list.filter((f) => !samePath(f.path, path));
}

/** Gespeicherte Liste lesen; kaputte oder unvollständige Einträge entfallen. */
export function parseRecent(json: string | null): RecentFile[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: RecentFile[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const { path, name, openedAt } = r as Record<string, unknown>;
    if (typeof path !== 'string' || !path || typeof name !== 'string') continue;
    out.push({ path, name, openedAt: typeof openedAt === 'string' ? openedAt : '' });
  }
  return out.slice(0, RECENT_MAX);
}

/** Ordner der Datei zur Anzeige, mit dem Trennzeichen des Pfads; ohne Ordner leer. */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut <= 0 ? '' : path.slice(0, cut);
}
