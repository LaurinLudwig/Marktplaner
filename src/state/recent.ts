import { create } from 'zustand';
import { addRecent, parseRecent, removeRecent, type RecentFile } from '../core/recentFiles';
import { platform } from '../platform';

/**
 * Zuletzt geöffnete Projekte dieses Rechners (#11, spec.md §10). Nicht im Projekt: kein Undo-Schritt, keine
 * Änderungsmarkierung. Gespeichert über `platform.writeAppSetting` (Desktop: Datei im App-Datenordner).
 */
const KEY = 'recent-projects';

interface RecentState {
  files: RecentFile[];
  /** Pfade, die beim letzten Prüfen fehlten (ausgegraut). */
  missing: ReadonlySet<string>;
}

export const useRecent = create<RecentState>()(() => ({ files: [], missing: new Set() }));

const persist = () => platform.writeAppSetting(KEY, JSON.stringify(useRecent.getState().files)).catch((e: unknown) => console.warn(e));

/** Beim Start: Liste lesen und fehlende Dateien markieren. */
export async function loadRecent() {
  const files = parseRecent(await platform.readAppSetting(KEY).catch(() => null));
  useRecent.setState({ files });
  await checkRecent();
}

/** Prüft, welche Dateien es nicht mehr gibt (vor dem Anzeigen der Liste). */
export async function checkRecent() {
  const { files } = useRecent.getState();
  const gone = await Promise.all(files.map((f) => platform.fileExists(f.path).then((ok) => !ok, () => true)));
  useRecent.setState({ missing: new Set(files.filter((_, i) => gone[i]).map((f) => f.path)) });
}

/** Geöffnete oder gespeicherte Datei oben eintragen (nur mit Pfad, also nicht im Browser). */
export function rememberRecent(path: string | null, name: string) {
  if (!path) return;
  const s = useRecent.getState();
  const missing = new Set(s.missing);
  missing.delete(path);
  useRecent.setState({ files: addRecent(s.files, { path, name, openedAt: new Date().toISOString() }), missing });
  void persist();
}

export function forgetRecent(path: string) {
  useRecent.setState((s) => ({ files: removeRecent(s.files, path) }));
  void persist();
}

export function clearRecent() {
  useRecent.setState({ files: [], missing: new Set() });
  void persist();
}
