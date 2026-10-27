import { create } from 'zustand';
import { BUILTIN_CATEGORY_LISTS, listFromCategories, loadOwnLists, uniqueListName, type CategoryList } from '../core/categoryLists';
import { userMessage } from '../core/errors';
import { platform } from '../platform';

/**
 * Eigene Kategorielisten dieses Rechners (#2). Nicht im Projekt: kein Undo-Schritt, keine Änderungsmarkierung.
 * Gespeichert über `platform.writeAppSetting` (Desktop: Datei im App-Datenordner, Browser: localStorage).
 */
const LISTS_KEY = 'kategorie-listen';

interface CategoryListsState {
  loaded: boolean;
  lists: CategoryList[];
  /** Meldung beim Laden oder Speichern. */
  error: string | null;
}

export const useCategoryLists = create<CategoryListsState>()(() => ({ loaded: false, lists: [], error: null }));

let loading: Promise<void> | null = null;

/** Einmal beim Start; weitere Aufrufe warten auf dasselbe Ergebnis. */
export function loadCategoryLists(): Promise<void> {
  loading ??= (async () => {
    try {
      const json = await platform.readAppSetting(LISTS_KEY);
      let raw: unknown;
      try {
        raw = json === null ? undefined : JSON.parse(json);
      } catch {
        raw = 'kaputt';
      }
      const { lists, error } = loadOwnLists(raw);
      useCategoryLists.setState({ loaded: true, lists, error: error ?? null });
    } catch (e) {
      useCategoryLists.setState({ loaded: true, error: userMessage(e, 'Die eigenen Kategorielisten konnten nicht gelesen werden.') });
    }
  })();
  return loading;
}

async function persist() {
  try {
    await platform.writeAppSetting(LISTS_KEY, JSON.stringify(useCategoryLists.getState().lists));
  } catch (e) {
    useCategoryLists.setState({ error: userMessage(e, 'Die eigenen Kategorielisten konnten nicht gespeichert werden.') });
  }
}

/** Neue eigene Liste anlegen (aus dem Projekt oder importiert); vergebene Namen (auch mitgelieferte) bekommen eine Nummer. */
export function addOwnList(list: CategoryList): CategoryList {
  const lists = useCategoryLists.getState().lists;
  const added = { ...list, builtin: false, name: uniqueListName(list.name, [...BUILTIN_CATEGORY_LISTS, ...lists]) };
  useCategoryLists.setState({ lists: [...lists, added] });
  void persist();
  return added;
}

export const saveCategoriesAsList = (name: string, categories: Parameters<typeof listFromCategories>[1]) => addOwnList(listFromCategories(name, categories));

export function renameOwnList(id: string, name: string) {
  const lists = useCategoryLists.getState().lists;
  const list = lists.find((l) => l.id === id);
  if (!list || !name.trim() || name.trim() === list.name) return;
  const others = [...BUILTIN_CATEGORY_LISTS, ...lists.filter((l) => l.id !== id)];
  useCategoryLists.setState({ lists: lists.map((l) => (l.id === id ? { ...l, name: uniqueListName(name, others) } : l)) });
  void persist();
}

export function deleteOwnList(id: string) {
  useCategoryLists.setState((s) => ({ lists: s.lists.filter((l) => l.id !== id) }));
  void persist();
}
