import { boundsOfRects, fromLocal, handlePoint, rectEdge, RESIZE_HANDLES, type Handle } from '../../../core/geometry/rect';
import { lineEnds } from '../../../core/infra';
import type { EdgeIndex, FestplatzPage, Id, InfraGeometry, Vec, View } from '../../../core/model/types';
import { findObjects, type PageObject } from '../../../core/objects';
import { closestPointOnSegment } from '../../../core/snap';
import { groupCenter } from '../../../core/transform';
import { worldToScreen } from '../../../core/viewport';

/** Abstand des Drehgriffs von der Oberkante in Bildschirmpixeln. */
export const ROTATE_OFFSET = 24;
/** Trefferradius der Griffe und Kanten in Bildschirmpixeln. */
export const HANDLE_HIT = 7;

/**
 * Griffe der Auswahl in Bildschirmkoordinaten. Eine Quelle für Darstellung (SelectionOverlay) und
 * Treffertest (useSelectTool), damit beide immer übereinstimmen.
 */
export interface SelectionGeometry {
  objects: PageObject[];
  /** Drehpunkt in Weltkoordinaten: Mittelpunkt bzw. Mitte der Auswahl. */
  pivot: Vec;
  rotateBase: Vec;
  /** null: kein Drehgriff (einzelner Marker, M7). */
  rotateHandle: Vec | null;
  /** Größenänderung, nur bei genau einer ausgewählten Grundfläche. */
  resize: { handle: Handle; p: Vec }[];
  /** Kanten, die Vorderseite werden können (nur einzelne Grundfläche, ohne die aktuelle). */
  edges: { edge: EdgeIndex; a: Vec; b: Vec }[];
  /** Endpunkt-Griffe einer einzelnen Linie (Infrastruktur, M7); `world` in Metern. */
  ends: { end: 0 | 1; p: Vec; world: Vec }[];
}

export function selectionGeometry(page: FestplatzPage, ids: readonly Id[], view: View, geometryOf?: (typeId: Id) => InfraGeometry | undefined): SelectionGeometry | null {
  const objects = findObjects(page, ids);
  if (!objects.length) return null;
  const rects = objects.map((o) => o.obj);
  const pivot = groupCenter(rects)!;
  const s = (p: Vec) => worldToScreen(view, p);
  let rotateBase: Vec;
  let rotateHandle: Vec;
  if (objects.length === 1) {
    const r = rects[0]!;
    const top = s(fromLocal(r, { x: 0, y: -r.d / 2 }));
    const c = s({ x: r.cx, y: r.cy });
    const len = Math.hypot(top.x - c.x, top.y - c.y);
    const rad = (r.rot * Math.PI) / 180;
    const dir = len > 0.5 ? { x: (top.x - c.x) / len, y: (top.y - c.y) / len } : { x: Math.sin(rad), y: -Math.cos(rad) };
    rotateBase = top;
    rotateHandle = { x: top.x + dir.x * ROTATE_OFFSET, y: top.y + dir.y * ROTATE_OFFSET };
  } else {
    const b = boundsOfRects(rects)!;
    rotateBase = s({ x: (b.minX + b.maxX) / 2, y: b.minY });
    rotateHandle = { x: rotateBase.x, y: rotateBase.y - ROTATE_OFFSET };
  }
  const single = objects.length === 1 && objects[0]!.kind === 'area' ? objects[0]!.obj : null;
  const only = objects.length === 1 ? objects[0]! : null;
  const geometry = only?.kind === 'infra' ? geometryOf?.(only.obj.typeId) : undefined;
  return {
    objects,
    pivot,
    rotateBase,
    rotateHandle: geometry === 'point' ? null : rotateHandle,
    ends: geometry === 'line' && only ? lineEnds(only.obj).map((w, i) => ({ end: i as 0 | 1, p: s(w), world: w })) : [],
    resize: single ? RESIZE_HANDLES.map((handle) => ({ handle, p: s(handlePoint(single, handle)) })) : [],
    edges: single
      ? ([0, 1, 3] as const).map((edge) => {
          const [a, b] = rectEdge(single, edge);
          return { edge, a: s(a), b: s(b) };
        })
      : [],
  };
}

export type HandleHit = { kind: 'rotate' } | { kind: 'resize'; handle: Handle } | { kind: 'edge'; edge: EdgeIndex } | { kind: 'end'; end: 0 | 1 };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Welcher Griff liegt unter dem Bildschirmpunkt? Reihenfolge: Endpunkte, Drehgriff, Größe, Kanten. */
export function hitHandle(g: SelectionGeometry | null, p: Vec): HandleHit | null {
  if (!g) return null;
  for (const e of g.ends) if (dist(e.p, p) <= HANDLE_HIT) return { kind: 'end', end: e.end };
  if (g.rotateHandle && dist(g.rotateHandle, p) <= HANDLE_HIT) return { kind: 'rotate' };
  // Liegen Griffe übereinander (sehr kleine Fläche auf dem Bildschirm), gewinnt der nächstgelegene
  let best: { handle: Handle; d: number } | null = null;
  for (const r of g.resize) {
    const d = dist(r.p, p);
    if (d <= HANDLE_HIT && (!best || d < best.d)) best = { handle: r.handle, d };
  }
  if (best) return { kind: 'resize', handle: best.handle };
  for (const e of g.edges) if (dist(closestPointOnSegment(p, e.a, e.b), p) <= HANDLE_HIT - 1) return { kind: 'edge', edge: e.edge };
  return null;
}

/** CSS-Mauszeiger für einen Größengriff, passend zur Drehung auf dem Bildschirm. */
export function resizeCursor(g: SelectionGeometry, handle: Handle): string {
  const r = g.objects[0]!.obj;
  const ang = (((Math.atan2(handle.hy, handle.hx) * 180) / Math.PI + r.rot) % 180 + 180) % 180;
  const idx = Math.round(ang / 45) % 4;
  return ['cursor-ew', 'cursor-nwse', 'cursor-ns', 'cursor-nesw'][idx]!;
}
