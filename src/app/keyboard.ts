import { SHORTCUTS } from '../ui/shortcuts/definitions';
import { IS_MAC, matches, parseCombo } from '../ui/shortcuts/keys';
import { useCategoryListDialog, useCategoryListManager } from './categoryLists';
import { useDialogs } from './dialogs';
import { usePagePicker } from './pagePicker';
import { useRenumber } from './renumber';
import { COMMANDS, runCommand } from './commands';
import { useStore } from '../state/store';

/** Befehle, die auch in Textfeldern greifen (alle Cmd/Strg ohne Alt, siehe spec.md Tastaturkürzel). */
export const FILE_COMMANDS_IN_TEXT = new Set(['file.save', 'file.saveAs', 'file.open', 'file.new']);

const compiled = SHORTCUTS.flatMap((def) => def.keys.map((k) => ({ id: def.id, combo: parseCombo(k) })));

/** Häkchen und Optionsfelder sind keine Textfelder: Cmd/Strg+Z usw. wirken dort global (M4: „ignorieren“ mit Undo). */
const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t instanceof HTMLInputElement && t.type !== 'checkbox' && t.type !== 'radio'));

/** Liefert true, wenn die Taste verarbeitet wurde (z. B. Esc bricht eine Geste ab). */
export type InteractionKeyHandler = (e: KeyboardEvent) => boolean;

let interaction: InteractionKeyHandler | null = null;

/**
 * Meldet die laufende Interaktion an (das Werkzeug der Zeichenfläche: Ziehen, Aufziehen, Messen,
 * Kalibrieren). Sie bekommt jede Taste VOR den globalen Kurzbefehlen, unabhängig davon, wann sie
 * angemeldet wurde (QA-M3-01). Rückgabe: Abmelden.
 */
export function setInteractionKeyHandler(handler: InteractionKeyHandler): () => void {
  interaction = handler;
  return () => {
    if (interaction === handler) interaction = null;
  };
}

/**
 * Der einzige globale Tastatur-Handler. Reihenfolge, fest im Code statt über die Anmeldung von
 * Listenern: 1. offene Dialoge behandeln ihre Tasten selbst; 2. die laufende Interaktion;
 * 3. die Kurzbefehle aus der zentralen Konfiguration (in Textfeldern nur Speichern, Speichern unter, Öffnen, Neu).
 */
export function handleKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  if (useDialogs.getState().queue.length || usePagePicker.getState().request || useRenumber.getState().plans || useCategoryListDialog.getState().request || useCategoryListManager.getState().open) return;
  // Startbildschirm (#11): nur Neu und Öffnen; Pfeile, Enter und Esc behandelt er selbst
  const startScreen = useStore.getState().ui.startScreen;
  const inText = isTextField(e.target);
  if (!inText && interaction?.(e)) {
    e.preventDefault();
    return;
  }
  for (const { id, combo } of compiled) {
    const cmd = COMMANDS[id];
    if (!cmd || !matches(combo, e, IS_MAC)) continue;
    // In Textfeldern (spec.md Tastaturkürzel, QA-M5-03) greifen nur die Datei-Befehle (Cmd/Strg ohne Alt).
    // Vorher verlässt der Fokus das Feld, damit es seinen Wert übernimmt und die letzte Eingabe mitgespeichert
    // wird. Alle anderen Kurzbefehle sind gesperrt, vor allem alle mit Alt: Unter Windows ist AltGr = Strg+Alt,
    // ein Tippfehler im Feld darf z. B. keinen Festplatz duplizieren. Undo, Kopieren usw. gehören dem Feld.
    // Gesperrte Kombinationen mit Strg/Cmd ohne Alt werden trotzdem abgefangen, damit der Browser im Dev-Modus
    // keine eigene Aktion ausführt; AltGr-Zeichen bleiben unberührt.
    if (startScreen) {
      if (id === 'file.new' || id === 'file.open') {
        e.preventDefault();
        runCommand(id, e);
      }
      return;
    }
    if (inText) {
      if (FILE_COMMANDS_IN_TEXT.has(id)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
        runCommand(id, e);
      } else if ((combo.mod || combo.ctrl) && !combo.alt && !id.startsWith('edit.')) e.preventDefault();
      return;
    }
    const ran = runCommand(id, e);
    // Kombinationen mit Strg/Cmd immer abfangen (sonst z. B. Lesezeichen im Browser); einfache Tasten
    // wie Esc, Pfeile oder Entf nur, wenn der Befehl wirklich lief.
    if (ran || combo.mod || combo.ctrl) e.preventDefault();
    return;
  }
}

export function startKeyboard(): () => void {
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}
