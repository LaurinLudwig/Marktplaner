import { describe, expect, it } from 'vitest';
import { createInfra } from './infra';
import { DEFAULT_INFRA_TYPES, createPage, createProject } from './model/defaults';
import { DEFAULT_INFRA_SORT, EMPTY_INFRA_FILTER, filterInfraRows, infraRows, sortInfraRows } from './infraTable';

/** M7-09: Infrastrukturliste der Start-Page (spec.md §7). */
const T = (id: string) => DEFAULT_INFRA_TYPES.find((t) => t.id === id)!;

function project() {
  const p = createProject();
  const a = { ...createPage('A'), infra: [createInfra(T('toilet'), { cx: 0, cy: 0, w: 6, d: 2.5, rot: 0 }, { label: 'Süd' }), createInfra(T('narrowPassage'), { cx: 0, cy: 0, w: 3, d: 0, rot: 0 })] };
  const b = { ...createPage('B'), infra: [createInfra(T('barrierMobile'), { cx: 0, cy: 0, w: 3.5, d: 0.3, rot: 0 }), createInfra(T('toilet'), { cx: 0, cy: 0, w: 6, d: 2.5, rot: 0 }, { label: 'Nord', note: 'Wasser' })] };
  p.pages = [a, b];
  return p;
}

describe('Infrastrukturliste', () => {
  it('Zeilen mit Maßen und Warnung; Standard-Sortierung Festplatz, Typ, Bezeichnung', () => {
    const rows = sortInfraRows(infraRows(project()), DEFAULT_INFRA_SORT);
    expect(rows.map((r) => [r.pageName, r.type.label, r.obj.label, r.dims, r.narrow])).toEqual([
      ['A', 'Toilette', 'Süd', '6 × 2,5 m', false],
      ['A', 'Enge Durchfahrt', '', '3 m licht', true],
      ['B', 'Mobile Sperre', '', '3,5 m', false],
      ['B', 'Toilette', 'Nord', '6 × 2,5 m', false],
    ]);
  });

  it('Filter nach Festplatz, Typ, Warnung und Suche (Bezeichnung, Notiz, Typ)', () => {
    const p = project();
    const rows = infraRows(p);
    expect(filterInfraRows(rows, { ...EMPTY_INFRA_FILTER, typeId: 'toilet' })).toHaveLength(2);
    expect(filterInfraRows(rows, { ...EMPTY_INFRA_FILTER, pageId: p.pages[1]!.id })).toHaveLength(2);
    expect(filterInfraRows(rows, { ...EMPTY_INFRA_FILTER, withWarning: true }).map((r) => r.type.id)).toEqual(['narrowPassage']);
    expect(filterInfraRows(rows, { ...EMPTY_INFRA_FILTER, search: 'wasser' }).map((r) => r.obj.label)).toEqual(['Nord']);
    expect(sortInfraRows(rows, [{ col: 'label', dir: 'desc' }])[0]!.obj.label).toBe('');
  });
});
