import { createVerbund } from '../core/model/defaults';
import type { Id, Placement, Project, Verbund } from '../core/model/types';
import { cleanPlacement, composePlacement, IDENTITY, placementOfTransform } from '../core/placement';
import { groupOf, placementOf, rotatePageInPlace, type PageTransform } from '../core/verbund';
import { useStore } from './store';

/**
 * Festplatz-Verbünde (#15, spec.md „Verbund / Gesamtansicht“): anlegen, umbenennen, löschen, Mitglieder und ihre Lage.
 * Jede Änderung ist genau ein Undo-Schritt. Eine Page gehört zu höchstens einem Verbund. Jede Page behält ihr eigenes
 * Koordinatensystem; der Verbund speichert je Mitglied nur die Lage (`Verbund.placements`, #27): Aufnehmen setzt die
 * Identität, Herausnehmen und Löschen verwerfen die Lage (der Inhalt der Page bleibt unverändert).
 */

/**
 * Lagen eines Verbunds im Entwurf; fehlen sie (Daten, die am Laden vorbei in den Store kamen, z. B. Testdaten), werden
 * sie angelegt – fehlende Lagen gelten als Identität (core/verbund.ts `placementOf`).
 */
export const placementsOf = (g: Pick<Verbund, 'placements'>): Verbund['placements'] => (g.placements ??= {});

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
    for (const other of p.groups) {
      other.pageIds = other.pageIds.filter((id) => !pageIds.includes(id));
      for (const id of pageIds) delete placementsOf(other)[id];
    }
    const members = pageIds.filter((id) => p.pages.some((pg) => pg.id === id));
    p.groups.push({ ...g, pageIds: members, placements: Object.fromEntries(members.map((id) => [id, { ...IDENTITY }])) });
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

/** Löscht den Verbund; die Pages behalten ihren Inhalt in ihren eigenen Koordinaten, die Lagen entfallen. */
export function deleteVerbund(id: Id) {
  useStore.getState().change('Verbund löschen', (p) => {
    const i = p.groups.findIndex((x) => x.id === id);
    if (i >= 0) p.groups.splice(i, 1);
  });
}

/**
 * Nimmt eine Page in den Verbund auf (am Ende) mit der Lage „keine Verschiebung, keine Drehung“ (#27); aus einem anderen
 * Verbund wird sie dabei herausgenommen.
 */
export function addMember(verbundId: Id, pageId: Id) {
  useStore.getState().change('Festplatz in Verbund aufnehmen', (p) => {
    const g = p.groups.find((x) => x.id === verbundId);
    if (!g || g.pageIds.includes(pageId) || !p.pages.some((pg) => pg.id === pageId)) return;
    for (const other of p.groups)
      if (other !== g) {
        other.pageIds = other.pageIds.filter((x) => x !== pageId);
        delete placementsOf(other)[pageId];
      }
    g.pageIds.push(pageId);
    placementsOf(g)[pageId] = { ...IDENTITY };
  });
}

/** Nimmt die Page aus dem Verbund; ihr Inhalt bleibt in ihren eigenen Koordinaten unverändert, die Lage entfällt. */
export function removeMember(verbundId: Id, pageId: Id) {
  useStore.getState().change('Festplatz aus Verbund nehmen', (p) => {
    const g = p.groups.find((x) => x.id === verbundId);
    if (!g) return;
    g.pageIds = g.pageIds.filter((x) => x !== pageId);
    delete placementsOf(g)[pageId];
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
/** Nur Gleitkomma-Reste entfernen (10⁻⁸ m bzw. °). */
const fine = (n: number) => Math.round(n * 1e8) / 1e8;

/** Lage einer Page im Verbund setzen (ein Undo-Schritt, „Lage im Verbund ändern“); false ohne Verbund oder ohne Änderung. */
function changePlacement(pageId: Id, next: (current: Placement) => Placement): boolean {
  const s = useStore.getState();
  const group = groupOf(s.project, pageId);
  if (!group) return false;
  const current = placementOf(group, pageId);
  const p = cleanPlacement(next(current));
  if (p.x === current.x && p.y === current.y && p.rot === current.rot) return false;
  return s.change('Lage im Verbund ändern', (draft) => {
    const g = draft.groups.find((x) => x.id === group.id);
    if (g) placementsOf(g)[pageId] = p;
  });
}

/**
 * Lage einer Page im Verbund ändern (#15, #27): Die starre Bewegung `t` (im System des Verbunds, wie in der
 * Gesamtansicht: um `pivot` drehen, dann verschieben) wird in die Lage der Page komponiert (Lage′ = T ∘ Lage); der
 * Inhalt der Page bleibt unverändert – ihre Einzelansicht, ihr Einzel-PDF und ihre Nummerierung ändern sich nicht,
 * nur Gesamtansicht, Nachbarn und Zuordnung. Ein Undo-Schritt.
 *
 * Verschiebung auf 0,01 m, Drehung auf 0,1° gerundet; mit `precise` (Werkzeug „Ausrichten“: Punktpaare und manuelle Sitzung, #26;
 * Felder der Lage) entfallen nur Gleitkomma-Reste: Bei 0,1° läge ein Punkt 200 m vom Drehpunkt bis etwa
 * 0,17 m daneben. Gespeichert wird die Lage ungerundet (nur Reste unter 10⁻⁸). Da nur die Lage sich ändert, gibt es
 * keine Rundung je Objekt und keine Fehlwarnungen. false ohne Verbund oder ohne Bewegung.
 */
export function movePageContent(pageId: Id, t: PageTransform, opts: { precise?: boolean } = {}): boolean {
  const tr: PageTransform = opts.precise ? { dx: fine(t.dx), dy: fine(t.dy), rot: fine(t.rot), pivot: t.pivot } : { dx: r2(t.dx), dy: r2(t.dy), rot: r1(t.rot), pivot: t.pivot };
  if (!tr.dx && !tr.dy && !tr.rot) return false;
  return changePlacement(pageId, (current) => composePlacement(placementOfTransform(tr), current));
}

/**
 * Lage direkt setzen (Projekteinstellungen „Lage“, #27): nur die angegebenen Felder; ein Undo-Schritt. Die Drehung
 * setzt `setPlacementRotation` (um die Mitte des Platzes).
 */
export function setPlacement(pageId: Id, patch: Partial<Pick<Placement, 'x' | 'y'>>): boolean {
  return changePlacement(pageId, (current) => ({ ...current, ...patch }));
}

/**
 * Drehung der Lage auf `rot` setzen, um den Punkt `pivot` im System des Verbunds (die Mitte des Platzes in der
 * Gesamtansicht): Der Platz dreht sich dort an Ort und Stelle, die Verschiebung der Lage passt sich an.
 */
export function setPlacementRotation(pageId: Id, rot: number, pivot: { x: number; y: number }): boolean {
  return changePlacement(pageId, (current) => composePlacement(placementOfTransform({ dx: 0, dy: 0, rot: rot - current.rot, pivot }), current));
}

/** Lage auf „keine Verschiebung, keine Drehung“ zurücksetzen (ein Undo-Schritt). */
export function resetPlacement(pageId: Id): boolean {
  return changePlacement(pageId, () => IDENTITY);
}

/**
 * „Platz in der Einzelansicht drehen“ (#27): dreht den Inhalt der Page in ihren eigenen Koordinaten um `theta` Grad im
 * Uhrzeigersinn um ihre Mitte (core/verbund.ts `rotatePageInPlace`) und gleicht die Lage im Verbund aus, sodass der
 * Platz in der Gesamtansicht und für seine Nachbarn an derselben Stelle bleibt. Ohne Verbund dreht nur der Inhalt.
 * Ein Undo-Schritt.
 *
 * Die Ansicht der Einzelansicht folgt dem Inhalt (die Mitte bleibt an ihrer Bildschirmstelle), auch bei Undo/Redo:
 * Die aktuelle Ansicht wird zuerst ohne Undo-Schritt in `page.view` übernommen, dann verschiebt der Undo-Schritt sie
 * mit dem Inhalt; Undo/Redo setzen die Ansicht aus `page.view` zurück (store.ts `syncViews`).
 */
export function rotatePageView(pageId: Id, theta: number): boolean {
  const s = useStore.getState();
  const rot = fine(theta);
  const page = s.project.pages.find((x) => x.id === pageId);
  if (!page || !rot) return false;
  const view = s.views[pageId];
  // Aktuelle Ansicht ohne Undo-Schritt und ohne Änderungsmarkierung in die Page (Ausgangspunkt für Undo)
  if (view && page.view !== view)
    s.changeView((p) => {
      const pg = p.pages.find((x) => x.id === pageId);
      if (pg) pg.view = view;
    });
  const project = useStore.getState().project;
  const current = project.pages.find((x) => x.id === pageId)!;
  const group = groupOf(project, pageId);
  const next = rotatePageInPlace(current, placementOf(group, pageId), rot);
  const ok = useStore.getState().change('Platz in der Einzelansicht drehen', (p) => {
    const i = p.pages.findIndex((x) => x.id === pageId);
    if (i >= 0) p.pages[i] = next.page;
    const g = group && p.groups.find((x) => x.id === group.id);
    if (g) placementsOf(g)[pageId] = next.placement;
  });
  if (ok && next.page.view) useStore.getState().setView(pageId, next.page.view);
  return ok;
}
