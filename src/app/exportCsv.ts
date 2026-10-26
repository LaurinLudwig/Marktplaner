import { safeFileName, toCsv, withExportNote, type CsvCell } from '../core/csv';
import { userMessage } from '../core/errors';
import type { StandRow } from '../core/standTable';
import { platform } from '../platform';
import { useStartPage, type StandColumn } from '../state/startPage';
import { useStore } from '../state/store';
import { showError } from './dialogs';
import { notify } from './notify';
import { allFreeRows, connectionText, displayedFreeRows, displayedInfraRows, displayedStandRows, warningText } from './startPageData';
import { CONNECTION_LABEL } from '../core/label';

/** CSV-Export der Start-Page (M6-06, spec.md §7): die angezeigten Zeilen der aktiven Liste mit den sichtbaren Spalten. */

const STAND_CSV: Record<StandColumn, { header: string; value: (r: StandRow) => CsvCell }> = {
  page: { header: 'Festplatz', value: (r) => r.pageName },
  nr: { header: 'Nr', value: (r) => r.stand.nr },
  name: { header: 'Name', value: (r) => r.stand.name },
  owner: { header: 'Eigentümer', value: (r) => r.stand.owner },
  ware: { header: 'Ware', value: (r) => r.stand.ware },
  category: { header: 'Kategorie', value: (r) => r.categoryName },
  w: { header: 'Breite (m)', value: (r) => r.stand.w },
  d: { header: 'Tiefe (m)', value: (r) => r.stand.d },
  power: { header: 'Strom (kW)', value: (r) => r.stand.powerKw },
  connection: { header: 'Anschlussart', value: connectionText },
  warnings: { header: 'Warnungen', value: warningText },
  note: { header: 'Notiz', value: (r) => r.stand.note },
};

/** Spalten in Tabellen-Reihenfolge; Name ist immer dabei. */
export const STAND_COLUMN_ORDER: readonly StandColumn[] = ['page', 'nr', 'name', 'owner', 'ware', 'category', 'w', 'd', 'power', 'connection', 'warnings', 'note'];

export function standCsv(rows: readonly StandRow[], hidden: readonly StandColumn[]): string {
  const cols = STAND_COLUMN_ORDER.filter((c) => c === 'name' || !hidden.includes(c));
  return toCsv(
    cols.map((c) => STAND_CSV[c].header),
    rows.map((r) => cols.map((c) => STAND_CSV[c].value(r))),
  );
}

export async function exportCurrentList() {
  const { project } = useStore.getState();
  const st = useStartPage.getState();
  let csv: string;
  let what: string;
  if (st.tab === 'free') {
    const rows = displayedFreeRows(allFreeRows(project), st);
    // Spalte „ausgeblendet“ nur, wenn ausgeblendete Freiflächen gezeigt werden (#8)
    const withHidden = st.freeFilter.showHidden;
    csv = toCsv(
      ['Festplatz', 'Grundfläche', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)', 'angeschnitten', ...(withHidden ? ['ausgeblendet'] : [])],
      rows.map((r) => [r.pageName, r.areaName, r.width, r.depth, r.size, r.clipped ? 'ja' : '', ...(withHidden ? [r.hidden ? 'ja' : ''] : [])]),
    );
    what = 'Freiflächen';
  } else if (st.tab === 'infra') {
    const rows = displayedInfraRows(project, st).rows;
    csv = toCsv(
      ['Festplatz', 'Typ', 'Bezeichnung', 'Breite/Länge (m)', 'Tiefe/Stärke (m)', 'Strom (kW)', 'Anschlussart', 'Warnung', 'Notiz'],
      rows.map((r) => [
        r.pageName,
        r.type.label,
        r.obj.label,
        r.type.geometry === 'point' ? null : r.obj.w,
        r.type.geometry === 'rect' || (r.type.geometry === 'line' && r.obj.d > 0) ? r.obj.d : null,
        r.type.geometry === 'rect' ? r.obj.powerKw : null,
        r.obj.connection ? CONNECTION_LABEL[r.obj.connection] : '',
        r.narrow ? 'Durchfahrt zu eng' : '',
        r.obj.note,
      ]),
    );
    what = 'Infrastruktur';
  } else {
    csv = standCsv(displayedStandRows(project, st).rows, st.hidden);
    what = 'Geschäfte';
  }
  const name = `${safeFileName(project.name)} – ${what}.csv`;
  try {
    const saved = await platform.saveFile(new TextEncoder().encode(withExportNote(csv)), name, { name: 'CSV (Excel)', extensions: ['csv'] }, 'text/csv;charset=utf-8', useStore.getState().filePath);
    if (saved) notify(`${what} exportiert: ${saved.name}`, 'success');
  } catch (e) {
    void showError('Export fehlgeschlagen', userMessage(e, 'Die CSV-Datei konnte nicht geschrieben werden.'));
  }
}
