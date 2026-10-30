import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { runCommand } from '../../app/commands';
import { setInteractionKeyHandler } from '../../app/keyboard';
import { effectivePage } from '../../core/derive';
import { createFreeSpaceCache, pageFreeSpaces, type FreeSpace } from '../../core/freeSpace';
import { applyHidden, pickFreeSpace } from '../../core/hiddenFree';
import { pickObject } from '../../core/hit';
import { markerSize, pageOccupants, typeMap } from '../../core/infra';
import { fmt } from '../../core/format';
import type { FestplatzPage, Id, Rect, Vec, View } from '../../core/model/types';
import { findSnap, rectSnapSource } from '../../core/snap';
import { defaultView, fitBounds, focusBounds, screenToWorld, worldToScreen, zoomAt, type Bounds } from '../../core/viewport';
import { cachedDuplicates } from '../../core/numbering';
import { activeNarrow, cachedDistanceWarnings, cachedInfraWarnings, cachedPageWarnings } from '../../core/warnings';
import { hideFreeSpace } from '../../state/freeSpaces';
import { useStore } from '../../state/store';
import { Menu } from '../shell/Menu';
import { IS_MAC } from '../shortcuts/keys';
import { Icon } from '../icons/Icon';
import { tip } from '../shortcuts/tip';
import { BackgroundLayer } from './background/BackgroundLayer';
import { FpsMeter } from './FpsMeter';
import { ObjectsLayer } from './objects/ObjectsLayer';
import { PaperLayer } from './objects/PaperLayer';
import { pagePaper, paperElementAt } from '../../core/paper';
import { SNAP_PX, type ToolContext, type ToolPointer } from './tools/types';
import { useCalibrateTool } from './tools/useCalibrateTool';
import { useCenterTool } from './tools/useCenterTool';
import { ClockwiseMarker } from './ClockwiseMarker';
import { useCreateTool } from './tools/useCreateTool';
import { useMeasureTool } from './tools/useMeasureTool';
import { useSelectTool } from './tools/useSelectTool';
import { useInfraTool } from './tools/useInfraTool';
import { useTitleBlockTool } from './tools/useTitleBlockTool';
import { interpretWheel } from './wheel';

/** Unter dieser Schrifthöhe (px) wird die Beschriftung ausgeblendet. */
const MIN_LABEL_PX = 3;
/** Ab dieser Schrifthöhe (px) bekommt die Beschriftung einen hellen Rand (siehe ObjectsLayer). */
const HALO_LABEL_PX = 12;
/**
 * Freiflächen-Beschriftung erst ab dieser Schrifthöhe (px). Darunter ist sie nicht lesbar, und Hunderte
 * zusätzlicher Texte kosten in WebKit spürbar Bildrate (Lasttest M4-21).
 */
const MIN_FREE_LABEL_PX = 6;
/** Linienabstand der Schraffur: etwa 8 px auf dem Bildschirm, in Zweierpotenzen von Metern (ändert sich beim Zoomen selten). */
const hatchSpacing = (scale: number) => 2 ** Math.round(Math.log2(8 / scale));

/**
 * Bereich, in dem Freiflächen-Beschriftungen gezeichnet werden: der sichtbare Ausschnitt, auf ganze
 * Bildschirmfelder gerundet und um ein Feld erweitert. Ändert sich beim Verschieben und Zoomen nur
 * beim Überschreiten eines Feldes; so bleiben Hunderte Texte außerhalb aus dem DOM (WebKit, M4-21).
 */
function labelWindow(view: View, w: number, h: number): Bounds {
  const k = 2 ** (Math.floor(Math.log2(view.scale) * 2) / 2);
  const cell = Math.max(w, h, 1) / k;
  const qx = Math.floor(-view.tx / view.scale / cell);
  const qy = Math.floor(-view.ty / view.scale / cell);
  return { minX: (qx - 1) * cell, minY: (qy - 1) * cell, maxX: (qx + 2) * cell, maxY: (qy + 2) * cell };
}
const NO_SELECTION: ReadonlySet<string> = new Set();

/**
 * Zwischengespeicherte Ebenen (QA-M4-03): Plan und Objekte werden für eine „gerenderte Ansicht“
 * gezeichnet. Ändert sich die Ansicht (Zoomen, Verschieben), verschiebt bzw. skaliert nur ein
 * CSS-Transform das fertige Bild (GPU, kein Neuzeichnen von Plan, 500 Ständen, Schraffur und Text).
 * Neu gezeichnet wird nur, wenn nötig: nach SETTLE_MS Ruhe, falls sich der Zoom geändert hat (Schärfe) oder
 * der Rand zu mehr als der Hälfte verbraucht ist; sofort, wenn Rand oder Zoomfaktor ausgereizt sind. Reines
 * Verschieben bleibt ohne Neuzeichnen scharf.
 */
const SETTLE_MS = 150;
/** Dauer der Hervorhebung nach einem Sprung von der Start-Page (M6-09). */
const FLASH_MS = 1600;
/** Rand der zwischengespeicherten Ebenen je Seite, in Bildschirmbreiten (Platz für Verschieben ohne Neuzeichnen). */
const LAYER_MARGIN = 0.5;
/**
 * Spätestens bei diesem Vergrößerungsfaktor gegenüber der gerenderten Ansicht wird sofort neu gezeichnet
 * (sonst zu unscharf); darunter erst nach der Ruhepause. Beim Verkleinern begrenzt der Rand (Faktor ≥ 0,5).
 */
const MAX_LAYER_ZOOM = 4;

/**
 * Muss die gerenderte Ansicht nachgezogen werden? `share` = Anteil des Rands, der verbraucht sein darf
 * (1 = sofort, wenn der Rand nicht mehr reicht; 0,5 = nach Ruhe schon ab dem halben Rand).
 */
function layerExhausted(rv: View, v: View, w: number, h: number, share = 1): boolean {
  const k = v.scale / rv.scale;
  if (k > MAX_LAYER_ZOOM) return true;
  // Wohin wandert der Rand der Ebene? Die Ebene deckt in gerenderten Bildschirmkoordinaten
  // [−m·w, (1+m)·w] ab; nach dem Transform muss sie den sichtbaren Bereich [0, w] weiter abdecken.
  const ox = v.tx - rv.tx * k;
  const oy = v.ty - rv.ty * k;
  const mx = LAYER_MARGIN * share * w;
  const my = LAYER_MARGIN * share * h;
  return ox + -mx * k > 0 || ox + (w + mx) * k < w || oy + -my * k > 0 || oy + (h + my) * k < h;
}

/** CSS-Transform, der die für `rv` gezeichnete Ebene an die Ansicht `v` anpasst. */
function layerTransform(rv: View, v: View): string | undefined {
  if (rv.scale === v.scale && rv.tx === v.tx && rv.ty === v.ty) return undefined;
  const k = v.scale / rv.scale;
  return `translate(${v.tx - rv.tx * k}px, ${v.ty - rv.ty * k}px) scale(${k})`;
}

/** Zwischengespeicherte Weltebene: SVG mit Rand, Inhalt für die gerenderte Ansicht `rv`. */
function WorldLayer({ className, rv, view, size, children }: { className: string; rv: View; view: View; size: { w: number; h: number }; children: React.ReactNode }) {
  // Ganze Pixel: Sonst rastet WebKit die Ebene auf Gerätepixel ein und der Inhalt sitzt leicht versetzt
  const mx = Math.round(LAYER_MARGIN * size.w);
  const my = Math.round(LAYER_MARGIN * size.h);
  return (
    <svg
      className={`canvas-layer ${className}`}
      style={{ left: -mx, top: -my, width: size.w + 2 * mx, height: size.h + 2 * my, transformOrigin: `${mx}px ${my}px`, transform: layerTransform(rv, view) }}
      aria-hidden="true"
    >
      <g transform={`translate(${rv.tx + mx} ${rv.ty + my}) scale(${rv.scale})`} className="world">
        {children}
      </g>
    </svg>
  );
}

/** Ereignis aus einer der SVG-Ebenen der Zeichenfläche (nicht aus Statusleiste, Panels usw.)? */
const onCanvas = (e: { target: EventTarget | null }) => e.target instanceof SVGElement && !!e.target.closest('svg.canvas, svg.canvas-layer');

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

interface PanDrag {
  kind: 'pan';
  pointerId: number;
  x0: number;
  y0: number;
  view0: View;
}

/**
 * Zeichenfläche (SVG). Weltkoordinaten in Metern; die Ansicht `view` bildet sie auf Pixel ab.
 * Zoom und Pan, Raster, Hintergrund, Objekte (M3) und Werkzeuge. Während einer Geste zeigt sie die
 * Page mit eingesetzter Vorschau (core/derive.ts).
 */
export function Canvas({ page: storedPage }: { page: FestplatzPage }) {
  const preview = useStore((s) => s.preview);
  const page = useMemo(() => effectivePage(storedPage, preview), [storedPage, preview]);
  const categories = useStore((s) => s.project.categories);
  const defaultStandColor = useStore((s) => s.project.settings.defaultStandColor);
  const shapeTemplates = useStore((s) => s.project.shapeTemplates);
  const labelTemplate = useStore((s) => s.project.settings.labelTemplate);
  const labelFontSize = useStore((s) => s.project.settings.labelFontSize);
  const minFreeWidth = useStore((s) => s.project.settings.minFreeWidth);
  const warnOutside = useStore((s) => s.project.settings.warnOutside);
  const warnOverlap = useStore((s) => s.project.settings.warnOverlap);
  const warnDuplicateNr = useStore((s) => s.project.settings.warnDuplicateNr);
  const warnInfra = useStore((s) => s.project.settings.warnInfra);
  const warnPassageWidth = useStore((s) => s.project.settings.warnPassageWidth);
  const warnDistance = useStore((s) => s.project.settings.warnDistance);
  const minPassageWidth = useStore((s) => s.project.settings.minPassageWidth);
  const warnSettings = useMemo(
    () => ({ warnOutside, warnOverlap, warnDuplicateNr, warnInfra, warnPassageWidth, warnDistance }),
    [warnOutside, warnOverlap, warnDuplicateNr, warnInfra, warnPassageWidth, warnDistance],
  );
  const infraTypes = useStore((s) => s.project.infraTypes);
  const typesById = useMemo(() => typeMap(infraTypes), [infraTypes]);
  // Doppelte Nummern (M5-10) aus dem gespeicherten Projekt: Nummern ändern sich während einer Geste nicht
  const duplicates = useStore((s) => cachedDuplicates(s.project.pages, s.project.settings.numbering.scope));
  // Freiflächen und Warnungen live aus der Page mit Vorschau; der Zwischenspeicher rechnet nur
  // Grundflächen neu, deren Eingaben sich geändert haben (M4-04)
  const [freeCache] = useState(createFreeSpaceCache);
  // Belegende Infrastruktur-Objekte (M7-05) zählen wie Stände
  const occupants = useMemo(() => pageOccupants(page, infraTypes), [page, infraTypes]);
  // Ausgeblendete Freiflächen (#8) fallen weg; während einer Geste passt ihr Intervall nicht mehr, sie erscheinen live
  const free = useMemo(() => applyHidden(pageFreeSpaces(page.areas, occupants, minFreeWidth, freeCache), page.hiddenFree), [page.areas, occupants, minFreeWidth, freeCache, page.hiddenFree]);
  const warnings = useMemo(() => cachedPageWarnings(page.areas, page.stands), [page.areas, page.stands]);
  const infraWarnings = useMemo(() => cachedInfraWarnings(page, infraTypes, minPassageWidth), [page, infraTypes, minPassageWidth]);
  const infraWarnStands = useMemo(() => new Set(infraWarnings.byStand.keys()), [infraWarnings]);
  // Konkurrenzschutz (#3) live aus der Page mit Vorschau: Warnung und Linien folgen dem gezogenen Stand
  const distanceWarnings = useMemo(() => cachedDistanceWarnings(page.stands, categories), [page.stands, categories]);
  // Blatt, Schriftfeld, Legende (M7-10 bis M7-12)
  const projectName = useStore((s) => s.project.name);
  const titleFields = useStore((s) => s.project.titleBlock);
  const freeShown = free.some((a) => a.free.length > 0);
  const paper = useMemo(
    () => pagePaper(page, { name: projectName, categories, infraTypes, titleBlock: titleFields, settings: { minFreeWidth, defaultStandColor } }, page.layers, freeShown),
    [page, projectName, categories, infraTypes, titleFields, minFreeWidth, defaultStandColor, freeShown],
  );
  const paperVisible = useMemo(
    () => ({ titleBlock: page.titleBlock.visible, legend: page.legend.visible, scaleBar: page.scaleBar.visible, northArrow: page.northArrow.visible }),
    [page.titleBlock.visible, page.legend.visible, page.scaleBar.visible, page.northArrow.visible],
  );
  const infraWarnObjects = useMemo(() => new Set(page.infra.filter((o) => activeNarrow(o, infraWarnings, warnSettings)).map((o) => o.id)), [page.infra, infraWarnings, warnSettings]);
  // Von der laufenden Geste bewegte Objekte (gleiche Menge über die ganze Geste, siehe ObjectsLayer)
  const movingKey =
    preview?.pageId === storedPage.id
      ? [...Object.keys(preview.rects), ...(preview.added?.stands.map((s) => s.id) ?? []), ...(preview.added?.areas.map((a) => a.id) ?? []), ...(preview.added?.infra.map((o) => o.id) ?? [])].join('|')
      : '';
  const movingIds = useMemo(() => (movingKey ? new Set(movingKey.split('|')) : NO_SELECTION), [movingKey]);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const size = useStore((s) => s.ui.viewport);
  const storedView = useStore((s) => s.views[page.id]);
  const tool = useStore((s) => s.ui.tool);
  const fpsVisible = useStore((s) => s.ui.fpsVisible);
  const gridOpacity = useStore((s) => s.ui.gridOpacity);
  const setView = useStore((s) => s.setView);
  const setUi = useStore((s) => s.setUi);
  const view = storedView ?? defaultView(size.w, size.h);
  // Gerenderte Ansicht der zwischengespeicherten Ebenen (siehe WorldLayer); beim Seitenwechsel sofort
  const viewLive = useStore((s) => s.viewLive);
  const [rendered, setRendered] = useState({ pageId: page.id, view, w: size.w, h: size.h });
  const jumped = !viewLive && (rendered.view.scale !== view.scale || rendered.view.tx !== view.tx || rendered.view.ty !== view.ty);
  if (jumped || rendered.pageId !== page.id || rendered.w !== size.w || rendered.h !== size.h || layerExhausted(rendered.view, view, size.w, size.h)) {
    setRendered({ pageId: page.id, view, w: size.w, h: size.h });
  }
  const rv = rendered.view;
  useEffect(() => {
    if (rv.scale === view.scale && !layerExhausted(rv, view, size.w, size.h, 0.5)) return;
    const t = setTimeout(() => setRendered((r) => ({ ...r, view })), SETTLE_MS);
    return () => clearTimeout(t);
  }, [rv, view, size.w, size.h]);
  // Aktuelle Ansicht für Ereignis-Handler (Rad, Ziehen), ohne sie bei jeder Änderung neu zu registrieren
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });

  const [cursor, setCursor] = useState<Vec | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [altDown, setAltDown] = useState(false);
  const [panning, setPanning] = useState(false);
  /** Kontextmenü einer Freifläche (#8). */
  const [freeMenu, setFreeMenu] = useState<{ x: number; y: number; fs: FreeSpace } | null>(null);
  const drag = useRef<PanDrag | null>(null);
  const selection = useStore((s) => s.ui.selection);
  const assets = useStore((s) => s.assets);
  const selectedIds = useMemo(() => (selection?.kind === 'objects' ? new Set(selection.ids) : NO_SELECTION), [selection]);

  // ---------- Werkzeuge ----------
  // Fang nur an sichtbaren Ebenen (M3-18); Quelle einmal pro Objektänderung aufbauen
  const snapSource = useMemo(() => {
    const rects: Rect[] = [];
    if (page.layers.areas.visible) rects.push(...page.areas);
    if (page.layers.stands.visible) rects.push(...page.stands);
    if (page.layers.infra.visible) rects.push(...page.infra);
    return rectSnapSource(rects);
  }, [page.areas, page.stands, page.infra, page.layers]);
  const ctx: ToolContext = {
    page,
    view,
    toScreen: (p) => worldToScreen(view, p),
    toWorld: (p) => screenToWorld(view, p),
    snap: (p, exclude) => findSnap(p, [exclude ? snapSourceWithout(page, exclude) : snapSource], SNAP_PX / view.scale),
    geometryOf: (typeId) => typesById.get(typeId)?.geometry,
    markerSize: markerSize(labelFontSize),
    paper,
  };
  const measureTool = useMeasureTool(ctx, tool === 'measure');
  const calibrateTool = useCalibrateTool(ctx, tool === 'calibrate');
  const selectTool = useSelectTool(ctx, tool === 'select' && !spaceDown);
  const areaTool = useCreateTool(ctx, 'area', tool === 'area' && !spaceDown);
  const standTool = useCreateTool(ctx, 'stand', tool === 'stand' && !spaceDown);
  const infraTool = useInfraTool(ctx, tool === 'infra' && !spaceDown);
  const titleBlockTool = useTitleBlockTool(ctx, tool === 'titleBlock' && !spaceDown);
  const centerTool = useCenterTool(ctx, tool === 'numberCenter' && !spaceDown);
  const activeTool =
    tool === 'measure'
      ? measureTool
      : tool === 'calibrate'
        ? calibrateTool
        : tool === 'select'
          ? selectTool
          : tool === 'area'
            ? areaTool
            : tool === 'stand'
              ? standTool
              : tool === 'infra'
                ? infraTool
                : tool === 'titleBlock'
                  ? titleBlockTool
                : tool === 'numberCenter'
                  ? centerTool
                  : null;
  const activeToolRef = useRef(activeTool);
  useLayoutEffect(() => {
    activeToolRef.current = activeTool;
  });

  // Das aktive Werkzeug bekommt Tasten vor allen Kurzbefehlen (Esc bricht eine Geste ab); die
  // Reihenfolge legt app/keyboard.ts fest, nicht die Anmeldereihenfolge (QA-M3-01)
  useEffect(() => setInteractionKeyHandler((e) => !!activeToolRef.current?.onKeyDown(e)), []);

  // Größe der Zeichenfläche verfolgen
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => setUi({ viewport: { w: el.clientWidth, h: el.clientHeight } });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setUi]);

  // Sprung von der Start-Page (M6-09): auf das Ziel zoomen, sobald die Größe der Zeichenfläche bekannt ist
  // (von der Start-Page aus ist `ui.viewport` evtl. veraltet), dann das Ziel kurz aufleuchten lassen
  const focus = useStore((s) => s.ui.focus);
  const [flash, setFlash] = useState<{ polys: Vec[][]; id: number } | null>(null);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!focus || focus.pageId !== storedPage.id || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setView(storedPage.id, fitBounds(focusBounds(focus.bounds), w, h, 60));
    setFlash({ polys: focus.flash, id: Date.now() });
    setUi({ focus: null, viewport: { w, h } });
  }, [focus, storedPage.id, setView, setUi]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // Leertaste = temporäre Hand, Alt = Zoom-Werkzeug verkleinert
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(true);
      if (e.code !== 'Space' || isTextField(e.target) || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      // Fokussierte Buttons würden sonst per Leertaste ausgelöst
      if (e.target instanceof HTMLButtonElement) e.target.blur();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false);
      if (e.code === 'Space') setSpaceDown(false);
    };
    const reset = () => {
      setSpaceDown(false);
      setAltDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // Mausrad und Pinch zoomen um den Mauszeiger, Zwei-Finger-Wischen verschiebt (siehe wheel.ts)
  useEffect(() => {
    const el = stageRef.current;
    const svg = svgRef.current;
    if (!el || !svg) return;
    const at = (e: { clientX: number; clientY: number }) => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // Direkt aus dem Store lesen: Trackpads feuern mehrere Ereignisse pro Bild, der Ref wäre dann veraltet.
    const current = () => useStore.getState().views[page.id] ?? viewRef.current;
    // Safari/WKWebView: Pinch kommt als Geste mit fortlaufendem Gesamtfaktor `scale`
    let gestureScale: number | null = null;
    const onWheel = (e: WheelEvent) => {
      if (!onCanvas(e)) return;
      e.preventDefault();
      if (gestureScale !== null) return;
      const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      const action = interpretWheel(
        {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          ...(legacy !== undefined ? { wheelDeltaY: legacy } : {}),
        },
        useStore.getState().ui.invertPan,
      );
      const v = current();
      setView(page.id, action.kind === 'zoom' ? zoomAt(v, action.factor, at(e)) : { ...v, tx: v.tx + action.dx, ty: v.ty + action.dy }, true);
    };
    type GestureLike = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLike;
      if (gestureScale === null || !(g.scale > 0)) return;
      const factor = g.scale / gestureScale;
      gestureScale = g.scale;
      setView(page.id, zoomAt(current(), factor, at(g)), true);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [page.id, setView]);

  const localPoint = (e: React.PointerEvent): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const toolPointer = (e: React.PointerEvent): ToolPointer => {
    const screen = localPoint(e);
    return {
      screen,
      world: screenToWorld(viewRef.current, screen),
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      modKey: IS_MAC ? e.metaKey : e.ctrlKey,
      target: e.target as Element | null,
    };
  };

  /**
   * Rechtsklick auf eine angezeigte Freifläche (Auswahlwerkzeug, Ebene sichtbar) öffnet das Menü „Freifläche nicht
   * mehr anzeigen“ (#8). Liegt ein Stand, Infrastruktur-Objekt oder Papier-Element darüber, gibt es kein Menü
   * (QA-M11-01).
   */
  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (!onCanvas(e)) return;
    e.preventDefault();
    if (tool !== 'select' || !page.layers.free.visible || !page.layers.areas.visible) return;
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const w = screenToWorld(v, { x: e.clientX - r.left, y: e.clientY - r.top });
    const top = pickObject(page, w, 0, { geometry: ctx.geometryOf, tol: { line: 5 / v.scale, point: Math.max(ctx.markerSize / 2, 5 / v.scale) } });
    if ((top && top.kind !== 'area') || paperElementAt(page, paper, w)) return;
    const fs = pickFreeSpace(free, w);
    if (fs) setFreeMenu({ x: e.clientX, y: e.clientY, fs });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!onCanvas(e)) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const wantsPan = e.button === 1 || (e.button === 0 && (spaceDown || tool === 'hand'));
    if (wantsPan) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'pan', pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, view0: viewRef.current };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    if (activeTool) {
      if (activeTool.onPointerDown(toolPointer(e))) e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'zoom') setView(page.id, zoomAt(viewRef.current, e.altKey ? 0.5 : 2, localPoint(e)));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current && !e.currentTarget.hasPointerCapture(e.pointerId) && !onCanvas(e)) return;
    const p = toolPointer(e);
    setCursor(p.world);
    activeTool?.onPointerMove(p);
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setView(page.id, { ...d.view0, tx: d.view0.tx + e.clientX - d.x0, ty: d.view0.ty + e.clientY - d.y0 }, true);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (drag.current) {
      drag.current = null;
      setPanning(false);
      return;
    }
    activeTool?.onPointerUp(toolPointer(e));
  };

  const { minX: wx0, minY: wy0, maxX: wx1, maxY: wy1 } = labelWindow(rv, size.w, size.h);
  const freeLabelWindow = useMemo(() => ({ minX: wx0, minY: wy0, maxX: wx1, maxY: wy1 }), [wx0, wy0, wx1, wy1]);
  const grid = useMemo(
    () => (page.grid.visible ? buildGrid(view, size.w, size.h, page.grid.size) : { minor: '', major: '' }),
    [view, size.w, size.h, page.grid.size, page.grid.visible],
  );
  const bg = page.background;
  const origin = { x: view.tx, y: view.ty };

  const classes = ['stage', `tool-${tool}`];
  if (spaceDown || panning) classes.push('panning');
  if (panning) classes.push('dragging');
  if (altDown) classes.push('alt');
  if (activeTool?.cursor && !spaceDown && !panning) classes.push(activeTool.cursor);

  return (
    <main
      ref={stageRef}
      className={classes.join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => !drag.current && setCursor(null)}
      onContextMenu={onContextMenu}
    >
      {/* Ebenen von unten nach oben: Plan (zwischengespeichert), Raster und Klickfläche, Objekte
          (zwischengespeichert), Werkzeuge. Ereignisse behandelt <main> für alle SVG-Ebenen. */}
      {bg && page.layers.background.visible && (
        <WorldLayer className="layer-plan" rv={rv} view={view} size={size}>
          <BackgroundLayer background={bg} bytes={assets[bg.assetId]} view={rv} viewport={size} selected={selection?.kind === 'background'} interactive={false} />
        </WorldLayer>
      )}
      <svg ref={svgRef} className={`canvas${bg && page.layers.background.visible ? ' has-bg' : ''}`} aria-label={`Zeichenfläche ${page.name}`}>
        <g className="grid" opacity={gridOpacity}>
          <path className="grid-minor" d={grid.minor} />
          <path className="grid-major" d={grid.major} />
        </g>
        <path className="origin" d={`M${origin.x - 8} ${origin.y}H${origin.x + 8}M${origin.x} ${origin.y - 8}V${origin.y + 8}`} />
      </svg>
      <WorldLayer className="layer-objects" rv={rv} view={view} size={size}>
          <ObjectsLayer
            page={page}
            categories={categories}
            shapeTemplates={shapeTemplates}
            defaultColor={defaultStandColor}
            template={labelTemplate}
            fontSize={labelFontSize}
            selected={selectedIds}
            labelsTiny={labelFontSize * rv.scale < MIN_LABEL_PX}
            labelHalo={labelFontSize * rv.scale >= HALO_LABEL_PX}
            free={free}
            hatchSpacing={hatchSpacing(rv.scale)}
            freeLabelsTiny={labelFontSize * rv.scale < MIN_FREE_LABEL_PX}
            freeLabelWindow={freeLabelWindow}
            warnings={warnings}
            warnSettings={warnSettings}
            duplicates={duplicates}
            baseStands={storedPage.stands}
            movingIds={movingIds}
            infraTypes={typesById}
            markerSize={markerSize(labelFontSize)}
            infraWarnStands={infraWarnStands}
            infraWarnObjects={infraWarnObjects}
            distanceWarnings={distanceWarnings}
          />
          {page.layers.sheet.visible && (
            <PaperLayer
              paper={paper}
              sheet={page.sheet}
              visible={paperVisible}
              selected={selection?.kind === 'paper' ? selection.element : null}
              locked={page.layers.sheet.locked}
            />
          )}
      </WorldLayer>
      <svg className="canvas-layer canvas-overlay" aria-hidden="true">
        <ClockwiseMarker page={storedPage} toScreen={ctx.toScreen} />
        {flash && (
          <g key={flash.id} className="jump-flash" data-testid="jump-flash">
            {flash.polys.map((poly, i) => (
              <polygon key={i} points={poly.map((p) => ctx.toScreen(p)).map((p) => `${p.x},${p.y}`).join(' ')} />
            ))}
          </g>
        )}
        {activeTool?.overlay}
      </svg>
      {activeTool?.panel && <div className="tool-panel-host">{activeTool.panel}</div>}
      <NorthArrow angle={page.northAngle} />
      {fpsVisible && <FpsMeter />}
      <div className="statusbar">
        <span>
          x <b>{cursor ? fmt(cursor.x) : '–'}</b> y <b>{cursor ? fmt(cursor.y) : '–'}</b> m
        </span>
        <span>
          1 m = <b>{fmt(view.scale, view.scale < 10 ? 2 : 1)}</b> px
        </span>
        <div className="spacer" />
        <button type="button" className="icon-btn" onClick={() => runCommand('view.zoomOut')} {...tip({ shortcut: 'view.zoomOut', side: 'top' })}>
          <Icon name="zoomOut" size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => runCommand('view.zoomIn')} {...tip({ shortcut: 'view.zoomIn', side: 'top' })}>
          <Icon name="zoom" size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => runCommand('view.fit')} {...tip({ shortcut: 'view.fit', side: 'top' })}>
          <Icon name="fit" size={16} />
        </button>
      </div>
      {freeMenu && (
        <Menu
          x={freeMenu.x}
          y={freeMenu.y}
          onClose={() => setFreeMenu(null)}
          items={[{ label: 'Freifläche nicht mehr anzeigen', detail: `${fmt(freeMenu.fs.width)} × ${fmt(freeMenu.fs.depth)} m`, onSelect: () => hideFreeSpace(page.id, freeMenu.fs) }]}
        />
      )}
    </main>
  );
}

/** Fangquelle ohne ein Objekt (Endpunkt-Griffe einer Linie fangen nicht an der Linie selbst). */
function snapSourceWithout(page: FestplatzPage, exclude: Id) {
  const rects: Rect[] = [];
  if (page.layers.areas.visible) rects.push(...page.areas);
  if (page.layers.stands.visible) rects.push(...page.stands);
  if (page.layers.infra.visible) rects.push(...page.infra.filter((o) => o.id !== exclude));
  return rectSnapSource(rects.filter((r) => (r as Rect & { id?: Id }).id !== exclude));
}

/** Nordpfeil oben rechts; `angle` = Richtung Norden in Grad im Uhrzeigersinn ab „oben“. */
function NorthArrow({ angle }: { angle: number }) {
  return (
    <div className="north-arrow" {...tip({ label: `Norden: ${fmt(angle, 1)}°`, desc: 'Nordrichtung in der Seitenleiste einstellen', side: 'bottom' })}>
      <svg viewBox="-20 -20 40 40" width="40" height="40" aria-hidden="true">
        <circle r="18" className="north-ring" />
        <g transform={`rotate(${angle})`}>
          <path d="M0 -4 L4.5 13 L0 10 L-4.5 13 Z" className="north-needle" />
          <text y="-10.5" textAnchor="middle" dominantBaseline="central" className="north-n">
            N
          </text>
        </g>
      </svg>
    </div>
  );
}

/**
 * Orientierungsraster in Bildschirmkoordinaten (Linien pixelgenau, wie im Prototyp).
 * Feine Linien im Abstand `step`, kräftige alle 10 Schritte; zu dichte Linien entfallen.
 */
function buildGrid(view: View, w: number, h: number, step: number): { minor: string; major: string } {
  let minor = '';
  let major = '';
  if (!(step > 0) || w === 0 || h === 0) return { minor, major };
  const { scale: k, tx, ty } = view;
  const minorOn = step * k >= 6;
  const majorStep = step * 10;
  if (majorStep * k < 6) return { minor, major };
  const unit = minorOn ? step : majorStep;
  const x0 = Math.floor(-tx / k / unit);
  const x1 = Math.ceil((w - tx) / k / unit);
  const y0 = Math.floor(-ty / k / unit);
  const y1 = Math.ceil((h - ty) / k / unit);
  const isMajor = (i: number) => (minorOn ? i % 10 === 0 : true);
  for (let i = x0; i <= x1; i++) {
    const sx = Math.round(tx + i * unit * k) + 0.5;
    const seg = `M${sx} 0V${h}`;
    if (isMajor(i)) major += seg;
    else minor += seg;
  }
  for (let i = y0; i <= y1; i++) {
    const sy = Math.round(ty + i * unit * k) + 0.5;
    const seg = `M0 ${sy}H${w}`;
    if (isMajor(i)) major += seg;
    else minor += seg;
  }
  return { minor, major };
}
