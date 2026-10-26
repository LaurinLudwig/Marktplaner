/**
 * Schnittstelle zum Betriebssystem. Die App spricht nur über `platform` (siehe index.ts) mit
 * Dateien und Fenster. Es gibt zwei Implementierungen:
 * - tauri.ts:   Desktop-App mit nativen Dateidialogen und Dateisystem
 * - browser.ts: normaler Browser (`npm run dev`, E2E-Tests) mit Upload, Download und localStorage
 */

export interface PickedFile {
  bytes: Uint8Array;
  /** Vollständiger Pfad; im Browser null, weil Webseiten keine Pfade kennen. */
  path: string | null;
  name: string;
}

export interface FileFilter {
  name: string;
  /** Endungen ohne Punkt, z. B. ['pdf', 'png']. */
  extensions: string[];
}

export interface SavedFile {
  path: string | null;
  name: string;
}

export type AutosaveSlot = 'current' | 'kept';

export interface AutosaveInfo {
  bytes: Uint8Array;
  time: Date | null;
}

export interface Platform {
  kind: 'tauri' | 'browser';

  /** Projektdatei auswählen und lesen. null = abgebrochen. */
  pickProjectFile(): Promise<PickedFile | null>;
  /** Beliebige Datei mit den gegebenen Endungen auswählen und lesen (z. B. Hintergrundplan). */
  pickFile(filter: FileFilter): Promise<PickedFile | null>;
  /**
   * Projektdatei schreiben. Ohne `path` wird nach dem Ziel gefragt (Desktop) bzw. die Datei
   * heruntergeladen (Browser). null = abgebrochen.
   */
  writeProjectFile(bytes: Uint8Array, path: string | null, suggestedName: string): Promise<SavedFile | null>;
  /**
   * Exportdatei schreiben (z. B. CSV, M6-06): fragt nach dem Ziel (Desktop) bzw. lädt herunter (Browser).
   * `suggestedName` mit Endung. `projectPath`: der Dialog startet im Ordner dieser Projektdatei (#4; Browser: ohne
   * Wirkung). null = abgebrochen.
   */
  saveFile(bytes: Uint8Array, suggestedName: string, filter: FileFilter, mime: string, projectPath?: string | null): Promise<SavedFile | null>;

  /**
   * Sicherung schreiben; `projectPath` null = unbenanntes Projekt. `slot` „current“ ist die
   * laufende Sicherung, „kept“ eine im Wiederherstellen-Dialog behaltene (QA-M1-08), die die
   * laufende Sitzung nie überschreibt.
   */
  writeAutosave(projectPath: string | null, bytes: Uint8Array, slot?: AutosaveSlot): Promise<void>;
  /** Sicherung lesen, bei benannten Projekten nur, wenn sie neuer ist als die Datei. */
  readAutosave(projectPath: string | null, slot?: AutosaveSlot): Promise<AutosaveInfo | null>;
  removeAutosave(projectPath: string | null, slot?: AutosaveSlot): Promise<void>;

  /**
   * Einstellungen dieses Rechners, die nicht ins Projekt gehören (M8: Export-Profile, Raster-Auflösung). Ein Eintrag
   * je Schlüssel als JSON-Text; null = noch nie gespeichert. Desktop: Datei im App-Datenordner, Browser: localStorage.
   */
  readAppSetting(key: string): Promise<string | null>;

  /**
   * Projektdateien, die das Betriebssystem übergeben hat (Doppelklick, „Öffnen mit“; E-02). Liefert jede Datei nur
   * einmal. Browser: immer leer.
   */
  takeOpenedFiles(): Promise<string[]>;
  /** Meldet, dass bei laufender App weitere Dateien übergeben wurden (dann `takeOpenedFiles`). Liefert Abmelden. */
  onFilesOpened(cb: () => void): () => void;
  /** Gibt es die Datei noch? (Zuletzt geöffnet, #11; Browser: immer false) */
  fileExists(path: string): Promise<boolean>;
  /** Projektdatei an einem bekannten Pfad lesen (Desktop). */
  readProjectFile(path: string): Promise<PickedFile>;
  writeAppSetting(key: string, json: string): Promise<void>;

  setWindowTitle(title: string): void;
  /**
   * Schützt vor versehentlichem Schließen. `isDirty` wird beim Schließen abgefragt;
   * `confirmClose` darf nachfragen (nur Desktop – Browser zeigen dafür nur ihren eigenen Hinweis).
   * Liefert eine Funktion zum Abmelden.
   */
  guardClose(isDirty: () => boolean, confirmClose: () => Promise<boolean>): () => void;
}
