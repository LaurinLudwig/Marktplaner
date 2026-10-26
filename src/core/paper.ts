/**
 * Papier-Elemente einer Page zusammengestellt (M7, M8, spec.md §8): Blatt, Schriftfeld, Legende, Maßstabsbalken und
 * Nordpfeil mit ihrer Lage auf dem Plan. Gemeinsam für Zeichenfläche, Befehle (Ziehen, Pfeiltasten) und PDF-Export.
 */
import { pageFree } from './hiddenFree';
import { legendEntries, legendLayout, type LegendLayout } from './legend';
import type { FestplatzPage, LayerId, LayerState, PaperAnchor, Project, Vec } from './model/types';
import { NORTH_ARROW_SIZE, scaleBarLayout, type ScaleBarLayout } from './scene/paper';
import { anchorToWorld, backgroundBounds, mmToM, sheetFrame, shownOnPaper, titleBlockLayout, paperSize, type PaperRect, type SheetFrame, type TitleBlockLayout } from './sheet';
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

type ProjectPart = Pick<Project, 'name' | 'categories' | 'infraTypes' | 'titleBlock'> & { settings: Pick<Project['settings'], 'minFreeWidth' | 'defaultStandColor'> };

/** Wird auf der Page mindestens eine Freifläche angezeigt? (für den Legendeneintrag „Freifläche“) */
export function hasFreeSpace(page: FestplatzPage, project: ProjectPart): boolean {
  return pageFree(page, { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes }).some((a) => a.free.length > 0);
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
  const paper = paperSize(page.sheet);
  const tb = (scale: number) =>
    titleBlockLayout({
      projectName: project.name,
      pageName: page.name,
      scale,
      sheet: page.sheet,
      dateText: project.titleBlock.dateText,
      version: project.titleBlock.version,
      freeText: page.titleBlockText,
    });
  const entries = legendEntries(page, project, layers, freeShown ?? hasFreeSpace(page, project));
  const lLayout = entries.length ? legendLayout(entries, paper.h) : null;
  // Größen auf dem Papier hängen nicht vom Maßstab ab: Freizuhaltende Bereiche vor dem Anpassen bestimmen (E-49)
  const sizes: [PaperAnchor, { w: number; h: number } | null][] = [
    [page.titleBlock, tb(page.sheet.scale ?? 1000)],
    [page.legend, lLayout],
    [page.scaleBar, scaleBarLayout(page.sheet.scale ?? 1000)],
    [page.northArrow, NORTH_ARROW_SIZE],
  ];
  const obstacles: PaperRect[] = sizes.flatMap(([a, size]) => (a.visible && size ? [{ ...shownOnPaper(a, size, paper), w: size.w, h: size.h }] : []));
  const frame = sheetFrame(page, backgroundBounds(page), obstacles);
  const tLayout = tb(frame.scale);
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
