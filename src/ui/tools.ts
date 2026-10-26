import type { ToolId } from '../state/store';
import type { IconName } from './icons/Icon';

/** Einträge der Werkzeugleiste. `milestone` markiert Werkzeuge, die noch nicht umgesetzt sind. */
export interface ToolbarItem {
  shortcut: string;
  icon: IconName;
  description: string;
  kind: 'tool' | 'toggle';
  tool?: ToolId;
  milestone?: string;
  /** Fang-Umschalter (M4): welcher Fang. */
  snap?: 'front' | 'grid' | 'neighbors';
  /** Tooltip-Zusatz, wenn das Werkzeug gerade nicht verfügbar ist. */
  disabledHint?: string;
  /** Aufklappbare Werkzeuggruppe (Infrastruktur, M7): Symbol des zuletzt genutzten Typs, Liste per Dreieck. */
  flyout?: boolean;
}

export const TOOL_GROUPS: ToolbarItem[][] = [
  [
    { shortcut: 'tool.select', icon: 'select', kind: 'tool', tool: 'select', description: 'Objekte auswählen und verschieben' },
    { shortcut: 'tool.hand', icon: 'hand', kind: 'tool', tool: 'hand', description: 'Ansicht verschieben (auch: Leertaste gedrückt halten)' },
    { shortcut: 'tool.zoom', icon: 'zoom', kind: 'tool', tool: 'zoom', description: 'Klicken vergrößert, mit Alt verkleinert' },
  ],
  [
    { shortcut: 'tool.area', icon: 'area', kind: 'tool', tool: 'area', description: 'Grundfläche als Rechteck aufziehen' },
    { shortcut: 'tool.stand', icon: 'stand', kind: 'tool', tool: 'stand', description: 'Neuen Stand auf der Zeichenfläche aufziehen' },
    { shortcut: 'tool.infra', icon: 'infra', kind: 'tool', tool: 'infra', flyout: true, description: 'Sperren, Sanität, Toiletten und weitere Objekte platzieren. Dreieck, Rechtsklick oder langes Drücken: Typ wählen' },
  ],
  [
    { shortcut: 'tool.measure', icon: 'measure', kind: 'tool', tool: 'measure', description: 'Zwei Punkte klicken, Abstand in Metern ablesen' },
    { shortcut: 'tool.calibrate', icon: 'calibrate', kind: 'tool', tool: 'calibrate', description: 'Hintergrund über zwei Punkte und einen bekannten Abstand skalieren', disabledHint: 'Zuerst einen Hintergrund importieren (Cmd/Strg+Shift+P)' },
    { shortcut: 'tool.titleBlock', icon: 'titleBlock', kind: 'tool', tool: 'titleBlock', description: 'Klick setzt das Schriftfeld an diese Stelle; verschieben mit dem Auswahlwerkzeug' },
  ],
  [
    { shortcut: 'snap.front', icon: 'snapFront', kind: 'toggle', snap: 'front', description: 'Stände rasten an der Vorderseite einer Grundfläche ein. Cmd/Strg beim Ziehen: Fang aus' },
    { shortcut: 'snap.grid', icon: 'snapGrid', kind: 'toggle', snap: 'grid', description: 'Objekte rasten am eingeblendeten Raster ein. Cmd/Strg beim Ziehen: Fang aus' },
    { shortcut: 'snap.neighbors', icon: 'snapNeighbors', kind: 'toggle', snap: 'neighbors', description: 'Stände rasten bündig an benachbarten Ständen ein. Cmd/Strg beim Ziehen: Fang aus' },
    { shortcut: 'view.grid', icon: 'grid', kind: 'toggle', description: 'Raster ein- oder ausblenden; Weite in der Seitenleiste' },
  ],
];
