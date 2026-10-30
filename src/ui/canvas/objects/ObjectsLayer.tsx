import { memo, useMemo } from 'react';
import type { AreaFreeSpaces, FreeSpace } from '../../../core/freeSpace';
import type { Area, Category, FestplatzPage, Id, InfraTypeDef, ShapeTemplate, Stand, Vec } from '../../../core/model/types';
import { resolveStandColor } from '../../../core/objects';
import { isShaped, templateOf } from '../../../core/shape';
import type { Bounds } from '../../../core/viewport';
import { areaLabelPrim, areaPrims, freeLabelPrim, freePrims, overlapPrim, standHitboxPrim, standLabelPrim, standPrims, warnIconPrims, warnKind, type WarnKind } from '../../../core/scene/objects';
import { dilateRect } from '../../../core/geometry/polygon';
import { activeWarnings, type DistanceWarnings, type PageWarnings, type WarnSettings } from '../../../core/warnings';
import { CM, PrimView, Prims } from '../scene/Prim';
import { InfraLabelList, InfraList } from './InfraLayer';

/**
 * Grundflächen, Geschäfte und Beschriftung in Weltkoordinaten (Meter).
 *
 * Leistung (Abnahme: 500 Stände, ≥ 50 Bilder/s): Die Ebene bekommt die Ansicht NICHT als Prop.
 * Zoomen und Verschieben ändern nur das transform der umgebenden Gruppe; hier wird dann nichts neu
 * gerendert. Jedes Objekt ist memo; Immer teilt unveränderte Objekte, also rendern beim Ziehen nur
 * die bewegten neu.
 *
 * Reihenfolge der Ebenen: Grundflächen → Freiflächen → Geschäfte → Infrastruktur (M7) →
 * Warnsymbole → Beschriftung (oberste Ebene).
 *
 * Geometrie und Text kommen aus den Bausteinen der gemeinsamen Szene (core/scene, M8); dieselben Bausteine
 * zeichnet der PDF-Export.
 *
 * Freiflächen (M4) kommen aus einem Zwischenspeicher (core/freeSpace.ts): Das Ergebnis einer
 * Grundfläche behält seine Identität, solange sie nicht neu berechnet wurde; die memo-Komponenten
 * je Grundfläche zeichnen dann nicht neu.
 */
interface Props {
  page: FestplatzPage;
  categories: Category[];
  /** Formvorlagen der Stände (M12). */
  shapeTemplates: ShapeTemplate[];
  /** Farbe der Stände ohne eigene Farbe und Kategorie (Projekteinstellung, #3). */
  defaultColor: string;
  template: string;
  /** Schriftgröße der Beschriftung in Metern. */
  fontSize: number;
  selected: ReadonlySet<Id>;
  /** Beschriftung ist auf dem Bildschirm kleiner als lesbar: per CSS ausblenden, ohne neu zu rendern. */
  labelsTiny: boolean;
  /**
   * Heller Rand um die Schrift (bessere Lesbarkeit auf dunklem Grund). Teuer zu zeichnen (WebKit:
   * 500 Beschriftungen mit Rand ≈ 33 statt 60 Bilder/s), deshalb erst ab lesbarer Größe, wenn ohnehin
   * nur ein Ausschnitt des Plans im Bild ist.
   */
  labelHalo: boolean;
  free: readonly AreaFreeSpaces[];
  /** Linienabstand der Schraffur in Metern. */
  hatchSpacing: number;
  /** Freiflächen-Beschriftung zu klein zum Lesen: ausblenden (siehe Canvas.tsx). */
  freeLabelsTiny: boolean;
  /** Nur Freiflächen-Beschriftungen in diesem Bereich zeichnen (siehe Canvas.tsx `labelWindow`). */
  freeLabelWindow: Bounds;
  warnings: PageWarnings;
  /** Stände ohne Vorschau (gespeichert); bleibt während einer Geste dieselbe Liste. */
  baseStands: Stand[];
  /** Objekte, die die laufende Geste bewegt (bzw. Kopien bei Alt+Ziehen). */
  movingIds: ReadonlySet<Id>;
  warnSettings: WarnSettings;
  /** Stände mit doppelter Nummer (M5-10, numbering.ts). */
  duplicates: ReadonlyMap<Id, unknown>;
  /** Infrastruktur-Typen nach ID (M7). */
  infraTypes: ReadonlyMap<Id, InfraTypeDef>;
  /** Symbolgröße der Marker in Metern. */
  markerSize: number;
  /** Stände in Objekten mit „freihalten“ (Rohdaten) und Objekte mit angezeigter Warnung „Durchfahrt zu eng“ (M7). */
  infraWarnStands: ReadonlySet<Id>;
  infraWarnObjects: ReadonlySet<Id>;
  /** Zu nahe Stände gleicher Kategorie (Rohdaten, #3). */
  distanceWarnings: DistanceWarnings;
}



export const ObjectsLayer = memo(function ObjectsLayer({
  page,
  categories,
  shapeTemplates,
  defaultColor,
  template,
  fontSize,
  selected,
  labelsTiny,
  labelHalo,
  free,
  hatchSpacing,
  freeLabelsTiny,
  freeLabelWindow,
  warnings,
  baseStands,
  movingIds,
  warnSettings,
  duplicates,
  infraTypes,
  markerSize,
  infraWarnStands,
  infraWarnObjects,
  distanceWarnings,
}: Props) {
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tplById = useMemo(() => new Map(shapeTemplates.map((t) => [t.id, t])), [shapeTemplates]);
  const L = page.layers;
  // Leistung beim Ziehen (QA-M4-03): Unbewegte Stände kommen aus der gespeicherten Liste, die während der
  // Geste gleich bleibt; ihre Listen rendern dann nicht neu. Nur die bewegten Stände werden pro Bild gezeichnet.
  const unmoved = useMemo(() => baseStands.filter((s) => !movingIds.has(s.id)), [movingIds, baseStands]);
  const staticStands = movingIds.size ? unmoved : page.stands;
  const movingStands = movingIds.size ? page.stands.filter((s) => movingIds.has(s.id)) : NO_STANDS;
  const kindOf = (s: Stand): WarnKind =>
    warnKind(activeWarnings(warnings.byStand.get(s.id), s, warnSettings, duplicates.has(s.id), infraWarnStands.has(s.id), distanceWarnings.has(s.id)));
  // Warnungen der unbewegten Stände: nur eine neue Map, wenn sich eine Warnung wirklich ändert
  const kindsKey = staticStands.map((s) => kindOf(s) ?? '').join(',');
  const staticKinds = useMemo(() => {
    const k = kindsKey.split(',');
    return new Map(staticStands.map((s, i) => [s.id, (k[i] || null) as WarnKind]));
  }, [staticStands, kindsKey]);
  const movingKinds = new Map(movingStands.map((s) => [s.id, kindOf(s)]));
  const warnKinds = movingStands.length ? new Map([...staticKinds, ...movingKinds]) : staticKinds;
  const freeVisible = L.free.visible && L.areas.visible;
  // Leistung (QA-M4-03): Die Listen sind eigene memo-Komponenten. Ändert sich beim Zoomen nur eine
  // Schwelle (Schriftgröße, Schraffurabstand, Beschriftungsbereich), rendert nur die betroffene Liste
  // neu, nicht 500 Stände.
  return (
    <>
      {L.areas.visible && (
        <g className={`layer-areas${L.areas.locked ? ' locked' : ''}`}>
          <AreaList areas={page.areas} selected={selected} />
        </g>
      )}
      {freeVisible && (
        <g className="layer-free">
          <FreeList free={free} spacing={hatchSpacing} />
        </g>
      )}
      {L.stands.visible && (
        <g className={`layer-stands${L.stands.locked ? ' locked' : ''}`}>
          <StandList stands={staticStands} catById={catById} tplById={tplById} defaultColor={defaultColor} selected={selected} warnKinds={staticKinds} />
          {movingStands.length > 0 && <StandList stands={movingStands} catById={catById} tplById={tplById} defaultColor={defaultColor} selected={selected} warnKinds={movingKinds} />}
        </g>
      )}
      {L.infra.visible && (
        <g className={`layer-infra${L.infra.locked ? ' locked' : ''}`}>
          <InfraList infra={page.infra} types={infraTypes} selected={selected} fontSize={fontSize} markerSize={markerSize} warn={infraWarnObjects} />
        </g>
      )}
      <g className={`layer-warnings${labelsTiny ? ' tiny' : ''}`}>
        {L.stands.visible && <OverlapRegions regions={warnings.regions} warnKinds={warnKinds} />}
        {L.stands.visible && warnSettings.warnDistance && <DistanceZones stands={page.stands} selected={selected} catById={catById} conflicts={distanceWarnings} />}
        {L.stands.visible && <WarnIcons stands={staticStands} warnKinds={staticKinds} size={fontSize * 1.3} />}
        {L.stands.visible && movingStands.length > 0 && <WarnIcons stands={movingStands} warnKinds={movingKinds} size={fontSize * 1.3} />}
      </g>
      {L.labels.visible && (
        <g className={`layer-labels${labelsTiny ? ' tiny' : ''}${labelHalo ? ' halo' : ''}`} transform={`scale(${1 / CM})`} fontSize={fontSize * CM} strokeWidth={fontSize * CM * 0.22}>
          {L.areas.visible && <AreaLabelList areas={page.areas} fontSize={fontSize} />}
          {freeVisible && !freeLabelsTiny && <FreeLabelList free={free} fontSize={fontSize} window={freeLabelWindow} />}
          {L.stands.visible && <StandLabelList stands={staticStands} template={template} fontSize={fontSize} catById={catById} />}
          {L.stands.visible && movingStands.length > 0 && <StandLabelList stands={movingStands} template={template} fontSize={fontSize} catById={catById} />}
          {L.infra.visible && <InfraLabelList infra={page.infra} types={infraTypes} fontSize={fontSize} markerSize={markerSize} />}
        </g>
      )}
    </>
  );
});

const NO_STANDS: Stand[] = [];

/**
 * Konkurrenzschutz (#3): Um jeden ausgewählten Stand einer Kategorie mit Mindestabstand dessen Umriss (Rechteck um den
 * Mindestabstand aufgeweitet, Ecken gerundet) und eine Linie zu jedem zu nahen Stand derselben Kategorie.
 */
function DistanceZones({ stands, selected, catById, conflicts }: { stands: Stand[]; selected: ReadonlySet<Id>; catById: Map<Id, Category>; conflicts: DistanceWarnings }) {
  if (!selected.size) return null;
  return stands.map((s) => {
    const min = selected.has(s.id) && s.categoryId ? catById.get(s.categoryId)?.minDistance : null;
    if (!min) return null;
    const zone = dilateRect(s, min);
    return (
      <g key={s.id} className="distance-zone" data-testid="distance-zone">
        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(' ')} />
        {conflicts.get(s.id)?.map((c) => <line key={c.id} className="distance-line" data-testid="distance-line" x1={c.from.x} y1={c.from.y} x2={c.to.x} y2={c.to.y} />)}
      </g>
    );
  });
}

const AreaList = memo(function AreaList({ areas, selected }: { areas: Area[]; selected: ReadonlySet<Id> }) {
  return areas.map((a) => <AreaShape key={a.id} area={a} selected={selected.has(a.id)} />);
});

const FreeList = memo(function FreeList({ free, spacing }: { free: readonly AreaFreeSpaces[]; spacing: number }) {
  return free.map((r) => <FreeArea key={r.areaId} result={r} spacing={spacing} />);
});

const StandList = memo(function StandList({
  stands,
  catById,
  tplById,
  defaultColor,
  selected,
  warnKinds,
}: {
  stands: Stand[];
  catById: Map<Id, Category>;
  tplById: Map<Id, ShapeTemplate>;
  defaultColor: string;
  selected: ReadonlySet<Id>;
  warnKinds: Map<Id, WarnKind>;
}) {
  return stands.map((s) => {
    const cat = s.categoryId ? catById.get(s.categoryId) : undefined;
    return (
      <StandShape key={s.id} stand={s} template={templateOf(s, tplById)} color={resolveStandColor(s, cat, defaultColor)} selected={selected.has(s.id)} warn={warnKinds.get(s.id) ?? null} />
    );
  });
});

const OverlapRegions = memo(function OverlapRegions({ regions, warnKinds }: { regions: PageWarnings['regions']; warnKinds: Map<Id, WarnKind> }) {
  return regions
    .filter((r) => warnKinds.get(r.a) === 'overlap' || warnKinds.get(r.b) === 'overlap')
    .map((r) => <PrimView key={`${r.a}|${r.b}`} p={overlapPrim(r.polygon)} />);
});

const WarnIcons = memo(function WarnIcons({ stands, warnKinds, size }: { stands: Stand[]; warnKinds: Map<Id, WarnKind>; size: number }) {
  return stands.filter((s) => warnKinds.get(s.id)).map((s) => <WarnIcon key={s.id} stand={s} kind={warnKinds.get(s.id)!} size={size} />);
});

const AreaLabelList = memo(function AreaLabelList({ areas, fontSize }: { areas: Area[]; fontSize: number }) {
  return areas.map((a) => <AreaLabel key={a.id} area={a} fontSize={fontSize} />);
});

const FreeLabelList = memo(function FreeLabelList({ free, fontSize, window: win }: { free: readonly AreaFreeSpaces[]; fontSize: number; window: Bounds }) {
  return free.map((r) => <FreeLabels key={r.areaId} result={r} fontSize={fontSize} window={win} />);
});

const StandLabelList = memo(function StandLabelList({ stands, template, fontSize, catById }: { stands: Stand[]; template: string; fontSize: number; catById: Map<Id, Category> }) {
  return stands.map((s) => <StandLabel key={s.id} stand={s} template={template} fontSize={fontSize} categoryName={(s.categoryId && catById.get(s.categoryId)?.name) || ''} />);
});

const AreaShape = memo(function AreaShape({ area, selected }: { area: Area; selected: boolean }) {
  const [body, front] = areaPrims(area);
  return (
    <g className={`area${selected ? ' selected' : ''}`} data-id={area.id}>
      <PrimView p={body} />
      <PrimView p={front} />
    </g>
  );
});

/**
 * Stand in seiner Form (M12). Rechteck und Kreis/Oval sind ein Element `.stand`; eine zusammengesetzte Form ist eine
 * Gruppe `.stand-group` aus Füllung und äußerer Kontur. Ausgewählte Stände mit Form zeigen die Hitbox gestrichelt.
 */
const StandShape = memo(function StandShape({
  stand,
  template,
  color,
  selected,
  warn,
}: {
  stand: Stand;
  template: ShapeTemplate | undefined;
  color: string;
  selected: boolean;
  warn: WarnKind;
}) {
  const prims = standPrims(stand, color, warn, template);
  const hitbox = selected && isShaped(stand, template) ? <PrimView p={standHitboxPrim(stand)} /> : null;
  const sel = selected ? 'selected' : undefined;
  if (prims.length === 1)
    return (
      <>
        <PrimView p={prims[0]!} className={sel} data-id={stand.id} data-warning={warn ?? undefined} />
        {hitbox}
      </>
    );
  return (
    <g className={`stand-group${sel ? ' selected' : ''}`} data-id={stand.id} data-warning={warn ?? undefined}>
      <Prims prims={prims} />
      {hitbox}
    </g>
  );
});

/**
 * Freiflächen einer Grundfläche: hellgrün getönt und schraffiert. Die Schraffur sind echte Linien in
 * Metern (ein Pfad je Grundfläche), kein SVG-<pattern>: Musterfüllungen kosten in WebKit beim Zoomen
 * und Verschieben bis zu 25 Bilder/s (Lasttest M4-21).
 */
const FreeArea = memo(function FreeArea({ result, spacing }: { result: AreaFreeSpaces; spacing: number }) {
  const prims = freePrims(result, spacing);
  let i = 0;
  const keys = result.free.flatMap((f) => f.polygons.map((_, k) => ({ key: `${f.key}:${k}`, fkey: f.key })));
  return prims.map((p) => {
    if (p.s !== 'free-space') return <PrimView key="hatch" p={p} />;
    const k = keys[i++]!;
    return <PrimView key={k.key} p={p} data-key={k.fkey} data-area={result.areaId} />;
  });
});

/** „Frei 20 × 10 m“: horizontal, mittig, feste Schriftgröße wie die Standbeschriftung. */
const FreeLabels = memo(function FreeLabels({ result, fontSize, window: win }: { result: AreaFreeSpaces; fontSize: number; window: Bounds }) {
  const inside = (p: Vec) => p.x >= win.minX && p.x <= win.maxX && p.y >= win.minY && p.y <= win.maxY;
  return result.free.filter((f) => inside(f.center)).map((f) => <FreeLabel key={f.key} space={f} fontSize={fontSize} />);
});

const FreeLabel = memo(function FreeLabel({ space: f, fontSize }: { space: FreeSpace; fontSize: number }) {
  return <PrimView p={freeLabelPrim(f, fontSize)} unit={CM} data-key={f.key} />;
});

/** Warndreieck an der Ecke oben rechts des Stands (Weltgröße, an die Schriftgröße gekoppelt). */
const WarnIcon = memo(function WarnIcon({ stand, kind, size }: { stand: Stand; kind: 'outside' | 'overlap'; size: number }) {
  return (
    <g className="warn-icon-group">
      <Prims prims={warnIconPrims(stand, kind, size)} />
    </g>
  );
});

/** Standbeschriftung: horizontal, mittig, feste Schriftgröße; darf über den Stand hinausragen. */
const StandLabel = memo(function StandLabel({ stand, template, fontSize, categoryName }: { stand: Stand; template: string; fontSize: number; categoryName: string }) {
  const p = standLabelPrim(stand, template, fontSize, categoryName);
  return p ? <PrimView p={p} unit={CM} data-id={stand.id} /> : null;
});

/** Grundflächen-Beschriftung: horizontal, außerhalb der Fläche vor der Mitte der Vorderseite. */
const AreaLabel = memo(function AreaLabel({ area, fontSize }: { area: Area; fontSize: number }) {
  return <PrimView p={areaLabelPrim(area, fontSize)} unit={CM} data-id={area.id} />;
});
