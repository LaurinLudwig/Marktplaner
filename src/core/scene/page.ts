/**
 * Szene einer Page für das PDF (M8, spec.md §9): Ebenen in fester Reihenfolge aus den Bausteinen (objects.ts,
 * paper.ts), gefiltert nach Export-Profil. Erwartet das bereits geschwärzte Projekt (`redactProject`). Die
 * Ebenen-Sichtbarkeit der Zeichenfläche spielt keine Rolle.
 *
 * Festplatz-Verbund (#15 Teil c): Die Gesamtansicht ist die `mergedPage` (Objekte aller Mitglieder, Blatt und
 * Papier-Elemente des Verbunds) mit einem Hintergrund je Mitglied. Eine Einzelansicht zeigt ihre Nachbarn blass mit
 * „Nr · Platz“ (Ebene „Nachbarn“ des Profils).
 */
import { blankedPlaceholders, profileLayers, type ExportProfile } from '../exportProfiles';
import { pageFree } from '../hiddenFree';
import { markerSize, typeMap } from '../infra';
import type { FestplatzPage, Project, Rect, Vec } from '../model/types';
import { cachedDuplicates } from '../numbering';
import { pagePaper, type PaperKind } from '../paper';
import { boundsOfRects } from '../geometry/rect';
import { mmToM, shownOnPaper, type SheetFrame } from '../sheet';
import type { Bounds } from '../viewport';
import { activeAreas } from '../pageAreas';
import { neighbourCaption, ownerOf, pageEnv } from '../verbund';
import { viewBackgrounds, type ViewBackground } from '../verbundView';
import { activeNarrow, activeWarnings, cachedWarningData } from '../warnings';
import { cachedStandLabels } from '../labelLayout';
import {
  areaLabelBounds,
  areaLabelPrim,
  areaPrims,
  freeLabelPrim,
  freePrims,
  infraLabelPrim,
  infraPrims,
  neighbourLabelPrim,
  overlapPrim,
  standLabelPrims,
  standPrims,
  warnIconPrims,
  warnKind,
  type WarnKind,
} from './objects';
import { legendPrims, northArrowPrims, scaleBarPrims, titleBlockPrims } from './paper';
import { PAPER_HATCH_MM } from './paperStyle';
import type { Prim } from './prims';
import { resolveStandColor } from '../objects';
import { templateOf } from '../shape';
import { footprint, pageStands } from '../footprint';

/** Ebenen der Szene von unten nach oben; Nachbarn (#15) unter den eigenen Objekten wie auf der Zeichenfläche. */
export const SCENE_ORDER = ['grid', 'areas', 'free', 'neighbours', 'stands', 'infra', 'warnings', 'labels'] as const;
export type SceneLayerId = (typeof SCENE_ORDER)[number];

export interface SceneLayer {
  id: SceneLayerId;
  /** Weltkoordinaten (Meter). */
  prims: Prim[];
  /** Blass und gestrichelt (Nachbarn aus dem Verbund, #15): Deckkraft `FADED_OPACITY`, Linien `FADED_DASH_MM`. */
  faded?: boolean;
}

/** Nachbarn im PDF (#15 Teil c): Deckkraft und Strichmuster (mm) wie `.layer-neighbours` auf der Zeichenfläche. */
export const FADED_OPACITY = 0.4;
export const FADED_DASH_MM: readonly number[] = [1.2, 0.7];

export interface ScenePaperElement {
  kind: PaperKind;
  /** Linke obere Ecke auf dem Papier (mm vom Blattrand oben links). */
  at: Vec;
  /** mm relativ zu `at`. */
  prims: Prim[];
}

export interface PageScene {
  /** ID der Page bzw. `verbund:<id>` (Gesamtansicht eines Verbunds, #15). */
  pageId: string;
  /** Name für Lesezeichen und Fortschritt („Seestraße“, „Unterstadt (gesamt)“). */
  name: string;
  frame: SheetFrame;
  /**
   * Hintergründe, falls das Profil sie zeigt, von unten nach oben: der der Page bzw. in der Gesamtansicht je Mitglied
   * einer (Reihenfolge des Verbunds, keine Masken).
   */
  backgrounds: ViewBackground[];
  /** Unter dem Hintergrund nichts; danach die Ebenen in `SCENE_ORDER`. */
  layers: SceneLayer[];
  paper: ScenePaperElement[];
}

const intersects = (a: Bounds, b: Bounds) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Szene einer Page oder der Gesamtansicht eines Verbunds (`page` = `mergedPage`, #15 Teil c). `name` ersetzt den Namen
 * für Lesezeichen und Fortschritt (Gesamtansicht: „Unterstadt (gesamt)“); im Schriftfeld steht weiter `page.name`.
 */
export function pageScene(page: FestplatzPage, project: Project, profile: ExportProfile, name = page.name): PageScene {
  const L = profile.layers;
  const env = pageEnv(project, page);
  const types = typeMap(project.infraTypes);
  const settings = project.settings;
  const fontSize = settings.labelFontSize;
  const mSize = markerSize(fontSize);
  // Nachbarn aus dem Verbund (#15) belegen Freiflächen und zählen für die Warnungen; gezeichnet werden sie im PDF nicht
  const free = L.areas && L.free ? pageFree(page, { minFreeWidth: settings.minFreeWidth, infraTypes: project.infraTypes, shapeTemplates: project.shapeTemplates, verbund: project }) : [];
  const freeShown = free.some((a) => a.free.length > 0);
  const pp = pagePaper(page, project, profileLayers(profile), freeShown);
  const frame = pp.frame;
  // Nur, was das Blatt berührt (mit Rand für Beschriftungen, die über Objekte hinausragen)
  const pad = fontSize * 8;
  const view: Bounds = { minX: frame.bounds.minX - pad, minY: frame.bounds.minY - pad, maxX: frame.bounds.maxX + pad, maxY: frame.bounds.maxY + pad };
  const onSheet = <T extends Rect>(r: T) => intersects(boundsOfRects([r])!, view);
  // Ohne Grundflächen (#17) erscheinen gespeicherte Grundflächen nicht, auch nicht ihre Beschriftung
  const pageAreas = activeAreas(page);
  const areas = pageAreas.filter(onSheet);
  const stands = page.stands.filter(onSheet);
  const infra = page.infra.filter(onSheet);

  // Warnungen nach Profil: „alle“ wie auf der Zeichenfläche, „Rettungswege“ nur Freihaltefläche und Durchfahrt
  const mode = profile.warnings;
  // Stände, wie sie belegen (#16): Vorlagen mit „belegt wie gezeichnet“ eingesetzt
  const calc = pageStands(page, project.shapeTemplates);
  const wd = cachedWarningData(calc, page.infra, env, project);
  const pw = wd.page;
  const iw = wd.infra;
  const dups = mode === 'all' ? cachedDuplicates(project.pages, settings.numbering.scope) : null;
  const dw = mode === 'all' ? wd.distance : null;
  const kinds = new Map<string, WarnKind>(
    stands.map((s) => {
      if (mode === 'none') return [s.id, null];
      const a = activeWarnings(pw.byStand.get(s.id), s, settings, !!dups?.has(s.id), iw.byStand.has(s.id), !!dw?.has(s.id));
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
  // Nachbarn aus dem Verbund (#15 Teil c, Entscheidung Laurin 2026-11-07): blass wie auf der Zeichenfläche, ohne
  // Warnungen; Stände nur mit „Geschäfte“, Infrastruktur nur mit „Infrastruktur“. Die Gesamtansicht hat keine.
  const nbOn = L.neighbours;
  const nbStands = nbOn && L.stands ? env.neighbours.stands.filter((s) => intersects(footprint(s).bounds, view)) : [];
  const nbInfra = nbOn && L.infra ? env.neighbours.infra.filter(onSheet) : [];
  const nbPrims: Prim[] = [
    ...nbStands.flatMap((s) => standPrims(s, resolveStandColor(s, s.categoryId ? cats.get(s.categoryId) : undefined, settings.defaultStandColor), null, templateOf(s, templates))),
    ...nbInfra.flatMap((o) => (types.has(o.typeId) ? infraPrims(o, types.get(o.typeId)!, fontSize, mSize, false) : [])),
  ];
  if (nbPrims.length) layers.push({ id: 'neighbours', prims: nbPrims, faded: true });
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
    if (L.stands) {
      // Platziert wird auf der ganzen Page, damit Beschriftungen am Blattrand denselben Platz haben wie auf der Zeichenfläche
      const blocked = L.areas ? pageAreas.map((a) => areaLabelBounds(a, fontSize)) : [];
      const placed = cachedStandLabels({ stands: calc, areas: pageAreas, infra: page.infra, template: settings.labelTemplate, fontSize, categories: project.categories, blank, blocked });
      for (const s of stands) {
        const p = placed.get(s.id);
        if (p) labels.push(...standLabelPrims(p, fontSize));
      }
    }
    if (L.infra)
      for (const o of infra) {
        const t = types.get(o.typeId);
        const p = t && infraLabelPrim(o, t, fontSize, mSize);
        if (p) labels.push(p);
      }
    // „SE-02 · Seestraße“ in der Mitte des Nachbarstands (wie auf der Zeichenfläche)
    for (const s of nbStands) labels.push(neighbourLabelPrim(s, neighbourCaption(s, project.pages.find((p) => p.id === ownerOf(project, s.id))?.name ?? ''), fontSize));
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

  return { pageId: page.id, name, frame, backgrounds: L.background ? viewBackgrounds(project, page) : [], layers, paper };
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
