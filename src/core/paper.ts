/**
 * Papier-Elemente einer Page zusammengestellt (M7, M8, spec.md §8): Blatt, Schriftfeld, Legende, Maßstabsbalken und
 * Nordpfeil mit ihrer Lage auf dem Plan. Gemeinsam für Zeichenfläche, Befehle (Ziehen, Pfeiltasten) und PDF-Export.
 */
import { profileLayers, type ExportProfile } from './exportProfiles';
import { pageFree } from './hiddenFree';
import { legendEntries, legendLayout, type LegendLayout } from './legend';
import type { FestplatzPage, LayerId, LayerState, PaperAnchor, Project, Vec } from './model/types';
import { NORTH_ARROW_SIZE, SCALE_BAR_SIZE, scaleBarLayout, type ScaleBarLayout } from './scene/paper';
import { anchorToWorld, backgroundBounds, formatText, mmToM, sheetFrame, titleBlockLayout, type SheetElement, type SheetFrame, type TitleBlockLayout } from './sheet';
import type { Bounds } from './viewport';

export type PaperKind = 'titleBlock' | 'legend' | 'scaleBar' | 'northArrow';
export const PAPER_KINDS: readonly PaperKind[] = ['titleBlock', 'legend', 'scaleBar', 'northArrow'];

/** Deutsche Namen der Papier-Elemente (Undo-Schritte, Seitenleiste). */
export const PAPER_KIND_LABEL: Record<PaperKind, string> = { titleBlock: 'Schriftfeld', legend: 'Legende', scaleBar: 'Maßstabsbalken', northArrow: 'Nordpfeil' };

export interface PaperElement<L> {
  layout: L;
  anchor: PaperAnchor;
  /** Linke obere Ecke auf dem Plan (Meter). */
  topLeft: Vec;
}

export interface PagePaper {
  frame: SheetFrame;
  titleBlock: PaperElement<TitleBlockLayout>;
  /** null: Die Legende hat keine Einträge (wird nicht gezeichnet). */
  legend: PaperElement<LegendLayout> | null;
  scaleBar: PaperElement<ScaleBarLayout>;
  northArrow: PaperElement<{ w: number; h: number; angle: number }>;
}

type ProjectPart = Pick<Project, 'name' | 'categories' | 'infraTypes' | 'titleBlock' | 'shapeTemplates'> &
  Partial<Pick<Project, 'pages' | 'groups'>> & { settings: Pick<Project['settings'], 'minFreeWidth' | 'defaultStandColor'> };

/** Wird auf der Page mindestens eine Freifläche angezeigt? (für den Legendeneintrag „Freifläche“) */
export function hasFreeSpace(page: FestplatzPage, project: ProjectPart): boolean {
  // Nachbarn aus dem Verbund (#15) belegen mit, sofern das Projekt seine Pages mitgibt
  const verbund = project.pages ? { pages: project.pages, groups: project.groups ?? [], categories: project.categories } : undefined;
  return pageFree(page, { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes, shapeTemplates: project.shapeTemplates, ...(verbund ? { verbund } : {}) }).some((a) => a.free.length > 0);
}

/** Element `kind` der Page (Anker und Layout), unabhängig davon, ob es sichtbar ist. */
export function paperElement(pp: PagePaper, kind: PaperKind): PaperElement<{ w: number; h: number }> | null {
  return pp[kind];
}

/**
 * Blatt und Papier-Elemente der Page. `layers` = sichtbare Ebenen (Zeichenfläche: die der Page; PDF: die des
 * Export-Profils); `freeShown` aus der Freiflächen-Berechnung des Aufrufers (sonst neu berechnet).
 */
export function pagePaper(page: FestplatzPage, project: ProjectPart, layers: Record<LayerId, LayerState> = page.layers, freeShown?: boolean): PagePaper {
  const tb = (scale: number, format: string) =>
    titleBlockLayout({
      projectName: project.name,
      pageName: page.name,
      scale,
      format,
      dateText: project.titleBlock.dateText,
      version: project.titleBlock.version,
      freeText: page.titleBlockText,
    });
  const entries = legendEntries(page, project, layers, freeShown ?? hasFreeSpace(page, project));
  // Die Legende bricht nach der Blatthöhe um; beim Plan hängt die vom Maßstab ab (#13)
  const legends = new Map<number, LegendLayout | null>();
  const legendFor = (height: number) => {
    if (!legends.has(height)) legends.set(height, entries.length ? legendLayout(entries, height) : null);
    return legends.get(height)!;
  };
  // Größen auf dem Papier hängen nicht vom Maßstab ab (Inhalt des Schriftfelds schon, seine Größe nicht): Freizuhaltende
  // Bereiche bzw. Bänder vor dem Maßstab bestimmen (E-49, #13)
  const tbSize = tb(1000, '');
  const elements = (height: number): SheetElement[] =>
    (
      [
        [page.titleBlock, tbSize],
        [page.legend, legendFor(height)],
        [page.scaleBar, SCALE_BAR_SIZE],
        [page.northArrow, NORTH_ARROW_SIZE],
      ] as [PaperAnchor, { w: number; h: number } | null][]
    ).flatMap(([a, size]) => (a.visible && size ? [{ corner: a.corner, dx: a.dx, dy: a.dy, w: size.w, h: size.h }] : []));
  const frame = sheetFrame(page, backgroundBounds(page), elements);
  const lLayout = legendFor(frame.layoutHeight);
  const tLayout = tb(frame.scale, formatText(page.sheet, frame.paper));
  const sLayout = scaleBarLayout(frame.scale);
  const nLayout = { ...NORTH_ARROW_SIZE, angle: page.northAngle };
  return {
    frame,
    titleBlock: { layout: tLayout, anchor: page.titleBlock, topLeft: anchorToWorld(frame, page.titleBlock, tLayout) },
    legend: lLayout ? { layout: lLayout, anchor: page.legend, topLeft: anchorToWorld(frame, page.legend, lLayout) } : null,
    scaleBar: { layout: sLayout, anchor: page.scaleBar, topLeft: anchorToWorld(frame, page.scaleBar, sLayout) },
    northArrow: { layout: nLayout, anchor: page.northArrow, topLeft: anchorToWorld(frame, page.northArrow, nLayout) },
  };
}

/** Umriss eines sichtbaren Papier-Elements auf dem Plan (Meter), sonst null. */
export function paperElementBounds(page: Pick<FestplatzPage, PaperKind>, pp: PagePaper, kind: PaperKind): Bounds | null {
  const el = page[kind].visible ? pp[kind] : null;
  if (!el) return null;
  const k = mmToM(1, pp.frame.scale);
  return { minX: el.topLeft.x, minY: el.topLeft.y, maxX: el.topLeft.x + el.layout.w * k, maxY: el.topLeft.y + el.layout.h * k };
}

/** Oberstes Papier-Element am Punkt (nur bei sichtbarer Ebene „Blatt“), sonst null. */
export function paperElementAt(page: Pick<FestplatzPage, PaperKind | 'layers'>, pp: PagePaper, w: Vec): PaperKind | null {
  if (!page.layers.sheet.visible) return null;
  for (const kind of ['titleBlock', 'legend', 'northArrow', 'scaleBar'] as const) {
    const b = paperElementBounds(page, pp, kind);
    if (b && w.x >= b.minX && w.x <= b.maxX && w.y >= b.minY && w.y <= b.maxY) return kind;
  }
  return null;
}

/**
 * Blatt der Page im PDF (§9): Die Legende entsteht aus den Ebenen des Export-Profils; beim Plan hängt davon auch das
 * Papiermaß ab (#13). Für Export-Dialog, Vorschau, gerasterte Hintergründe und Größenschätzung, damit alle dasselbe
 * Blatt wie `pageScene` verwenden.
 */
export function exportFrame(page: FestplatzPage, project: ProjectPart, profile: ExportProfile): SheetFrame {
  return pagePaper(page, project, profileLayers(profile)).frame;
}
