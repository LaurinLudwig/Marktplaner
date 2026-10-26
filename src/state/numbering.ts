import { normAngle } from '../core/geometry/rect';
import type { Id, NumberingMode, NumberingScope, Vec } from '../core/model/types';
import { clampDigits, clampStart, defaultClockwiseCenter, type RenumberPlan } from '../core/numbering';
import { updatePage } from './pageSettings';
import { useStore } from './store';

/** Befehle der Nummerierung (M5, spec.md §5). Jede Änderung ist genau ein Undo-Schritt. */

const st = () => useStore.getState();
const round2 = (v: number) => Math.round(v * 100) / 100;

export function setNumberingMode(pageId: Id, mode: NumberingMode) {
  updatePage(pageId, 'Nummerierungsmodus ändern', (page) => {
    page.numberingMode = mode;
    // Beim ersten Umschalten auf „Uhrzeigersinn“: Mittelpunkt = Mitte aller Grundflächen und Stände
    if (mode === 'clockwise' && !page.clockwise) {
      const center = defaultClockwiseCenter(page);
      if (center) page.clockwise = { center, startAngle: 0 };
    }
  });
}

export function setPrefix(pageId: Id, prefix: string) {
  updatePage(pageId, 'Präfix ändern', (page) => {
    page.prefix = prefix;
  });
}

export function setClockwiseCenter(pageId: Id, center: Partial<Vec>) {
  updatePage(pageId, 'Mittelpunkt setzen', (page) => {
    const old = page.clockwise ?? { center: defaultClockwiseCenter(page) ?? { x: 0, y: 0 }, startAngle: 0 };
    page.clockwise = { startAngle: old.startAngle, center: { x: round2(center.x ?? old.center.x), y: round2(center.y ?? old.center.y) } };
  });
}

export function setClockwiseStart(pageId: Id, angle: number) {
  updatePage(pageId, 'Startrichtung ändern', (page) => {
    const center = page.clockwise?.center ?? defaultClockwiseCenter(page) ?? { x: 0, y: 0 };
    page.clockwise = { center, startAngle: Math.round(normAngle(angle) * 10) / 10 };
  });
}

/** Grundfläche in der Reihenfolge der Page um `delta` Plätze verschieben (Nummerierung und §4). */
export function moveArea(pageId: Id, areaId: Id, delta: number) {
  updatePage(pageId, 'Reihenfolge der Grundflächen ändern', (page) => {
    const from = page.areas.findIndex((a) => a.id === areaId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= page.areas.length) return;
    const [a] = page.areas.splice(from, 1);
    page.areas.splice(to, 0, a!);
  });
}

export function setNumberingScope(scope: NumberingScope) {
  st().change(scope === 'global' ? 'Nummerierung global durchgehend' : 'Nummerierung pro Festplatz', (p) => {
    p.settings.numbering.scope = scope;
  });
}

export function setNumberingStart(start: number) {
  st().change('Startnummer ändern', (p) => {
    p.settings.numbering.start = clampStart(start);
  });
}

export function setNumberingDigits(digits: number) {
  st().change('Stellenzahl ändern', (p) => {
    p.settings.numbering.digits = clampDigits(digits);
  });
}

export function setNrLocked(pageId: Id, ids: readonly Id[], locked: boolean) {
  const set = new Set(ids);
  updatePage(pageId, locked ? 'Nummer fixieren' : 'Fixierung lösen', (page) => {
    for (const s of page.stands) if (set.has(s.id)) s.nrLocked = locked;
  });
}

/** Plan aus `planRenumber` übernehmen: ein Undo-Schritt für alle Pages. */
export function applyRenumber(plan: RenumberPlan) {
  const next = new Map(plan.changes.map((c) => [c.standId, c.next]));
  const pages = new Set(plan.changes.map((c) => c.pageId));
  st().change('Neu nummerieren', (p) => {
    for (const page of p.pages) {
      if (!pages.has(page.id)) continue;
      for (const s of page.stands) {
        const nr = next.get(s.id);
        if (nr !== undefined) s.nr = nr;
      }
    }
  });
}

