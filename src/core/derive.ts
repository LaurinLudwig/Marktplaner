/**
 * Sicht auf eine Page während einer Geste: Die Vorschau-Rechtecke (Ziehen, Drehen, Größe ändern)
 * werden eingesetzt, ohne das Projekt zu ändern. Zeichenfläche, Steuerungsleiste und ab M4 die
 * Freiflächen und Warnungen lesen nur diese Sicht und rechnen so live mit.
 */
import type { Area, FestplatzPage, Id, InfraObject, Rect, Stand } from './model/types';

export interface Preview {
  pageId: Id;
  rects: Record<Id, Rect>;
  /** Zusätzliche Objekte, z. B. die Kopien bei Alt+Ziehen (M4-12). */
  added?: { areas: Area[]; stands: Stand[]; infra: InfraObject[] };
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
  const stands = apply(page.stands, preview.rects);
  const infra = apply(page.infra, preview.rects);
  const add = preview.added;
  return {
    ...page,
    areas: add?.areas.length ? [...areas, ...add.areas] : areas,
    stands: add?.stands.length ? [...stands, ...add.stands] : stands,
    infra: add?.infra.length ? [...infra, ...add.infra] : infra,
  };
}
