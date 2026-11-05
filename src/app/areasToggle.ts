import { setUseAreas } from '../state/pageSettings';
import { useStore } from '../state/store';
import { ask } from './dialogs';

/**
 * Schalter „Grundflächen verwenden“ der Page (#17, spec.md §2). Einschalten sofort; beim Abschalten mit vorhandenen
 * Grundflächen fragt die App, ob sie ausgeblendet erhalten bleiben (wirken dann nicht) oder gelöscht werden.
 * Jede Variante ist ein Undo-Schritt.
 */
export async function changeUseAreas(pageId: string, on: boolean) {
  const page = useStore.getState().project.pages.find((p) => p.id === pageId);
  if (!page || page.useAreas === on) return;
  if (on || !page.areas.length) {
    setUseAreas(pageId, on);
    return;
  }
  const n = page.areas.length;
  const r = await ask({
    title: 'Ohne Grundflächen planen',
    message: `„${page.name}“ hat ${n === 1 ? 'eine Grundfläche' : `${n} Grundflächen`}. Behalten: Sie bleiben gespeichert, sind aber ausgeblendet und wirken nicht, bis „Grundflächen verwenden“ wieder an ist. Löschen: Sie werden entfernt. (Beides rückgängig mit Strg/Cmd+Z.)`,
    buttons: [
      { id: 'cancel', label: 'Abbrechen' },
      { id: 'delete', label: 'Grundflächen löschen', variant: 'danger' },
      { id: 'keep', label: 'Grundflächen behalten', variant: 'primary' },
    ],
    cancelId: 'cancel',
  });
  if (r === 'keep') setUseAreas(pageId, false);
  else if (r === 'delete') setUseAreas(pageId, false, true);
}
