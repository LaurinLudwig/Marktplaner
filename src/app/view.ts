import { bgCorners } from '../core/background';
import { boundsOfRects } from '../core/geometry/rect';
import type { FestplatzPage, Project, View } from '../core/model/types';
import { pagePaper } from '../core/paper';
import { mmToM } from '../core/sheet';
import { defaultView, fitBounds, zoomAt, type Bounds } from '../core/viewport';
import { START_PAGE, useStore } from '../state/store';

/** Ansicht der aktiven Page (Standardansicht, falls noch keine gesetzt ist). */
export function currentView(): View | null {
  const s = useStore.getState();
  const id = s.ui.activePage;
  if (id === START_PAGE) return null;
  const { w, h } = s.ui.viewport;
  return s.views[id] ?? defaultView(w, h);
}

function activePage(): FestplatzPage | null {
  const s = useStore.getState();
  return s.project.pages.find((p) => p.id === s.ui.activePage) ?? null;
}

/** Sichtbarer Ausschnitt der aktiven Page in Weltkoordinaten. */
export function visibleBounds(): Bounds | null {
  const v = currentView();
  if (!v) return null;
  const { w, h } = useStore.getState().ui.viewport;
  return { minX: -v.tx / v.scale, minY: -v.ty / v.scale, maxX: (w - v.tx) / v.scale, maxY: (h - v.ty) / v.scale };
}

/** Zoomt um die Mitte der Zeichenfläche. */
export function zoomBy(factor: number) {
  const page = activePage();
  const v = currentView();
  if (!page || !v) return;
  const { w, h } = useStore.getState().ui.viewport;
  useStore.getState().setView(page.id, zoomAt(v, factor, { x: w / 2, y: h / 2 }));
}

/** Hüllrechteck aller Objekte und des Hintergrundplans (sichtbare Ebene) einer Page. */
export function pageBounds(page: FestplatzPage): Bounds | null {
  const objects = boundsOfRects([...page.areas, ...page.stands, ...page.infra]);
  const bg = page.background && page.layers.background.visible ? bgCorners(page.background.transform, page.background.pxSize) : [];
  if (!bg.length) return objects;
  const xs = bg.map((p) => p.x);
  const ys = bg.map((p) => p.y);
  const b: Bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  if (!objects) return b;
  return {
    minX: Math.min(b.minX, objects.minX),
    minY: Math.min(b.minY, objects.minY),
    maxX: Math.max(b.maxX, objects.maxX),
    maxY: Math.max(b.maxY, objects.maxY),
  };
}

/** Passt Objekte und Hintergrund der Page ins Fenster; leere Page → Standardansicht um den Ursprung. */
export function fitView() {
  const page = activePage();
  if (!page) return;
  const s = useStore.getState();
  const { w, h } = s.ui.viewport;
  s.setView(page.id, fitBounds(withSheet(page, s.project, pageBounds(page)), w, h));
}

/** Höhe der Blattmarke „A1 quer · 1:500“ über dem Rahmen in mm (PaperLayer: 4 mm Schrift, 2 mm Abstand). */
const SHEET_LABEL_MM = 7;

/**
 * „An Fenster anpassen“ (M8-Nacharbeit, Layout): zusätzlich das ganze Blatt mit Marke und Papier-Elementen, solange
 * die Ebene „Blatt“ sichtbar ist. Eine leere Page bleibt bei der Standardansicht.
 */
function withSheet(page: FestplatzPage, project: Project, b: Bounds | null): Bounds | null {
  if (!b || !page.layers.sheet.visible) return b;
  const f = pagePaper(page, project).frame;
  const label = mmToM(SHEET_LABEL_MM, f.scale);
  return {
    minX: Math.min(b.minX, f.bounds.minX),
    minY: Math.min(b.minY, f.bounds.minY - label),
    maxX: Math.max(b.maxX, f.bounds.maxX),
    maxY: Math.max(b.maxY, f.bounds.maxY),
  };
}
