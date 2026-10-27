import { create } from 'zustand';
import { applyCategoryList, BUILTIN_CATEGORY_LISTS, DEFAULT_LIST_ID, EMPTY_LIST_ID, type ApplyMode, type CategoryList } from '../core/categoryLists';
import { APP_KEY_PREFIX } from '../platform/legacyKeys';
import { categoryUsage, loadCategoryList } from '../state/objects';
import { useStore } from '../state/store';
import { confirm } from './dialogs';
import { notify } from './notify';

/**
 * Auswahl einer Kategorieliste (#1; Dialog: ui/shell/CategoryListDialog.tsx): beim neuen Projekt und über „Liste
 * laden …“ in den Projekteinstellungen.
 */
export type ListDialogMode = 'new' | 'load';
export interface ListChoice {
  listId: string;
  apply: ApplyMode;
}
interface ListDialogState {
  request: { mode: ListDialogMode; resolve: (c: ListChoice | null) => void } | null;
}
export const useCategoryListDialog = create<ListDialogState>()(() => ({ request: null }));

/** Alle wählbaren Listen. */
export const availableLists = (): readonly CategoryList[] => BUILTIN_CATEGORY_LISTS;
export const findList = (id: string) => availableLists().find((l) => l.id === id) ?? null;

const NEW_LIST_KEY = `${APP_KEY_PREFIX}newProjectCategoryList`;

/** Zuletzt beim neuen Projekt gewählte Liste (Komfort, pro Rechner); Standard „Jahrmarkt klein“. */
export function lastNewProjectList(): string {
  try {
    const id = localStorage.getItem(NEW_LIST_KEY);
    if (id && (id === EMPTY_LIST_ID || findList(id))) return id;
  } catch {
    /* Einstellung ist nur Komfort */
  }
  return DEFAULT_LIST_ID;
}
export function rememberNewProjectList(id: string) {
  try {
    localStorage.setItem(NEW_LIST_KEY, id);
  } catch {
    /* Einstellung ist nur Komfort */
  }
}

export function chooseCategoryList(mode: ListDialogMode): Promise<ListChoice | null> {
  return new Promise((resolve) => {
    useCategoryListDialog.setState({
      request: {
        mode,
        resolve: (c) => {
          useCategoryListDialog.setState({ request: null });
          resolve(c);
        },
      },
    });
  });
}

/** „Liste laden …“: Auswahl, beim Ersetzen Rückfrage für Kategorien mit Ständen, dann ein Undo-Schritt. */
export async function loadListInteractive() {
  const choice = await chooseCategoryList('load');
  const list = choice && findList(choice.listId);
  if (!choice || !list) return;
  const project = useStore.getState().project;
  const { categories, removed } = applyCategoryList(project.categories, list, choice.apply);
  if (choice.apply === 'merge' && categories.length === project.categories.length) {
    notify(`Alle Kategorien aus „${list.name}“ sind schon vorhanden.`);
    return;
  }
  const used = removed.filter((id) => categoryUsage(project, id) > 0);
  if (used.length) {
    const n = used.reduce((sum, id) => sum + categoryUsage(project, id), 0);
    const names = used.map((id) => `„${project.categories.find((c) => c.id === id)?.name}“`).join(', ');
    const ok = await confirm(
      'Kategorien ersetzen',
      `${names} ${used.length === 1 ? 'kommt' : 'kommen'} in „${list.name}“ nicht vor und ${used.length === 1 ? 'wird' : 'werden'} von ${n} ${n === 1 ? 'Geschäft' : 'Geschäften'} verwendet. Diese verlieren die Kategorie (Farbe: eigene Farbe bzw. Standardfarbe). Rückgängig mit Strg/Cmd+Z möglich.`,
      'Ersetzen',
      true,
    );
    if (!ok) return;
  }
  loadCategoryList(list, choice.apply);
}
