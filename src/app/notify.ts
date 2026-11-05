import { create } from 'zustand';
import { headId } from '../state/history';
import { useStore } from '../state/store';

/** Knopf in einem Hinweis (z. B. „Rückgängig“); ein Klick führt ihn aus und schließt den Hinweis. */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** Kurze Hinweise unten auf der Zeichenfläche (z. B. „Kalibriert …“, „Plan wird geladen …“). */
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error' | 'busy';
  action?: ToastAction;
}

export const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));
let nextId = 1;

export function dismiss(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Zeigt einen Hinweis; `busy`-Hinweise bleiben, bis die Rückgabefunktion aufgerufen wird. */
export function notify(text: string, kind: Toast['kind'] = 'info', ms = 4000, action?: ToastAction): () => void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, ...(action && { action }) }] }));
  if (kind !== 'busy') setTimeout(() => dismiss(id), ms);
  return () => dismiss(id);
}

/**
 * Hinweis nach einem Undo-Schritt mit Knopf „Rückgängig“ (#14). Der Knopf nimmt genau diesen Schritt zurück, solange
 * er der letzte ist; kam danach eine weitere Änderung, sagt er das, statt eine andere zurückzunehmen.
 */
export function notifyUndoable(text: string, ms = 8000): () => void {
  const step = headId(useStore.getState().history);
  return notify(text, 'success', ms, {
    label: 'Rückgängig',
    run: () => {
      const s = useStore.getState();
      if (!s.history.open && headId(s.history) === step) s.undo();
      else if (s.history.future.some((e) => e.id === step)) notify('Schon rückgängig gemacht.');
      else notify('Rückgängig hier nicht mehr möglich: Danach wurde weiter geändert. Strg/Cmd+Z nimmt Schritt für Schritt zurück.');
    },
  });
}
