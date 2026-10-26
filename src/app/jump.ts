import { resolveFreeSpace, type FreeSpaceRef } from '../core/freeSpace';
import { pageFree } from '../core/hiddenFree';
import { rectGeo } from '../core/geometry/polygon';
import type { Id, Vec } from '../core/model/types';
import type { Bounds } from '../core/viewport';
import { useStore } from '../state/store';
import { notify } from './notify';

/**
 * Sprung-Links der Start-Page (M6-09, spec.md §7): wechselt auf die Festplatz-Page, zoomt auf das Ziel und lässt
 * es kurz aufleuchten. Gezoomt wird in der Zeichenfläche, sobald sie ihre Größe kennt (`ui.focus`).
 */

function boundsOfPolys(polys: readonly Vec[][]): Bounds | null {
  const pts = polys.flat();
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function go(pageId: Id, flash: Vec[][], selection: Id[] | null) {
  const bounds = boundsOfPolys(flash);
  if (!bounds) return;
  useStore.getState().setUi({
    activePage: pageId,
    tool: 'select',
    selection: selection ? { kind: 'objects', ids: selection } : null,
    focus: { pageId, bounds, flash },
  });
}

export function jumpToStand(pageId: Id, standId: Id): boolean {
  const page = useStore.getState().project.pages.find((p) => p.id === pageId);
  const stand = page?.stands.find((s) => s.id === standId);
  if (!page || !stand) {
    notify('Dieses Geschäft gibt es nicht mehr.', 'error');
    return false;
  }
  // Ausgeblendete oder gesperrte Ebene: zoomen und hervorheben, aber nicht auswählen (wie ein Klick auf den Plan)
  const selectable = page.layers.stands.visible && !page.layers.stands.locked;
  go(pageId, [rectGeo(stand).poly], selectable ? [stand.id] : null);
  return true;
}

/** Sprung zu einem Infrastruktur-Objekt (M7-09); Punkte und Linien mit einem kleinen Rahmen um sich. */
export function jumpToInfra(pageId: Id, objId: Id): boolean {
  const page = useStore.getState().project.pages.find((p) => p.id === pageId);
  const o = page?.infra.find((x) => x.id === objId);
  if (!page || !o) {
    notify('Dieses Objekt gibt es nicht mehr.', 'error');
    return false;
  }
  const r = { ...o, w: Math.max(o.w, 2), d: Math.max(o.d, 2) };
  const selectable = page.layers.infra.visible && !page.layers.infra.locked;
  go(pageId, [rectGeo(r).poly], selectable ? [o.id] : null);
  return true;
}

export function jumpToArea(pageId: Id, areaId: Id): boolean {
  const area = useStore.getState().project.pages.find((p) => p.id === pageId)?.areas.find((a) => a.id === areaId);
  if (!area) return false;
  go(pageId, [rectGeo(area).poly], null);
  return true;
}

/**
 * Löst den Verweis gegen den aktuellen Plan auf (`resolveFreeSpace`, spec.md §4): Hat sich die Freifläche verändert,
 * zeigt der Sprung die passendste derselben Grundfläche; gibt es keine mehr, die Grundfläche mit Hinweis.
 */
export function jumpToFreeSpace(ref: FreeSpaceRef): boolean {
  const { project } = useStore.getState();
  const page = project.pages.find((p) => p.id === ref.pageId);
  if (!page) {
    notify('Diesen Festplatz gibt es nicht mehr.', 'error');
    return false;
  }
  const all = pageFree(page, { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes });
  const free = resolveFreeSpace(all, ref);
  if (free) {
    go(page.id, free.polygons, null);
    return true;
  }
  if (jumpToArea(page.id, ref.areaId)) {
    notify('Diese Freifläche gibt es nicht mehr; angezeigt wird die Grundfläche.');
    return true;
  }
  notify('Diese Freifläche und ihre Grundfläche gibt es nicht mehr.', 'error');
  return false;
}
