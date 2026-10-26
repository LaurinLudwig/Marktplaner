import { createPage } from '../core/model/defaults';
import { clonePage, copyName, nextPageName } from '../core/model/pages';
import type { Id } from '../core/model/types';
import { START_PAGE, useStore } from './store';

/** Page-Befehle. Alle Änderungen am Projekt laufen über `change` und sind damit rückgängig machbar. */

export function addPage(): Id {
  const s = useStore.getState();
  const page = createPage(nextPageName(s.project.pages));
  s.change('Festplatz anlegen', (p) => {
    p.pages.push(page);
  });
  useStore.getState().setUi({ activePage: page.id });
  return page.id;
}

export function renamePage(id: Id, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  useStore.getState().change('Festplatz umbenennen', (p) => {
    const page = p.pages.find((x) => x.id === id);
    if (page && page.name !== trimmed) page.name = trimmed;
  });
}

/** Projektname (Projekteinstellungen, M6-05); leer wird abgewiesen (false). */
export function setProjectName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  useStore.getState().change('Projekt umbenennen', (p) => {
    if (p.name !== trimmed) p.name = trimmed;
  });
  return true;
}

export function duplicatePage(id: Id) {
  const s = useStore.getState();
  const index = s.project.pages.findIndex((x) => x.id === id);
  const src = s.project.pages[index];
  if (!src) return;
  const copy = clonePage(src, copyName(src.name, s.project.pages));
  s.change('Festplatz duplizieren', (p) => {
    p.pages.splice(index + 1, 0, copy);
  });
  const view = s.views[id];
  if (view) useStore.getState().setView(copy.id, view);
  useStore.getState().setUi({ activePage: copy.id });
}

export function deletePage(id: Id) {
  const s = useStore.getState();
  const index = s.project.pages.findIndex((x) => x.id === id);
  if (index < 0) return;
  const neighbor = s.project.pages[index + 1]?.id ?? s.project.pages[index - 1]?.id ?? START_PAGE;
  s.change('Festplatz löschen', (p) => {
    p.pages.splice(index, 1);
  });
  if (s.ui.activePage === id) useStore.getState().setUi({ activePage: neighbor });
}

/** Verschiebt eine Page an Position `to` (Index in der Liste nach dem Entfernen). */
export function movePage(id: Id, to: number) {
  useStore.getState().change('Festplätze umsortieren', (p) => {
    const from = p.pages.findIndex((x) => x.id === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(p.pages.length - 1, to));
    if (target === from) return;
    const [page] = p.pages.splice(from, 1);
    p.pages.splice(target, 0, page!);
  });
}

/** Wechselt relativ zur aktiven Page; die Start-Page zählt als Position 0. */
export function cyclePage(delta: number) {
  const s = useStore.getState();
  const order = [START_PAGE, ...s.project.pages.map((p) => p.id)];
  const i = order.indexOf(s.ui.activePage);
  const next = order[(i + delta + order.length) % order.length]!;
  s.setUi({ activePage: next });
}

/** Springt zur n-ten Page (0 = Start-Page). */
export function gotoPage(n: number) {
  const s = useStore.getState();
  const target = n === 0 ? START_PAGE : s.project.pages[n - 1]?.id;
  if (target) s.setUi({ activePage: target });
}
