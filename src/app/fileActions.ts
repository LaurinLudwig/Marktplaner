import { referencedAssets } from '../core/assets';
import { UserError, userMessage } from '../core/errors';
import { decodeProjectFile, encodeProjectFile, encodeProjectFileAsync } from '../core/fileFormat';
import { createProject } from '../core/model/defaults';
import { platform, type PickedFile } from '../platform';
import { notify } from './notify';
import { checkRecent, forgetRecent, rememberRecent } from '../state/recent';
import { projectForSave, selectDirty, useStore } from '../state/store';
import { ask, showError } from './dialogs';

/** Deutsche Meldung; technische Details nur in der Konsole (QA-M2-02). */
const errorText = (e: unknown, fallback: string) => {
  if (!(e instanceof UserError)) console.warn(e);
  return userMessage(e, fallback);
};
const dateText = (d: Date | null) =>
  d ? d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'unbekannt';

/** Projektdatei mit allen verwendeten Hintergründen (ungenutzte bleiben nur im Speicher, für Undo). */
export function currentBytes(): Uint8Array {
  const s = useStore.getState();
  const project = projectForSave(s);
  return encodeProjectFile({ project, assets: referencedAssets(project, s.assets) });
}

/** Wie `currentBytes`, ohne den Hauptthread zu blockieren (Autosave). */
export function currentBytesAsync(): Promise<Uint8Array> {
  const s = useStore.getState();
  const project = projectForSave(s);
  return encodeProjectFileAsync({ project, assets: referencedAssets(project, s.assets) });
}

/**
 * Fragt bei ungespeicherten Änderungen nach. Liefert true, wenn fortgefahren werden darf
 * (gespeichert oder bewusst verworfen).
 */
export async function confirmDiscard(): Promise<boolean> {
  if (!selectDirty(useStore.getState())) return true;
  const r = await ask({
    title: 'Ungespeicherte Änderungen',
    message: `Änderungen an „${useStore.getState().project.name}“ speichern?`,
    buttons: [
      { id: 'discard', label: 'Nicht speichern', variant: 'danger' },
      { id: 'cancel', label: 'Abbrechen' },
      { id: 'save', label: 'Speichern', variant: 'primary' },
    ],
    cancelId: 'cancel',
  });
  if (r === 'save') return saveProject(false);
  return r === 'discard';
}

export async function newProject() {
  if (!(await confirmDiscard())) return;
  await platform.removeAutosave(useStore.getState().filePath);
  useStore.getState().loadBundle({ project: createProject(), assets: {} }, { path: null, name: null });
  useStore.getState().setUi({ startScreen: false });
}

export async function openProject() {
  if (!(await confirmDiscard())) return;
  let picked;
  try {
    picked = await platform.pickProjectFile();
  } catch (e) {
    await showError('Öffnen fehlgeschlagen', errorText(e, 'Die Datei konnte nicht gelesen werden.'));
    return;
  }
  if (picked) await loadPicked(picked);
}

/**
 * Vom Betriebssystem übergebene Projektdateien öffnen (Doppelklick im Finder/Explorer; E-02, QA-M10-02). Ein Fenster
 * zeigt ein Projekt: geöffnet wird die erste Datei, wie mit Cmd/Strg+O inklusive Rückfrage bei Änderungen.
 */
export async function openProjectPaths(paths: readonly string[]) {
  const path = paths[0];
  if (!path || path === useStore.getState().filePath) return;
  if (paths.length > 1) notify('Es wird nur die erste Datei geöffnet; ein Fenster zeigt ein Projekt.');
  if (!(await confirmDiscard())) return;
  let picked;
  try {
    picked = await platform.readProjectFile(path);
  } catch (e) {
    await showError('Öffnen fehlgeschlagen', errorText(e, 'Die Datei konnte nicht gelesen werden.'));
    return;
  }
  await loadPicked(picked);
}

/**
 * Doppelklick-Dateien abholen, sobald `ready` erfüllt ist (Abfrage der Sicherung beim Start), und später übergebene
 * Dateien ebenso. Kam beim Start keine Datei und ist kein Projekt geladen, erscheint in der Desktop-App der
 * Startbildschirm (#11). Liefert Abmelden.
 */
export function startOpenedFiles(ready: Promise<unknown>): () => void {
  let first = true;
  const handle = () =>
    void ready
      .then(() => platform.takeOpenedFiles())
      .then(async (paths) => {
        const atStart = first;
        first = false;
        if (paths.length) return openProjectPaths(paths);
        const s = useStore.getState();
        if (atStart && platform.kind === 'tauri' && !s.filePath && !selectDirty(s)) {
          await checkRecent();
          useStore.getState().setUi({ startScreen: true });
        }
      })
      .catch((e: unknown) => console.warn(e));
  const stop = platform.onFilesOpened(handle);
  handle();
  return stop;
}

/** Eintrag aus „Zuletzt geöffnet“ öffnen (#11); fehlt die Datei, Meldung und Eintrag entfernen. */
export async function openRecent(path: string) {
  if (path === useStore.getState().filePath) {
    useStore.getState().setUi({ startScreen: false });
    return;
  }
  if (!(await platform.fileExists(path).catch(() => false))) {
    forgetRecent(path);
    await showError('Datei nicht gefunden', `„${path}“ gibt es nicht mehr (verschoben, umbenannt oder gelöscht). Der Eintrag wurde aus „Zuletzt geöffnet“ entfernt.`);
    return;
  }
  await openProjectPaths([path]);
}

async function loadPicked(picked: PickedFile) {
  try {
    const bundle = decodeProjectFile(picked.bytes);
    const previousPath = useStore.getState().filePath;
    useStore.getState().loadBundle(bundle, { path: picked.path, name: picked.name });
    useStore.getState().setUi({ startScreen: false });
    rememberRecent(picked.path, picked.name);
    if (previousPath !== picked.path) await platform.removeAutosave(previousPath);
    if (picked.path) await offerRecovery(picked.path);
  } catch (e) {
    await showError('Datei kann nicht geöffnet werden', errorText(e, 'Die Datei ist beschädigt oder kein Marktplaner-Projekt.'));
  }
}

/** Speichert; bei `saveAs` oder unbenanntem Projekt mit Dateidialog. Liefert true bei Erfolg. */
export async function saveProject(saveAs: boolean): Promise<boolean> {
  const s = useStore.getState();
  try {
    const result = await platform.writeProjectFile(currentBytes(), saveAs ? null : s.filePath, s.fileName ?? s.project.name);
    if (!result) return false;
    useStore.getState().markSaved(result.path, result.name);
    rememberRecent(result.path, result.name);
    await platform.removeAutosave(s.filePath);
    if (result.path !== s.filePath) await platform.removeAutosave(result.path);
    return true;
  } catch (e) {
    await showError('Speichern fehlgeschlagen', errorText(e, 'Die Datei konnte nicht geschrieben werden. Ist der Speicherort beschreibbar und nicht voll?'));
    return false;
  }
}

/**
 * Bietet vorhandene Sicherungen zur Wiederherstellung an: zuerst die laufende, dann eine früher
 * behaltene. `path` = geöffnete Projektdatei; null = unbenanntes Projekt (beim App-Start).
 *
 * Esc bzw. Klick neben den Dialog heißt „später entscheiden“: Die Sicherung wandert ins Fach
 * „behalten“, das die laufende Sitzung nicht überschreibt, und wird beim nächsten Mal wieder
 * angeboten (QA-M1-08). Gibt es dort schon eine ältere, wird sie durch die neuere ersetzt.
 */
export async function offerRecovery(path: string | null) {
  for (const slot of ['current', 'kept'] as const) {
    const info = await platform.readAutosave(path, slot).catch(() => null);
    if (!info) continue;
    const when = dateText(info.time);
    const r = await ask({
      title: 'Sicherung gefunden',
      message:
        slot === 'kept'
          ? `Es gibt eine früher behaltene Sicherung vom ${when}. Wiederherstellen?`
          : path
            ? `Für diese Datei gibt es eine neuere automatische Sicherung vom ${when}. Wiederherstellen?`
            : `Es gibt ein nicht gespeichertes Projekt vom ${when}. Wiederherstellen?`,
      buttons: [
        { id: 'discard', label: 'Verwerfen', variant: 'danger' },
        { id: 'restore', label: 'Wiederherstellen', variant: 'primary' },
      ],
      cancelId: 'keep',
    });
    if (r === 'restore') {
      try {
        const bundle = decodeProjectFile(info.bytes);
        const s = useStore.getState();
        useStore.getState().loadBundle(bundle, { path, name: path ? s.fileName : null, dirty: true });
        // Der Inhalt lebt jetzt in der Sitzung weiter und wird von dort neu gesichert
        if (slot === 'kept') await platform.removeAutosave(path, 'kept');
      } catch (e) {
        await showError('Sicherung ist beschädigt', errorText(e, 'Die Sicherung kann nicht geladen werden.'));
      }
      return;
    }
    if (r === 'discard') {
      await platform.removeAutosave(path, slot);
      continue;
    }
    // Später entscheiden: laufende Sicherung ins Fach „behalten“ verschieben, damit sie erhalten bleibt
    if (slot === 'current') {
      await platform.writeAutosave(path, info.bytes, 'kept');
      await platform.removeAutosave(path, 'current');
    }
    return;
  }
}
