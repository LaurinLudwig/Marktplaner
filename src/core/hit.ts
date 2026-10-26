/**
 * Treffertest und Rechteckauswahl auf einer Page (M3). Nur Objekte auf sichtbaren, nicht gesperrten
 * Ebenen sind auswählbar. Infrastruktur liegt über Ständen, Stände über Grundflächen; innerhalb einer Art
 * gewinnt das zuletzt gezeichnete Objekt (Array-Ende).
 */
import { pointInRect, rectInBounds } from './geometry/rect';
import { hitInfra } from './infra';
import type { FestplatzPage, Id, InfraGeometry, Vec } from './model/types';
import { selectable, type ObjectKind } from './objects';
import type { Bounds } from './viewport';

/** Toleranzen in Metern für schmale Objekte: Linien (zusätzlich zur halben Stärke) und Punkte (Radius). */
export interface PickTolerance {
  line: number;
  point: number;
}

export function pickObject(
  page: FestplatzPage,
  p: Vec,
  tol = 0,
  infra?: { geometry: (typeId: Id) => InfraGeometry | undefined; tol: PickTolerance },
): { kind: ObjectKind; id: Id } | null {
  if (infra && selectable(page, 'infra')) {
    const t = { rect: tol, line: Math.max(tol, infra.tol.line), point: Math.max(tol, infra.tol.point) };
    for (let i = page.infra.length - 1; i >= 0; i--) {
      const o = page.infra[i]!;
      const g = infra.geometry(o.typeId);
      if (g && hitInfra(o, g, p, t)) return { kind: 'infra', id: o.id };
    }
  }
  if (selectable(page, 'stand')) {
    for (let i = page.stands.length - 1; i >= 0; i--) {
      const s = page.stands[i]!;
      if (pointInRect(s, p, tol)) return { kind: 'stand', id: s.id };
    }
  }
  if (selectable(page, 'area')) {
    for (let i = page.areas.length - 1; i >= 0; i--) {
      const a = page.areas[i]!;
      if (pointInRect(a, p, tol)) return { kind: 'area', id: a.id };
    }
  }
  return null;
}

/** IDs aller auswählbaren Objekte, die vollständig im Bereich liegen. */
export function objectsInBounds(page: FestplatzPage, b: Bounds): Id[] {
  const out: Id[] = [];
  if (selectable(page, 'area')) for (const a of page.areas) if (rectInBounds(a, b)) out.push(a.id);
  if (selectable(page, 'stand')) for (const s of page.stands) if (rectInBounds(s, b)) out.push(s.id);
  if (selectable(page, 'infra')) for (const o of page.infra) if (rectInBounds(o, b)) out.push(o.id);
  return out;
}

/** IDs aller auswählbaren Objekte der Page (Alles auswählen). */
export function allSelectable(page: FestplatzPage): Id[] {
  return [
    ...(selectable(page, 'area') ? page.areas.map((a) => a.id) : []),
    ...(selectable(page, 'stand') ? page.stands.map((s) => s.id) : []),
    ...(selectable(page, 'infra') ? page.infra.map((o) => o.id) : []),
  ];
}
