import { fmt } from '../core/format';
import type { Id } from '../core/model/types';
import { nrLockTargets } from '../core/numbering';
import { setAllNrLocked } from '../state/numbering';
import { START_PAGE, useStore } from '../state/store';
import { notify, notifyUndoable } from './notify';

/**
 * „Alle Fixierungen lösen“ und „Alle Nummern fixieren“ (#14, spec.md §5): auf einer Festplatz-Page für deren
 * Nummernkreis (pro Festplatz = diese Page, global = alle Pages), auf der Start-Page für alle Pages. Ohne Nachfrage,
 * ein Undo-Schritt, danach ein Hinweis mit „Rückgängig“. Die Nummern selbst ändern sich nicht.
 */

/** Page, deren Nummernkreis gemeint ist; `null` = alle Pages (Start-Page). */
export function nrLockPage(): Id | null {
  const active = useStore.getState().ui.activePage;
  return active === START_PAGE ? null : active;
}

/** Zahl der Stände, die der Befehl ändern würde. */
export function nrLockCount(locked: boolean, pageId: Id | null = nrLockPage()): number {
  return nrLockTargets(useStore.getState().project, pageId, locked).length;
}

export function setAllNrLocks(locked: boolean, pageId: Id | null = nrLockPage()) {
  const n = setAllNrLocked(pageId, locked);
  if (!n) {
    notify(locked ? 'Keine Nummer zu fixieren: Alle Nummern sind schon fixiert, oder es gibt keine.' : 'Es gibt keine fixierten Nummern.');
    return;
  }
  notifyUndoable(locked ? `${fmt(n, 0)} ${n === 1 ? 'Nummer' : 'Nummern'} fixiert` : `${fmt(n, 0)} ${n === 1 ? 'Fixierung' : 'Fixierungen'} gelöst`);
}
