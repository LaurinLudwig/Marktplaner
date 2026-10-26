import { PROJECT_EXTENSIONS, PROJECT_FILE_TYPE, projectFileName } from '../core/fileFormat';
import { APP_KEY_PREFIX } from './legacyKeys';
import type { AutosaveSlot, Platform } from './types';

/**
 * Browser-Ersatz: Öffnen per Datei-Upload, Speichern per Download, Autosave in localStorage.
 * Im Browser gibt es keine Dateipfade; jedes Projekt gilt für die Sicherung als „unbenannt“.
 */
const LS_KEY = `${APP_KEY_PREFIX}autosave`;
const LS_MAX_BYTES = 1_000_000;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- IndexedDB-Ablage für große Sicherungen ----------
// Name der Datenbank bleibt aus der Zeit vor der Umbenennung (#10): IndexedDB lässt sich nicht umbenennen, und die
// Sicherungen sollen erhalten bleiben. Nur im Browser-Modus sichtbar (Entwicklertools).
const IDB_NAME = 'schelmeplaner';
const IDB_STORE = 'autosave';
const idbKey = (slot: AutosaveSlot) => slot;
const lsKey = (slot: AutosaveSlot) => (slot === 'kept' ? `${LS_KEY}.behalten` : LS_KEY);

function idb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1);
    open.addEventListener('upgradeneeded', () => open.result.createObjectStore(IDB_STORE));
    open.addEventListener('error', () => reject(open.error));
    open.addEventListener('success', () => {
      const db = open.result;
      const req = fn(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      req.addEventListener('success', () => {
        resolve(req.result);
        db.close();
      });
      req.addEventListener('error', () => {
        reject(req.error);
        db.close();
      });
    });
  });
}
const idbPut = (slot: AutosaveSlot, v: { time: number; bytes: Uint8Array }) => idb('readwrite', (s) => s.put(v, idbKey(slot))).then(() => undefined);
const idbGet = (slot: AutosaveSlot) =>
  idb<{ time: number; bytes: Uint8Array } | undefined>('readonly', (s) => s.get(idbKey(slot))).then((v) => v ?? null);
const idbDelete = (slot: AutosaveSlot) => idb('readwrite', (s) => s.delete(idbKey(slot))).then(() => undefined);

export const browserPlatform: Platform = {
  kind: 'browser',

  pickProjectFile() {
    return this.pickFile({ name: PROJECT_FILE_TYPE, extensions: PROJECT_EXTENSIONS });
  },

  pickFile(filter) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = filter.extensions.map((e) => `.${e}`).join(',');
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        resolve(f ? { bytes: new Uint8Array(await f.arrayBuffer()), path: null, name: f.name } : null);
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },

  async writeProjectFile(bytes, _path, suggestedName) {
    const name = projectFileName(suggestedName);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { path: null, name };
  },

  async saveFile(bytes, suggestedName, _filter, mime) {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { path: null, name: suggestedName };
  },

  async writeAutosave(_projectPath, bytes, slot = 'current') {
    const time = Date.now();
    try {
      // Große Sicherungen (eingebettete Pläne) direkt nach IndexedDB: Base64 für localStorage kostet
      // bei 20 MB eine halbe Sekunde im Hauptthread (QA-M4-03)
      if (bytes.length > LS_MAX_BYTES) throw new Error('zu groß für localStorage');
      localStorage.setItem(lsKey(slot), JSON.stringify({ time, data: toBase64(bytes) }));
      // Ältere große Sicherung im Hintergrund entfernen; der Ablauf wartet nicht darauf
      void idbDelete(slot).catch(() => undefined);
    } catch {
      // localStorage fasst nur wenige MB; mit eingebetteten Plänen weicht die Sicherung auf IndexedDB aus.
      localStorage.removeItem(lsKey(slot));
      await idbPut(slot, { time, bytes });
    }
  },

  async readAutosave(projectPath, slot = 'current') {
    if (projectPath) return null;
    let fromLs: { time: number; bytes: Uint8Array } | null = null;
    try {
      const raw = localStorage.getItem(lsKey(slot));
      if (raw) {
        const { time, data } = JSON.parse(raw) as { time: number; data: string };
        fromLs = { time, bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) };
      }
    } catch {
      fromLs = null;
    }
    const fromIdb = await idbGet(slot).catch(() => null);
    const newest = !fromIdb || (fromLs && fromLs.time >= fromIdb.time) ? fromLs : fromIdb;
    return newest ? { bytes: newest.bytes, time: new Date(newest.time) } : null;
  },

  async removeAutosave(projectPath, slot = 'current') {
    if (projectPath) return;
    try {
      localStorage.removeItem(lsKey(slot));
    } catch {
      /* Eine übrig gebliebene Sicherung ist harmlos */
    }
    // Im Hintergrund, damit z. B. „Neues Projekt“ nicht auf IndexedDB warten muss
    void idbDelete(slot).catch(() => undefined);
  },

  async readAppSetting(key) {
    try {
      return localStorage.getItem(APP_KEY_PREFIX + key);
    } catch {
      return null;
    }
  },

  async writeAppSetting(key, json) {
    localStorage.setItem(APP_KEY_PREFIX + key, json);
  },

  async takeOpenedFiles() {
    return [];
  },

  onFilesOpened() {
    return () => undefined;
  },

  async fileExists() {
    return false;
  },

  async readProjectFile() {
    throw new Error('Im Browser gibt es keine Dateipfade');
  },

  setWindowTitle(title) {
    document.title = title;
  },

  guardClose(isDirty) {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  },
};
