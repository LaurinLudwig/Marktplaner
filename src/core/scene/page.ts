/**
 * Szene einer Page für das PDF (M8, spec.md §9): Ebenen in fester Reihenfolge aus den Bausteinen (objects.ts,
 * paper.ts), gefiltert nach Export-Profil. Erwartet das bereits geschwärzte Projekt (`redactProject`). Die
 * Ebenen-Sichtbarkeit der Zeichenfläche spielt keine Rolle.
 */
import { blankedPlaceholders, profileLayers, type ExportProfile } from '../exportProfiles';
import { pageFree } from '../hiddenFree';
import { markerSize, typeMap } from '../infra';
import type { Background, FestplatzPage, Project, Rect, Vec } from '../model/types';
import { cachedDuplicates } from '../numbering';
import { pagePaper, type PaperKind } from '../paper';
import { boundsOfRects } from '../geometry/rect';
import { mmToM, shownOnPaper, type SheetFrame } from '../sheet';
import type { Bounds } from '../viewport';
import { activeNarrow, activeWarnings, cachedInfraWarnings, cachedPageWarnings } from '../warnings';
import { areaLabelPrim, areaPrims, freeLabelPrim, freePrims, infraLabelPrim, infraPrims, overlapPrim, standLabelPrim, standPrims, warnIconPrims, warnKind, type WarnKind } from './objects';
import { legendPrims, northArrowPrims, scaleBarPrims, titleBlockPrims } from './paper';
import { PAPER_HATCH_MM } from './paperStyle';
import type { Prim } from './prims';
import { resolveStandColor } from '../objects';
import { templateOf } from '../shape';

export const SCENE_ORDER = ['grid', 'areas', 'free', 'stands', 'infra', 'warnings', 'labels'] as const;
export type SceneLayerId = (typeof SCENE_ORDER)[number];

export interface SceneLayer {
  id: SceneLayerId;
  /** Weltkoordinaten (Meter). */
  prims: Prim[];
}

export interface ScenePaperElement {
  kind: PaperKind;
  /** Linke obere Ecke auf dem Papier (mm vom Blattrand oben links). */
  at: Vec;
  /** mm relativ zu `at`. */
  prims: Prim[];
}

export interface PageScene {
  pageId: string;
  name: string;
  frame: SheetFrame;
  /** Hintergrund, falls das Profil ihn zeigt. */
  background: Background | null;
  /** Unter dem Hintergrund nichts; danach die Ebenen in `SCENE_ORDER`. */
  layers: SceneLayer[];
  paper: ScenePaperElement[];
}

const intersects = (a: Bounds, b: Bounds) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export function pageScene(page: FestplatzPage, project: Project, profile: ExportProfile): PageScene {
  const L = profile.layers;
  const types = typeMap(project.infraTypes);
  const settings = project.settings;
  const fontSize = settings.labelFontSize;
  const mSize = markerSize(fontSize);
  const free = L.areas && L.free ? pageFree(page, { minFreeWidth: settings.minFreeWidth, infraTypes: project.infraTypes }) : [];
  const freeShown = free.some((a) => a.free.length > 0);
  const pp = pagePaper(page, project, profileLayers(profile), freeShown);
  const frame = pp.frame;
  // Nur, was das Blatt berührt (mit Rand für Beschriftungen, die über Objekte hinausragen)
  const pad = fontSize * 8;
  const view: Bounds = { minX: frame.bounds.minX - pad, minY: frame.bounds.minY - pad, maxX: frame.bounds.maxX + pad, maxY: frame.bounds.maxY + pad };
  const onSheet = <T extends Rect>(r: T) => intersects(boundsOfRects([r])!, view);
  const areas = page.areas.filter(onSheet);
  const stands = page.stands.filter(onSheet);
  const infra = page.infra.filter(onSheet);

  // Warnungen nach Profil: „alle“ wie auf der Zeichenfläche, „Rettungswege“ nur Freihaltefläche und Durchfahrt
  const mode = profile.warnings;
  const pw = cachedPageWarnings(page.areas, page.stands);
  const iw = cachedInfraWarnings(page, project.infraTypes, settings.minPassageWidth);
  const dups = mode === 'all' ? cachedDuplicates(project.pages, settings.numbering.scope) : null;
  const kinds = new Map<string, WarnKind>(
    stands.map((s) => {
      if (mode === 'none') return [s.id, null];
      const a = activeWarnings(pw.byStand.get(s.id), s, settings, !!dups?.has(s.id), iw.byStand.has(s.id));
      return [s.id, mode === 'all' ? warnKind(a) : a.infra ? 'overlap' : null];
    }),
  );
  const narrow = (id: string) => mode !== 'none' && infra.some((o) => o.id === id && activeNarrow(o, iw, settings));

  const cats = new Map(project.categories.map((c) => [c.id, c]));
  const layers: SceneLayer[] = [];
  const push = (id: SceneLayerId, prims: Prim[]) => {
    if (prims.length) layers.push({ id, prims });
  };

  // Raster nach Profil; die Rasterweite kommt von der Page, „Raster ein/aus“ der Zeichenfläche zählt nicht (§9)
  if (L.grid) push('grid', gridPrims(frame, page.grid.size));
  if (L.areas) push('areas', areas.flatMap((a) => areaPrims(a)));
  if (L.areas && L.free) push('free', free.flatMap((r) => freePrims(r, mmToM(PAPER_HATCH_MM, frame.scale))));
  const templates = new Map(project.shapeTemplates.map((t) => [t.id, t]));
  if (L.stands)
    push(
      'stands',
      stands.flatMap((s) =>
        standPrims(s, resolveStandColor(s, s.categoryId ? cats.get(s.categoryId) : undefined, project.settings.defaultStandColor), kinds.get(s.id) ?? null, templateOf(s, templates)),
      ),
    );
  if (L.infra) push('infra', infra.flatMap((o) => (types.has(o.typeId) ? infraPrims(o, types.get(o.typeId)!, fontSize, mSize, narrow(o.id)) : [])));
  if (L.stands && mode !== 'none') {
    const warn: Prim[] = [];
    if (mode === 'all')
      for (const r of pw.regions) if (kinds.get(r.a) === 'overlap' || kinds.get(r.b) === 'overlap') warn.push(overlapPrim(r.polygon));
    for (const s of stands) {
      const k = kinds.get(s.id);
      if (k) warn.push(...warnIconPrims(s, k, fontSize * 1.3));
    }
    push('warnings', warn);
  }
  if (L.labels) {
    const blank = blankedPlaceholders(profile);
    const labels: Prim[] = [];
    if (L.areas) labels.push(...areas.map((a) => areaLabelPrim(a, fontSize)));
    if (L.areas && L.free) for (const r of free) labels.push(...r.free.map((f) => freeLabelPrim(f, fontSize)));
    if (L.stands)
      for (const s of stands) {
        const p = standLabelPrim(s, settings.labelTemplate, fontSize, (s.categoryId && cats.get(s.categoryId)?.name) || '', blank);
        if (p) labels.push(p);
      }
    if (L.infra)
      for (const o of infra) {
        const t = types.get(o.typeId);
        const p = t && infraLabelPrim(o, t, fontSize, mSize);
        if (p) labels.push(p);
      }
    push('labels', labels);
  }

  const paper: ScenePaperElement[] = [];
  const add = (kind: PaperKind, size: { w: number; h: number }, prims: Prim[]) => {
    if (page[kind].visible) paper.push({ kind, at: shownOnPaper(page[kind], size, frame.paper), prims });
  };
  add('scaleBar', pp.scaleBar.layout, scaleBarPrims(pp.scaleBar.layout, frame.scale));
  add('northArrow', pp.northArrow.layout, northArrowPrims(pp.northArrow.layout.angle));
  if (pp.legend) add('legend', pp.legend.layout, legendPrims(pp.legend.layout));
  add('titleBlock', pp.titleBlock.layout, titleBlockPrims(pp.titleBlock.layout));

  return { pageId: page.id, name: page.name, frame, background: L.background ? page.background : null, layers, paper };
}

/** Raster im Blatt: feine Linien im Abstand `size`, kräftige alle 10; Linien unter 2 mm Abstand auf dem Papier entfallen. */
export function gridPrims(frame: SheetFrame, size: number): Prim[] {
  if (!(size > 0)) return [];
  const minMm = 2;
  const b = frame.bounds;
  const lines = (step: number, skipMajor: boolean) => {
    let d = '';
    for (let i = Math.ceil(b.minX / step); i * step <= b.maxX; i++) if (!skipMajor || i % 10 !== 0) d += `M${i * step} ${b.minY}V${b.maxY}`;
    for (let i = Math.ceil(b.minY / step); i * step <= b.maxY; i++) if (!skipMajor || i % 10 !== 0) d += `M${b.minX} ${i * step}H${b.maxX}`;
    return d;
  };
  const out: Prim[] = [];
  const minorOn = (size * 1000) / frame.scale >= minMm;
  if (minorOn) out.push({ t: 'path', s: 'grid-minor', d: lines(size, true) });
  if ((size * 10 * 1000) / frame.scale >= minMm) out.push({ t: 'path', s: 'grid-major', d: lines(size * 10, false) });
  return out;
}
