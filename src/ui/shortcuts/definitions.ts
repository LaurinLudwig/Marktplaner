/**
 * Zentrale Shortcut-Konfiguration. Werkzeugleiste, Tooltips, Menüs und die Übersicht (?)
 * lesen ihre Tasten ausschließlich von hier. Neue Funktionen tragen sich hier ein.
 */
export type ShortcutGroup = 'Datei' | 'Bearbeiten' | 'Beim Ziehen' | 'Werkzeuge' | 'Ansicht' | 'Pages' | 'Start-Page' | 'Fenster';

export interface ShortcutDef {
  id: string;
  label: string;
  group: ShortcutGroup;
  /** Erste Kombination wird angezeigt, weitere sind Alternativen. */
  keys: string[];
}

const pageJumps: ShortcutDef[] = Array.from({ length: 9 }, (_, i) => ({
  id: `page.goto${i + 1}`,
  label: `Zu Festplatz ${i + 1}`,
  group: 'Pages' as const,
  keys: [`Alt+${i + 1}`],
}));

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'file.new', label: 'Neues Projekt', group: 'Datei', keys: ['Mod+N'] },
  { id: 'file.open', label: 'Projekt öffnen …', group: 'Datei', keys: ['Mod+O'] },
  { id: 'file.save', label: 'Speichern', group: 'Datei', keys: ['Mod+S'] },
  { id: 'file.saveAs', label: 'Speichern unter …', group: 'Datei', keys: ['Mod+Shift+S'] },
  { id: 'file.importBackground', label: 'Hintergrund importieren …', group: 'Datei', keys: ['Mod+Shift+P'] },
  { id: 'file.exportPdf', label: 'Als PDF exportieren …', group: 'Datei', keys: ['Mod+P'] },

  { id: 'edit.undo', label: 'Rückgängig', group: 'Bearbeiten', keys: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Wiederholen', group: 'Bearbeiten', keys: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'edit.cut', label: 'Ausschneiden', group: 'Bearbeiten', keys: ['Mod+X'] },
  { id: 'edit.copy', label: 'Kopieren', group: 'Bearbeiten', keys: ['Mod+C'] },
  { id: 'edit.paste', label: 'Einfügen', group: 'Bearbeiten', keys: ['Mod+V'] },
  { id: 'edit.duplicate', label: 'Duplizieren', group: 'Bearbeiten', keys: ['Mod+D'] },
  { id: 'edit.delete', label: 'Löschen', group: 'Bearbeiten', keys: ['Delete', 'Backspace'] },
  { id: 'edit.selectAll', label: 'Alles auswählen', group: 'Bearbeiten', keys: ['Mod+A'] },
  { id: 'edit.deselect', label: 'Auswahl aufheben', group: 'Bearbeiten', keys: ['Escape'] },
  { id: 'numbering.renumber', label: 'Neu nummerieren …', group: 'Bearbeiten', keys: ['Mod+Alt+N'] },
  { id: 'edit.nudgeLeft', label: 'Nach links verschieben (0,1 m)', group: 'Bearbeiten', keys: ['ArrowLeft'] },
  { id: 'edit.nudgeRight', label: 'Nach rechts verschieben (0,1 m)', group: 'Bearbeiten', keys: ['ArrowRight'] },
  { id: 'edit.nudgeUp', label: 'Nach oben verschieben (0,1 m)', group: 'Bearbeiten', keys: ['ArrowUp'] },
  { id: 'edit.nudgeDown', label: 'Nach unten verschieben (0,1 m)', group: 'Bearbeiten', keys: ['ArrowDown'] },
  { id: 'edit.nudgeLeftBig', label: 'Nach links verschieben (1 m)', group: 'Bearbeiten', keys: ['Shift+ArrowLeft'] },
  { id: 'edit.nudgeRightBig', label: 'Nach rechts verschieben (1 m)', group: 'Bearbeiten', keys: ['Shift+ArrowRight'] },
  { id: 'edit.nudgeUpBig', label: 'Nach oben verschieben (1 m)', group: 'Bearbeiten', keys: ['Shift+ArrowUp'] },
  { id: 'edit.nudgeDownBig', label: 'Nach unten verschieben (1 m)', group: 'Bearbeiten', keys: ['Shift+ArrowDown'] },

  // Nur Anzeige in der Übersicht (kein Befehl): Tasten, die während des Ziehens wirken (M4)
  { id: 'drag.constrain', label: 'Richtung beschränken (waagerecht, senkrecht, 45°; an der Vorderseite halten)', group: 'Beim Ziehen', keys: ['Shift+Ziehen'] },
  { id: 'drag.duplicate', label: 'Duplizieren (Alt beim Loslassen)', group: 'Beim Ziehen', keys: ['Alt+Ziehen'] },
  { id: 'drag.noSnap', label: 'Fang vorübergehend aus', group: 'Beim Ziehen', keys: ['Mod+Ziehen'] },

  { id: 'tool.select', label: 'Auswahl', group: 'Werkzeuge', keys: ['V'] },
  { id: 'tool.hand', label: 'Hand', group: 'Werkzeuge', keys: ['H'] },
  { id: 'tool.zoom', label: 'Zoom', group: 'Werkzeuge', keys: ['Z'] },
  { id: 'tool.area', label: 'Grundfläche erstellen', group: 'Werkzeuge', keys: ['F'] },
  { id: 'tool.stand', label: 'Geschäft erstellen', group: 'Werkzeuge', keys: ['G'] },
  { id: 'tool.infra', label: 'Infrastruktur', group: 'Werkzeuge', keys: ['I'] },
  { id: 'tool.infraNext', label: 'Infrastruktur: nächster Typ', group: 'Werkzeuge', keys: ['Shift+I'] },
  { id: 'tool.measure', label: 'Messen', group: 'Werkzeuge', keys: ['M'] },
  { id: 'tool.calibrate', label: 'Kalibrieren', group: 'Werkzeuge', keys: ['K'] },
  { id: 'tool.titleBlock', label: 'Schriftfeld', group: 'Werkzeuge', keys: ['T'] },
  { id: 'view.legend', label: 'Legende ein/aus', group: 'Ansicht', keys: ['Shift+L'] },
  { id: 'snap.front', label: 'Fang an Vorderkante', group: 'Werkzeuge', keys: ['Shift+F'] },
  { id: 'snap.grid', label: 'Fang am Raster', group: 'Werkzeuge', keys: ['Shift+R'] },
  { id: 'snap.neighbors', label: 'Fang an Nachbarständen', group: 'Werkzeuge', keys: ['Shift+N'] },
  { id: 'view.grid', label: 'Raster ein/aus', group: 'Werkzeuge', keys: ["Mod+'", 'Mod+#'] },

  { id: 'view.zoomIn', label: 'Vergrößern', group: 'Ansicht', keys: ['Mod+Plus'] },
  { id: 'view.zoomOut', label: 'Verkleinern', group: 'Ansicht', keys: ['Mod+Minus'] },
  { id: 'view.fit', label: 'An Fenster anpassen', group: 'Ansicht', keys: ['Mod+0'] },
  { id: 'view.pan', label: 'Ansicht verschieben (gedrückt halten)', group: 'Ansicht', keys: ['Space'] },

  { id: 'page.next', label: 'Nächste Page', group: 'Pages', keys: ['Ctrl+Tab', 'Ctrl+PageDown'] },
  { id: 'page.prev', label: 'Vorherige Page', group: 'Pages', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'] },
  { id: 'page.start', label: 'Zur Start-Page', group: 'Pages', keys: ['Alt+0'] },
  ...pageJumps,
  { id: 'page.new', label: 'Neuer Festplatz', group: 'Pages', keys: ['Mod+Shift+N'] },
  { id: 'page.rename', label: 'Festplatz umbenennen', group: 'Pages', keys: ['F2'] },
  { id: 'page.duplicate', label: 'Festplatz duplizieren', group: 'Pages', keys: ['Mod+Alt+D'] },
  { id: 'page.delete', label: 'Festplatz löschen', group: 'Pages', keys: ['Mod+Alt+Backspace'] },

  { id: 'start.stands', label: 'Start-Page: Geschäfte', group: 'Start-Page', keys: ['Mod+1'] },
  { id: 'start.free', label: 'Start-Page: Freiflächen', group: 'Start-Page', keys: ['Mod+2'] },
  { id: 'start.infra', label: 'Start-Page: Infrastruktur', group: 'Start-Page', keys: ['Mod+3'] },
  { id: 'start.settings', label: 'Start-Page: Einstellungen', group: 'Start-Page', keys: ['Mod+4'] },
  { id: 'start.search', label: 'Geschäfte suchen', group: 'Start-Page', keys: ['Mod+F'] },
  { id: 'start.exportCsv', label: 'Liste als CSV exportieren …', group: 'Start-Page', keys: ['Mod+Shift+E'] },

  { id: 'ui.panels', label: 'Alle Panels ein-/ausblenden (Festplatz-Page)', group: 'Fenster', keys: ['Tab'] },
  { id: 'ui.sidebar', label: 'Seitenleiste ein-/ausblenden', group: 'Fenster', keys: ['Shift+Tab'] },
  { id: 'ui.theme', label: 'Helles/dunkles Design', group: 'Fenster', keys: ['Mod+Alt+T'] },
  { id: 'ui.fps', label: 'Bildrate anzeigen (Bilder/s, längstes Bild)', group: 'Fenster', keys: ['Mod+Alt+F'] },
  { id: 'ui.shortcuts', label: 'Tastaturkürzel anzeigen', group: 'Fenster', keys: ['?'] },
];

export const SHORTCUT_BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));
