import { beforeEach, describe, expect, it } from 'vitest';
import { pageFree } from '../core/hiddenFree';
import { createProject } from '../core/model/defaults';
import { createArea, createStand } from '../core/objects';
import { hideFreeSpace, showFreeSpace } from './freeSpaces';
import { useStore } from './store';

/** #8: Ausblenden und Verfall im selben Undo-Schritt (spec.md §4). */

const page = () => useStore.getState().project.pages[0]!;
const free = () => {
  const { project } = useStore.getState();
  return pageFree(page(), { minFreeWidth: project.settings.minFreeWidth, infraTypes: project.infraTypes })[0]!;
};

beforeEach(() => {
  const project = createProject('T');
  const pg = project.pages[0]!;
  pg.areas = [createArea({ cx: 25, cy: 0, w: 50, d: 10, rot: 0 }, 'G')];
  pg.stands = [createStand({ cx: 24, cy: 3.5, w: 8, d: 3, rot: 0 })];
  useStore.getState().loadBundle({ project, assets: {} }, { path: null, name: null });
});

describe('#8 Freiflächen ausblenden', () => {
  it('Ausblenden und wieder anzeigen sind je ein Undo-Schritt', () => {
    const left = free().free[0]!;
    hideFreeSpace(page().id, left);
    expect(free().free).toHaveLength(1);
    expect(page().hiddenFree).toEqual([{ key: left.key, start: 0, end: 20 }]);
    showFreeSpace(page().id, left.key);
    expect(free().free).toHaveLength(2);
    useStore.getState().undo();
    expect(free().hidden).toHaveLength(1);
    useStore.getState().undo();
    expect(page().hiddenFree).toEqual([]);
    expect(useStore.getState().history.past).toHaveLength(0);
  });

  it('Verschieben des begrenzenden Stands hebt die Ausblendung auf; Rückgängig stellt beides wieder her', () => {
    hideFreeSpace(page().id, free().free[0]!);
    const sid = page().stands[0]!.id;
    useStore.getState().change('Verschieben', (p) => {
      p.pages[0]!.stands.find((s) => s.id === sid)!.cx = 26;
    });
    expect(page().hiddenFree).toEqual([]);
    expect(free().free).toHaveLength(2);
    expect(useStore.getState().history.past).toHaveLength(2);
    useStore.getState().undo();
    expect(page().stands[0]!.cx).toBe(24);
    expect(page().hiddenFree).toHaveLength(1);
    useStore.getState().redo();
    expect(page().hiddenFree).toEqual([]);
  });

  it('Änderungen ohne Einfluss auf die Lücke lassen die Ausblendung stehen', () => {
    hideFreeSpace(page().id, free().free[0]!);
    useStore.getState().change('Name', (p) => {
      p.pages[0]!.stands[0]!.name = 'Imbiss';
    });
    expect(page().hiddenFree).toHaveLength(1);
  });
});
