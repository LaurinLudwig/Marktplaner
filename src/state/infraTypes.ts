import { clampToLimits, INFRA_LIMITS } from '../core/infra';
import { newId } from '../core/id';
import type { Id, InfraTypeDef, Project } from '../core/model/types';
import { PALETTE } from '../core/objects';
import { useStore } from './store';

/**
 * Infrastruktur-Typen in den Projekteinstellungen (M7-08, spec.md §11). Feste Typen: Name, Farbe, Standardmaß,
 * „belegt Fläche“ und „freihalten“ änderbar; eigene Typen zusätzlich Geometrie (solange unbenutzt) und Symbol.
 * Jede Änderung ist ein Undo-Schritt.
 */

const st = () => useStore.getState();

/** Anzahl der Objekte (alle Pages) dieses Typs. */
export function infraTypeUsage(project: Pick<Project, 'pages'>, id: Id): number {
  return project.pages.reduce((n, pg) => n + pg.infra.filter((o) => o.typeId === id).length, 0);
}

export function addInfraType(): Id {
  const types = st().project.infraTypes;
  const names = new Set(types.map((t) => t.label));
  let i = 1;
  while (names.has(`Eigener Typ ${i}`)) i++;
  const used = new Set(types.map((t) => t.color));
  const t: InfraTypeDef = {
    id: newId(),
    builtin: false,
    label: `Eigener Typ ${i}`,
    geometry: 'rect',
    color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[0]!,
    icon: 'info',
    defaultW: 3,
    defaultD: 3,
    occupiesArea: true,
    keepClear: false,
  };
  st().change('Infrastruktur-Typ anlegen', (p) => void p.infraTypes.push(t));
  return t.id;
}

type Patch = Partial<Pick<InfraTypeDef, 'label' | 'color' | 'icon' | 'geometry' | 'defaultW' | 'defaultD' | 'occupiesArea' | 'keepClear'>>;

const LABEL: Record<keyof Patch, string> = {
  label: 'Typ umbenennen',
  color: 'Typ umfärben',
  icon: 'Symbol ändern',
  geometry: 'Geometrie ändern',
  defaultW: 'Standardmaß ändern',
  defaultD: 'Standardmaß ändern',
  occupiesArea: '„belegt Fläche“ ändern',
  keepClear: '„freihalten“ ändern',
};

export function updateInfraType(id: Id, patch: Patch) {
  const key = Object.keys(patch)[0] as keyof Patch | undefined;
  st().change(key ? LABEL[key] : 'Typ ändern', (p) => {
    const t = p.infraTypes.find((x) => x.id === id);
    if (!t) return;
    const next = { ...patch };
    // Geometrie und Symbol fester Typen sind fest; Geometrie eigener Typen nur, solange es keine Objekte gibt
    if (t.builtin) {
      delete next.geometry;
      delete next.icon;
    } else if (next.geometry && next.geometry !== t.geometry && infraTypeUsage(p, id) > 0) delete next.geometry;
    Object.assign(t, next);
    const lim = INFRA_LIMITS[t.geometry];
    if (next.geometry) {
      t.defaultW = t.geometry === 'point' ? 0 : Math.max(t.defaultW, 3);
      t.defaultD = t.geometry === 'point' ? 0 : t.geometry === 'line' ? 0.3 : Math.max(t.defaultD, 3);
    }
    t.defaultW = Math.round(clampToLimits(t.defaultW, lim.w) * 100) / 100;
    t.defaultD = Math.round(clampToLimits(t.defaultD, lim.d) * 100) / 100;
    if (t.geometry === 'point') {
      t.occupiesArea = false;
      t.keepClear = false;
    }
    if (t.label.trim() === '') t.label = 'Infrastruktur';
  });
}

/** Eigenen Typ löschen; seine Objekte auf allen Pages werden mitgelöscht (ein Undo-Schritt). */
export function deleteInfraType(id: Id) {
  st().change('Infrastruktur-Typ löschen', (p) => {
    const t = p.infraTypes.find((x) => x.id === id);
    if (!t || t.builtin) return;
    p.infraTypes = p.infraTypes.filter((x) => x.id !== id);
    for (const pg of p.pages) pg.infra = pg.infra.filter((o) => o.typeId !== id);
  });
  if (st().ui.infraTypeId === id) st().setUi({ infraTypeId: st().project.infraTypes[0]?.id ?? '' });
}
