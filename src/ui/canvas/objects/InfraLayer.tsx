import { memo } from 'react';
import type { Id, InfraObject, InfraTypeDef } from '../../../core/model/types';
import { infraLabelPrim, infraPrims } from '../../../core/scene/objects';
import { CM, PrimView, Prims } from '../scene/Prim';

/**
 * Infrastruktur-Objekte in Weltkoordinaten (M7, spec.md §11). Wie ObjectsLayer ohne Ansicht als Prop:
 * Linienstärken auf dem Bildschirm kommen über `vector-effect: non-scaling-stroke` (CSS).
 *
 * - Rechteck: in Typfarbe getönt, mit Rand und Symbol in der Mitte.
 * - Linie: Typfarbe in ihrer Stärke, dazu eine Haarlinie (mindestens 2 px); mobile Sperre gestrichelt.
 * - Enge Durchfahrt: Maßlinie mit Endstrichen; die lichte Breite steht in der Beschriftung.
 * - Punkt (Marker): Symbol mit der Spitze auf dem Punkt.
 */
interface Props {
  infra: InfraObject[];
  types: ReadonlyMap<Id, InfraTypeDef>;
  selected: ReadonlySet<Id>;
  fontSize: number;
  markerSize: number;
  /** Objekte mit aktiver Warnung („Durchfahrt zu eng“). */
  warn: ReadonlySet<Id>;
}

export const InfraList = memo(function InfraList({ infra, types, selected, fontSize, markerSize, warn }: Props) {
  return infra.map((o) => {
    const t = types.get(o.typeId);
    return t ? <InfraShape key={o.id} obj={o} type={t} selected={selected.has(o.id)} fontSize={fontSize} markerSize={markerSize} warn={warn.has(o.id)} /> : null;
  });
});

const InfraShape = memo(function InfraShape({ obj: o, type: t, selected, fontSize, markerSize, warn }: { obj: InfraObject; type: InfraTypeDef; selected: boolean; fontSize: number; markerSize: number; warn: boolean }) {
  const cls = `infra infra-${t.geometry}${selected ? ' selected' : ''}${warn ? ' warn-narrow' : ''}`;
  return (
    <g className={cls} data-id={o.id} data-type={t.id} style={{ color: t.color }}>
      <Prims prims={infraPrims(o, t, fontSize, markerSize, warn)} />
    </g>
  );
});

/**
 * Beschriftung der Infrastruktur (Ebene „Beschriftung“, Gruppe in Zentimetern): horizontal; Rechtecke unter dem
 * Symbol, Linien über der Mitte, Marker rechts neben dem Symbol.
 */
export const InfraLabelList = memo(function InfraLabelList({ infra, types, fontSize, markerSize }: { infra: InfraObject[]; types: ReadonlyMap<Id, InfraTypeDef>; fontSize: number; markerSize: number }) {
  return infra.map((o) => {
    const t = types.get(o.typeId);
    const p = t && infraLabelPrim(o, t, fontSize, markerSize);
    return p ? <PrimView key={o.id} p={p} unit={CM} data-id={o.id} /> : null;
  });
});
