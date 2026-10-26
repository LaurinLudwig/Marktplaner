/**
 * Infrastrukturliste der Start-Page (M7-09, spec.md §7): Zeilen über alle Festplätze, Filter und Sortierung.
 */
import { fmt } from './format';
import { PASSAGE_TYPE_ID } from './infra';
import type { Id, InfraObject, InfraTypeDef, Project } from './model/types';
import { normalizeSearch, type SortKey } from './standTable';
import { activeNarrow, cachedInfraWarnings } from './warnings';

export interface InfraRow {
  pageId: Id;
  pageName: string;
  pageIndex: number;
  obj: InfraObject;
  type: InfraTypeDef;
  typeIndex: number;
  /** Maße als Text: „6 × 2,5 m“, Linien „3,5 m“, Marker leer. */
  dims: string;
  /** Angezeigte Warnung „Durchfahrt zu eng“. */
  narrow: boolean;
}

export function infraDims(o: InfraObject, t: InfraTypeDef): string {
  if (t.geometry === 'point') return '';
  if (t.geometry === 'line') return `${fmt(o.w)} m${t.id === PASSAGE_TYPE_ID ? ' licht' : ''}`;
  return `${fmt(o.w)} × ${fmt(o.d)} m`;
}

export function infraRows(project: Pick<Project, 'pages' | 'infraTypes' | 'settings'>): InfraRow[] {
  const types = new Map(project.infraTypes.map((t, i) => [t.id, { t, i }]));
  const out: InfraRow[] = [];
  project.pages.forEach((page, pageIndex) => {
    const iw = cachedInfraWarnings(page, project.infraTypes, project.settings.minPassageWidth);
    for (const obj of page.infra) {
      const e = types.get(obj.typeId);
      if (!e) continue;
      out.push({ pageId: page.id, pageName: page.name, pageIndex, obj, type: e.t, typeIndex: e.i, dims: infraDims(obj, e.t), narrow: activeNarrow(obj, iw, project.settings) });
    }
  });
  return out;
}

export interface InfraFilter {
  search: string;
  /** null = alle Festplätze. */
  pageId: Id | null;
  typeId: Id | null;
  withWarning: boolean;
}

export const EMPTY_INFRA_FILTER: InfraFilter = { search: '', pageId: null, typeId: null, withWarning: false };

export function filterInfraRows(rows: readonly InfraRow[], f: InfraFilter): InfraRow[] {
  const q = normalizeSearch(f.search);
  return rows.filter(
    (r) =>
      (!f.pageId || r.pageId === f.pageId) &&
      (!f.typeId || r.obj.typeId === f.typeId) &&
      (!f.withWarning || r.narrow) &&
      (!q || normalizeSearch(`${r.obj.label} ${r.obj.note} ${r.type.label}`).includes(q)),
  );
}

export type InfraSortColumn = 'page' | 'type' | 'label' | 'size' | 'power' | 'note';
/** Standard: Festplatz, dann Typ (Reihenfolge der Typen), dann Bezeichnung (§7). */
export const DEFAULT_INFRA_SORT: SortKey<InfraSortColumn>[] = [
  { col: 'page', dir: 'asc' },
  { col: 'type', dir: 'asc' },
  { col: 'label', dir: 'asc' },
];

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function compare(a: InfraRow, b: InfraRow, col: InfraSortColumn): number {
  switch (col) {
    case 'page':
      return a.pageIndex - b.pageIndex;
    case 'type':
      return a.typeIndex - b.typeIndex;
    case 'label':
      // leere Bezeichnungen zuletzt
      return (a.obj.label ? 0 : 1) - (b.obj.label ? 0 : 1) || collator.compare(a.obj.label, b.obj.label);
    case 'size':
      return a.obj.w * Math.max(a.obj.d, 1) - b.obj.w * Math.max(b.obj.d, 1);
    case 'power':
      return a.obj.powerKw - b.obj.powerKw;
    case 'note':
      return collator.compare(a.obj.note, b.obj.note);
  }
}

export function sortInfraRows(rows: readonly InfraRow[], keys: readonly SortKey<InfraSortColumn>[]): InfraRow[] {
  return rows.toSorted((a, b) => {
    for (const k of keys) {
      const c = compare(a, b, k.col);
      if (c) return k.dir === 'desc' ? -c : c;
    }
    return 0;
  });
}
