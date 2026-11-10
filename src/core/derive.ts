/**
 * Sicht auf eine Page während einer Geste: Die Vorschau-Rechtecke (Ziehen, Drehen, Größe ändern)
 * werden eingesetzt, ohne das Projekt zu ändern. Zeichenfläche, Steuerungsleiste und ab M4 die
 * Freiflächen und Warnungen lesen nur diese Sicht und rechnen so live mit.
 */
import type { Area, FestplatzPage, Id, InfraObject, Rect, ShapePart, Stand, Vec } from './model/types';

export interface Preview {
  pageId: Id;
  rects: Record<Id, Rect>;
  /** Eigene Form eines Stands während einer Geste an einem Teil (#16); das Hüllrechteck steht in `rects`. */
  parts?: Record<Id, ShapePart[]>;
  /** Zusätzliche Objekte, z. B. die Kopien bei Alt+Ziehen (M4-12). */
  added?: { areas: Area[]; stands: Stand[]; infra: InfraObject[] };
  /** Von Hand verschobene Beschriftungen während einer Geste (Werkzeug „Ausrichten“ dreht sie mit, #26). */
  labelOffsets?: Record<Id, Vec>;
}

const apply = <T extends Rect & { id: Id }>(list: T[], rects: Record<Id, Rect>): T[] => {
  if (!list.some((o) => rects[o.id])) return list;
  return list.map((o) => {
    const r = rects[o.id];
    return r ? { ...o, cx: r.cx, cy: r.cy, w: r.w, d: r.d, rot: r.rot } : o;
  });
};

/** Page mit eingesetzter Vorschau; unveränderte Objekte behalten ihre Identität (wichtig für memo). */
export function effectivePage(page: FestplatzPage, preview: Preview | null): FestplatzPage {
  if (!preview || preview.pageId !== page.id) return page;
  const areas = apply(page.areas, preview.rects);
  const partsOf = preview.parts;
  const offsets = preview.labelOffsets;
  let stands = partsOf ? apply(page.stands, preview.rects).map((s) => (partsOf[s.id] ? { ...s, parts: partsOf[s.id]! } : s)) : apply(page.stands, preview.rects);
  if (offsets) stands = stands.map((s) => (offsets[s.id] ? { ...s, labelOffset: offsets[s.id]! } : s));
  const infra = apply(page.infra, preview.rects);
  const add = preview.added;
  return {
    ...page,
    areas: add?.areas.length ? [...areas, ...add.areas] : areas,
    stands: add?.stands.length ? [...stands, ...add.stands] : stands,
    infra: add?.infra.length ? [...infra, ...add.infra] : infra,
  };
}
