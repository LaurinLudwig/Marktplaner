import type { Id } from '../core/model/types';
import { EMPTY_STAND_FILTER } from '../core/standTable';
import { useStartPage, type StartTab } from '../state/startPage';
import { START_PAGE, useStore } from '../state/store';

/** Öffnet die Start-Page mit dem Unter-Tab `tab` (M6). */
export function openStartTab(tab: StartTab) {
  useStore.getState().setUi({ activePage: START_PAGE });
  useStartPage.getState().setTab(tab);
}

/** Link „Projekteinstellungen“ aus der Seitenleiste (M6-07). */
export const openProjectSettings = () => openStartTab('settings');

/** Klick auf die Infrastruktur-Warnzahl einer Kennzahl-Karte (M7-09): Infrastrukturliste „mit Warnung“. */
export function showInfraWarnings(pageId: Id | null) {
  useStartPage.getState().setInfraFilter({ pageId, typeId: null, withWarning: true, search: '' });
  openStartTab('infra');
}

/** Klick auf die Warnzahl einer Kennzahl-Karte: Geschäftstabelle mit „mit Warnung“, ggf. nur dieser Festplatz. */
export function showWarnings(pageId: Id | null) {
  const sp = useStartPage.getState();
  sp.setStandFilter({ ...sp.standFilter, pages: pageId ? [pageId] : null, withWarning: true });
  openStartTab('stands');
}

/** Klick auf eine Kategorie einer Kennzahl-Karte (#7): Geschäftstabelle nur mit dieser Kategorie (null = ohne). */
export function showCategory(pageId: Id | null, categoryId: Id | null) {
  useStartPage.getState().setStandFilter({ ...EMPTY_STAND_FILTER, pages: pageId ? [pageId] : null, categories: [categoryId] });
  openStartTab('stands');
}
