import { beforeEach, describe, expect, it } from 'vitest';
import { createPage, createProject, createVerbund, LEGACY_SHEET } from '../core/model/defaults';
import { createArea } from '../core/objects';
import { pagePaper } from '../core/paper';
import { verbundRef } from '../core/verbund';
import { pageView } from '../core/verbundView';
import { moveSheetTo, nudgePaper, placeTitleBlock, setPaperAnchor, setPaperVisible, setSheet, setSheetRegion, setTitleBlockText } from './paper';
import { setLayer } from './pageSettings';
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

describe('Blatt der Gesamtansicht eines Verbunds (#15 Teil c)', () => {
  const REF = verbundRef('g');
  const g = () => st().project.groups[0]!;
  const view = () => pageView(st().project, REF)!;
  const labels = () => st().history.past.map((h) => h.label);

  beforeEach(() => {
    const p = createProject('T');
    const a = { ...createPage('Müllerwiese'), id: 'A', areas: [createArea({ cx: 10, cy: 5, w: 20, d: 10, rot: 0 })] };
    const b = { ...createPage('Ziegelturm'), id: 'B', areas: [createArea({ cx: 40, cy: 5, w: 20, d: 10, rot: 0 })] };
    p.pages = [a, b];
    p.groups = [{ ...createVerbund('Unterstadt', ['A', 'B']), id: 'g' }];
    st().loadBundle({ project: p, assets: {} }, { path: null, name: null });
    st().setUi({ activePage: REF });
  });

  it('Format, Maßstab und Ausschnitt landen im Verbund, nicht in den Mitgliedern; je ein Undo-Schritt', () => {
    const pagesBefore = st().project.pages;
    // „Plan“ (Vorgabe): Inhalt sind beide Mitglieder
    const plan = pagePaper(view(), st().project).frame;
    expect(plan.bounds.minX).toBeLessThan(0);
    expect(plan.bounds.maxX).toBeGreaterThan(50);
    setSheet(REF, { format: 'A2' });
    expect(g().sheet.format).toBe('A2');
    expect(view().sheet).toBe(g().sheet);
    setSheet(REF, { scale: 750 });
    // Beim Wechsel auf einen festen Maßstab wird die Mitte des angepassten Blatts übernommen (etwa die Mitte beider
    // Plätze; die Papier-Elemente verschieben sie leicht)
    expect(g().sheet.scale).toBe(750);
    expect(g().sheet.cx).toBeCloseTo(25, 0);
    expect(g().sheet.cy).toBeCloseTo(5, 0);
    moveSheetTo(REF, { x: 30, y: 6 });
    expect(g().sheet).toMatchObject({ cx: 30, cy: 6 });
    setSheetRegion(REF, { minX: 0, minY: 0, maxX: 60, maxY: 20 });
    expect(g().sheet).toMatchObject({ format: 'region', region: { cx: 30, cy: 10, w: 60, h: 20 } });
    expect(st().project.pages).toBe(pagesBefore);
    expect(labels()).toEqual(['Papierformat ändern', 'Maßstab ändern', 'Blatt verschieben', 'Ausschnitt ändern']);
    for (let i = 0; i < 4; i++) st().undo();
    expect(g().sheet.format).toBe('plan');
    st().redo();
    expect(g().sheet.format).toBe('A2');
  });

  it('Papier-Elemente: Sichtbarkeit, Lage, Freitext, Schriftfeld setzen und Pfeiltasten am Verbund (Undo)', () => {
    setPaperVisible(REF, 'legend', false);
    expect(g().legend.visible).toBe(false);
    setPaperAnchor(REF, 'titleBlock', { corner: 'tl', dx: 12, dy: 15 });
    expect(g().titleBlock).toMatchObject({ corner: 'tl', dx: 12, dy: 15 });
    setTitleBlockText(REF, 'Übersichtsplan');
    expect(g().titleBlockText).toBe('Übersichtsplan');
    placeTitleBlock(REF, { corner: 'br', dx: 20, dy: 20 });
    expect(g().titleBlock).toMatchObject({ corner: 'br', dx: 20, dy: 20, visible: true });
    expect(st().ui.selection).toEqual({ kind: 'paper', element: 'titleBlock' });
    nudgePaper(0, -1);
    expect(g().titleBlock.dy).toBe(21);
    // Mitglieder unverändert
    for (const p of st().project.pages) {
      expect(p.legend.visible).toBe(true);
      expect(p.titleBlockText).toBe('');
    }
    expect(labels()).toEqual(['Legende ausblenden', 'Schriftfeld verschieben', 'Freitext des Schriftfelds ändern', 'Schriftfeld setzen', 'Schriftfeld verschieben']);
    for (let i = 0; i < 5; i++) st().undo();
    expect(g()).toMatchObject({ titleBlockText: '', legend: { visible: true }, titleBlock: { corner: 'br', dx: 10, dy: 10 } });
  });

  it('Ebene „Blatt“ des Verbunds lässt sich ausblenden (Ansichtseinstellung wie bei einer Page)', () => {
    setLayer(REF, 'sheet', { visible: false });
    expect(g().layers.sheet.visible).toBe(false);
    expect(view().layers.sheet.visible).toBe(false);
    expect(st().project.pages.every((p) => p.layers.sheet.visible)).toBe(true);
  });
});
