/**
 * Datenmodell des Projekts (wird als `project.json` gespeichert).
 *
 * Konventionen (aus dem Prototyp übernommen):
 * - Einheit Meter, x nach rechts, y nach unten.
 * - Drehung in Grad, positiv = im Uhrzeigersinn auf dem Bildschirm.
 * - Rechteck { cx, cy, w, d, rot }: Mittelpunkt, Breite (lokale x-Achse), Tiefe (lokale y-Achse).
 * - Kanten: 0 = oben, 1 = rechts, 2 = unten, 3 = links (ungedreht). Grundfläche und Geschäft haben
 *   ihre Vorderseite immer an Kante 2; `w` ist damit stets die Länge der Vorderseite. Wird eine
 *   andere Kante zur Vorderseite, wird das Rechteck umorientiert (siehe geometry/rect.ts `setFront`).
 * - Gespeicherte Positionen und Maße sind auf 0,01 m gerundet, Drehungen auf 0,1° (`roundRect`).
 *
 * Abgeleitete Daten (Freiflächen, Warnungen, Summen) werden nie gespeichert.
 */

export type Id = string;

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot: number;
}

export const LAYER_IDS = ['background', 'areas', 'free', 'stands', 'infra', 'labels', 'sheet'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export interface LayerState {
  visible: boolean;
  locked: boolean;
}

export interface Category {
  id: Id;
  name: string;
  color: string;
}

/** IDs der festen Infrastruktur-Typen (spec.md §11). Eigene Typen haben eine zufällige ID. */
export const BUILTIN_INFRA_IDS = [
  'barrierMobile',
  'barrierFixed',
  'medical',
  'ambulance',
  'toilet',
  'waste',
  'narrowPassage',
  'marker',
] as const;
export type BuiltinInfraId = (typeof BUILTIN_INFRA_IDS)[number];

/** Geometrie eines Infrastruktur-Typs. Gespeichert wird immer ein Rechteck (siehe `InfraObject`). */
export type InfraGeometry = 'rect' | 'line' | 'point';

export interface InfraTypeDef {
  /** Bei festen Typen eine der `BUILTIN_INFRA_IDS`. */
  id: Id;
  builtin: boolean;
  label: string;
  geometry: InfraGeometry;
  color: string;
  /** Name eines Symbols aus `INFRA_ICONS` (core/infra.ts). */
  icon: string;
  /** Standardmaß beim Anlegen: Rechteck B × T, Linie Länge × Stärke, Punkt 0 × 0. */
  defaultW: number;
  defaultD: number;
  /** Belegt die Achse einer Grundfläche wie ein Geschäft (dort keine Freifläche, spec.md §4). */
  occupiesArea: boolean;
  /** Ein Stand darin bekommt die Warnung „Infrastruktur“ (spec.md §3, §11). */
  keepClear: boolean;
}

/** Index einer Rechteckkante (lokal, ungedreht): 0 oben, 1 rechts, 2 unten, 3 links. */
export type EdgeIndex = 0 | 1 | 2 | 3;

/** Grundfläche. Vorderseite = Kante 2. */
export interface Area extends Rect {
  id: Id;
  name: string;
}

export type Connection = '230V' | 'CEE16' | 'CEE32';

/** Grundform eines Stands (M12, #9). Nur Darstellung; gerechnet wird immer mit dem Rechteck B × T (Hitbox). */
export type StandShape = 'rect' | 'ellipse';
export const STAND_SHAPES: readonly StandShape[] = ['rect', 'ellipse'];

/**
 * Teil einer Formvorlage: Rechteck oder Ellipse ohne Drehung, relativ (0–1) zum Hüllrechteck der Vorlage.
 * x/y = linke obere Ecke (y nach unten, die Vorderseite ist unten), w/h = Breite und Tiefe.
 */
export interface ShapePart {
  kind: StandShape;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Formvorlage (M12): aus Teilen zusammengesetzter Umriss; `w` × `d` ist das Vorschlagsmaß in Metern. */
export interface ShapeTemplate {
  id: Id;
  name: string;
  w: number;
  d: number;
  parts: ShapePart[];
}

export interface Stand extends Rect {
  id: Id;
  nr: string;
  nrLocked: boolean;
  name: string;
  owner: string;
  ware: string;
  powerKw: number;
  connection: Connection | null;
  note: string;
  categoryId: Id | null;
  /** Eigene Farbe; überschreibt die Kategoriefarbe. null = Farbe der Kategorie bzw. Standardfarbe des Projekts. */
  color: string | null;
  /** Warnung „außerhalb“ für diesen Stand ignorieren. */
  suppressOutsideWarning: boolean;
  /** Warnung „Überlappung“ für diesen Stand ignorieren (die Warnung am anderen Stand bleibt). */
  suppressOverlapWarning: boolean;
  /** Warnung „doppelte Nummer“ für diesen Stand ignorieren. */
  suppressDuplicateWarning: boolean;
  /** Warnung „Infrastruktur“ für diesen Stand ignorieren. */
  suppressInfraWarning: boolean;
  /** Grundform (M12); gilt, solange keine Formvorlage gesetzt ist. */
  shape: StandShape;
  /** Formvorlage (M12); hat Vorrang vor `shape`. */
  shapeTemplateId: Id | null;
}

/**
 * Infrastruktur-Objekt (spec.md §11). Rechteck wie ein Stand; bei Linien ist `w` die Länge (entlang der lokalen
 * x-Achse, Richtung = `rot`) und `d` die Strichstärke (auch 0), bei Punkten sind `w` und `d` 0.
 * Bei der engen Durchfahrt ist `w` die lichte Breite.
 */
export interface InfraObject extends Rect {
  id: Id;
  typeId: Id;
  /** Bezeichnung; beim Marker der angezeigte Text. */
  label: string;
  note: string;
  /** Nur bei Rechteck-Typen; sonst 0 bzw. null. */
  powerKw: number;
  connection: Connection | null;
  /** Warnung „Durchfahrt zu eng“ für dieses Objekt ignorieren. */
  suppressWidthWarning: boolean;
}

export const PAPER_FORMATS = ['A4', 'A3', 'A2', 'A1', 'A0'] as const;
export type PaperFormat = (typeof PAPER_FORMATS)[number];

/** Blatt einer Festplatz-Page (spec.md §8): Papier für Druck und PDF. */
export interface Sheet {
  format: PaperFormat;
  orientation: 'portrait' | 'landscape';
  /** Maßstab 1:n; null = an Seite anpassen. */
  scale: number | null;
  /** Mitte des Blatts in Metern (nur bei festem Maßstab maßgeblich). */
  cx: number;
  cy: number;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Lage eines Papier-Elements: Ecke des Blatts und Abstand in mm von deren beiden Rändern. */
export interface PaperAnchor {
  visible: boolean;
  corner: Corner;
  dx: number;
  dy: number;
}

export type BackgroundKind = 'pdf' | 'svg' | 'image';

export interface Background {
  /** Schlüssel der eingebetteten Datei in `assets/` (Inhalts-Hash + Endung). */
  assetId: string;
  kind: BackgroundKind;
  /** Ursprünglicher Dateiname, nur zur Anzeige. */
  fileName: string;
  /** Bei PDFs: gewählte Seite (1-basiert) und Seitenzahl der Originaldatei. Eingebettet ist nur diese Seite. */
  pdfPage?: number;
  pdfPageCount?: number;
  /** Größe in Quell-Einheiten: Pixel (PNG/JPEG), Nutzereinheiten (SVG), Punkte (PDF). */
  pxSize: { w: number; h: number };
  /** Siehe core/background.ts. */
  transform: { x: number; y: number; metersPerPx: number; rot: number };
  /** Zuletzt verwendete Kalibrierpunkte in Quell-Einheiten und der eingegebene Abstand. */
  calibration?: { p1: Vec; p2: Vec; meters: number };
  /** Bei PDFs: direkt eingegebener Planmaßstab 1:n (Alternative zur 2-Punkt-Kalibrierung). */
  paperScale?: number;
  opacity: number;
  locked: boolean;
}

export interface View {
  /** Pixel pro Meter. */
  scale: number;
  tx: number;
  ty: number;
}

export type NumberingScope = 'global' | 'perPage';
/** `frontLtr` = links → rechts über den ganzen Festplatz (Name aus der Planung, im Dateiformat beibehalten). */
export type NumberingMode = 'frontLtr' | 'clockwise' | 'manual';

/** Nummerierung im Uhrzeigersinn: Mittelpunkt und Startrichtung (Grad im Uhrzeigersinn ab Norden der Page). */
export interface ClockwiseSettings {
  center: Vec;
  startAngle: number;
}

/** Ausgeblendete Freifläche: Schlüssel und Lage auf der Achse der Grundfläche (auf 0,01 m gerundet). */
export interface HiddenFree {
  key: string;
  start: number;
  end: number;
}

export interface FestplatzPage {
  id: Id;
  name: string;
  prefix: string;
  numberingMode: NumberingMode;
  clockwise?: ClockwiseSettings;
  powerLimitKw: number | null;
  blockOverLimit: boolean;
  northAngle: number;
  grid: { size: number; visible: boolean };
  layers: Record<LayerId, LayerState>;
  background: Background | null;
  /** Array-Reihenfolge der Grundflächen: Bei Überlappung gewinnt die frühere (spec.md §4). */
  areas: Area[];
  stands: Stand[];
  infra: InfraObject[];
  sheet: Sheet;
  /** Lage des Schriftfelds auf dem Blatt; die Felder stehen projektweit in `Project.titleBlock`. */
  titleBlock: PaperAnchor;
  /** Freitext des Schriftfelds dieser Page. */
  titleBlockText: string;
  legend: PaperAnchor;
  /** Maßstabsbalken und Nordpfeil (seit M8, Formatversion 5). */
  scaleBar: PaperAnchor;
  northArrow: PaperAnchor;
  /**
   * Ausgeblendete Freiflächen (seit M11, #8, Formatversion 7): stabiler Schlüssel (spec.md §4) und Achsenintervall.
   * Passt keine aktuelle Freifläche mehr (anderer Schlüssel oder Intervall um mehr als 0,01 m verschoben), verfällt
   * der Eintrag.
   */
  hiddenFree: HiddenFree[];
  /** Zuletzt verwendete Ansicht; wird beim Speichern geschrieben, gehört nicht zur Undo-Historie. */
  view: View | null;
}

export interface ProjectSettings {
  minFreeWidth: number;
  /** Schriftgröße der Standbeschriftung in Metern (Planeinheiten). */
  labelFontSize: number;
  labelTemplate: string;
  /** Nummernkreis, Startnummer und Stellenzahl (führende Nullen bis `digits` Stellen). */
  numbering: { scope: NumberingScope; start: number; digits: number };
  warnOutside: boolean;
  warnOverlap: boolean;
  warnDuplicateNr: boolean;
  /** Warnung „Infrastruktur“: Stand in einem Objekt mit „freihalten“ (§11). */
  warnInfra: boolean;
  /** Warnung „Durchfahrt zu eng“ und die Mindestbreite in Metern (§11). */
  warnPassageWidth: boolean;
  minPassageWidth: number;
  /** Fang-Umschalter: Ansichtseinstellung (kein Undo-Schritt), wird aber mitgespeichert. */
  snap: { front: boolean; grid: boolean; neighbors: boolean };
  /** Abstand in Metern, mit dem ein Stand an einem Nachbarstand einrastet (#2); 0 = bündig. */
  snapGap: number;
  /** Farbe der Stände ohne eigene Farbe und ohne Kategorie (#3). */
  defaultStandColor: string;
}

export interface Vendor {
  id: Id;
  name: string;
  owner: string;
  ware: string;
  w: number;
  d: number;
  powerKw: number;
  connection: Connection | null;
  note: string;
}

export interface Project {
  id: Id;
  name: string;
  settings: ProjectSettings;
  /** Festplatz-Pages in Tab-Reihenfolge. Die Start-Page ist implizit und immer die erste. */
  pages: FestplatzPage[];
  categories: Category[];
  infraTypes: InfraTypeDef[];
  /** Formvorlagen der Stände (M12, §3 „Form“). */
  shapeTemplates: ShapeTemplate[];
  /** Projektweite Felder des Schriftfelds (§8). */
  titleBlock: { dateText: string; version: string };
  unplaced: Vendor[];
}

export interface ProjectFile {
  format: 'schelmeplaner';
  schemaVersion: number;
  project: Project;
}
