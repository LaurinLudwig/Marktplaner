import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { Project } from '../core/model/types';

enablePatches();

export interface HistoryEntry {
  id: number;
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Schlüssel, unter dem Folgeschritte in diesen Eintrag verschmelzen dürfen (z. B. gehaltene Pfeiltaste). */
  mergeKey?: string;
}

export interface RecordOptions {
  mergeKey?: string;
  /**
   * In den letzten Eintrag einfügen, wenn er denselben `mergeKey` hat (z. B. Tastenwiederholung einer
   * gehaltenen Pfeiltaste). Ohne diese Angabe beginnt immer ein neuer Undo-Schritt.
   */
  mergeIntoPrevious?: boolean;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Offene Transaktion: weitere Änderungen werden in diesen Eintrag gebündelt (z. B. ein Ziehvorgang). */
  open: HistoryEntry | null;
}

export const MAX_HISTORY = 500;
let nextEntryId = 1;

export const emptyHistory = (): History => ({ past: [], future: [], open: null });

/** ID des Eintrags, der den aktuellen Projektstand beschreibt (0 = Ausgangsstand). */
export const headId = (h: History): number => h.open?.id ?? h.past.at(-1)?.id ?? 0;

export type Recipe = (draft: Project) => void;

/** Wendet eine Änderung an und protokolliert sie. Liefert null, wenn sich nichts geändert hat. */
export function record(
  project: Project,
  h: History,
  label: string,
  recipe: Recipe,
  opts: RecordOptions = {},
): { project: Project; history: History } | null {
  const [next, patches, inverse] = produceWithPatches(project, recipe);
  if (!patches.length) return null;
  if (h.open) {
    const open = { ...h.open, patches: [...h.open.patches, ...patches], inverse: [...inverse, ...h.open.inverse] };
    return { project: next, history: { ...h, open } };
  }
  const last = h.past.at(-1);
  if (opts.mergeIntoPrevious && opts.mergeKey && last && last.mergeKey === opts.mergeKey && !h.future.length) {
    // Neue ID: Der zusammengefasste Stand ist ein anderer als ein womöglich gespeicherter (dirty-Erkennung).
    const merged: HistoryEntry = { ...last, id: nextEntryId++, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse] };
    return { project: next, history: { past: [...h.past.slice(0, -1), merged], future: [], open: null } };
  }
  const entry: HistoryEntry = { id: nextEntryId++, label, patches, inverse, ...(opts.mergeKey ? { mergeKey: opts.mergeKey } : {}) };
  return { project: next, history: { past: [...h.past, entry].slice(-MAX_HISTORY), future: [], open: null } };
}

export function beginTransaction(h: History, label: string): History {
  if (h.open) return h;
  return { ...h, open: { id: nextEntryId++, label, patches: [], inverse: [] } };
}

export function commitTransaction(h: History): History {
  if (!h.open) return h;
  if (!h.open.patches.length) return { ...h, open: null };
  return { past: [...h.past, h.open].slice(-MAX_HISTORY), future: [], open: null };
}

/** Bricht die offene Transaktion ab: Ihre Änderungen werden zurückgenommen, kein Undo-Schritt (Esc, QA-M4-04). */
export function abortTransaction(project: Project, h: History): { project: Project; history: History } {
  if (!h.open) return { project, history: h };
  return { project: h.open.patches.length ? applyPatches(project, h.open.inverse) : project, history: { ...h, open: null } };
}

export function undo(project: Project, h: History): { project: Project; history: History } | null {
  const h2 = commitTransaction(h);
  const entry = h2.past.at(-1);
  if (!entry) return null;
  return {
    project: applyPatches(project, entry.inverse),
    history: { past: h2.past.slice(0, -1), future: [entry, ...h2.future], open: null },
  };
}

export function redo(project: Project, h: History): { project: Project; history: History } | null {
  const h2 = commitTransaction(h);
  const entry = h2.future[0];
  if (!entry) return null;
  return {
    project: applyPatches(project, entry.patches),
    history: { past: [...h2.past, entry], future: h2.future.slice(1), open: null },
  };
}
