import { platform } from '../platform';
import { selectDirty, useStore } from '../state/store';
import { confirmDiscard } from './fileActions';

/** Fenstertitel mit Dateiname und Änderungsmarkierung. */
export function startWindowTitle(): () => void {
  let last = '';
  const update = () => {
    const s = useStore.getState();
    const title = `${s.fileName ?? s.project.name}${selectDirty(s) ? ' •' : ''} – Marktplaner`;
    if (title === last) return;
    last = title;
    platform.setWindowTitle(title);
  };
  update();
  return useStore.subscribe(update);
}

/** Schließen nur nach Rückfrage bei ungespeicherten Änderungen. */
export function guardClose(): () => void {
  return platform.guardClose(() => selectDirty(useStore.getState()), confirmDiscard);
}
