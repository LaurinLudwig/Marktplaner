import { create } from 'zustand';

/** In-App-Dialoge (einheitlich in Browser und Desktop, Beschriftung auf Deutsch). */
export interface DialogButton {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'default';
}

export interface DialogRequest {
  title: string;
  message: string;
  buttons: DialogButton[];
  /** Ergebnis bei Esc bzw. Klick neben den Dialog. */
  cancelId: string;
  resolve: (id: string) => void;
}

interface DialogState {
  queue: DialogRequest[];
}

export const useDialogs = create<DialogState>()(() => ({ queue: [] }));

export function ask(opts: Omit<DialogRequest, 'resolve'>): Promise<string> {
  return new Promise((resolve) => {
    const req: DialogRequest = {
      ...opts,
      resolve: (id) => {
        useDialogs.setState((s) => ({ queue: s.queue.filter((q) => q !== req) }));
        resolve(id);
      },
    };
    useDialogs.setState((s) => ({ queue: [...s.queue, req] }));
  });
}

export const showError = (title: string, message: string) =>
  ask({ title, message, buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }], cancelId: 'ok' });

export async function confirm(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  const r = await ask({
    title,
    message,
    buttons: [
      { id: 'cancel', label: 'Abbrechen' },
      { id: 'ok', label: okLabel, variant: danger ? 'danger' : 'primary' },
    ],
    cancelId: 'cancel',
  });
  return r === 'ok';
}

/** Rückfrage bei unplausiblem Maßstab (QA-M2-07). true = übernehmen. Ohne Hinweise sofort true. */
export async function confirmScale(warnings: string[]): Promise<boolean> {
  if (!warnings.length) return true;
  const r = await ask({
    title: 'Maßstab prüfen',
    message: `${warnings.join(' ')} Ist das richtig?`,
    buttons: [
      { id: 'back', label: 'Zurück' },
      { id: 'ok', label: 'Trotzdem übernehmen', variant: 'primary' },
    ],
    cancelId: 'back',
  });
  return r === 'ok';
}
