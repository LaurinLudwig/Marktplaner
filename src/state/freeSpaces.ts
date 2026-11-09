import type { FreeSpace } from '../core/freeSpace';
import { hiddenEntry } from '../core/hiddenFree';
import type { FestplatzPage, Id, Project } from '../core/model/types';
import { ownerPages } from '../core/verbundView';
import { useStore } from './store';

/**
 * Page, in der die Ausblendung einer Freifläche steht: die Page selbst; in der Gesamtansicht eines Verbunds (#15) die
 * Besitzer-Page ihrer Grundfläche (Schlüssel „areaId|…“).
 */
const pageFor = (p: Project, pageId: Id, key: string): FestplatzPage | undefined => {
  const pages = ownerPages(p, pageId);
  if (pages.length === 1) return pages[0];
  const areaId = key.slice(0, key.indexOf('|'));
  return pages.find((pg) => pg.areas.some((a) => a.id === areaId) || pg.hiddenFree.some((h) => h.key === key));
};

/** Freifläche „nicht mehr anzeigen“ (#8): ein Undo-Schritt. */
export function hideFreeSpace(pageId: Id, fs: Pick<FreeSpace, 'key' | 'start' | 'end'>) {
  useStore.getState().change('Freifläche ausblenden', (p) => {
    const page = pageFor(p, pageId, fs.key);
    if (!page) return;
    page.hiddenFree = [...page.hiddenFree.filter((h) => h.key !== fs.key), hiddenEntry(fs)];
  });
}

/** Ausgeblendete Freifläche wieder anzeigen (#8): ein Undo-Schritt. */
export function showFreeSpace(pageId: Id, key: string) {
  useStore.getState().change('Freifläche wieder anzeigen', (p) => {
    const page = pageFor(p, pageId, key);
    if (page) page.hiddenFree = page.hiddenFree.filter((h) => h.key !== key);
  });
}
