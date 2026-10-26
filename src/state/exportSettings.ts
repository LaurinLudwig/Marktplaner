import { create } from 'zustand';
import { builtinProfile, DEFAULT_DPI, EXPORT_DPI, loadProfiles, newProfile, type ExportDpi, type ExportProfile } from '../core/exportProfiles';
import { userMessage } from '../core/errors';
import { platform } from '../platform';

/**
 * Export-Profile und Export-Optionen dieses Rechners (M8-07, spec.md §9). Nicht im Projekt: kein Undo-Schritt, keine
 * Änderungsmarkierung. Gespeichert über `platform.writeAppSetting` (Desktop: Datei im App-Datenordner).
 */
const PROFILES_KEY = 'export-profile';
const OPTIONS_KEY = 'export-optionen';

interface ExportSettings {
  loaded: boolean;
  profiles: ExportProfile[];
  profileId: string;
  dpi: ExportDpi;
  /** Meldung beim Laden (beschädigte Datei). */
  error: string | null;
}

export const useExportSettings = create<ExportSettings>()(() => ({
  loaded: false,
  profiles: loadProfiles(undefined).profiles,
  profileId: 'internal',
  dpi: DEFAULT_DPI,
  error: null,
}));

const parse = (json: string | null): unknown => {
  if (json === null) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return 'kaputt';
  }
};

/** Einmal beim ersten Öffnen des Export-Dialogs. */
export async function loadExportSettings() {
  if (useExportSettings.getState().loaded) return;
  try {
    const [p, o] = await Promise.all([platform.readAppSetting(PROFILES_KEY), platform.readAppSetting(OPTIONS_KEY)]);
    const { profiles, error } = loadProfiles(parse(p));
    const opts = parse(o) as { dpi?: unknown; profileId?: unknown } | undefined;
    const dpi = EXPORT_DPI.find((d) => d === opts?.dpi) ?? DEFAULT_DPI;
    const profileId = typeof opts?.profileId === 'string' && profiles.some((x) => x.id === opts.profileId) ? opts.profileId : 'internal';
    useExportSettings.setState({ loaded: true, profiles, dpi, profileId, error: error ?? null });
  } catch (e) {
    useExportSettings.setState({ loaded: true, error: userMessage(e, 'Die Export-Profile konnten nicht gelesen werden; es gelten die mitgelieferten.') });
  }
}

async function persist() {
  const s = useExportSettings.getState();
  try {
    await platform.writeAppSetting(PROFILES_KEY, JSON.stringify(s.profiles));
    await platform.writeAppSetting(OPTIONS_KEY, JSON.stringify({ dpi: s.dpi, profileId: s.profileId }));
  } catch (e) {
    useExportSettings.setState({ error: userMessage(e, 'Die Export-Profile konnten nicht gespeichert werden.') });
  }
}

export const currentProfile = (): ExportProfile => {
  const s = useExportSettings.getState();
  return s.profiles.find((p) => p.id === s.profileId) ?? s.profiles[0]!;
};

export function selectProfile(id: string) {
  useExportSettings.setState({ profileId: id });
  void persist();
}

export function setExportDpi(dpi: ExportDpi) {
  useExportSettings.setState({ dpi });
  void persist();
}

export function updateProfile(id: string, patch: Partial<Omit<ExportProfile, 'id' | 'builtin'>>) {
  useExportSettings.setState((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() || p.name } : {}) } : p)) }));
  void persist();
}

/** Neues eigenes Profil als Kopie des gewählten; wird ausgewählt. */
export function addProfile(): string {
  const s = useExportSettings.getState();
  const from = currentProfile();
  const names = new Set(s.profiles.map((p) => p.name));
  let name = `${from.name} (Kopie)`;
  for (let i = 2; names.has(name); i++) name = `${from.name} (Kopie ${i})`;
  const p = newProfile(name, from);
  useExportSettings.setState({ profiles: [...s.profiles, p], profileId: p.id });
  void persist();
  return p.id;
}

export function deleteProfile(id: string) {
  const s = useExportSettings.getState();
  const p = s.profiles.find((x) => x.id === id);
  if (!p || p.builtin) return;
  useExportSettings.setState({ profiles: s.profiles.filter((x) => x.id !== id), profileId: s.profileId === id ? 'internal' : s.profileId });
  void persist();
}

/** Mitgeliefertes Profil auf den Auslieferungsstand zurücksetzen. */
export function resetProfile(id: string) {
  const b = builtinProfile(id);
  if (!b) return;
  useExportSettings.setState((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? structuredClone(b) : p)) }));
  void persist();
}
