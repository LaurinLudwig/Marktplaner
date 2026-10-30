import { categoriesFromList, type CategoryList } from '../categoryLists';
import { newId } from '../id';
import { DEFAULT_STAND_COLOR } from '../objects';
import {
  LAYER_IDS,
  type FestplatzPage,
  type InfraTypeDef,
  type LayerId,
  type LayerState,
  type PaperAnchor,
  type Project,
  type ProjectSettings,
  type Sheet,
} from './types';

export const DEFAULT_SETTINGS: ProjectSettings = {
  minFreeWidth: 0.5,
  labelFontSize: 0.6,
  labelTemplate: '{nr}\n{name}\n{breite}×{tiefe} m',
  numbering: { scope: 'perPage', start: 1, digits: 1 },
  warnOutside: true,
  warnOverlap: true,
  warnDuplicateNr: true,
  warnInfra: true,
  warnPassageWidth: true,
  minPassageWidth: 3.5,
  warnDistance: true,
  snap: { front: true, grid: false, neighbors: true },
  snapGap: 0.3,
  defaultStandColor: DEFAULT_STAND_COLOR,
};

/** Feste Infrastruktur-Typen (spec.md §11). Reihenfolge = Reihenfolge in Werkzeuggruppe und Legende. */
export const DEFAULT_INFRA_TYPES: InfraTypeDef[] = [
  { id: 'barrierMobile', builtin: true, label: 'Mobile Sperre', geometry: 'line', color: '#e0a526', icon: 'fence', defaultW: 3.5, defaultD: 0.3, occupiesArea: false, keepClear: true },
  { id: 'barrierFixed', builtin: true, label: 'Feste Sperre', geometry: 'line', color: '#c0392b', icon: 'block', defaultW: 4, defaultD: 0.8, occupiesArea: false, keepClear: true },
  { id: 'medical', builtin: true, label: 'Sanitätsdienst', geometry: 'rect', color: '#e74c3c', icon: 'medical_services', defaultW: 6, defaultD: 3, occupiesArea: true, keepClear: true },
  { id: 'ambulance', builtin: true, label: 'RTW-Platz', geometry: 'rect', color: '#d35454', icon: 'ambulance', defaultW: 8, defaultD: 3.5, occupiesArea: true, keepClear: true },
  { id: 'toilet', builtin: true, label: 'Toilette', geometry: 'rect', color: '#3a86c8', icon: 'wc', defaultW: 6, defaultD: 2.5, occupiesArea: true, keepClear: true },
  { id: 'waste', builtin: true, label: 'Müllcontainer', geometry: 'rect', color: '#6d7a80', icon: 'delete', defaultW: 1.5, defaultD: 1.2, occupiesArea: true, keepClear: true },
  { id: 'narrowPassage', builtin: true, label: 'Enge Durchfahrt', geometry: 'line', color: '#9b59b6', icon: 'arrow_range', defaultW: 3.5, defaultD: 0, occupiesArea: true, keepClear: true },
  { id: 'marker', builtin: true, label: 'Marker', geometry: 'point', color: '#16a085', icon: 'location_on', defaultW: 0, defaultD: 0, occupiesArea: false, keepClear: false },
];

export const DEFAULT_SHEET: Sheet = { format: 'A3', orientation: 'landscape', scale: null, cx: 0, cy: 0 };
export const DEFAULT_TITLE_BLOCK_ANCHOR: PaperAnchor = { visible: true, corner: 'br', dx: 10, dy: 10 };
export const DEFAULT_LEGEND_ANCHOR: PaperAnchor = { visible: true, corner: 'bl', dx: 10, dy: 10 };
export const DEFAULT_SCALE_BAR_ANCHOR: PaperAnchor = { visible: true, corner: 'tl', dx: 10, dy: 10 };
export const DEFAULT_NORTH_ARROW_ANCHOR: PaperAnchor = { visible: true, corner: 'tr', dx: 10, dy: 10 };

export function defaultLayers(): Record<LayerId, LayerState> {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, { visible: true, locked: false }])) as Record<
    LayerId,
    LayerState
  >;
}

export function createPage(name: string): FestplatzPage {
  return {
    id: newId(),
    name,
    prefix: '',
    numberingMode: 'frontLtr',
    powerLimitKw: null,
    blockOverLimit: false,
    northAngle: 0,
    grid: { size: 1, visible: true },
    layers: defaultLayers(),
    background: null,
    areas: [],
    stands: [],
    infra: [],
    sheet: { ...DEFAULT_SHEET },
    titleBlock: { ...DEFAULT_TITLE_BLOCK_ANCHOR },
    titleBlockText: '',
    legend: { ...DEFAULT_LEGEND_ANCHOR },
    scaleBar: { ...DEFAULT_SCALE_BAR_ANCHOR },
    northArrow: { ...DEFAULT_NORTH_ARROW_ANCHOR },
    hiddenFree: [],
    view: null,
  };
}

/** Neues Projekt; mit `list` starten die Kategorien aus dieser Kategorieliste (#1), sonst leer. */
export function createProject(name = 'Neues Projekt', list: CategoryList | null = null): Project {
  return {
    id: newId(),
    name,
    settings: structuredClone(DEFAULT_SETTINGS),
    pages: [createPage('Festplatz 1')],
    categories: list ? categoriesFromList(list) : [],
    infraTypes: structuredClone(DEFAULT_INFRA_TYPES),
    shapeTemplates: [],
    titleBlock: { dateText: '', version: '' },
    unplaced: [],
  };
}
