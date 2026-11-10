import { createVerbund } from '../core/model/defaults';
import type { Id, Project } from '../core/model/types';
import { transformPageContent, type PageTransform } from '../core/verbund';
import { useStore } from './store';

/**
 * Festplatz-Verbünde (#15, spec.md „Verbund / Gesamtansicht“): anlegen, umbenennen, löschen, Mitglieder und ihre Lage.
 * Jede Änderung ist genau ein Undo-Schritt. Eine Page gehört zu höchstens einem Verbund.
 */

/** Freier Name „Verbund“, „Verbund 2“, … */
export function nextVerbundName(project: Pick<Project, 'groups'>): string {
  const taken = new Set(project.groups.map((g) => g.name.trim().toLowerCase()));
  if (!taken.has('verbund')) return 'Verbund';
  for (let i = 2; ; i++) if (!taken.has(`verbund ${i}`)) return `Verbund ${i}`;
}

/** Legt einen Verbund an (ohne Mitglieder, wenn keine angegeben sind) und liefert seine ID. */
export function addVerbund(name?: string, pageIds: Id[] = []): Id {
  const s = useStore.getState();
  const g = createVerbund(name?.trim() || nextVerbundName(s.project), []);
  s.change('Verbund anlegen', (p) => {
    // Mitglieder anderer Verbünde wechseln hierher (eine Page gehört zu höchstens einem Verbund)
    for (const other of p.groups) other.pageIds = other.pageIds.filter((id) => !pageIds.includes(id));
    p.groups.push({ ...g, pageIds: pageIds.filter((id) => p.pages.some((pg) => pg.id === id)) });
  });
  return g.id;
}

/** Umbenennen; ein leerer Name wird abgewiesen (false). */
export function renameVerbund(id: Id, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  useStore.getState().change('Verbund umbenennen', (p) => {
    const g = p.groups.find((x) => x.id === id);
    if (g && g.name !== trimmed) g.name = trimmed;
  });
  return true;
}

/** Löscht den Verbund; die Pages bleiben, wo sie sind (ihr Inhalt wird nicht zurückverschoben). */
export function deleteVerbund(id: Id) {
  useStore.getState().change('Verbund löschen', (p) => {
    const i = p.groups.findIndex((x) => x.id === id);
    if (i >= 0) p.groups.splice(i, 1);
  });
}

/** Nimmt eine Page in den Verbund auf (am Ende); aus einem anderen Verbund wird sie dabei herausgenommen. */
export function addMember(verbundId: Id, pageId: Id) {
  useStore.getState().change('Festplatz in Verbund aufnehmen', (p) => {
    const g = p.groups.find((x) => x.id === verbundId);
    if (!g || g.pageIds.includes(pageId) || !p.pages.some((pg) => pg.id === pageId)) return;
    for (const other of p.groups) if (other !== g) other.pageIds = other.pageIds.filter((x) => x !== pageId);
    g.pageIds.push(pageId);
  });
}

export function removeMember(verbundId: Id, pageId: Id) {
  useStore.getState().change('Festplatz aus Verbund nehmen', (p) => {
    const g = p.groups.find((x) => x.id === verbundId);
    if (g) g.pageIds = g.pageIds.filter((x) => x !== pageId);
  });
}

/** Verschiebt ein Mitglied in der Reihenfolge des Verbunds um `delta` Plätze. */
export function moveMember(verbundId: Id, pageId: Id, delta: number) {
  useStore.getState().change('Reihenfolge im Verbund ändern', (p) => {
    const g = p.groups.find((x) => x.id === verbundId);
    if (!g) return;
    const from = g.pageIds.indexOf(pageId);
    const to = Math.max(0, Math.min(g.pageIds.length - 1, from + delta));
    if (from < 0 || from === to) return;
    g.pageIds.splice(from, 1);
    g.pageIds.splice(to, 0, pageId);
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Nur Gleitkomma-Reste entfernen (10⁻⁸ m bzw. °), wie `transformPageContent` für die bewegten Positionen. */
const fine = (n: number) => Math.round(n * 1e8) / 1e8;

/**
 * Lage einer Page im Verbund ändern (#15): die ganze Page samt Hintergrund und allen Objekten verschieben bzw. drehen
 * (`transformPageContent`). Verschiebung auf 0,01 m, Drehung auf 0,1° gerundet; ein Undo-Schritt. Mit `precise`
 * (Werkzeug „Ausrichten“: Punktpaare und manuelle Sitzung, #26) entfallen nur Gleitkomma-Reste: Bei 0,1° läge ein
 * Punkt 200 m vom Drehpunkt bis etwa 0,17 m daneben. Die Lage der Objekte zueinander bleibt so oder so starr
 * (keine Rundung je Objekt, also keine Fehlwarnungen).
 *
 * Die Ansicht der Page folgt dem Inhalt (der Drehpunkt bleibt an seiner Bildschirmstelle), auch bei Undo/Redo: Die
 * aktuelle Ansicht wird zuerst ohne Undo-Schritt in `page.view` übernommen, dann verschiebt der Undo-Schritt sie mit
 * dem Inhalt; Undo/Redo setzen die Ansicht aus `page.view` zurück (store.ts `syncViews`). Ohne das bliebe nach Undo die
 * verschobene Ansicht stehen und der Inhalt erschiene versetzt. „An Fenster anpassen“ wäre keine Lösung: Es ginge nur
 * auf der sichtbaren Zeichenfläche (die Lage wird in den Projekteinstellungen geändert) und verlöre den Ausschnitt.
 */
export function movePageContent(pageId: Id, t: PageTransform, opts: { precise?: boolean } = {}): boolean {
  const s = useStore.getState();
  const tr: PageTransform = opts.precise ? { dx: fine(t.dx), dy: fine(t.dy), rot: fine(t.rot), pivot: t.pivot } : { dx: r2(t.dx), dy: r2(t.dy), rot: r1(t.rot), pivot: t.pivot };
  const page = s.project.pages.find((x) => x.id === pageId);
  if (!page || (!tr.dx && !tr.dy && !tr.rot)) return false;
  const view = s.views[pageId];
  // Aktuelle Ansicht ohne Undo-Schritt und ohne Änderungsmarkierung in die Page (Ausgangspunkt für Undo)
  if (view && page.view !== view)
    s.changeView((p) => {
      const pg = p.pages.find((x) => x.id === pageId);
      if (pg) pg.view = view;
    });
  const current = useStore.getState().project.pages.find((x) => x.id === pageId)!;
  const next = transformPageContent(current, tr);
  const ok = useStore.getState().change('Lage im Verbund ändern', (p) => {
    const i = p.pages.findIndex((x) => x.id === pageId);
    if (i >= 0) p.pages[i] = next;
  });
  if (ok && next.view) useStore.getState().setView(pageId, next.view);
  return ok;
}
