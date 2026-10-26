import { useMemo } from 'react';
import { effectivePage } from '../../core/derive';
import { INFRA_LIMITS, PASSAGE_TYPE_ID } from '../../core/infra';
import type { FestplatzPage, Id, InfraGeometry, InfraTypeDef } from '../../core/model/types';
import { findObjects, LIMITS, type PageObject } from '../../core/objects';
import { useStore } from '../../state/store';

export interface SelectionInfo {
  page: FestplatzPage;
  objects: PageObject[];
}

/**
 * Ausgewählte Objekte der aktiven Page, mit eingesetzter Vorschau: Steuerungs- und Seitenleiste
 * zeigen beim Ziehen und Drehen die Werte live an.
 */
export function useSelectedObjects(): SelectionInfo | null {
  const stored = useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePage) ?? null);
  const preview = useStore((s) => s.preview);
  const selection = useStore((s) => s.ui.selection);
  return useMemo(() => {
    if (!stored || selection?.kind !== 'objects') return null;
    const page = effectivePage(stored, preview);
    const objects = findObjects(page, selection.ids);
    return objects.length ? { page, objects } : null;
  }, [stored, preview, selection]);
}

/** Gemeinsamer Wert oder null, wenn die Werte verschieden sind (Mehrfachauswahl: leeres Feld). */
export function common<T>(values: readonly T[]): T | null {
  if (!values.length) return null;
  const first = values[0]!;
  return values.every((v) => v === first) ? first : null;
}

/** Bezeichnung der Auswahl: „Geschäft“, „Grundfläche“, der Typ eines Infrastruktur-Objekts oder eine Aufzählung. */
export function selectionTitle(objects: readonly PageObject[], types?: ReadonlyMap<Id, InfraTypeDef>): string {
  if (objects.length === 1) {
    const o = objects[0]!;
    return o.kind === 'area' ? 'Grundfläche' : o.kind === 'stand' ? 'Geschäft' : (types?.get(o.obj.typeId)?.label ?? 'Infrastruktur');
  }
  const a = objects.filter((o) => o.kind === 'area').length;
  const s = objects.filter((o) => o.kind === 'stand').length;
  const i = objects.length - a - s;
  const parts = [a ? `${a} ${a === 1 ? 'Grundfläche' : 'Grundflächen'}` : '', s ? `${s} ${s === 1 ? 'Geschäft' : 'Geschäfte'}` : '', i ? `${i} Infrastruktur` : ''].filter(Boolean);
  return parts.join(', ');
}

export interface DimField {
  label: string;
  min: number;
  max: number;
}

/** Maßfelder der Auswahl (Steuerungs- und Seitenleiste): Beschriftung und Grenzen je Objektart und Geometrie (M7). */
export interface DimSpec {
  w: DimField | null;
  d: DimField | null;
  rot: boolean;
}

export function dimSpec(objects: readonly PageObject[], geometryOf: (typeId: Id) => InfraGeometry | undefined): DimSpec {
  const infra = objects.filter((o) => o.kind === 'infra');
  if (infra.length === objects.length && infra.length) {
    const geos = new Set(infra.map((o) => geometryOf(o.obj.typeId) ?? 'rect'));
    if (geos.has('point')) return { w: null, d: null, rot: geos.size > 1 };
    if (geos.size === 1 && geos.has('line')) {
      const passages = infra.every((o) => o.obj.typeId === PASSAGE_TYPE_ID);
      return {
        w: { label: passages ? 'Lichte Breite' : 'Länge', ...INFRA_LIMITS.line.w },
        d: passages ? null : { label: 'Stärke', ...INFRA_LIMITS.line.d },
        rot: true,
      };
    }
    const lim = geos.size === 1 ? INFRA_LIMITS.rect : { w: { min: 0.5, max: 2000 }, d: { min: 0, max: 2000 } };
    return { w: { label: 'Breite', ...lim.w }, d: { label: 'Tiefe', ...lim.d }, rot: true };
  }
  const onlyStands = objects.every((o) => o.kind === 'stand');
  const min = onlyStands ? LIMITS.stand.min : infra.length ? 0 : LIMITS.area.min;
  const max = objects.some((o) => o.kind !== 'stand') ? LIMITS.area.max : LIMITS.stand.max;
  return { w: { label: 'Breite', min, max }, d: { label: 'Tiefe', min, max }, rot: true };
}
