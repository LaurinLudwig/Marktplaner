import { PAPER_KIND_LABEL, pagePaper, type PaperKind } from '../core/paper';
import { mmToM, nudgeAnchor } from '../core/sheet';
import { SCALE_LIMITS } from '../core/model/schema';
import type { Id, PaperAnchor, Project, Sheet } from '../core/model/types';
import { useStore } from './store';

/**
 * Befehle für Blatt und Papier-Elemente (M7, M8, spec.md §8). Jede Änderung ist ein Undo-Schritt.
 */

const st = () => useStore.getState();
const pageOf = (p: Project, pageId: Id) => p.pages.find((x) => x.id === pageId);

const SHEET_LABEL: Record<keyof Sheet, string> = {
  format: 'Papierformat ändern',
  orientation: 'Ausrichtung ändern',
  scale: 'Maßstab ändern',
  cx: 'Blatt verschieben',
  cy: 'Blatt verschieben',
};

/**
 * Blatt ändern. Beim Wechsel von „an Seite anpassen“ auf einen festen Maßstab werden die aktuelle Mitte und n
 * (auf volle 10) übernommen (§8).
 */
export function setSheet(pageId: Id, patch: Partial<Sheet>) {
  const page = pageOf(st().project, pageId);
  if (!page) return;
  const next = { ...patch };
  if (next.scale !== undefined && next.scale !== null) next.scale = Math.round(Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, next.scale)));
  if (page.sheet.scale === null && next.scale !== undefined && next.scale !== null) {
    const f = pagePaper(page, st().project).frame;
    next.cx = Math.round(((f.bounds.minX + f.bounds.maxX) / 2) * 100) / 100;
    next.cy = Math.round(((f.bounds.minY + f.bounds.maxY) / 2) * 100) / 100;
  }
  const key = Object.keys(patch)[0] as keyof Sheet | undefined;
  st().change(key ? SHEET_LABEL[key] : 'Blatt ändern', (p) => {
    const pg = pageOf(p, pageId);
    if (pg) Object.assign(pg.sheet, next);
  });
}

/** Bei „an Seite anpassen“: fester Maßstab mit dem aktuellen n (Knopf in der Seitenleiste). */
export function fixSheetScale(pageId: Id) {
  const page = pageOf(st().project, pageId);
  if (!page || page.sheet.scale !== null) return;
  setSheet(pageId, { scale: pagePaper(page, st().project).frame.scale });
}

export function setPaperAnchor(pageId: Id, kind: PaperKind, anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>, label = `${PAPER_KIND_LABEL[kind]} verschieben`, merge?: { mergeKey: string; mergeIntoPrevious: boolean }) {
  st().change(
    label,
    (p) => {
      const pg = pageOf(p, pageId);
      if (pg) Object.assign(pg[kind], anchor);
    },
    merge ?? {},
  );
}

export function setPaperVisible(pageId: Id, kind: PaperKind, visible: boolean) {
  st().change(`${PAPER_KIND_LABEL[kind]} ${visible ? 'einblenden' : 'ausblenden'}`, (p) => {
    const pg = pageOf(p, pageId);
    if (pg) pg[kind].visible = visible;
  });
  const sel = st().ui.selection;
  if (!visible && sel?.kind === 'paper' && sel.element === kind) st().setUi({ selection: null });
}

export function setTitleBlockText(pageId: Id, text: string) {
  st().change('Freitext des Schriftfelds ändern', (p) => {
    const pg = pageOf(p, pageId);
    if (pg) pg.titleBlockText = text;
  });
}

/** Datum oder Version des Schriftfelds (projektweit, gilt für alle Pages). */
export function setTitleBlockField(field: 'dateText' | 'version', value: string) {
  st().change(field === 'dateText' ? 'Datum des Schriftfelds ändern' : 'Version des Schriftfelds ändern', (p) => void (p.titleBlock[field] = value.trim()));
}

/** Heutiges Datum als TT.MM.JJJJ. */
export const todayText = (d = new Date()) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

/**
 * Pfeiltasten bei ausgewähltem Papier-Element: 1 mm bzw. 10 mm auf dem Papier (Tastenwiederholung verschmilzt zu
 * einem Undo-Schritt wie bei Objekten). Das Blatt selbst bewegt sich bei festem Maßstab um dieselbe Strecke.
 */
export function nudgePaper(dxMm: number, dyMm: number, repeat = false) {
  const s = st();
  const sel = s.ui.selection;
  const page = s.project.pages.find((p) => p.id === s.ui.activePage);
  if (sel?.kind !== 'paper' || !page) return;
  const merge = { mergeKey: `nudge-paper:${page.id}:${sel.element}:${dxMm},${dyMm}`, mergeIntoPrevious: repeat };
  if (sel.element === 'sheet') {
    if (page.sheet.scale === null) return;
    const k = page.sheet.scale;
    s.change(
      'Blatt verschieben',
      (p) => {
        const pg = pageOf(p, page.id);
        if (!pg) return;
        pg.sheet.cx = Math.round((pg.sheet.cx + mmToM(dxMm, k)) * 100) / 100;
        pg.sheet.cy = Math.round((pg.sheet.cy + mmToM(dyMm, k)) * 100) / 100;
      },
      merge,
    );
    return;
  }
  const paper = pagePaper(page, s.project);
  const el = paper[sel.element];
  if (!el) return;
  setPaperAnchor(page.id, sel.element, nudgeAnchor(el.anchor, dxMm, dyMm, el.layout, paper.frame.paper), undefined, merge);
}

/** Schriftfeld-Werkzeug: Schriftfeld an diese Lage setzen und einblenden (ein Undo-Schritt), danach ausgewählt. */
export function placeTitleBlock(pageId: Id, anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>) {
  st().change('Schriftfeld setzen', (p) => {
    const pg = pageOf(p, pageId);
    if (pg) Object.assign(pg.titleBlock, anchor, { visible: true });
  });
  st().setUi({ selection: { kind: 'paper', element: 'titleBlock' } });
}
