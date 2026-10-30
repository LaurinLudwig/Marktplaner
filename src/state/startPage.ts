import { create } from 'zustand';
import type { FreeSortColumn, FreeSpaceFilter } from '../core/freeSpaceList';
import { EMPTY_FREE_FILTER } from '../core/freeSpaceList';
import type { Id } from '../core/model/types';
import { DEFAULT_STAND_SORT, EMPTY_STAND_FILTER, type SortKey, type StandFilter } from '../core/standTable';
import { DEFAULT_INFRA_SORT, EMPTY_INFRA_FILTER, type InfraFilter, type InfraSortColumn } from '../core/infraTable';
import { APP_KEY_PREFIX } from '../platform/legacyKeys';
import { useStore } from './store';

/**
 * Zustand der Start-Page (M6): Unter-Tab, Suche, Filter, Sortierung, aktive Zelle. Gilt für die Sitzung, gehört
 * nicht zur Undo-Historie und nicht in die Projektdatei; bleibt beim Wechsel der Page erhalten (spec.md §7).
 * Die Spaltenauswahl gilt pro Rechner (localStorage).
 */

export type StartTab = 'stands' | 'free' | 'infra' | 'settings';

/** Spalten der Geschäftstabelle, die sich ausblenden lassen (Sprung und Name sind immer sichtbar). */
export type StandColumn = 'page' | 'nr' | 'name' | 'owner' | 'ware' | 'category' | 'w' | 'd' | 'power' | 'connection' | 'fee' | 'feeGross' | 'warnings' | 'note';
export const HIDEABLE_COLUMNS: readonly StandColumn[] = ['page', 'nr', 'owner', 'ware', 'category', 'w', 'd', 'power', 'connection', 'fee', 'feeGross', 'warnings', 'note'];
/** Standgeld-Spalten (#5): nur, wenn im Projekt ein Preis festgelegt ist. */
export const FEE_COLUMNS: readonly StandColumn[] = ['fee', 'feeGross'];
const DEFAULT_HIDDEN: StandColumn[] = ['note'];
const COLUMNS_KEY = `${APP_KEY_PREFIX}standColumns`;

function loadHidden(): StandColumn[] {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    if (!raw) return DEFAULT_HIDDEN;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((c): c is StandColumn => HIDEABLE_COLUMNS.includes(c as StandColumn)) : DEFAULT_HIDDEN;
  } catch {
    return DEFAULT_HIDDEN;
  }
}
function saveHidden(cols: StandColumn[]) {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(cols));
  } catch {
    /* Einstellung ist nur Komfort */
  }
}

export interface ActiveCell {
  standId: Id;
  col: StandColumn | 'jump';
}

interface StartPageState {
  tab: StartTab;
  standFilter: StandFilter;
  standSort: SortKey[];
  /**
   * Nach einer Zelländerung eingefrorene Reihenfolge (Stand-IDs), damit die bearbeitete Zeile nicht wegspringt;
   * null = es gilt die Sortierung. Ändern von Sortierung oder Filter hebt sie auf.
   */
  frozen: Id[] | null;
  hidden: StandColumn[];
  cell: ActiveCell | null;
  standScroll: number;
  freeFilter: FreeSpaceFilter;
  /** null = Standard (Breite; mit Passt-Filter aufsteigend). */
  freeSort: SortKey<FreeSortColumn>[] | null;
  freeActive: string | null;
  freeActivePage: Id | null;
  freeScroll: number;
  /** Zähler: Die Suche soll den Fokus bekommen (Cmd/Strg+F). */
  focusSearch: number;
  /** Infrastrukturliste (M7-09). */
  infraFilter: InfraFilter;
  infraSort: SortKey<InfraSortColumn>[];

  setTab: (tab: StartTab) => void;
  setStandFilter: (patch: Partial<StandFilter>) => void;
  setStandSort: (sort: SortKey[]) => void;
  freeze: (ids: Id[]) => void;
  unfreeze: () => void;
  setHidden: (col: StandColumn, hidden: boolean) => void;
  setCell: (cell: ActiveCell | null) => void;
  setFreeFilter: (patch: Partial<FreeSpaceFilter>) => void;
  setFreeSort: (sort: SortKey<FreeSortColumn>[] | null) => void;
  setInfraFilter: (patch: Partial<InfraFilter>) => void;
  setInfraSort: (sort: SortKey<InfraSortColumn>[]) => void;
  set: (patch: Partial<Pick<StartPageState, 'standScroll' | 'freeScroll' | 'freeActive' | 'freeActivePage' | 'focusSearch'>>) => void;
  reset: () => void;
}

const initial = () => ({
  tab: 'stands' as StartTab,
  standFilter: EMPTY_STAND_FILTER,
  standSort: DEFAULT_STAND_SORT,
  frozen: null,
  cell: null,
  standScroll: 0,
  freeFilter: EMPTY_FREE_FILTER,
  freeSort: null,
  freeActive: null,
  freeActivePage: null,
  freeScroll: 0,
  focusSearch: 0,
  infraFilter: EMPTY_INFRA_FILTER,
  infraSort: DEFAULT_INFRA_SORT,
});

export const useStartPage = create<StartPageState>()((set, get) => ({
  ...initial(),
  hidden: loadHidden(),
  setTab: (tab) => set({ tab }),
  setStandFilter: (patch) => set({ standFilter: { ...get().standFilter, ...patch }, frozen: null, standScroll: 0 }),
  setStandSort: (standSort) => set({ standSort, frozen: null }),
  freeze: (ids) => set({ frozen: get().frozen ?? ids }),
  unfreeze: () => set({ frozen: null }),
  setHidden: (col, hide) => {
    const hidden = hide ? [...new Set([...get().hidden, col])] : get().hidden.filter((c) => c !== col);
    saveHidden(hidden);
    set({ hidden });
  },
  setCell: (cell) => set({ cell }),
  setFreeFilter: (patch) => set({ freeFilter: { ...get().freeFilter, ...patch }, freeScroll: 0 }),
  setFreeSort: (freeSort) => set({ freeSort }),
  setInfraFilter: (patch) => set({ infraFilter: { ...get().infraFilter, ...patch } }),
  setInfraSort: (infraSort) => set({ infraSort }),
  set: (patch) => set(patch),
  reset: () => set(initial()),
}));

// Anderes Projekt geöffnet bzw. neu angelegt: Filter auf Pages und Kategorien des alten Projekts verwerfen
useStore.subscribe((s, prev) => {
  if (s.project.id !== prev.project.id) useStartPage.getState().reset();
});
