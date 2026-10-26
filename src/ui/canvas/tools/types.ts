import type { ReactNode } from 'react';
import type { FestplatzPage, Id, InfraGeometry, Vec, View } from '../../../core/model/types';
import type { SnapResult } from '../../../core/snap';
import type { PagePaper } from '../../../core/paper';

/** Fangradius in Bildschirmpixeln (Messen, Kalibrieren und Fang beim Ziehen, M4). */
export const SNAP_PX = 8;

/** Was ein Werkzeug von der Zeichenfläche bekommt. */
export interface ToolContext {
  page: FestplatzPage;
  view: View;
  /** Weltpunkt → Bildschirmpunkt (relativ zur Zeichenfläche). */
  toScreen: (p: Vec) => Vec;
  /** Bildschirmpunkt → Weltpunkt. */
  toWorld: (p: Vec) => Vec;
  /** Fang am nächsten Objekt-Eckpunkt bzw. an der nächsten Kante (siehe core/snap.ts); `exclude` fängt nicht. */
  snap: (p: Vec, exclude?: Id) => SnapResult | null;
  /** Geometrie eines Infrastruktur-Typs (M7). */
  geometryOf: (typeId: Id) => InfraGeometry | undefined;
  /** Symbolgröße der Marker in Metern (M7, folgt der Schriftgröße der Beschriftung). */
  markerSize: number;
  /** Blatt und Papier-Elemente der Page (M7). */
  paper: PagePaper;
}

export interface ToolPointer {
  world: Vec;
  screen: Vec;
  shiftKey: boolean;
  altKey: boolean;
  /** Cmd (macOS) bzw. Strg (Windows): schaltet beim Ziehen den Fang aus (M4-08). */
  modKey: boolean;
  /** Getroffenes DOM-Element (z. B. Hintergrund); Objekte werden geometrisch getroffen (core/hit.ts). */
  target: Element | null;
}

/** Schnittstelle der Werkzeug-Hooks (useMeasureTool, useCalibrateTool, useSelectTool, useCreateTool). */
export interface ToolHandlers {
  /** true = Ereignis verarbeitet (Zeichenfläche macht dann nichts weiter). */
  onPointerDown(p: ToolPointer): boolean;
  onPointerMove(p: ToolPointer): void;
  onPointerUp(p: ToolPointer): void;
  /** true = Taste verarbeitet. */
  onKeyDown(e: KeyboardEvent): boolean;
  /** Zeichnungen in Bildschirmkoordinaten (SVG). */
  overlay: ReactNode;
  /** HTML über der Zeichenfläche (Eingabefelder, Hinweise). */
  panel: ReactNode;
  /** Zusätzliche CSS-Klasse für die Zeichenfläche (Mauszeiger). */
  cursor?: string;
}
