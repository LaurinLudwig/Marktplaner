/**
 * Export-Profile (M8, spec.md §9): Was ein PDF zeigt – Ebenen, Warnungen, erlaubte Felder, Anhang. Profile gelten
 * pro Rechner (Entscheidung Laurin 2026-10-12) und liegen nicht in der Projektdatei.
 *
 * Datenschutz: `redactProject` erzeugt vor dem Export eine Kopie des Projekts, in der alle nicht erlaubten Felder
 * geleert sind. Nur diese Kopie wird zu Szene, Anhang und Metadaten verarbeitet; was dort fehlt, kann im PDF nicht
 * vorkommen. Fehlt in einem gespeicherten Profil eine Angabe, gilt sie als nicht erlaubt.
 */
import { newId } from './id';
import { LAYER_IDS, type LayerId, type LayerState, type Project } from './model/types';

/** Felder eines Stands, die Beschriftung und Anhang zeigen können. */
export const STAND_FIELDS = ['nr', 'name', 'owner', 'ware', 'w', 'd', 'power', 'connection', 'category', 'note'] as const;
export type StandField = (typeof STAND_FIELDS)[number];

export const STAND_FIELD_LABEL: Record<StandField, string> = {
  nr: 'Nummer',
  name: 'Name',
  owner: 'Eigentümer',
  ware: 'Ware',
  w: 'Breite',
  d: 'Tiefe',
  power: 'Strom',
  connection: 'Anschlussart',
  category: 'Kategorie',
  note: 'Notiz',
};

/** Platzhalter der Beschriftungsvorlage (§3) je Feld. */
export const FIELD_PLACEHOLDER: Record<StandField, string | null> = {
  nr: 'nr',
  name: 'name',
  owner: 'eigentuemer',
  ware: 'ware',
  w: 'breite',
  d: 'tiefe',
  power: 'strom',
  connection: 'anschluss',
  category: 'kategorie',
  note: null,
};

/** Ebenen, die ein Profil schalten kann. */
export const PROFILE_LAYERS = ['background', 'grid', 'areas', 'free', 'stands', 'infra', 'labels'] as const;
export type ProfileLayer = (typeof PROFILE_LAYERS)[number];

export const PROFILE_LAYER_LABEL: Record<ProfileLayer, string> = {
  background: 'Hintergrund',
  grid: 'Raster',
  areas: 'Grundflächen',
  free: 'Freiflächen',
  stands: 'Geschäfte',
  infra: 'Infrastruktur',
  labels: 'Beschriftung',
};

/** `safety` = „Rettungswege“: nur „Infrastruktur“ (Stand in Freihaltefläche) und „Durchfahrt zu eng“. */
export type WarningMode = 'none' | 'safety' | 'all';
export const WARNING_MODE_LABEL: Record<WarningMode, string> = { none: 'keine', safety: 'Rettungswege', all: 'alle' };

export const APPENDIX_PARTS = ['stands', 'free', 'infra'] as const;
export type AppendixPart = (typeof APPENDIX_PARTS)[number];
export const APPENDIX_LABEL: Record<AppendixPart, string> = { stands: 'Standliste', free: 'Freiflächenliste', infra: 'Infrastrukturliste' };

export interface ExportProfile {
  id: string;
  builtin: boolean;
  name: string;
  layers: Record<ProfileLayer, boolean>;
  warnings: WarningMode;
  fields: StandField[];
  appendix: Record<AppendixPart, boolean>;
}

const allLayers = (on: boolean) => Object.fromEntries(PROFILE_LAYERS.map((l) => [l, on])) as Record<ProfileLayer, boolean>;

/** Mitgeliefert (§9): bearbeitbar, „Zurücksetzen“ stellt diesen Stand her, nicht löschbar. */
export const BUILTIN_PROFILES: readonly ExportProfile[] = [
  {
    id: 'internal',
    builtin: true,
    name: 'Intern',
    layers: allLayers(true),
    warnings: 'all',
    fields: [...STAND_FIELDS],
    appendix: { stands: true, free: true, infra: true },
  },
  {
    id: 'safety',
    builtin: true,
    name: 'Sanität/Ordnungsamt',
    layers: { ...allLayers(true), grid: false },
    warnings: 'safety',
    fields: ['nr', 'name', 'ware', 'w', 'd', 'category'],
    appendix: { stands: true, free: false, infra: true },
  },
  {
    id: 'vendor',
    builtin: true,
    name: 'Händler',
    layers: { ...allLayers(true), grid: false, free: false },
    warnings: 'none',
    fields: ['nr', 'name'],
    appendix: { stands: false, free: false, infra: false },
  },
];

export const builtinProfile = (id: string) => BUILTIN_PROFILES.find((p) => p.id === id);

/** Neues eigenes Profil als Kopie von `from` (ohne `from`: wie „Händler“, also zurückhaltend). */
export function newProfile(name: string, from?: ExportProfile): ExportProfile {
  const base = from ?? BUILTIN_PROFILES[2]!;
  return { ...structuredClone(base), id: newId(), builtin: false, name };
}

// ---------- Laden und Prüfen ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ein gespeichertes Profil prüfen; fehlende oder unbekannte Angaben gelten als nicht erlaubt bzw. aus. */
export function normalizeProfile(raw: unknown): ExportProfile | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const layers = isObj(raw.layers) ? raw.layers : {};
  const appendix = isObj(raw.appendix) ? raw.appendix : {};
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  const builtin = !!builtinProfile(raw.id);
  return {
    id: raw.id,
    builtin,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (builtinProfile(raw.id)?.name ?? 'Profil'),
    layers: Object.fromEntries(PROFILE_LAYERS.map((l) => [l, layers[l] === true])) as Record<ProfileLayer, boolean>,
    warnings: raw.warnings === 'all' || raw.warnings === 'safety' ? raw.warnings : 'none',
    fields: STAND_FIELDS.filter((f) => fields.includes(f)),
    appendix: Object.fromEntries(APPENDIX_PARTS.map((a) => [a, appendix[a] === true])) as Record<AppendixPart, boolean>,
  };
}

export interface StoredProfiles {
  profiles: ExportProfile[];
  /** Deutsche Meldung, wenn die gespeicherten Profile nicht lesbar waren. */
  error?: string;
}

/**
 * Profile aus den App-Einstellungen: die mitgelieferten zuerst (in gespeicherter Fassung, sonst Auslieferung),
 * dann die eigenen in gespeicherter Reihenfolge.
 */
export function loadProfiles(raw: unknown): StoredProfiles {
  const fresh = () => BUILTIN_PROFILES.map((p) => structuredClone(p) as ExportProfile);
  if (raw === undefined || raw === null) return { profiles: fresh() };
  if (!Array.isArray(raw)) return { profiles: fresh(), error: 'Die gespeicherten Export-Profile sind beschädigt; es gelten die mitgelieferten Profile.' };
  const stored = raw.map(normalizeProfile).filter((p): p is ExportProfile => !!p);
  const seen = new Set<string>();
  const unique = stored.filter((p) => !seen.has(p.id) && seen.add(p.id));
  const builtins = BUILTIN_PROFILES.map((b) => unique.find((p) => p.id === b.id) ?? (structuredClone(b) as ExportProfile));
  const own = unique.filter((p) => !p.builtin);
  const broken = stored.length < raw.length;
  return {
    profiles: [...builtins, ...own],
    ...(broken ? { error: 'Einige gespeicherte Export-Profile waren beschädigt und wurden verworfen.' } : {}),
  };
}

// ---------- Anwenden ----------

/** Sichtbare Ebenen für Legende und Szene: nur die des Profils, nie die der Zeichenfläche (§9). */
export function profileLayers(profile: ExportProfile): Record<LayerId, LayerState> {
  const on = (id: LayerId): boolean => {
    if (id === 'sheet') return true;
    return profile.layers[id as ProfileLayer] ?? false;
  };
  return Object.fromEntries(LAYER_IDS.map((id) => [id, { visible: on(id), locked: false }])) as Record<LayerId, LayerState>;
}

/** Platzhalter der Vorlage, die leer bleiben (nicht erlaubte Felder). */
export function blankedPlaceholders(profile: ExportProfile): Set<string> {
  const allowed = new Set(profile.fields);
  return new Set(STAND_FIELDS.filter((f) => !allowed.has(f)).flatMap((f) => (FIELD_PLACEHOLDER[f] ? [FIELD_PLACEHOLDER[f]] : [])));
}

/**
 * Kopie des Projekts ohne die nicht erlaubten Felder (Datenschutz, §9). Maße bleiben (die Stände werden gezeichnet);
 * sie verschwinden nur aus Beschriftung und Anhang. Die Kategorie bleibt am Stand (Farbe, Legende) und fehlt nur in
 * Beschriftung und Anhang. Strom, Anschlussart und Notiz gelten auch für Infrastruktur-Objekte. Personenbezogene
 * Daten der Händlerliste (`unplaced`) kommen nie in den Export.
 */
export function redactProject(project: Project, profile: ExportProfile): Project {
  const allow = new Set(profile.fields);
  const has = (f: StandField) => allow.has(f);
  return {
    ...project,
    unplaced: [],
    pages: project.pages.map((pg) => ({
      ...pg,
      stands: pg.stands.map((s) => ({
        ...s,
        nr: has('nr') ? s.nr : '',
        name: has('name') ? s.name : '',
        owner: has('owner') ? s.owner : '',
        ware: has('ware') ? s.ware : '',
        powerKw: has('power') ? s.powerKw : 0,
        connection: has('connection') ? s.connection : null,
        note: has('note') ? s.note : '',
      })),
      infra: pg.infra.map((o) => ({
        ...o,
        powerKw: has('power') ? o.powerKw : 0,
        connection: has('connection') ? o.connection : null,
        note: has('note') ? o.note : '',
      })),
    })),
  };
}

// ---------- Raster-Auflösung ----------

/**
 * Qualität der Rasterhintergründe (§9): Ziel-Auflösung in dpi, `original` = nicht verkleinern, `email` = 100 dpi und
 * alle Rasterbilder als JPEG mit Qualität 60 (M8-Nacharbeit). Standard 200 dpi.
 */
export type ExportDpi = 'email' | 150 | 200 | 300 | 'original';
export const EXPORT_DPI: readonly ExportDpi[] = ['email', 150, 200, 300, 'original'];
export const DEFAULT_DPI: ExportDpi = 200;

export interface RasterQuality {
  /** dpi oder `original` (nicht verkleinern). */
  dpi: number | 'original';
  /** JPEG-Qualität nach libjpeg-Skala (0–100); der Export rechnet sie je Browser um. */
  jpeg: number;
  /** Auch PNG und gerasterte SVG als JPEG. */
  allJpeg: boolean;
}

export function rasterQuality(q: ExportDpi | number): RasterQuality {
  if (q === 'email') return { dpi: 100, jpeg: 60, allJpeg: true };
  return { dpi: q, jpeg: 85, allJpeg: false };
}

// ---------- Dateiname ----------

const ISO_DATE = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * „Schelmenmarkt 2027 – Sanität – 2026-10-12.pdf“; bei genau einer Page mit Festplatz. Im Dateinamen unzulässige
 * Zeichen (auch „/“ aus „Sanität/Ordnungsamt“) werden durch „-“ ersetzt.
 */
export function exportFileName(projectName: string, profileName: string, date: Date, pageName?: string): string {
  const parts = [projectName.trim() || 'Projekt', ...(pageName ? [pageName.trim() || 'Festplatz'] : []), profileName.trim() || 'Export', ISO_DATE(date)];
  const name = parts
    .join(' – ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[^\P{Cc}]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name}.pdf`;
}
