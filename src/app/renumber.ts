import { create } from 'zustand';
import { defaultRenumberMode, planRenumber, renumberIssue, type RenumberMode, type RenumberPlan } from '../core/numbering';
import { applyRenumber } from '../state/numbering';
import { START_PAGE, useStore } from '../state/store';
import { isVerbundRef } from '../core/verbundView';
import { notify } from './notify';

/**
 * Neu nummerieren mit Vorschau (M5-06; Dialog: ui/shell/RenumberDialog.tsx). Beide Optionen („Alle neu
 * nummerieren“, „Nur Stände ohne Nummer“) werden beim Öffnen berechnet; der Dialog zeigt die gewählte.
 */
interface RenumberState {
  plans: Record<RenumberMode, RenumberPlan> | null;
  mode: RenumberMode;
}
export const useRenumber = create<RenumberState>()(() => ({ plans: null, mode: 'all' }));

/** Bei „pro Festplatz“ die aktive Page; im Modus „manuell“ nicht möglich. Bei „global“ immer (sofern es eine nicht-manuelle Page gibt). */
export function canRenumber(): boolean {
  const s = useStore.getState();
  if (isVerbundRef(s.ui.activePage)) return false;
  const page = s.project.pages.find((p) => p.id === s.ui.activePage);
  if (s.project.settings.numbering.scope === 'global') return s.project.pages.some((p) => p.numberingMode !== 'manual');
  return !!page && page.numberingMode !== 'manual';
}

export function openRenumber() {
  const s = useStore.getState();
  if (s.ui.activePage === START_PAGE && s.project.settings.numbering.scope !== 'global') return;
  // In der Gesamtansicht eines Verbunds (#15) gesperrt
  if (isVerbundRef(s.ui.activePage)) return;
  const pageId = s.ui.activePage;
  // Gesperrt, solange eine betroffene Page nicht nummerieren kann (eigene Richtung mit A = B, #12)
  const issue = renumberIssue(s.project, pageId);
  if (issue) {
    notify(issue.pageId === pageId ? issue.message : `${issue.pageName}: ${issue.message}`);
    return;
  }
  const plans = { all: planRenumber(s.project, pageId, 'all'), missing: planRenumber(s.project, pageId, 'missing') };
  if (!plans.all.pageIds.length) {
    notify('Im Modus „manuell“ wird nicht automatisch nummeriert.');
    return;
  }
  if (!plans.all.changes.length && !plans.missing.changes.length) {
    notify(plans.all.duplicates.size ? 'Alle Nummern sind schon aktuell. Es gibt aber doppelte Nummern unter den fixierten Ständen.' : 'Alle Nummern sind schon aktuell.');
    return;
  }
  useRenumber.setState({ plans, mode: defaultRenumberMode(s.project, pageId) });
}

export const setRenumberMode = (mode: RenumberMode) => useRenumber.setState({ mode });

export function closeRenumber(apply: boolean) {
  const { plans, mode } = useRenumber.getState();
  useRenumber.setState({ plans: null });
  const plan = plans?.[mode];
  if (apply && plan?.changes.length) applyRenumber(plan);
}
