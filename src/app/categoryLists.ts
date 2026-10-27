import { create } from 'zustand';
import {
  applyCategoryList,
  BUILTIN_CATEGORY_LISTS,
  CATEGORY_LIST_EXTENSION,
  categoryListFileName,
  DEFAULT_LIST_ID,
  EMPTY_LIST_ID,
  encodeCategoryListFile,
  parseCategoryListFile,
  type ApplyMode,
  type CategoryList,
} from '../core/categoryLists';
import { UserError, userMessage } from '../core/errors';
import { platform } from '../platform';
import { APP_KEY_PREFIX } from '../platform/legacyKeys';
import { addOwnList, deleteOwnList, loadCategoryLists, useCategoryLists } from '../state/categoryLists';
import { categoryUsage, loadCategoryList } from '../state/objects';
import { useStore } from '../state/store';
import { confirm, showError } from './dialogs';
import { notify } from './notify';

/**
 * Auswahl einer Kategorieliste (#1; Dialog: ui/shell/CategoryListDialog.tsx): beim neuen Projekt und über „Liste
 * laden …“ in den Projekteinstellungen. Eigene Listen (#2; Verwaltung: ui/shell/CategoryListManager.tsx) stehen
 * hinter den mitgelieferten.
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

/** Alle wählbaren Listen: mitgelieferte, dann eigene. */
export const availableLists = (): readonly CategoryList[] => [...BUILTIN_CATEGORY_LISTS, ...useCategoryLists.getState().lists];
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

export async function chooseCategoryList(mode: ListDialogMode): Promise<ListChoice | null> {
  await loadCategoryLists();
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

// ---------- Verwaltung eigener Listen (#2) ----------

export const useCategoryListManager = create<{ open: boolean }>()(() => ({ open: false }));

export async function openCategoryListManager() {
  await loadCategoryLists();
  useCategoryListManager.setState({ open: true });
}
export const closeCategoryListManager = () => useCategoryListManager.setState({ open: false });

const FILTER = { name: 'Kategorieliste', extensions: [CATEGORY_LIST_EXTENSION] };

export async function exportListInteractive(list: CategoryList) {
  try {
    const bytes = new TextEncoder().encode(encodeCategoryListFile(list));
    const saved = await platform.saveFile(bytes, categoryListFileName(list), FILTER, 'application/json', useStore.getState().filePath);
    if (saved) notify(`Kategorieliste „${list.name}“ exportiert.`, 'success');
  } catch (e) {
    if (!(e instanceof UserError)) console.warn(e);
    await showError('Kategorieliste exportieren', userMessage(e, 'Die Datei konnte nicht geschrieben werden.'));
  }
}

export async function importListInteractive() {
  try {
    const picked = await platform.pickFile(FILTER);
    if (!picked) return;
    const list = parseCategoryListFile(new TextDecoder().decode(picked.bytes));
    const added = addOwnList(list);
    notify(`Kategorieliste „${added.name}“ importiert (${added.entries.length} ${added.entries.length === 1 ? 'Kategorie' : 'Kategorien'}).`, 'success');
  } catch (e) {
    if (!(e instanceof UserError)) console.warn(e);
    await showError('Kategorieliste importieren', userMessage(e, 'Die Datei konnte nicht gelesen werden.'));
  }
}

export async function deleteListInteractive(list: CategoryList) {
  if (list.builtin) return;
  const ok = await confirm('Kategorieliste löschen', `„${list.name}“ von diesem Rechner löschen? Projekte, die die Liste verwenden, behalten ihre Kategorien.`, 'Löschen', true);
  if (ok) deleteOwnList(list.id);
}
