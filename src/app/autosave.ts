import { platform } from '../platform';
import { headId } from '../state/history';
import { selectDirty, useStore } from '../state/store';
import { currentBytesAsync } from './fileActions';

export const AUTOSAVE_INTERVAL_MS = 30_000;
/** Während einer Geste und so lange nach dem letzten Zoomen/Verschieben wartet der Autosave. */
const QUIET_MS = 1500;
/** Danach erneut versuchen. */
const RETRY_MS = 2000;

/**
 * Schreibt alle 30 s eine Sicherung, wenn es ungespeicherte, noch nicht gesicherte Änderungen gibt.
 *
 * Wird das Projekt wieder „sauber“ (z. B. Undo bis zum gespeicherten Stand), entfernt es die
 * Sicherung, die diese Sitzung geschrieben hat, sofort. Sonst würde beim nächsten Start ein
 * bewusst verworfener Stand zur Wiederherstellung angeboten (QA-M1-03).
 *
 * Damit die Sicherung kein Bild verzögert (QA-M4-03: bis 650 ms mit großem Plan), wird sie nicht während
 * einer Geste oder direkt nach Zoomen/Verschieben geschrieben, und das ZIP entsteht asynchron.
 */
export function startAutosave(): () => void {
  let lastHead = -2;
  /** Pfad der Sicherung, die diese Sitzung geschrieben hat (null = unbenannt); undefined = keine. */
  let written: string | null | undefined;

  const discardOwnBackup = () => {
    if (written === undefined) return;
    const path = written;
    written = undefined;
    lastHead = -2;
    void platform.removeAutosave(path);
  };

  let lastActivity = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const busy = () => !!useStore.getState().preview || Date.now() - lastActivity < QUIET_MS;

  const save = async () => {
    retry = null;
    const s = useStore.getState();
    if (!selectDirty(s)) {
      discardOwnBackup();
      return;
    }
    const head = headId(s.history);
    if (head === lastHead || running) return;
    if (busy()) {
      retry ??= setTimeout(() => void save(), RETRY_MS);
      return;
    }
    running = true;
    try {
      const bytes = await currentBytesAsync();
      await platform.writeAutosave(s.filePath, bytes);
      lastHead = head;
      written = s.filePath;
    } catch (e) {
      console.warn('Autosave fehlgeschlagen', e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void save(), AUTOSAVE_INTERVAL_MS);

  // Sofort reagieren, wenn das Projekt sauber wird – nicht erst beim nächsten Intervall.
  // Nur für dieselbe Datei: Beim Öffnen einer anderen Datei kümmert sich fileActions um die Sicherungen.
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (selectDirty(prev) && !selectDirty(s) && s.filePath === written) discardOwnBackup();
    if (s.views !== prev.views || s.preview !== prev.preview) lastActivity = Date.now();
  });

  return () => {
    clearInterval(timer);
    if (retry) clearTimeout(retry);
    unsubscribe();
  };
}
