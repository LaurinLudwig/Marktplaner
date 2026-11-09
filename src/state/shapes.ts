import { roundRect } from '../core/geometry/rect';
import { dissolveStand, mergeStands, refitStand, shapeParts } from '../core/compound';
import { clampFrontOverride } from '../core/model/schema';
import { newId } from '../core/id';
import type { Id, Project, Rect, ShapePart, ShapeTemplate, StandShape } from '../core/model/types';
import { LIMITS } from '../core/objects';
import { normalizeParts } from '../core/shape';
import { ownerPages, pageView } from '../core/verbundView';
import { select } from './objects';
import { useStore } from './store';

/**
 * Geschäftsformen (M12, #9, spec.md §3 „Form“): Form der Stände, Formvorlagen in den Projekteinstellungen und die
 * eigene Form je Stand (#16). Jede Änderung ist ein Undo-Schritt. `pageId` darf die Gesamtansicht eines Verbunds sein
 * (#15): Die Stände werden dann in den Listen ihrer Besitzer-Pages geändert.
 */

const st = () => useStore.getState();

/** Stände der Pages von `pageId` (in der Gesamtansicht aller Mitglieder, #15); auch im Entwurf. */
const standsOf = (p: Pick<Project, 'pages' | 'groups'>, pageId: Id) => ownerPages(p, pageId).flatMap((pg) => pg.stands);

/** Auswahl im Feld „Form“: eine Grundform, eine Vorlage oder die eigene Form (#16). */
export type ShapeChoice = { shape: StandShape } | { templateId: Id } | { own: true };

/**
 * Form der Stände setzen. Eine Vorlage übernimmt ihr Vorschlagsmaß (Mittelpunkt und Drehung bleiben); eine Grundform
 * entfernt Vorlage und eigene Form und ändert die Maße nicht. „Eigene Form“ (#16) übernimmt die bisher gezeichneten
 * Teile (Vorlage bzw. Grundform als ein Teil) als eigene Teile des Stands; danach lassen sie sich einzeln bearbeiten.
 * Wer keine Belegung wie gezeichnet mehr hat, verliert die Frontmeter von Hand.
 */
export function setStandShape(pageId: Id, ids: readonly Id[], choice: ShapeChoice) {
  const set = new Set(ids);
  const templates = st().project.shapeTemplates;
  const tpl = 'templateId' in choice ? templates.find((t) => t.id === choice.templateId) : undefined;
  if ('templateId' in choice && !tpl) return;
  const byId = new Map(templates.map((t) => [t.id, t]));
  const clamp = (v: number) => Math.min(LIMITS.stand.max, Math.max(LIMITS.stand.min, v));
  const label = tpl ? `Form „${tpl.name}“ zuweisen` : 'own' in choice ? 'Eigene Form' : 'Form ändern';
  st().change(label, (p) => {
    for (const s of standsOf(p, pageId)) {
      if (!set.has(s.id)) continue;
      if ('own' in choice) {
        if (s.parts?.length) continue;
        s.parts = shapeParts(s, byId).map((q) => ({ ...q }));
        s.shapeTemplateId = null;
        continue;
      }
      s.parts = null;
      if (tpl) {
        s.shapeTemplateId = tpl.id;
        const r = roundRect({ ...s, w: clamp(tpl.w), d: clamp(tpl.d) });
        s.w = r.w;
        s.d = r.d;
        if (!tpl.occupies) s.frontOverride = null;
      } else if ('shape' in choice) {
        s.shapeTemplateId = null;
        s.shape = choice.shape;
        s.frontOverride = null;
      }
    }
  });
}

/**
 * Eigene Form eines Stands aus Teilen in Metern (Seitenleiste; X/Y ab der linken oberen Ecke von B × T, #16). Das
 * Hüllrechteck B × T wird neu bestimmt, die Teile bleiben auf dem Plan an ihrem Platz. false ohne brauchbares Teil.
 */
export function setStandParts(pageId: Id, id: Id, meters: readonly ShapePart[], label = 'Form ändern'): boolean {
  const stand = pageView(st().project, pageId)?.stands.find((x) => x.id === id);
  if (!stand) return false;
  const fit = refitStand(stand, meters);
  if (!fit) return false;
  commitStandParts(pageId, id, fit.rect, fit.parts, label);
  return true;
}

/** Hüllrechteck und relative Teile einer eigenen Form übernehmen (Gesten auf der Zeichenfläche, ein Undo-Schritt). */
export function commitStandParts(pageId: Id, id: Id, rect: Rect, parts: ShapePart[], label: string) {
  st().change(label, (p) => {
    const s = standsOf(p, pageId).find((x) => x.id === id);
    if (!s) return;
    const r = roundRect(rect);
    Object.assign(s, { cx: r.cx, cy: r.cy, w: r.w, d: r.d, rot: r.rot, parts, shapeTemplateId: null });
  });
}

/** Frontmeter von Hand (#16, Standgeld); null = automatisch. */
export function setFrontOverride(pageId: Id, ids: readonly Id[], value: number | null) {
  const set = new Set(ids);
  const v = value === null ? null : clampFrontOverride(value);
  st().change(v === null ? 'Frontmeter automatisch' : 'Frontmeter ändern', (p) => {
    for (const s of standsOf(p, pageId)) if (set.has(s.id)) s.frontOverride = v;
  });
}

/**
 * „Zu einem Stand zusammenfassen“ (#16): ausgewählte Stände (Reihenfolge der Auswahl) werden ein Stand mit eigener
 * Form (core/compound.ts `mergeStands`). Ein Undo-Schritt; danach ist der zusammengefasste Stand ausgewählt.
 */
export function mergeStandsOnPage(pageId: Id, ids: readonly Id[]): Id | null {
  const project = st().project;
  const page = pageView(project, pageId);
  if (!page) return null;
  const stands = ids.map((id) => page.stands.find((s) => s.id === id)).filter((s) => !!s);
  const merged = mergeStands(stands, new Map(project.shapeTemplates.map((t) => [t.id, t])));
  if (!merged) return null;
  const removed = new Set(merged.removed);
  st().change('Zu einem Stand zusammenfassen', (p) => {
    // Gesamtansicht (#15): Der zusammengefasste Stand bleibt auf dem Platz seines Ausgangsstands
    for (const pg of ownerPages(p, pageId)) {
      if (!pg.stands.some((s) => removed.has(s.id) || s.id === merged.stand.id)) continue;
      pg.stands = pg.stands.filter((s) => !removed.has(s.id)).map((s) => (s.id === merged.stand.id ? merged.stand : s));
    }
  });
  select([merged.stand.id]);
  return merged.stand.id;
}

/** „Form auflösen“ (#16): jeder Teil der eigenen Form wird ein eigener Stand (ein Undo-Schritt, alle ausgewählt). */
export function dissolveStandOnPage(pageId: Id, id: Id): Id[] {
  const stand = pageView(st().project, pageId)?.stands.find((s) => s.id === id);
  if (!stand?.parts?.length) return [];
  const pieces = dissolveStand(stand);
  st().change('Form auflösen', (p) => {
    for (const pg of ownerPages(p, pageId)) {
      const i = pg.stands.findIndex((s) => s.id === id);
      if (i >= 0) pg.stands.splice(i, 1, ...pieces);
    }
  });
  const newIds = pieces.map((s) => s.id);
  select(newIds);
  return newIds;
}

/** Anzahl der Stände (alle Pages) mit dieser Vorlage. */
export function shapeTemplateUsage(project: Pick<Project, 'pages'>, id: Id): number {
  return project.pages.reduce((n, pg) => n + pg.stands.filter((s) => s.shapeTemplateId === id).length, 0);
}

/**
 * Vorlage aus Teilen in Metern anlegen oder ersetzen (Editor). Die Teile werden auf ihr Hüllrechteck normiert; das
 * Hüllrechteck ist das Vorschlagsmaß. Bestehende Stände behalten ihr B × T (die Form wird gestreckt).
 * Rückgabe: ID der Vorlage, oder null ohne brauchbares Teil.
 */
export function saveShapeTemplate(id: Id | null, name: string, partsInMeters: readonly ShapePart[], occupies = false): Id | null {
  const n = normalizeParts(partsInMeters);
  if (!n) return null;
  const tpl: ShapeTemplate = { id: id ?? newId(), name: name.trim() || 'Form', w: round(n.w), d: round(n.d), parts: n.parts, occupies };
  st().change(id ? `Formvorlage „${tpl.name}“ ändern` : `Formvorlage „${tpl.name}“ anlegen`, (p) => {
    const i = p.shapeTemplates.findIndex((t) => t.id === tpl.id);
    if (i >= 0) p.shapeTemplates[i] = tpl;
    else p.shapeTemplates.push(tpl);
    // Ohne „belegt wie gezeichnet“ gibt es keine Frontmeter von Hand (#16)
    if (!occupies) for (const pg of p.pages) for (const s of pg.stands) if (s.shapeTemplateId === tpl.id) s.frontOverride = null;
  });
  return tpl.id;
}

/** Vorlage löschen; ihre Stände fallen auf ihre Grundform zurück (ein Undo-Schritt). */
export function deleteShapeTemplate(id: Id) {
  st().change('Formvorlage löschen', (p) => {
    p.shapeTemplates = p.shapeTemplates.filter((t) => t.id !== id);
    for (const pg of p.pages)
      for (const s of pg.stands)
        if (s.shapeTemplateId === id) {
          s.shapeTemplateId = null;
          s.frontOverride = null;
        }
  });
}

/** Vorschlag für den Namen einer neuen Vorlage. */
export function nextTemplateName(project: Pick<Project, 'shapeTemplates'>): string {
  const names = new Set(project.shapeTemplates.map((t) => t.name));
  let i = project.shapeTemplates.length + 1;
  while (names.has(`Form ${i}`)) i++;
  return `Form ${i}`;
}

const round = (v: number) => Math.round(v * 100) / 100;
