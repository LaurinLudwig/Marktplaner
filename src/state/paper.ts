import { PAPER_KIND_LABEL, pagePaper, type PaperKind } from '../core/paper';
import { isFreeFormat, mmToM, nudgeAnchor, regionOf } from '../core/sheet';
import { clampToLimits } from '../core/infra';
import { MARGIN_LIMITS, normalizeRegion, SCALE_LIMITS, TARGET_WIDTH_LIMITS } from '../core/model/schema';
import type { FestplatzPage, Id, PaperAnchor, Project, Sheet, Vec } from '../core/model/types';
import type { Bounds } from '../core/viewport';
import { pageView, verbundOfRef } from '../core/verbundView';
import { useStore } from './store';

/**
 * Befehle für Blatt und Papier-Elemente (M7, M8, spec.md §8). Jede Änderung ist ein Undo-Schritt.
 *
 * `pageId` ist eine Seitenreferenz: die ID einer Festplatz-Page oder die Gesamtansicht eines Verbunds `verbund:<id>`
 * (#15 Teil c). Gelesen wird dann die Sicht der Gesamtansicht (`pageView`, Objekte aller Mitglieder), geschrieben in die
 * Felder des Verbunds (`Verbund.sheet`, `titleBlock`, `titleBlockText`, `legend`, `scaleBar`, `northArrow`).
 */

const st = () => useStore.getState();
/** Page bzw. Sicht der Gesamtansicht zum Lesen (Blatt berechnen). */
const pageOf = (p: Project, ref: Id): FestplatzPage | null => pageView(p, ref);
/** Träger der Blatt-Felder im Entwurf: die Page oder der Verbund der Gesamtansicht. */
type PaperHolder = Pick<FestplatzPage, 'sheet' | 'titleBlock' | 'titleBlockText' | 'legend' | 'scaleBar' | 'northArrow'>;
const holderOf = (p: Project, ref: Id): PaperHolder | undefined => verbundOfRef(p, ref) ?? p.pages.find((x) => x.id === ref);

const SHEET_LABEL: Record<keyof Sheet, string> = {
  format: 'Papierformat ändern',
  orientation: 'Ausrichtung ändern',
  scale: 'Maßstab ändern',
  cx: 'Blatt verschieben',
  cy: 'Blatt verschieben',
  margin: 'Rand ändern',
  targetWidth: 'Zielbreite ändern',
  region: 'Ausschnitt ändern',
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const centerOf = (b: Bounds): Vec => ({ x: round2((b.minX + b.maxX) / 2), y: round2((b.minY + b.maxY) / 2) });

/**
 * Blatt ändern. Beim Wechsel von „an Seite anpassen“ auf einen festen Maßstab werden die aktuelle Mitte und n
 * (auf volle 10) übernommen (§8). Wechsel auf „Ausschnitt“ ohne aufgezogenen Ausschnitt: das bisherige Blatt wird der
 * Ausschnitt, bei angepasstem Maßstab mit dessen n, damit sich das Papier nicht ändert. Wechsel von einem freien
 * Blatt auf ein DIN-Format mit festem Maßstab: die bisherige Mitte (#13).
 */
export function setSheet(pageId: Id, patch: Partial<Sheet>, label?: string) {
  const page = pageOf(st().project, pageId);
  if (!page) return;
  const next: Partial<Sheet> = { ...patch };
  if (next.scale !== undefined && next.scale !== null) next.scale = Math.round(clampToLimits(next.scale, SCALE_LIMITS));
  if (next.margin !== undefined && next.margin !== null) next.margin = Math.round(clampToLimits(next.margin, MARGIN_LIMITS));
  if (next.targetWidth !== undefined) next.targetWidth = Math.round(clampToLimits(next.targetWidth, TARGET_WIDTH_LIMITS));
  if (next.region) next.region = normalizeRegion(next.region);
  const frame = () => pagePaper(page, st().project).frame;
  const format = next.format ?? page.sheet.format;
  const scale = next.scale !== undefined ? next.scale : page.sheet.scale;
  const fromFree = isFreeFormat(page.sheet.format);
  if (!isFreeFormat(format) && scale !== null && next.cx === undefined && (page.sheet.scale === null || fromFree)) {
    const c = centerOf(frame().bounds);
    next.cx = c.x;
    next.cy = c.y;
  }
  if (format === 'region' && page.sheet.format !== 'region' && !page.sheet.region && next.region === undefined) {
    const f = frame();
    next.region = regionOf(f.bounds);
    if (scale === null && next.scale === undefined) next.scale = f.scale;
  }
  const key = Object.keys(patch)[0] as keyof Sheet | undefined;
  st().change(label ?? (key ? SHEET_LABEL[key] : 'Blatt ändern'), (p) => {
    const pg = holderOf(p, pageId);
    if (pg) Object.assign(pg.sheet, next);
  });
}

/** Bei angepasstem Maßstab (bzw. Zielbreite): fester Maßstab mit dem aktuellen n (Knopf in der Seitenleiste). */
export function fixSheetScale(pageId: Id) {
  const page = pageOf(st().project, pageId);
  if (!page || page.sheet.scale !== null) return;
  setSheet(pageId, { scale: pagePaper(page, st().project).frame.scale });
}

/** Blatt per Ziehen verschieben: neue Mitte in Metern (DIN mit festem Maßstab oder Ausschnitt). */
export function moveSheetTo(pageId: Id, c: Vec) {
  const page = pageOf(st().project, pageId);
  if (!page) return;
  const center = { x: round2(c.x), y: round2(c.y) };
  if (page.sheet.format === 'region') {
    const r = page.sheet.region ?? regionOf(pagePaper(page, st().project).frame.bounds);
    setSheet(pageId, { region: { ...r, cx: center.x, cy: center.y } }, 'Blatt verschieben');
  } else setSheet(pageId, { cx: center.x, cy: center.y });
}

/** Ausschnitt setzen (Aufziehen oder Größe ändern an den Griffen, #13); schaltet auf „Ausschnitt“. */
export function setSheetRegion(pageId: Id, b: Bounds, label = 'Ausschnitt ändern') {
  setSheet(pageId, { format: 'region', region: regionOf(b) }, label);
}

export function setPaperAnchor(pageId: Id, kind: PaperKind, anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>, label = `${PAPER_KIND_LABEL[kind]} verschieben`, merge?: { mergeKey: string; mergeIntoPrevious: boolean }) {
  st().change(
    label,
    (p) => {
      const pg = holderOf(p, pageId);
      if (pg) Object.assign(pg[kind], anchor);
    },
    merge ?? {},
  );
}

export function setPaperVisible(pageId: Id, kind: PaperKind, visible: boolean) {
  st().change(`${PAPER_KIND_LABEL[kind]} ${visible ? 'einblenden' : 'ausblenden'}`, (p) => {
    const pg = holderOf(p, pageId);
    if (pg) pg[kind].visible = visible;
  });
  const sel = st().ui.selection;
  if (!visible && sel?.kind === 'paper' && sel.element === kind) st().setUi({ selection: null });
}

export function setTitleBlockText(pageId: Id, text: string) {
  st().change('Freitext des Schriftfelds ändern', (p) => {
    const pg = holderOf(p, pageId);
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
  const page = pageOf(s.project, s.ui.activePage);
  if (sel?.kind !== 'paper' || !page) return;
  const merge = { mergeKey: `nudge-paper:${page.id}:${sel.element}:${dxMm},${dyMm}`, mergeIntoPrevious: repeat };
  const paper = pagePaper(page, s.project);
  if (sel.element === 'sheet') {
    if (!paper.frame.movable) return;
    const k = paper.frame.scale;
    s.change(
      'Blatt verschieben',
      (p) => {
        const pg = holderOf(p, page.id);
        if (!pg) return;
        if (pg.sheet.format === 'region') {
          const r = pg.sheet.region ?? regionOf(paper.frame.bounds);
          pg.sheet.region = { ...r, cx: round2(r.cx + mmToM(dxMm, k)), cy: round2(r.cy + mmToM(dyMm, k)) };
        } else {
          pg.sheet.cx = round2(pg.sheet.cx + mmToM(dxMm, k));
          pg.sheet.cy = round2(pg.sheet.cy + mmToM(dyMm, k));
        }
      },
      merge,
    );
    return;
  }
  const el = paper[sel.element];
  if (!el) return;
  setPaperAnchor(page.id, sel.element, nudgeAnchor(el.anchor, dxMm, dyMm, el.layout, paper.frame.paper), undefined, merge);
}

/** Schriftfeld-Werkzeug: Schriftfeld an diese Lage setzen und einblenden (ein Undo-Schritt), danach ausgewählt. */
export function placeTitleBlock(pageId: Id, anchor: Pick<PaperAnchor, 'corner' | 'dx' | 'dy'>) {
  st().change('Schriftfeld setzen', (p) => {
    const pg = holderOf(p, pageId);
    if (pg) Object.assign(pg.titleBlock, anchor, { visible: true });
  });
  st().setUi({ selection: { kind: 'paper', element: 'titleBlock' } });
}
