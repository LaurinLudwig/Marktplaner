import type { FreeSpace } from '../core/freeSpace';
import { hiddenEntry } from '../core/hiddenFree';
import type { Id } from '../core/model/types';
import { useStore } from './store';

/** Freifläche „nicht mehr anzeigen“ (#8): ein Undo-Schritt. */
export function hideFreeSpace(pageId: Id, fs: Pick<FreeSpace, 'key' | 'start' | 'end'>) {
  useStore.getState().change('Freifläche ausblenden', (p) => {
    const page = p.pages.find((x) => x.id === pageId);
    if (!page) return;
    page.hiddenFree = [...page.hiddenFree.filter((h) => h.key !== fs.key), hiddenEntry(fs)];
  });
}

/** Ausgeblendete Freifläche wieder anzeigen (#8): ein Undo-Schritt. */
export function showFreeSpace(pageId: Id, key: string) {
  useStore.getState().change('Freifläche wieder anzeigen', (p) => {
    const page = p.pages.find((x) => x.id === pageId);
    if (page) page.hiddenFree = page.hiddenFree.filter((h) => h.key !== key);
  });
}
