import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, LEGACY_SHEET } from '../core/model/defaults';
import { createArea } from '../core/objects';
import { pagePaper } from '../core/paper';
import { moveSheetTo, nudgePaper, setSheet, setSheetRegion } from './paper';
import { useStore } from './store';

/** Blatt umschalten, verschieben, Ausschnitt (#13): Befehle der Seitenleiste und der Zeichenfläche. */

const st = () => useStore.getState();
const pg = () => st().project.pages[0]!;
const frame = () => pagePaper(pg(), st().project).frame;

beforeEach(() => {
  const p = createProject('T');
  p.pages[0]!.areas.push(createArea({ cx: 100, cy: 25, w: 200, d: 50, rot: 0 }));
  st().loadBundle({ project: p, assets: {} }, { path: null, name: null });
  st().setUi({ activePage: p.pages[0]!.id });
});

describe('Blatt umschalten (#13)', () => {
  it('Rand und Zielbreite: je ein Undo-Schritt, begrenzt und gerundet', () => {
    setSheet(pg().id, { margin: 3.4 });
    expect(pg().sheet.margin).toBe(10);
    setSheet(pg().id, { targetWidth: 1200.4 });
    expect(pg().sheet.targetWidth).toBe(1200);
    expect(st().history.past.map((h) => h.label)).toEqual(['Rand ändern', 'Zielbreite ändern']);
    st().undo();
    st().undo();
    expect(pg().sheet).toMatchObject({ margin: null, targetWidth: 841 });
  });

  it('Wechsel auf „Ausschnitt“: das bisherige Blatt wird der Ausschnitt, mit dessen Maßstab (Papier bleibt gleich)', () => {
    const before = frame();
    setSheet(pg().id, { format: 'region' });
    const s = pg().sheet;
    expect(s.format).toBe('region');
    expect(s.scale).toBe(before.scale);
    expect(s.region!.w).toBeCloseTo(before.bounds.maxX - before.bounds.minX, 1);
    expect(frame().paper.w).toBeCloseTo(before.paper.w, 0);
    expect(st().history.past).toHaveLength(1);
  });

  it('Wechsel von „Plan“ auf DIN mit festem Maßstab übernimmt die Mitte; DIN bleibt sonst unverändert', () => {
    setSheet(pg().id, { scale: 500 });
    const c = frame().bounds;
    setSheet(pg().id, { format: 'A1' });
    expect(pg().sheet).toMatchObject({ format: 'A1', scale: 500 });
    expect(pg().sheet.cx).toBeCloseTo((c.minX + c.maxX) / 2, 2);
    expect(pg().sheet.cy).toBeCloseTo((c.minY + c.maxY) / 2, 2);
    setSheet(pg().id, { format: 'A3' });
    expect(pg().sheet.format).toBe('A3');
    expect(pg().sheet.cx).toBeCloseTo((c.minX + c.maxX) / 2, 2);
  });

  it('Ausschnitt verschieben (Ziehen, Pfeiltasten) und an den Griffen ändern; ein Plan lässt sich nicht verschieben', () => {
    st().setUi({ selection: { kind: 'paper', element: 'sheet' } });
    nudgePaper(10, 0);
    expect(st().history.past).toHaveLength(0);
    setSheetRegion(pg().id, { minX: 0, minY: 0, maxX: 100, maxY: 40 });
    expect(pg().sheet).toMatchObject({ format: 'region', region: { cx: 50, cy: 20, w: 100, h: 40 } });
    moveSheetTo(pg().id, { x: 70.004, y: 30 });
    expect(pg().sheet.region).toEqual({ cx: 70, cy: 30, w: 100, h: 40 });
    const k = frame().scale;
    nudgePaper(10, 0);
    expect(pg().sheet.region!.cx).toBeCloseTo(70 + (10 * k) / 1000, 2);
    // DIN mit festem Maßstab: Mitte wie bisher
    setSheet(pg().id, { ...LEGACY_SHEET, scale: 500 });
    moveSheetTo(pg().id, { x: 1, y: 2 });
    expect(pg().sheet).toMatchObject({ cx: 1, cy: 2 });
  });
});
