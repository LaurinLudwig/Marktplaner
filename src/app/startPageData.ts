import { createFreeSpaceCache, type FreeSpaceCache } from '../core/freeSpace';
import { pageFree } from '../core/hiddenFree';
import { defaultFreeSort, filterFreeSpaces, freeSpaceRows, isFitFilterActive, sortFreeSpaces, type FreeSpaceRow } from '../core/freeSpaceList';
import { CONNECTION_LABEL } from '../core/label';
import { filterInfraRows, infraRows, sortInfraRows, type InfraRow } from '../core/infraTable';
import type { FestplatzPage, Id, InfraTypeDef, Project } from '../core/model/types';
import { filterRows, sortRows, standRows, type StandRow } from '../core/standTable';
import type { useStartPage } from '../state/startPage';

/**
 * Angezeigte Zeilen der Start-Page-Listen (M6), gemeinsam für Tabelle und CSV-Export: Filter, Sortierung und die
 * nach einer Zelländerung eingefrorene Reihenfolge.
 */

type StartState = ReturnType<typeof useStartPage.getState>;

/**
 * Eingefrorene Reihenfolge (spec.md §7): Zeilen bleiben an ihrer Stelle, auch wenn sie nach der Änderung nicht mehr
 * zum Filter passen; neue Zeilen kommen ans Ende. `stale` = die Sortierung würde jetzt anders aussehen.
 */
export function applyFrozen(frozen: readonly Id[] | null, sorted: StandRow[], all: readonly StandRow[]): { rows: StandRow[]; stale: boolean } {
  if (!frozen) return { rows: sorted, stale: false };
  const byId = new Map(all.map((r) => [r.stand.id, r]));
  const seen = new Set(frozen);
  const rows = [...frozen.flatMap((id) => byId.get(id) ?? []), ...sorted.filter((r) => !seen.has(r.stand.id))];
  const stale = rows.length !== sorted.length || rows.some((r, i) => r !== sorted[i]);
  return { rows, stale };
}

export function displayedStandRows(project: Project, st: Pick<StartState, 'standFilter' | 'standSort' | 'frozen'>) {
  const all = standRows(project);
  const sorted = sortRows(filterRows(all, st.standFilter), st.standSort);
  return { all, ...applyFrozen(st.frozen, sorted, all) };
}

/** Zwischenspeicher der Freiflächen je Page: nur geänderte Grundflächen werden neu berechnet. */
const freeCaches = new Map<Id, FreeSpaceCache>();
export function freeOf(minWidth: number, types: readonly InfraTypeDef[]) {
  return (page: FestplatzPage) => {
    let c = freeCaches.get(page.id);
    if (!c) freeCaches.set(page.id, (c = createFreeSpaceCache()));
    return pageFree(page, { minFreeWidth: minWidth, infraTypes: types }, c);
  };
}

export function allFreeRows(project: Project): FreeSpaceRow[] {
  return freeSpaceRows(project, freeOf(project.settings.minFreeWidth, project.infraTypes));
}

export function displayedFreeRows(all: readonly FreeSpaceRow[], st: Pick<StartState, 'freeFilter' | 'freeSort'>): FreeSpaceRow[] {
  return sortFreeSpaces(filterFreeSpaces(all, st.freeFilter), st.freeSort ?? defaultFreeSort(isFitFilterActive(st.freeFilter)));
}

export function displayedInfraRows(project: Project, st: Pick<StartState, 'infraFilter' | 'infraSort'>): { all: InfraRow[]; rows: InfraRow[] } {
  const all = infraRows(project);
  return { all, rows: sortInfraRows(filterInfraRows(all, st.infraFilter), st.infraSort) };
}

export const connectionText = (r: StandRow) => (r.stand.connection ? CONNECTION_LABEL[r.stand.connection] : '');

export function warningText(r: StandRow): string {
  const w = r.warnings;
  return [w.infra && 'Infrastruktur', w.overlap && 'Überlappung', w.outside && 'außerhalb', w.duplicate && 'doppelte Nummer', w.distance && 'Abstand'].filter(Boolean).join(', ');
}
