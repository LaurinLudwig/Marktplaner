/**
 * Inhalt eines PDF-Exports zusammenstellen (M8, spec.md §9): Schwärzung nach Profil, Szenen der gewählten Pages in
 * Tab-Reihenfolge und Tabellen des Anhangs. Rein; der PDF-Schreiber (writePdf.ts) macht daraus Bytes.
 *
 * Festplatz-Verbund (#15 Teil c): Die Gesamtansicht eines Verbunds („Unterstadt (gesamt)“, `verbund:<id>`) ist eine
 * eigene Seite des Exports an ihrer Stelle in der Tab-Reihenfolge (vor dem ersten Mitglied). Für den Anhang steht sie
 * für ihre Mitglieder: Die Listen sind ohnehin nach Festplatz gegliedert und jedes Objekt gehört genau einem Platz, also
 * kommt jedes Objekt genau einmal vor, unter seinem Platz – auch wenn Gesamtansicht und Einzelansicht exportiert werden.
 */
import { CONNECTION_LABEL } from '../label';
import { hasPricing, fmtMoney } from '../fee';
import { fmt } from '../format';
import { pageFree } from '../hiddenFree';
import { freeSpaceRows, sortFreeSpaces } from '../freeSpaceList';
import { infraRows, sortInfraRows, DEFAULT_INFRA_SORT } from '../infraTable';
import type { FestplatzPage, Id, Project, Verbund } from '../model/types';
import { mergedPage } from '../verbund';
import { overviewTitle, tabOrder } from '../verbundView';
import { pageScene, type PageScene } from '../scene/page';
import { DEFAULT_STAND_SORT, sortRows, standRows } from '../standTable';
import { APPENDIX_LABEL, redactProject, type AppendixPart, type ExportProfile, type StandField } from '../exportProfiles';
import type { AppendixColumn, AppendixTable } from './writePdf';

export interface ExportRequest {
  /**
   * Seiten des Exports: IDs von Pages und Gesamtansichten `verbund:<id>` (#15); exportiert wird in Tab-Reihenfolge.
   * null = Gesamtplan (alle Pages und Gesamtansichten).
   */
  pageIds: readonly Id[] | null;
  /** Teile des Anhangs (nur solche, die das Profil erlaubt, werden übernommen). */
  appendix: Partial<Record<AppendixPart, boolean>>;
}

export interface ExportContent {
  title: string;
  projectName: string;
  scenes: PageScene[];
  appendix: AppendixTable[];
}

/** Eine Seite des Exports: eine Festplatz-Page oder die Gesamtansicht eines Verbunds (#15 Teil c). */
export interface ExportEntry {
  /** Page-ID bzw. `verbund:<id>`. */
  ref: Id;
  /** „Seestraße“ bzw. „Unterstadt (gesamt)“. */
  name: string;
  /** Die Page bzw. die `mergedPage` des Verbunds (Blatt, Papier-Elemente und Ebenen des Verbunds). */
  page: FestplatzPage;
  verbund: Verbund | null;
}

/** Alle möglichen Seiten des Exports in Tab-Reihenfolge: Pages und Gesamtansichten (Verbünde mit Mitgliedern). */
export function exportEntries(project: Pick<Project, 'pages' | 'groups'>): ExportEntry[] {
  return tabOrder(project).map((t) =>
    t.kind === 'page' ? { ref: t.page.id, name: t.page.name, page: t.page, verbund: null } : { ref: t.ref, name: overviewTitle(t.verbund), page: mergedPage(project, t.verbund), verbund: t.verbund },
  );
}

/** Gewählte Seiten (`refs`, null = alle) in Tab-Reihenfolge; Unbekanntes entfällt. */
export function selectedEntries(project: Pick<Project, 'pages' | 'groups'>, refs: readonly Id[] | null): ExportEntry[] {
  const wanted = refs ? new Set(refs) : null;
  return exportEntries(project).filter((e) => !wanted || wanted.has(e.ref));
}

/**
 * Pages, deren Objekte die Seiten betreffen (Anhang, Größenschätzung): die gewählten Pages und die Mitglieder der
 * gewählten Gesamtansichten, jede einmal, in Tab-Reihenfolge.
 */
export function entryPages<P extends Pick<FestplatzPage, 'id'>>(project: { pages: P[]; groups?: readonly Verbund[] }, entries: readonly Pick<ExportEntry, 'ref' | 'verbund'>[]): P[] {
  const ids = new Set(entries.flatMap((e) => (e.verbund ? e.verbund.pageIds : [e.ref])));
  return project.pages.filter((p) => ids.has(p.id));
}

export function buildExport(project: Project, profile: ExportProfile, req: ExportRequest): ExportContent {
  const red = redactProject(project, profile);
  const entries = selectedEntries(red, req.pageIds);
  const pages = entryPages(red, entries);
  const scoped: Project = { ...red, pages };
  const appendix: AppendixTable[] = [];
  const on = (part: AppendixPart) => !!req.appendix[part] && profile.appendix[part];
  if (on('stands')) appendix.push(standTable(scoped, profile));
  if (on('free')) appendix.push(freeTable(scoped));
  if (on('infra')) appendix.push(infraTable(scoped, profile));
  return {
    title: `${project.name.trim() || 'Projekt'} – ${profile.name}`,
    projectName: project.name.trim() || 'Projekt',
    // Szenen sehen das ganze geschwärzte Projekt (Nummernkreis über alle Pages), zeichnen aber nur ihre Page bzw.
    // die Mitglieder ihres Verbunds
    scenes: entries.map((e) => pageScene(e.page, red, profile, e.name)),
    appendix,
  };
}

const num = (n: number) => fmt(n);

/** Spalten der Standliste in fester Reihenfolge, nur erlaubte Felder (§9). */
const STAND_COLUMNS: { field: StandField; label: string; align: AppendixColumn['align']; gross?: true }[] = [
  { field: 'nr', label: 'Nr.', align: 'left' },
  { field: 'name', label: 'Name', align: 'left' },
  { field: 'owner', label: 'Eigentümer', align: 'left' },
  { field: 'ware', label: 'Ware', align: 'left' },
  { field: 'category', label: 'Kategorie', align: 'left' },
  { field: 'w', label: 'Breite (m)', align: 'right' },
  { field: 'd', label: 'Tiefe (m)', align: 'right' },
  { field: 'power', label: 'Strom (kW)', align: 'right' },
  { field: 'connection', label: 'Anschluss', align: 'left' },
  { field: 'fee', label: 'Standgeld netto (€)', align: 'right' },
  { field: 'fee', label: 'Standgeld brutto (€)', align: 'right', gross: true },
  { field: 'note', label: 'Notiz', align: 'left' },
];

function standTable(project: Project, profile: ExportProfile): AppendixTable {
  const allowed = new Set(profile.fields);
  // Standgeld nur, wenn ein Preis festgelegt ist (sonst wären die Spalten leer)
  if (!hasPricing(project.settings.pricing, project.categories)) allowed.delete('fee');
  const cols = STAND_COLUMNS.filter((c) => allowed.has(c.field));
  const rows = sortRows(standRows(project), DEFAULT_STAND_SORT).map((r) => [
    r.pageName,
    ...cols.map((c) => {
      const s = r.stand;
      switch (c.field) {
        case 'nr':
          return s.nr;
        case 'name':
          return s.name;
        case 'owner':
          return s.owner;
        case 'ware':
          return s.ware;
        case 'category':
          return r.categoryName ?? '';
        case 'w':
          return num(s.w);
        case 'd':
          return num(s.d);
        case 'power':
          return s.powerKw ? num(s.powerKw) : '';
        case 'connection':
          return s.connection ? CONNECTION_LABEL[s.connection] : '';
        case 'note':
          return s.note.replace(/\s+/g, ' ').trim();
        case 'fee':
          return r.fee ? fmtMoney(c.gross ? r.fee.gross : r.fee.net) : '';
      }
    }),
  ]);
  return { title: APPENDIX_LABEL.stands, columns: [{ label: 'Festplatz', align: 'left' }, ...cols.map((c) => ({ label: c.label, align: c.align }))], rows };
}

function freeTable(project: Project): AppendixTable {
  const freeOf = (p: Project['pages'][number]) => pageFree(p, { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes, shapeTemplates: project.shapeTemplates, verbund: project });
  // Ausgeblendete Freiflächen (#8) fehlen im Anhang
  const rows = sortFreeSpaces(freeSpaceRows(project, freeOf).filter((r) => !r.hidden), [
    { col: 'page', dir: 'asc' },
    { col: 'area', dir: 'asc' },
    { col: 'w', dir: 'desc' },
  ]).map((r) => [r.pageName, r.areaName, num(r.width), num(r.depth), num(r.size), r.clipped ? 'angeschnitten' : '']);
  return {
    title: APPENDIX_LABEL.free,
    columns: [
      { label: 'Festplatz', align: 'left' },
      { label: 'Grundfläche', align: 'left' },
      { label: 'Breite (m)', align: 'right' },
      { label: 'Tiefe (m)', align: 'right' },
      { label: 'Fläche (m²)', align: 'right' },
      { label: 'Hinweis', align: 'left' },
    ],
    rows,
  };
}

function infraTable(project: Project, profile: ExportProfile): AppendixTable {
  const allowed = new Set(profile.fields);
  const extra: { field: StandField; label: string; align: AppendixColumn['align'] }[] = [
    { field: 'power', label: 'Strom (kW)', align: 'right' },
    { field: 'connection', label: 'Anschluss', align: 'left' },
    { field: 'note', label: 'Notiz', align: 'left' },
  ];
  const cols = extra.filter((c) => allowed.has(c.field));
  const rows = sortInfraRows(infraRows(project), DEFAULT_INFRA_SORT).map((r) => [
    r.pageName,
    r.type.label,
    r.obj.label,
    r.dims,
    ...cols.map((c) =>
      c.field === 'power' ? (r.obj.powerKw ? num(r.obj.powerKw) : '') : c.field === 'connection' ? (r.obj.connection ? CONNECTION_LABEL[r.obj.connection] : '') : r.obj.note.replace(/\s+/g, ' ').trim(),
    ),
  ]);
  return {
    title: APPENDIX_LABEL.infra,
    columns: [
      { label: 'Festplatz', align: 'left' },
      { label: 'Typ', align: 'left' },
      { label: 'Bezeichnung', align: 'left' },
      { label: 'Maße', align: 'left' },
      ...cols.map((c) => ({ label: c.label, align: c.align })),
    ],
    rows,
  };
}
