import { strFromU8, strToU8, unzipSync, zip, zipSync, type Zippable } from 'fflate';
import { parseProjectFile, ProjectFileError, toProjectFile } from './model/schema';
import type { Project } from './model/types';

/**
 * Dateiformat `.mplan` (bis M9 `.schelme`): ZIP-Container mit
 *   project.json        – Projektdaten (siehe model/types.ts)
 *   assets/<name>       – eingebettete Originaldateien (Hintergrundpläne)
 */
export const FILE_EXTENSION = 'mplan';
/** Endungen, die sich öffnen lassen: aktuelle und die alte `.schelme` (vor der Umbenennung in Marktplaner, #10). */
export const PROJECT_EXTENSIONS = [FILE_EXTENSION, 'schelme'];
export const PROJECT_FILE_TYPE = 'Marktplaner-Projekt';

/**
 * Vorschlag für einen Export-Dialog (#4): `name` im Ordner der Projektdatei `projectPath`. Ohne gespeichertes Projekt
 * nur der Name (das Betriebssystem öffnet dann den zuletzt benutzten Ordner). Trennzeichen wie im Pfad (/ oder \).
 */
export function exportDefaultPath(projectPath: string | null | undefined, name: string): string {
  if (!projectPath) return name;
  const cut = Math.max(projectPath.lastIndexOf('/'), projectPath.lastIndexOf('\\'));
  return cut < 0 ? name : projectPath.slice(0, cut + 1) + name;
}

/** Dateiname für einen Speichern-Dialog: alte oder fehlende Endung wird durch `.mplan` ersetzt. */
export function projectFileName(name: string): string {
  const base = name.replace(new RegExp(`\\.(${PROJECT_EXTENSIONS.join('|')})$`, 'i'), '');
  return `${base}.${FILE_EXTENSION}`;
}
const PROJECT_ENTRY = 'project.json';
const ASSET_PREFIX = 'assets/';

export type Assets = Record<string, Uint8Array>;

export interface ProjectBundle {
  project: Project;
  assets: Assets;
}

function zipEntries({ project, assets }: ProjectBundle): Zippable {
  const entries: Zippable = {
    [PROJECT_ENTRY]: [strToU8(JSON.stringify(toProjectFile(project), null, 2)), { level: 6 }],
  };
  // PDF/JPEG/PNG sind bereits komprimiert; erneutes Packen kostet nur Zeit. SVG ist Text und schrumpft stark.
  for (const [name, data] of Object.entries(assets)) entries[ASSET_PREFIX + name] = [data, { level: name.endsWith('.svg') ? 6 : 0 }];
  return entries;
}

export function encodeProjectFile(bundle: ProjectBundle): Uint8Array {
  return zipSync(zipEntries(bundle));
}

/**
 * Wie `encodeProjectFile`, aber ohne den Hauptthread zu blockieren (fflate packt in Web Workern, wo es
 * sie gibt). Für den Autosave: Mit großen Plänen dauert das Packen sonst ein spürbares Bild (QA-M4-03).
 */
export function encodeProjectFileAsync(bundle: ProjectBundle): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(zipEntries(bundle), (err, data) => (err ? reject(err) : resolve(data)));
  });
}

export function decodeProjectFile(bytes: Uint8Array): ProjectBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ProjectFileError('Die Datei ist beschädigt oder kein Marktplaner-Projekt.');
  }
  const json = files[PROJECT_ENTRY];
  if (!json) throw new ProjectFileError('In der Datei fehlt project.json.');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw new ProjectFileError('project.json ist kein gültiges JSON.');
  }
  const project = parseProjectFile(raw);
  const assets: Assets = {};
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith(ASSET_PREFIX) && path.length > ASSET_PREFIX.length) assets[path.slice(ASSET_PREFIX.length)] = data;
  }
  return { project, assets };
}
