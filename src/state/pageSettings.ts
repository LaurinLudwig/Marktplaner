import { LAYER_OF } from '../core/objects';
import { POWER_LIMIT } from '../core/power';
import type { Background, FestplatzPage, Id, LayerId } from '../core/model/types';
import { useStore } from './store';

/** Änderungen an einer Festplatz-Page (Hintergrund, Raster, Norden, Strom). Alle rückgängig machbar. */

export function updatePage(pageId: Id, label: string, fn: (page: FestplatzPage) => void): boolean {
  return useStore.getState().change(label, (p) => {
    const page = p.pages.find((x) => x.id === pageId);
    if (page) fn(page);
  });
}

export function setBackground(pageId: Id, background: Background | null, label: string) {
  updatePage(pageId, label, (page) => {
    page.background = background;
  });
}

export function updateBackground(pageId: Id, label: string, patch: Partial<Background>) {
  updatePage(pageId, label, (page) => {
    if (page.background) Object.assign(page.background, patch);
  });
}

/** Rasterweite: inhaltliche Einstellung, rückgängig machbar. */
export function setGridSize(pageId: Id, size: number) {
  if (!(size > 0)) return;
  updatePage(pageId, 'Rasterweite ändern', (page) => {
    page.grid.size = size;
  });
}

/** Raster ein/aus: Ansichtseinstellung ohne Undo-Schritt und ohne Änderungsmarkierung (QA-M2-05). */
export function setGridVisible(pageId: Id, visible: boolean) {
  useStore.getState().changeView((p) => {
    const page = p.pages.find((x) => x.id === pageId);
    if (page) page.grid.visible = visible;
  });
}

export type SnapKind = 'front' | 'grid' | 'neighbors';

/** Fang-Umschalter: Ansichtseinstellung ohne Undo-Schritt und ohne Änderungsmarkierung (M4-07). */
export function setSnap(kind: SnapKind, on: boolean) {
  useStore.getState().changeView((p) => {
    p.settings.snap[kind] = on;
  });
}

export function setNorthAngle(pageId: Id, angle: number) {
  const a = ((angle % 360) + 360) % 360;
  updatePage(pageId, 'Nordrichtung ändern', (page) => {
    page.northAngle = a;
  });
}

/**
 * Ebene ein-/ausblenden oder sperren: Ansichtseinstellung ohne Undo-Schritt (wie Raster ein/aus).
 * Die Sperre des Hintergrunds ist `background.locked` (E-13) und bleibt wie in M2 rückgängig machbar.
 * Objekte einer ausgeblendeten oder gesperrten Ebene werden aus der Auswahl genommen.
 */
export function setLayer(pageId: Id, layer: LayerId, patch: { visible?: boolean; locked?: boolean }) {
  const s = useStore.getState();
  const page = s.project.pages.find((p) => p.id === pageId);
  if (!page) return;
  if (layer === 'background' && patch.locked !== undefined) {
    if (page.background) updateBackground(pageId, patch.locked ? 'Hintergrund sperren' : 'Hintergrund entsperren', { locked: patch.locked });
    return;
  }
  s.changeView((p) => {
    const pg = p.pages.find((x) => x.id === pageId);
    if (pg) Object.assign(pg.layers[layer], patch);
  });
  const after = useStore.getState();
  const pg = after.project.pages.find((p) => p.id === pageId)!;
  const sel = after.ui.selection;
  if (layer === 'background' && sel?.kind === 'background' && !pg.layers.background.visible) after.setUi({ selection: null });
  if (sel?.kind === 'objects' && after.ui.activePage === pageId) {
    const blocked = (kind: 'area' | 'stand') => !pg.layers[LAYER_OF[kind]].visible || pg.layers[LAYER_OF[kind]].locked;
    const drop = new Set([...(blocked('area') ? pg.areas : []), ...(blocked('stand') ? pg.stands : [])].map((o) => o.id));
    const ids = sel.ids.filter((id) => !drop.has(id));
    if (ids.length !== sel.ids.length) after.setUi({ selection: ids.length ? { kind: 'objects', ids } : null });
  }
}

/** Stromlimit in kW (M5-07); null = kein Limit. Ein Limit unter der aktuellen Summe ist erlaubt (§6). */
export function setPowerLimit(pageId: Id, limitKw: number | null) {
  const v = limitKw === null ? null : Math.round(Math.min(POWER_LIMIT.max, Math.max(POWER_LIMIT.min, limitKw)) * 1000) / 1000;
  updatePage(pageId, v === null ? 'Stromlimit entfernen' : 'Stromlimit ändern', (page) => {
    page.powerLimitKw = v;
  });
}

export function setBlockOverLimit(pageId: Id, on: boolean) {
  updatePage(pageId, on ? 'Überschreitung blockieren' : 'Überschreitung erlauben', (page) => {
    page.blockOverLimit = on;
  });
}
