import { produce } from 'immer';
import { create } from 'zustand';
import type { Preview } from '../core/derive';
import type { Assets, ProjectBundle } from '../core/fileFormat';
import { expiredHiddenFree } from '../core/hiddenFree';
import { createProject } from '../core/model/defaults';
import type { Id, Project, Vec, View } from '../core/model/types';
import type { PaperKind } from '../core/paper';
import type { Bounds } from '../core/viewport';
import { APP_KEY_PREFIX } from '../platform/legacyKeys';
import * as H from './history';


export const START_PAGE = 'start';
export type PageRef = typeof START_PAGE | Id;

export type ToolId = 'select' | 'hand' | 'zoom' | 'measure' | 'calibrate' | 'area' | 'stand' | 'infra' | 'titleBlock' | 'numberCenter';

/**
 * Auswahl auf der aktiven Page: der Hintergrund, Objekte (Grundflächen, Geschäfte, Infrastruktur gemischt) oder ein
 * Element des Blatts (M7: Rahmen, Schriftfeld, Legende; nie zusammen mit Objekten).
 */
export type PaperElement = 'sheet' | PaperKind;
export type Selection = { kind: 'background' } | { kind: 'objects'; ids: Id[] } | { kind: 'paper'; element: PaperElement } | null;
export type Theme = 'dark' | 'light';

export interface UiState {
  activePage: PageRef;
  tool: ToolId;
  selection: Selection;
  sidebarOpen: boolean;
  /** Tab blendet alle Panels aus (wie in Illustrator). */
  panelsHidden: boolean;
  shortcutsOpen: boolean;
  /** Page, deren Tab gerade umbenannt wird. */
  renamingPage: Id | null;
  theme: Theme;
  /** App-Einstellung pro Rechner: Wischrichtung des Trackpads umkehren (QA-M1-07). */
  invertPan: boolean;
  /** Startbildschirm mit „Zuletzt geöffnet“ (#11); erscheint beim Start der Desktop-App ohne Projekt. */
  startScreen: boolean;
  /** App-Einstellung pro Rechner: Deckkraft des Rasters 0–1 (#1); 1 = Aussehen bis M9. */
  gridOpacity: number;
  /** Bildraten-Anzeige über der Zeichenfläche (Messen in der Desktop-App); nicht gespeichert, anfangs aus. */
  fpsVisible: boolean;
  /** Größe der Zeichenfläche in px (für Zoom-Befehle ohne Mausposition). */
  viewport: { w: number; h: number };
  /**
   * Sprung von der Start-Page (M6-09): Die Zeichenfläche der Page zoomt auf `bounds`, sobald sie ihre Größe kennt,
   * hebt `flash` kurz hervor und setzt das Feld zurück.
   */
  focus: FocusRequest | null;
  /** Typ des Infrastruktur-Werkzeugs (zuletzt genutzt; Ansichtseinstellung, nur für die Sitzung, M7). */
  infraTypeId: Id;
}

export interface FocusRequest {
  pageId: Id;
  bounds: Bounds;
  /** Umrisse in Weltkoordinaten, die kurz aufleuchten. */
  flash: Vec[][];
}

export interface AppState {
  project: Project;
  assets: Assets;
  filePath: string | null;
  fileName: string | null;
  /** headId der Historie beim letzten Speichern; -1 = nie gespeichert, aber mit Inhalt (wiederhergestellt). */
  savedHead: number;
  history: H.History;
  /** Ansicht je Page. Gehört nicht zur Undo-Historie. */
  views: Record<Id, View>;
  /**
   * Letzte Ansichtsänderung kam von einer fortlaufenden Geste (Mausrad, Pinch, Ansicht ziehen). Dann
   * zeigt die Zeichenfläche zwischengespeicherte Ebenen per CSS-Transform; Sprünge (Knöpfe, Kurzbefehle,
   * Einpassen) zeichnen sofort scharf (Canvas.tsx, QA-M4-03).
   */
  viewLive: boolean;
  ui: UiState;
  /**
   * Flüchtige Vorschau während einer Geste (Ziehen, Drehen, Größe ändern). Nicht in der Historie;
   * beim Loslassen wird sie mit genau einem `change` übernommen (siehe core/derive.ts).
   */
  preview: Preview | null;

  change: (label: string, recipe: H.Recipe, opts?: H.RecordOptions) => boolean;
  setPreview: (preview: Preview | null) => void;
  /**
   * Ansichtseinstellung im Projekt ändern (z. B. Raster ein/aus): kein Undo-Schritt, markiert das
   * Projekt nicht als ungespeichert, wird beim nächsten Speichern aber mitgeschrieben (QA-M2-05).
   * Nur für Felder, die von keiner Undo-Änderung berührt werden.
   */
  changeView: (recipe: H.Recipe) => void;
  beginTransaction: (label: string) => void;
  commitTransaction: () => void;
  /** Offene Transaktion verwerfen (Esc während einer Geste). */
  abortTransaction: () => void;
  undo: () => void;
  redo: () => void;
  loadBundle: (bundle: ProjectBundle, file: { path: string | null; name: string | null; dirty?: boolean }) => void;
  markSaved: (path: string | null, name: string) => void;
  setUi: (patch: Partial<UiState>) => void;
  /** Eingebettete Datei ablegen (nicht Teil der Undo-Historie; nur verwendete Dateien werden gespeichert). */
  addAsset: (id: string, bytes: Uint8Array) => void;
  setView: (pageId: Id, view: View, live?: boolean) => void;
}

const THEME_KEY = `${APP_KEY_PREFIX}theme`;
const INVERT_PAN_KEY = `${APP_KEY_PREFIX}invertPan`;
const GRID_OPACITY_KEY = `${APP_KEY_PREFIX}gridOpacity`;

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function saveInvertPan(on: boolean) {
  try {
    localStorage.setItem(INVERT_PAN_KEY, on ? '1' : '0');
  } catch {
    /* Einstellung ist nur Komfort */
  }
}
function loadGridOpacity(): number {
  const v = Number(loadPref(GRID_OPACITY_KEY) ?? 1);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
export function saveGridOpacity(v: number) {
  try {
    localStorage.setItem(GRID_OPACITY_KEY, String(v));
  } catch {
    /* Einstellung ist nur Komfort */
  }
}
function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
export function saveTheme(t: Theme) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* Einstellung ist nur Komfort */
  }
}

/** Hebt eine Auswahl auf, deren Objekt es nicht mehr gibt (z. B. nach Undo). */
function validSelection(project: Project, active: PageRef, sel: Selection): Selection {
  if (!sel) return null;
  const page = project.pages.find((p) => p.id === active);
  if (!page) return null;
  if (sel.kind === 'background') return page.background ? sel : null;
  if (sel.kind === 'paper') return sel;
  const exists = new Set([...page.areas.map((a) => a.id), ...page.stands.map((st) => st.id), ...page.infra.map((o) => o.id)]);
  const ids = sel.ids.filter((id) => exists.has(id));
  if (!ids.length) return null;
  return ids.length === sel.ids.length ? sel : { kind: 'objects', ids };
}

/** Sorgt dafür, dass die aktive Page nach Undo/Löschen noch existiert. */
function validActive(project: Project, active: PageRef): PageRef {
  if (active === START_PAGE || project.pages.some((p) => p.id === active)) return active;
  return project.pages[0]?.id ?? START_PAGE;
}

function normalizeUi(project: Project, ui: UiState): UiState {
  const activePage = validActive(project, ui.activePage);
  const selection = activePage === ui.activePage ? validSelection(project, activePage, ui.selection) : null;
  return { ...ui, activePage, selection };
}

function initialState(project: Project) {
  return {
    project,
    assets: {} as Assets,
    filePath: null,
    fileName: null,
    savedHead: 0,
    history: H.emptyHistory(),
    views: {} as Record<Id, View>,
  };
}

export const useStore = create<AppState>()((set, get) => {
  const first = createProject();
  return {
    ...initialState(first),
    ui: {
      activePage: first.pages[0]?.id ?? START_PAGE,
      tool: 'select',
      selection: null,
      sidebarOpen: true,
      panelsHidden: false,
      shortcutsOpen: false,
      renamingPage: null,
      theme: loadTheme(),
      invertPan: loadPref(INVERT_PAN_KEY) === '1',
      gridOpacity: loadGridOpacity(),
      startScreen: false,
      fpsVisible: false,
      viewport: { w: 0, h: 0 },
      focus: null,
      infraTypeId: 'barrierMobile',
    },
    preview: null,
    viewLive: false,

    change(label, recipe, opts) {
      const s = get();
      let r = H.record(s.project, s.history, label, recipe, opts);
      if (!r) return false;
      // Ausgeblendete Freiflächen, deren Lücke sich geändert hat, verfallen im selben Undo-Schritt (#8)
      const pruned = expiredHiddenFree(s.project, r.project);
      if (pruned.size) {
        r =
          H.record(s.project, s.history, label, (d) => {
            recipe(d);
            for (const pg of d.pages) {
              const keep = pruned.get(pg.id);
              if (keep) pg.hiddenFree = [...keep];
            }
          }, opts) ?? r;
      }
      set({ project: r.project, history: r.history, ui: normalizeUi(r.project, s.ui) });
      return true;
    },
    setPreview(preview) {
      set({ preview });
    },
    changeView(recipe) {
      set({ project: produce(get().project, recipe) });
    },
    beginTransaction(label) {
      set({ history: H.beginTransaction(get().history, label) });
    },
    commitTransaction() {
      set({ history: H.commitTransaction(get().history) });
    },
    abortTransaction() {
      const s = get();
      const r = H.abortTransaction(s.project, s.history);
      set({ project: r.project, history: r.history, ui: normalizeUi(r.project, s.ui) });
    },
    undo() {
      const s = get();
      const r = H.undo(s.project, s.history);
      if (r) set({ project: r.project, history: r.history, ui: normalizeUi(r.project, s.ui) });
    },
    redo() {
      const s = get();
      const r = H.redo(s.project, s.history);
      if (r) set({ project: r.project, history: r.history, ui: normalizeUi(r.project, s.ui) });
    },
    loadBundle({ project, assets }, file) {
      const views: Record<Id, View> = {};
      for (const p of project.pages) if (p.view) views[p.id] = p.view;
      set({
        ...initialState(project),
        assets,
        filePath: file.path,
        fileName: file.name,
        savedHead: file.dirty ? -1 : 0,
        views,
        preview: null,
        ui: { ...get().ui, activePage: project.pages[0]?.id ?? START_PAGE, tool: 'select', selection: null },
      });
    },
    markSaved(path, name) {
      set({ filePath: path, fileName: name, savedHead: H.headId(get().history) });
    },
    setUi(patch) {
      const ui = get().ui;
      const next = { ...ui, ...patch };
      // Auswahl gehört zur Page: beim Seitenwechsel aufheben
      if (patch.activePage !== undefined && patch.activePage !== ui.activePage && patch.selection === undefined) next.selection = null;
      // Eine laufende Geste endet mit Werkzeug- oder Seitenwechsel ohne Übernahme
      const reset = (patch.tool !== undefined && patch.tool !== ui.tool) || next.activePage !== ui.activePage;
      set(reset ? { ui: next, preview: null } : { ui: next });
    },
    addAsset(id, bytes) {
      if (get().assets[id]) return;
      set({ assets: { ...get().assets, [id]: bytes } });
    },
    setView(pageId, view, live = false) {
      set({ views: { ...get().views, [pageId]: view }, viewLive: live });
    },
  };
});

export const selectDirty = (s: AppState) => H.headId(s.history) !== s.savedHead;
export const selectCanUndo = (s: AppState) => s.history.past.length > 0 || !!s.history.open?.patches.length;
export const selectCanRedo = (s: AppState) => s.history.future.length > 0;

/** Projekt mit den aktuellen Ansichten, so wie es gespeichert wird. */
export function projectForSave(s: AppState): Project {
  return { ...s.project, pages: s.project.pages.map((p) => ({ ...p, view: s.views[p.id] ?? p.view })) };
}
