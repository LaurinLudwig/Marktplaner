import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs';
import { exportDefaultPath, FILE_EXTENSION, PROJECT_EXTENSIONS, PROJECT_FILE_TYPE, projectFileName } from '../core/fileFormat';
import type { AutosaveSlot, Platform } from './types';

const OPEN_FILTER = { name: PROJECT_FILE_TYPE, extensions: PROJECT_EXTENSIONS };
const SAVE_FILTERS = [{ name: PROJECT_FILE_TYPE, extensions: [FILE_EXTENSION] }];
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Sicherung neben der Projektdatei, bei unbenannten Projekten im App-Datenverzeichnis. */
async function autosavePath(projectPath: string | null, slot: AutosaveSlot = 'current'): Promise<string> {
  const suffix = slot === 'kept' ? '.behalten.autosave' : '.autosave';
  if (projectPath) return `${projectPath}${suffix}`;
  const dir = await appLocalDataDir();
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, `unbenannt.${FILE_EXTENSION}${suffix}`);
}

/** Einstellungen dieses Rechners (M8): eine JSON-Datei je Schlüssel im App-Datenordner. */
async function settingPath(key: string): Promise<string> {
  const dir = await appLocalDataDir();
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, `${key.replace(/[^a-z0-9-]/gi, '_')}.json`);
}

export const tauriPlatform: Platform = {
  kind: 'tauri',

  async pickProjectFile() {
    return this.pickFile(OPEN_FILTER);
  },

  async pickFile(filter) {
    const path = await openDialog({ multiple: false, directory: false, filters: [filter] });
    if (typeof path !== 'string') return null;
    return { bytes: await readFile(path), path, name: baseName(path) };
  },

  async writeProjectFile(bytes, path, suggestedName) {
    const target = path ?? (await saveDialog({ defaultPath: projectFileName(suggestedName), filters: SAVE_FILTERS }));
    if (!target) return null;
    await writeFile(target, bytes);
    return { path: target, name: baseName(target) };
  },

  async saveFile(bytes, suggestedName, filter, _mime, projectPath) {
    const target = await saveDialog({ defaultPath: exportDefaultPath(projectPath, suggestedName), filters: [filter] });
    if (!target) return null;
    await writeFile(target, bytes);
    return { path: target, name: baseName(target) };
  },

  async writeAutosave(projectPath, bytes, slot) {
    await writeFile(await autosavePath(projectPath, slot), bytes);
  },

  async readAutosave(projectPath, slot) {
    const p = await autosavePath(projectPath, slot);
    if (!(await exists(p))) return null;
    const info = await stat(p);
    if (projectPath) {
      const main = await stat(projectPath);
      if (main.mtime && info.mtime && info.mtime <= main.mtime) return null;
    }
    return { bytes: await readFile(p), time: info.mtime };
  },

  async removeAutosave(projectPath, slot) {
    try {
      const p = await autosavePath(projectPath, slot);
      if (await exists(p)) await remove(p);
    } catch {
      /* Eine übrig gebliebene Sicherung ist harmlos */
    }
  },

  async readAppSetting(key) {
    const p = await settingPath(key);
    if (!(await exists(p))) return null;
    return new TextDecoder().decode(await readFile(p));
  },

  async writeAppSetting(key, json) {
    await writeFile(await settingPath(key), new TextEncoder().encode(json));
  },

  takeOpenedFiles() {
    return invoke<string[]>('take_opened_files');
  },

  onFilesOpened(cb) {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen('files-opened', () => cb()).then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  async fileExists(path) {
    return exists(path);
  },

  async readProjectFile(path) {
    return { bytes: await readFile(path), path, name: baseName(path) };
  },

  setWindowTitle(title) {
    document.title = title;
    void getCurrentWindow().setTitle(title);
  },

  guardClose(isDirty, confirmClose) {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    const win = getCurrentWindow();
    void win
      .onCloseRequested(async (event) => {
        if (!isDirty()) return;
        event.preventDefault();
        if (await confirmClose()) await win.destroy();
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  },
};
