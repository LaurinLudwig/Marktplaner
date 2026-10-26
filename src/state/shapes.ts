import { roundRect } from '../core/geometry/rect';
import { newId } from '../core/id';
import type { Id, Project, ShapePart, ShapeTemplate, StandShape } from '../core/model/types';
import { LIMITS } from '../core/objects';
import { normalizeParts } from '../core/shape';
import { useStore } from './store';

/**
 * Geschäftsformen (M12, #9, spec.md §3 „Form“): Form der Stände und Formvorlagen in den Projekteinstellungen.
 * Jede Änderung ist ein Undo-Schritt.
 */

const st = () => useStore.getState();

/** Auswahl im Feld „Form“: eine Grundform oder eine Vorlage. */
export type ShapeChoice = { shape: StandShape } | { templateId: Id };

/**
 * Form der Stände setzen. Eine Vorlage übernimmt ihr Vorschlagsmaß (Mittelpunkt und Drehung bleiben); eine Grundform
 * entfernt die Vorlage und ändert die Maße nicht.
 */
export function setStandShape(pageId: Id, ids: readonly Id[], choice: ShapeChoice) {
  const set = new Set(ids);
  const tpl = 'templateId' in choice ? st().project.shapeTemplates.find((t) => t.id === choice.templateId) : undefined;
  if ('templateId' in choice && !tpl) return;
  const clamp = (v: number) => Math.min(LIMITS.stand.max, Math.max(LIMITS.stand.min, v));
  st().change(tpl ? `Form „${tpl.name}“ zuweisen` : 'Form ändern', (p) => {
    const page = p.pages.find((x) => x.id === pageId);
    if (!page) return;
    for (const s of page.stands) {
      if (!set.has(s.id)) continue;
      if (tpl) {
        s.shapeTemplateId = tpl.id;
        const r = roundRect({ ...s, w: clamp(tpl.w), d: clamp(tpl.d) });
        s.w = r.w;
        s.d = r.d;
      } else if ('shape' in choice) {
        s.shapeTemplateId = null;
        s.shape = choice.shape;
      }
    }
  });
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
export function saveShapeTemplate(id: Id | null, name: string, partsInMeters: readonly ShapePart[]): Id | null {
  const n = normalizeParts(partsInMeters);
  if (!n) return null;
  const tpl: ShapeTemplate = { id: id ?? newId(), name: name.trim() || 'Form', w: round(n.w), d: round(n.d), parts: n.parts };
  st().change(id ? `Formvorlage „${tpl.name}“ ändern` : `Formvorlage „${tpl.name}“ anlegen`, (p) => {
    const i = p.shapeTemplates.findIndex((t) => t.id === tpl.id);
    if (i >= 0) p.shapeTemplates[i] = tpl;
    else p.shapeTemplates.push(tpl);
  });
  return tpl.id;
}

/** Vorlage löschen; ihre Stände fallen auf ihre Grundform zurück (ein Undo-Schritt). */
export function deleteShapeTemplate(id: Id) {
  st().change('Formvorlage löschen', (p) => {
    p.shapeTemplates = p.shapeTemplates.filter((t) => t.id !== id);
    for (const pg of p.pages) for (const s of pg.stands) if (s.shapeTemplateId === id) s.shapeTemplateId = null;
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
