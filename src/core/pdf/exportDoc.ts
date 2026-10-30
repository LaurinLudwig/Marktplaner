/**
 * Inhalt eines PDF-Exports zusammenstellen (M8, spec.md §9): Schwärzung nach Profil, Szenen der gewählten Pages in
 * Tab-Reihenfolge und Tabellen des Anhangs. Rein; der PDF-Schreiber (writePdf.ts) macht daraus Bytes.
 */
import { CONNECTION_LABEL } from '../label';
import { hasPricing, fmtMoney } from '../fee';
import { fmt } from '../format';
import { pageFree } from '../hiddenFree';
import { freeSpaceRows, sortFreeSpaces } from '../freeSpaceList';
import { infraRows, sortInfraRows, DEFAULT_INFRA_SORT } from '../infraTable';
import type { Id, Project } from '../model/types';
import { pageScene, type PageScene } from '../scene/page';
import { DEFAULT_STAND_SORT, sortRows, standRows } from '../standTable';
import { APPENDIX_LABEL, redactProject, type AppendixPart, type ExportProfile, type StandField } from '../exportProfiles';
import type { AppendixColumn, AppendixTable } from './writePdf';

export interface ExportRequest {
  /** Pages in Tab-Reihenfolge; null = Gesamtplan (alle). */
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

export function buildExport(project: Project, profile: ExportProfile, req: ExportRequest): ExportContent {
  const red = redactProject(project, profile);
  const wanted = req.pageIds ? new Set(req.pageIds) : null;
  const pages = red.pages.filter((p) => !wanted || wanted.has(p.id));
  const scoped: Project = { ...red, pages };
  const appendix: AppendixTable[] = [];
  const on = (part: AppendixPart) => !!req.appendix[part] && profile.appendix[part];
  if (on('stands')) appendix.push(standTable(scoped, profile));
  if (on('free')) appendix.push(freeTable(scoped));
  if (on('infra')) appendix.push(infraTable(scoped, profile));
  return {
    title: `${project.name.trim() || 'Projekt'} – ${profile.name}`,
    projectName: project.name.trim() || 'Projekt',
    // Szenen sehen das ganze geschwärzte Projekt (Nummernkreis über alle Pages), zeichnen aber nur ihre Page
    scenes: pages.map((p) => pageScene(p, red, profile)),
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
  const freeOf = (p: Project['pages'][number]) => pageFree(p, { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes });
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
