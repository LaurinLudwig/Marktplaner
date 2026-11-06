/**
 * Eigene Form eines Stands (#16, spec.md §3 „Form“): Teile bearbeiten, mehrere Stände zu einem zusammenfassen und eine
 * Form wieder in einzelne Stände auflösen. Reine Funktionen; die Befehle mit Undo stehen in state/shapes.ts.
 *
 * Die Teile sind wie bei Formvorlagen relativ (0–1) zum Hüllrechteck B × T gespeichert, mit Drehung je Teil. Ändert
 * sich ein Teil, wird das Hüllrechteck neu bestimmt (es umschließt alle Teile) und der Stand so verschoben, dass alle
 * Teile auf dem Plan an ihrem Platz bleiben.
 */
import { fromLocal, normAngle, roundAngle, roundRect, toLocal } from './geometry/rect';
import { EPS } from './geometry/tolerance';
import type { Id, Rect, ShapePart, ShapeTemplate, Stand } from './model/types';
import { createStand, LIMITS } from './objects';
import { normalizeParts, partRect, partsInMeters } from './shape';

const clampSize = (v: number) => Math.min(LIMITS.stand.max, Math.max(LIMITS.stand.min, v));

/**
 * Neues Hüllrechteck (Weltkoordinaten, gerundet) und relative Teile aus Teilen in Metern, gemessen von der linken
 * oberen Ecke des bisherigen Hüllrechtecks von `stand` (wie im Editor). Die Drehung des Stands bleibt; die Teile
 * bleiben auf dem Plan, wo sie sind. null ohne brauchbares Teil.
 */
export function refitStand(stand: Rect, meters: readonly ShapePart[]): { rect: Rect; parts: ShapePart[] } | null {
  const n = normalizeParts(meters.map((p) => ({ ...p, rot: roundAngle(p.rot || 0) })));
  if (!n) return null;
  const c = fromLocal(stand, { x: n.x0 + n.w / 2 - stand.w / 2, y: n.y0 + n.d / 2 - stand.d / 2 });
  return { rect: roundRect({ cx: c.x, cy: c.y, w: clampSize(n.w), d: clampSize(n.d), rot: stand.rot }), parts: n.parts };
}

/** Teile eines Stands in Metern ab der linken oberen Ecke von B × T (für Seitenleiste und Gesten). */
export const standPartsInMeters = (stand: Pick<Stand, 'w' | 'd' | 'parts'>): ShapePart[] => (stand.parts ? partsInMeters({ w: stand.w, d: stand.d, parts: stand.parts }) : []);

/** Ein Teil in Metern (Editor-System von `frame`) aus einem Rechteck in Weltkoordinaten. */
export function meterPartFromWorld(frame: Rect, kind: ShapePart['kind'], r: Rect): ShapePart {
  const c = toLocal(frame, { x: r.cx, y: r.cy });
  return { kind, x: c.x + frame.w / 2 - r.w / 2, y: c.y + frame.d / 2 - r.d / 2, w: r.w, h: r.d, rot: normAngle(r.rot - frame.rot) };
}

/** Teile, aus denen ein Stand gezeichnet wird: eigene Form, Vorlage oder die Grundform als ein Teil. */
export function shapeParts(stand: Stand, templates: ReadonlyMap<Id, ShapeTemplate>): ShapePart[] {
  if (stand.parts?.length) return stand.parts;
  const tpl = stand.shapeTemplateId ? templates.get(stand.shapeTemplateId) : undefined;
  if (tpl) return tpl.parts;
  return [{ kind: stand.shape, x: 0, y: 0, w: 1, h: 1, rot: 0 }];
}

/** Fläche der gezeichneten Form in m² (Teile einzeln, Ellipse π/4 · B · T). */
const shapeArea = (s: Stand, parts: readonly ShapePart[]) => parts.reduce((n, p) => n + p.w * s.w * p.h * s.d * (p.kind === 'ellipse' ? Math.PI / 4 : 1), 0);

/**
 * „Zu einem Stand zusammenfassen“ (#16): Die Stände (in der Reihenfolge der Auswahl) werden ein Stand mit eigener
 * Form. Daten (Nummer, Name, Strom, Kategorie …), ID und Drehung kommen vom größten Stand (Fläche der gezeichneten
 * Form), bei gleicher Fläche vom zuerst ausgewählten. Jeder Stand bringt seine gezeichneten Teile mit (Grundform,
 * Vorlage oder eigene Form), jeweils an ihrem Platz auf dem Plan. Eine von Hand verschobene Beschriftung und die
 * Frontmeter von Hand entfallen. null bei weniger als zwei Ständen.
 */
export function mergeStands(stands: readonly Stand[], templates: ReadonlyMap<Id, ShapeTemplate>): { stand: Stand; removed: Id[] } | null {
  if (stands.length < 2) return null;
  let target = stands[0]!;
  let best = shapeArea(target, shapeParts(target, templates));
  for (const s of stands.slice(1)) {
    const a = shapeArea(s, shapeParts(s, templates));
    if (a > best + EPS) [target, best] = [s, a];
  }
  const meters = stands.flatMap((s) => shapeParts(s, templates).map((p) => meterPartFromWorld(target, p.kind, partRect(s, p))));
  const fit = refitStand(target, meters);
  if (!fit) return null;
  return {
    stand: { ...target, ...fit.rect, parts: fit.parts, shapeTemplateId: null, shape: 'rect', frontOverride: null, labelOffset: null },
    removed: stands.filter((s) => s.id !== target.id).map((s) => s.id),
  };
}

/**
 * „Form auflösen“ (#16): Jeder Teil der eigenen Form wird ein eigener Stand (Rechteck bzw. Kreis/Oval, gedreht wie der
 * Teil). Der größte Teil behält ID und alle Daten des Stands; die übrigen übernehmen nur Kategorie und eigene Farbe.
 */
export function dissolveStand(stand: Stand): Stand[] {
  if (!stand.parts?.length) return [stand];
  const parts = stand.parts;
  let main = 0;
  parts.forEach((p, i) => {
    if (shapeArea(stand, [p]) > shapeArea(stand, [parts[main]!]) + EPS) main = i;
  });
  return parts.map((p, i) => {
    const r = roundRect(partRect(stand, p));
    const rect = { ...r, w: clampSize(r.w), d: clampSize(r.d) };
    if (i === main) return { ...stand, ...rect, shape: p.kind, shapeTemplateId: null, parts: null, frontOverride: null, labelOffset: null };
    return createStand(rect, { categoryId: stand.categoryId, color: stand.color, shape: p.kind });
  });
}
