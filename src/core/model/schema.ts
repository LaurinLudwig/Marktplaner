import { normAngle } from '../geometry/rect';
import { newId } from '../id';
import { UserError } from '../errors';
import { createPage, defaultLayers, DEFAULT_INFRA_TYPES, DEFAULT_LEGEND_ANCHOR, DEFAULT_NORTH_ARROW_ANCHOR, DEFAULT_SCALE_BAR_ANCHOR, DEFAULT_SETTINGS, DEFAULT_SHEET, DEFAULT_TITLE_BLOCK_ANCHOR } from './defaults';
import { clampToLimits, GEOMETRIES, INFRA_LIMITS, isInfraIcon } from '../infra';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations';
import { clampDigits, clampStart } from '../numbering';
import {
  LAYER_IDS,
  PAPER_FORMATS,
  type Area,
  type Background,
  type Category,
  type Connection,
  type Corner,
  type FestplatzPage,
  type HiddenFree,
  type InfraGeometry,
  type InfraObject,
  type InfraTypeDef,
  type PaperAnchor,
  type PaperFormat,
  type Project,
  type ProjectFile,
  type ShapePart,
  type ShapeTemplate,
  type Sheet,
  type Stand,
  type StandShape,
  type Vec,
} from './types';

export class ProjectFileError extends UserError {
  override name = 'ProjectFileError';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function toProjectFile(project: Project): ProjectFile {
  return { format: 'schelmeplaner', schemaVersion: CURRENT_SCHEMA_VERSION, project };
}

/**
 * Liest den Inhalt von `project.json`: prüft Format und Version, führt Migrationen aus und
 * ergänzt fehlende Felder mit Standardwerten. Wirft `ProjectFileError` mit deutscher Meldung.
 */
export function parseProjectFile(raw: unknown): Project {
  if (!isObj(raw) || raw.format !== 'schelmeplaner') {
    throw new ProjectFileError('Die Datei ist kein Marktplaner-Projekt.');
  }
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFileError('Die Datei hat keine gültige Formatversion.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ProjectFileError(
      `Die Datei wurde mit einer neueren Version von Marktplaner erstellt (Format ${version}). Bitte die App aktualisieren.`,
    );
  }
  const migrated = migrate(raw.project, version);
  if (!isObj(migrated)) throw new ProjectFileError('Die Projektdaten fehlen oder sind beschädigt.');
  return normalizeProject(migrated);
}

function normalizeProject(p: Obj): Project {
  if (typeof p.id !== 'string' || !Array.isArray(p.pages)) {
    throw new ProjectFileError('Die Projektdaten sind unvollständig (ID oder Pages fehlen).');
  }
  const s = isObj(p.settings) ? p.settings : {};
  const numbering = isObj(s.numbering) ? s.numbering : {};
  const snap = isObj(s.snap) ? s.snap : {};
  const tb = isObj(p.titleBlock) ? p.titleBlock : {};
  const ids = new Set<string>();
  const objectIds = new Set<string>();
  const categories = normalizeCategories(p.categories);
  const categoryIds = new Set(categories.map((c) => c.id));
  const infraTypes = normalizeInfraTypes(p.infraTypes);
  const shapeTemplates = normalizeShapeTemplates(p.shapeTemplates);
  const templateIds = new Set(shapeTemplates.map((t) => t.id));
  return {
    id: p.id,
    name: str(p.name, 'Projekt'),
    settings: {
      minFreeWidth: num(s.minFreeWidth, DEFAULT_SETTINGS.minFreeWidth),
      labelFontSize: num(s.labelFontSize, DEFAULT_SETTINGS.labelFontSize),
      labelTemplate: str(s.labelTemplate, DEFAULT_SETTINGS.labelTemplate),
      numbering: {
        scope: numbering.scope === 'global' ? 'global' : 'perPage',
        start: clampStart(num(numbering.start, DEFAULT_SETTINGS.numbering.start)),
        digits: clampDigits(num(numbering.digits, DEFAULT_SETTINGS.numbering.digits)),
      },
      warnOutside: bool(s.warnOutside, DEFAULT_SETTINGS.warnOutside),
      warnOverlap: bool(s.warnOverlap, DEFAULT_SETTINGS.warnOverlap),
      warnDuplicateNr: bool(s.warnDuplicateNr, DEFAULT_SETTINGS.warnDuplicateNr),
      warnInfra: bool(s.warnInfra, DEFAULT_SETTINGS.warnInfra),
      warnPassageWidth: bool(s.warnPassageWidth, DEFAULT_SETTINGS.warnPassageWidth),
      minPassageWidth: clampMinPassage(num(s.minPassageWidth, DEFAULT_SETTINGS.minPassageWidth)),
      warnDistance: bool(s.warnDistance, DEFAULT_SETTINGS.warnDistance),
      snap: {
        front: bool(snap.front, DEFAULT_SETTINGS.snap.front),
        grid: bool(snap.grid, DEFAULT_SETTINGS.snap.grid),
        neighbors: bool(snap.neighbors, DEFAULT_SETTINGS.snap.neighbors),
      },
      snapGap: clampSnapGap(num(s.snapGap, DEFAULT_SETTINGS.snapGap)),
      defaultStandColor: isColor(s.defaultStandColor) ? s.defaultStandColor : DEFAULT_SETTINGS.defaultStandColor,
    },
    pages: p.pages.map((pg, i) => normalizePage(pg, i, ids, objectIds, categoryIds, infraTypes, templateIds)),
    categories,
    infraTypes,
    shapeTemplates,
    titleBlock: { dateText: str(tb.dateText, ''), version: str(tb.version, '') },
    unplaced: arr(p.unplaced),
  };
}

function normalizePage(
  raw: unknown,
  index: number,
  ids: Set<string>,
  objectIds: Set<string>,
  categoryIds: Set<string>,
  types: readonly InfraTypeDef[],
  templateIds: Set<string>,
): FestplatzPage {
  if (!isObj(raw) || typeof raw.id !== 'string' || ids.has(raw.id)) {
    throw new ProjectFileError(`Festplatz-Page Nr. ${index + 1} ist beschädigt (fehlende oder doppelte ID).`);
  }
  ids.add(raw.id);
  const base = createPage(str(raw.name, `Festplatz ${index + 1}`));
  const layersRaw = isObj(raw.layers) ? raw.layers : {};
  const layers = defaultLayers();
  for (const id of LAYER_IDS) {
    const l = layersRaw[id];
    if (isObj(l)) layers[id] = { visible: bool(l.visible, true), locked: bool(l.locked, false) };
  }
  const grid = isObj(raw.grid) ? raw.grid : {};
  const view = isObj(raw.view) ? raw.view : null;
  const mode = raw.numberingMode;
  const background = normalizeBackground(raw.background);
  // E-13: Es gibt nur eine Hintergrund-Sperre (`background.locked`); eine alte Ebenen-Sperre wird übernommen.
  if (background && layers.background.locked) background.locked = true;
  layers.background.locked = false;
  return {
    ...base,
    id: raw.id,
    prefix: str(raw.prefix, ''),
    numberingMode: mode === 'clockwise' || mode === 'manual' ? mode : 'frontLtr',
    ...normalizeClockwise(raw.clockwise),
    powerLimitKw: typeof raw.powerLimitKw === 'number' && Number.isFinite(raw.powerLimitKw) && raw.powerLimitKw > 0 ? raw.powerLimitKw : null,
    blockOverLimit: bool(raw.blockOverLimit, false),
    northAngle: num(raw.northAngle, 0),
    grid: { size: num(grid.size, base.grid.size), visible: bool(grid.visible, base.grid.visible) },
    layers,
    background,
    areas: arr(raw.areas).map((a) => normalizeArea(a, objectIds)).filter((a): a is Area => !!a),
    stands: arr(raw.stands).map((st) => normalizeStand(st, objectIds, categoryIds, templateIds)).filter((st): st is Stand => !!st),
    infra: arr(raw.infra).map((o) => normalizeInfra(o, objectIds, types)).filter((o): o is InfraObject => !!o),
    sheet: normalizeSheet(raw.sheet),
    titleBlock: normalizeAnchor(raw.titleBlock, DEFAULT_TITLE_BLOCK_ANCHOR),
    titleBlockText: str(raw.titleBlockText, ''),
    legend: normalizeAnchor(raw.legend, DEFAULT_LEGEND_ANCHOR),
    scaleBar: normalizeAnchor(raw.scaleBar, DEFAULT_SCALE_BAR_ANCHOR),
    northArrow: normalizeAnchor(raw.northArrow, DEFAULT_NORTH_ARROW_ANCHOR),
    hiddenFree: normalizeHiddenFree(raw.hiddenFree),
    view: view ? { scale: num(view.scale, 10), tx: num(view.tx, 0), ty: num(view.ty, 0) } : null,
  };
}

/** Ausgeblendete Freiflächen (#8); unbrauchbare Einträge und doppelte Schlüssel entfallen. */
function normalizeHiddenFree(v: unknown): HiddenFree[] {
  const seen = new Set<string>();
  const out: HiddenFree[] = [];
  for (const h of arr(v)) {
    if (!isObj(h) || typeof h.key !== 'string' || !h.key || seen.has(h.key)) continue;
    const start = num(h.start, NaN);
    const end = num(h.end, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    seen.add(h.key);
    out.push({ key: h.key, start, end });
  }
  return out;
}

const vecOrNull = (v: unknown): Vec | null =>
  isObj(v) && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;

/** Mittelpunkt und Startrichtung der Nummerierung im Uhrzeigersinn; unbrauchbare Angaben entfallen. */
function normalizeClockwise(raw: unknown): Pick<FestplatzPage, 'clockwise'> {
  const center = isObj(raw) ? vecOrNull(raw.center) : null;
  return isObj(raw) && center ? { clockwise: { center, startAngle: normAngle(num(raw.startAngle, 0)) } } : {};
}

/** Hintergrund prüfen; ein unbrauchbarer Eintrag wird verworfen statt die ganze Datei abzulehnen. */
function normalizeBackground(raw: unknown): Background | null {
  if (!isObj(raw) || typeof raw.assetId !== 'string' || !raw.assetId) return null;
  const kind = raw.kind === 'pdf' || raw.kind === 'svg' || raw.kind === 'image' ? raw.kind : null;
  const size = isObj(raw.pxSize) ? raw.pxSize : {};
  const t = isObj(raw.transform) ? raw.transform : {};
  const w = num(size.w, 0);
  const h = num(size.h, 0);
  const metersPerPx = num(t.metersPerPx, 0);
  if (!kind || !(w > 0) || !(h > 0) || !(metersPerPx > 0)) return null;
  const cal = isObj(raw.calibration) ? raw.calibration : null;
  const p1 = cal ? vecOrNull(cal.p1) : null;
  const p2 = cal ? vecOrNull(cal.p2) : null;
  const meters = cal ? num(cal.meters, 0) : 0;
  return {
    assetId: raw.assetId,
    kind,
    fileName: str(raw.fileName, raw.assetId),
    ...(typeof raw.pdfPage === 'number' ? { pdfPage: raw.pdfPage } : {}),
    ...(typeof raw.pdfPageCount === 'number' ? { pdfPageCount: raw.pdfPageCount } : {}),
    pxSize: { w, h },
    transform: { x: num(t.x, 0), y: num(t.y, 0), metersPerPx, rot: num(t.rot, 0) },
    ...(p1 && p2 && meters > 0 ? { calibration: { p1, p2, meters } } : {}),
    ...(typeof raw.paperScale === 'number' && raw.paperScale > 0 ? { paperScale: raw.paperScale } : {}),
    opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
    locked: bool(raw.locked, false),
  };
}

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Mindestabstand zur gleichen Kategorie (#3): 0,1–1000 m, auf 0,01 m gerundet; sonst null (keine Prüfung). */
export const MIN_DISTANCE_LIMITS = { min: 0.1, max: 1000 } as const;
export function clampMinDistance(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(Math.min(MIN_DISTANCE_LIMITS.max, Math.max(MIN_DISTANCE_LIMITS.min, v)) * 100) / 100;
}

function normalizeCategories(raw: unknown): Category[] {
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const c of arr(raw)) {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: str(c.name, 'Kategorie'), color: isColor(c.color) ? c.color : '#a7adb3', minDistance: clampMinDistance(c.minDistance) });
  }
  return out;
}

/** Rechteckfelder prüfen; null, wenn Position oder Maße unbrauchbar sind. */
function rectOf(o: Obj) {
  const cx = num(o.cx, NaN);
  const cy = num(o.cy, NaN);
  const w = num(o.w, NaN);
  const d = num(o.d, NaN);
  if (![cx, cy].every(Number.isFinite) || !(w > 0) || !(d > 0)) return null;
  return { cx, cy, w, d, rot: normAngle(num(o.rot, 0)) };
}

/** Eindeutige Objekt-ID; doppelte oder fehlende IDs werden neu vergeben. */
function objectId(raw: unknown, ids: Set<string>): string {
  const id = typeof raw === 'string' && raw && !ids.has(raw) ? raw : newId();
  ids.add(id);
  return id;
}

/** Grundfläche prüfen; ein unbrauchbarer Eintrag wird verworfen statt die Datei abzulehnen. */
function normalizeArea(raw: unknown, ids: Set<string>): Area | null {
  if (!isObj(raw)) return null;
  const r = rectOf(raw);
  if (!r) return null;
  return { id: objectId(raw.id, ids), name: str(raw.name, ''), ...r };
}

const CONNECTIONS: readonly Connection[] = ['230V', 'CEE16', 'CEE32'];

function normalizeStand(raw: unknown, ids: Set<string>, categoryIds: Set<string>, templateIds: Set<string>): Stand | null {
  if (!isObj(raw)) return null;
  const r = rectOf(raw);
  if (!r) return null;
  const cat = typeof raw.categoryId === 'string' && categoryIds.has(raw.categoryId) ? raw.categoryId : null;
  return {
    id: objectId(raw.id, ids),
    nr: str(raw.nr, ''),
    nrLocked: bool(raw.nrLocked, false),
    name: str(raw.name, ''),
    owner: str(raw.owner, ''),
    ware: str(raw.ware, ''),
    powerKw: Math.max(0, num(raw.powerKw, 0)),
    connection: CONNECTIONS.includes(raw.connection as Connection) ? (raw.connection as Connection) : null,
    note: str(raw.note, ''),
    categoryId: cat,
    color: isColor(raw.color) ? raw.color : null,
    suppressOutsideWarning: bool(raw.suppressOutsideWarning, false),
    suppressOverlapWarning: bool(raw.suppressOverlapWarning, false),
    suppressDuplicateWarning: bool(raw.suppressDuplicateWarning, false),
    suppressInfraWarning: bool(raw.suppressInfraWarning, false),
    suppressDistanceWarning: bool(raw.suppressDistanceWarning, false),
    shape: isShape(raw.shape) ? raw.shape : 'rect',
    shapeTemplateId: typeof raw.shapeTemplateId === 'string' && templateIds.has(raw.shapeTemplateId) ? raw.shapeTemplateId : null,
    ...r,
  };
}

const isShape = (v: unknown): v is StandShape => v === 'rect' || v === 'ellipse';

/** Formvorlagen (M12) prüfen; Vorlagen ohne brauchbares Teil oder Maß entfallen. */
function normalizeShapeTemplates(raw: unknown): ShapeTemplate[] {
  const seen = new Set<string>();
  const out: ShapeTemplate[] = [];
  for (const t of arr(raw)) {
    if (!isObj(t) || typeof t.id !== 'string' || !t.id || seen.has(t.id)) continue;
    const w = num(t.w, NaN);
    const d = num(t.d, NaN);
    const parts = arr(t.parts).map(normalizeShapePart).filter((x): x is ShapePart => !!x);
    if (!(w > 0) || !(d > 0) || !parts.length) continue;
    seen.add(t.id);
    out.push({ id: t.id, name: str(t.name, 'Form'), w, d, parts });
  }
  return out;
}

function normalizeShapePart(raw: unknown): ShapePart | null {
  if (!isObj(raw) || !isShape(raw.kind)) return null;
  const [x, y, w, h] = [raw.x, raw.y, raw.w, raw.h].map((v) => num(v, NaN)) as [number, number, number, number];
  if (![x, y].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
  return { kind: raw.kind, x, y, w, h };
}

export const MIN_PASSAGE_LIMITS = { min: 0.5, max: 50 } as const;
export const clampMinPassage = (v: number) => clampToLimits(v, MIN_PASSAGE_LIMITS);
export const SNAP_GAP_LIMITS = { min: 0, max: 10 } as const;
export const clampSnapGap = (v: number) => clampToLimits(v, SNAP_GAP_LIMITS);

/**
 * Infrastruktur-Typen prüfen (§11). Feste Typen sind immer vorhanden (fehlende werden an ihrer Stelle
 * ergänzt); Geometrie und Symbol fester Typen sind fest. Eigene Typen mit unbrauchbaren Angaben entfallen.
 */
function normalizeInfraTypes(raw: unknown): InfraTypeDef[] {
  const builtin = new Map(DEFAULT_INFRA_TYPES.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: InfraTypeDef[] = [];
  for (const t of arr(raw)) {
    if (!isObj(t) || typeof t.id !== 'string' || !t.id || seen.has(t.id)) continue;
    const def = builtin.get(t.id);
    const geometry: InfraGeometry | null = def ? def.geometry : GEOMETRIES.includes(t.geometry as InfraGeometry) ? (t.geometry as InfraGeometry) : null;
    if (!geometry) continue;
    seen.add(t.id);
    const lim = INFRA_LIMITS[geometry];
    const base = def ?? { defaultW: geometry === 'point' ? 0 : 3, defaultD: geometry === 'rect' ? 3 : geometry === 'line' ? 0.3 : 0, occupiesArea: false, keepClear: false, color: '#a7adb3' };
    out.push({
      id: t.id,
      builtin: !!def,
      label: str(t.label, def?.label ?? 'Infrastruktur') || (def?.label ?? 'Infrastruktur'),
      geometry,
      color: isColor(t.color) ? t.color : base.color,
      icon: def ? def.icon : isInfraIcon(t.icon) ? t.icon : 'info',
      defaultW: clampToLimits(num(t.defaultW, base.defaultW), lim.w),
      defaultD: clampToLimits(num(t.defaultD, base.defaultD), lim.d),
      occupiesArea: geometry !== 'point' && bool(t.occupiesArea, base.occupiesArea),
      keepClear: geometry !== 'point' && bool(t.keepClear, base.keepClear),
    });
  }
  // fehlende feste Typen an ihrer Standardposition einfügen
  DEFAULT_INFRA_TYPES.forEach((d, i) => {
    if (!seen.has(d.id)) out.splice(Math.min(i, out.length), 0, structuredClone(d));
  });
  return out;
}

/** Infrastruktur-Objekt prüfen; unbekannter Typ oder unbrauchbare Lage → verworfen. */
function normalizeInfra(raw: unknown, ids: Set<string>, types: readonly InfraTypeDef[]): InfraObject | null {
  if (!isObj(raw)) return null;
  const type = types.find((t) => t.id === raw.typeId);
  const cx = num(raw.cx, NaN);
  const cy = num(raw.cy, NaN);
  if (!type || ![cx, cy].every(Number.isFinite)) return null;
  const lim = INFRA_LIMITS[type.geometry];
  const w = num(raw.w, NaN);
  const d = num(raw.d, NaN);
  if (type.geometry !== 'point' && (!(w >= lim.w.min) || !(d >= lim.d.min))) return null;
  const rect = type.geometry === 'rect';
  return {
    id: objectId(raw.id, ids),
    typeId: type.id,
    label: str(raw.label, ''),
    note: str(raw.note, ''),
    powerKw: rect ? Math.max(0, num(raw.powerKw, 0)) : 0,
    connection: rect && CONNECTIONS.includes(raw.connection as Connection) ? (raw.connection as Connection) : null,
    suppressWidthWarning: bool(raw.suppressWidthWarning, false),
    cx,
    cy,
    w: type.geometry === 'point' ? 0 : Math.min(lim.w.max, w),
    d: type.geometry === 'point' ? 0 : Math.min(lim.d.max, d),
    rot: type.geometry === 'point' ? 0 : normAngle(num(raw.rot, 0)),
  };
}

export const SCALE_LIMITS = { min: 10, max: 100000 } as const;

function normalizeSheet(raw: unknown): Sheet {
  const s = isObj(raw) ? raw : {};
  const scale = typeof s.scale === 'number' && Number.isFinite(s.scale) ? Math.round(clampToLimits(s.scale, SCALE_LIMITS)) : null;
  return {
    format: PAPER_FORMATS.includes(s.format as PaperFormat) ? (s.format as PaperFormat) : DEFAULT_SHEET.format,
    orientation: s.orientation === 'portrait' || s.orientation === 'landscape' ? s.orientation : DEFAULT_SHEET.orientation,
    scale,
    cx: num(s.cx, DEFAULT_SHEET.cx),
    cy: num(s.cy, DEFAULT_SHEET.cy),
  };
}

const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];

function normalizeAnchor(raw: unknown, fallback: PaperAnchor): PaperAnchor {
  const a = isObj(raw) ? raw : {};
  return {
    visible: bool(a.visible, fallback.visible),
    corner: CORNERS.includes(a.corner as Corner) ? (a.corner as Corner) : fallback.corner,
    dx: Math.max(0, num(a.dx, fallback.dx)),
    dy: Math.max(0, num(a.dy, fallback.dy)),
  };
}
