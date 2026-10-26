import { create } from 'zustand';

/** Kurze Hinweise unten auf der Zeichenfläche (z. B. „Kalibriert …“, „Plan wird geladen …“). */
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error' | 'busy';
}

export const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));
let nextId = 1;

export function dismiss(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Zeigt einen Hinweis; `busy`-Hinweise bleiben, bis die Rückgabefunktion aufgerufen wird. */
export function notify(text: string, kind: Toast['kind'] = 'info', ms = 4000): () => void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  if (kind !== 'busy') setTimeout(() => dismiss(id), ms);
  return () => dismiss(id);
}
