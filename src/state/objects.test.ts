import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../core/model/defaults';
import { moveRects } from '../core/transform';
import {
  addArea,
  addCategory,
  addStand,
  commitRects,
  copySelection,
  cutSelection,
  deleteCategory,
  deleteSelection,
  duplicateSelection,
  moveCategory,
  moveGroupTo,
  nudge,
  paste,
  select,
  setAreaFront,
  setRectField,
  updateStands,
} from './objects';
import { addPage } from './pages';
import { setLayer, setUseAreas } from './pageSettings';
import { deleteShapeTemplate, dissolveStandOnPage, mergeStandsOnPage, saveShapeTemplate, setFrontOverride, setStandParts, setStandShape, shapeTemplateUsage } from './shapes';
import { standPartsInMeters } from '../core/compound';
import { selectDirty, useStore } from './store';

const s = () => useStore.getState();
const page = () => s().project.pages.find((p) => p.id === s().ui.activePage)!;
const past = () => s().history.past.length;

beforeEach(() => {
  s().loadBundle({ project: createProject('T'), assets: {} }, { path: null, name: null });
});

describe('Anlegen und Rundung', () => {
  it('nur plausible Maße (beide ≥ 0,5 m) werden neues Standmaß (QA-M3-L2)', async () => {
    const { standDefaultSize } = await import('./objects');
    addStand(page().id, { cx: 0, cy: 0, w: 4, d: 2.5, rot: 0 });
    addStand(page().id, { cx: 0, cy: 0, w: 10, d: 0.2, rot: 0 });
    expect(standDefaultSize()).toEqual({ w: 4, d: 2.5 });
  });

  it('Grundfläche und Geschäft: je ein Undo-Schritt, ausgewählt, gerundet', () => {
    const id = addArea(page().id, { cx: 10.123, cy: 5.456, w: 20.004, d: 8, rot: 0 });
    expect(page().areas[0]).toMatchObject({ cx: 10.12, cy: 5.46, w: 20 });
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [id] });
    addStand(page().id, { cx: 0, cy: 0, w: 0.01, d: 500, rot: 0 });
    expect(page().stands[0]).toMatchObject({ w: 0.1, d: 100 }); // Grenzen
    expect(past()).toBe(2);
    s().undo();
    expect(page().stands).toHaveLength(0);
    expect(s().ui.selection).toBeNull(); // Auswahl auf nicht mehr vorhandenes Objekt aufgehoben
  });
});

describe('Undo: eine Geste = ein Schritt (M3-21)', () => {
  it('viele Vorschau-Schritte, ein change beim Loslassen', () => {
    const pid = page().id;
    const id = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const n0 = past();
    const r0 = { [id]: page().stands[0]! };
    for (let i = 1; i <= 120; i++) s().setPreview({ pageId: pid, rects: moveRects(r0, { x: i * 0.1, y: i * 0.05 }) });
    expect(past()).toBe(n0); // die Vorschau ist nicht in der Historie
    expect(page().stands[0]!.cx).toBe(0); // und ändert das Projekt nicht
    commitRects(pid, s().preview!.rects, 'Verschieben');
    s().setPreview(null);
    expect(past()).toBe(n0 + 1);
    expect(page().stands[0]).toMatchObject({ cx: 12, cy: 6 });
    s().undo();
    expect(page().stands[0]).toMatchObject({ cx: 0, cy: 0 });
  });

  it('abgebrochene Geste hinterlässt nichts', () => {
    const pid = page().id;
    const id = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const n0 = past();
    s().setPreview({ pageId: pid, rects: { [id]: { cx: 9, cy: 9, w: 3, d: 3, rot: 45 } } });
    s().setPreview(null);
    expect(past()).toBe(n0);
    expect(selectDirty(s())).toBe(true); // nur durch das Anlegen
  });

  it('Werkzeugwechsel verwirft eine laufende Vorschau', () => {
    s().setPreview({ pageId: page().id, rects: {} });
    s().setUi({ tool: 'hand' });
    expect(s().preview).toBeNull();
  });

  it('gedrückt gehaltene Pfeiltaste (Wiederholung) = ein Schritt; jeder einzelne Druck ein eigener (QA-M3-05)', () => {
    addStand(page().id, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const n0 = past();
    nudge(0.1, 0); // erster Druck
    for (let i = 0; i < 9; i++) nudge(0.1, 0, true); // Tastenwiederholung
    expect(page().stands[0]!.cx).toBe(1);
    expect(past()).toBe(n0 + 1);
    nudge(0.1, 0); // neuer Druck derselben Taste
    nudge(0, 1); // andere Taste
    expect(past()).toBe(n0 + 3);
    s().undo();
    s().undo();
    expect(page().stands[0]).toMatchObject({ cx: 1, cy: 0 });
    s().undo();
    expect(page().stands[0]).toMatchObject({ cx: 0, cy: 0 });
  });

  it('nach Speichern und weiterer Tastenwiederholung gilt das Projekt als geändert', () => {
    addStand(page().id, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    nudge(1, 0);
    s().markSaved(null, 'x.schelme');
    nudge(1, 0, true); // verschmilzt mit dem gespeicherten Schritt
    expect(past()).toBe(2);
    expect(selectDirty(s())).toBe(true);
  });
});

describe('Felder bei Mehrfachauswahl (M3-12, M3-13)', () => {
  it('eine Eingabe gilt für alle; ein Undo-Schritt', () => {
    const pid = page().id;
    const a = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    const b = addStand(pid, { cx: 10, cy: 0, w: 4, d: 2, rot: 30 });
    const n0 = past();
    setRectField(pid, [a, b], 'w', 5);
    setRectField(pid, [a, b], 'rot', -90);
    updateStands(pid, [a, b], { ware: 'Imbiss', powerKw: 3.5 }, 'Ware ändern');
    expect(page().stands.map((x) => [x.w, x.rot, x.ware, x.powerKw])).toEqual([
      [5, 270, 'Imbiss', 3.5],
      [5, 270, 'Imbiss', 3.5],
    ]);
    expect(past()).toBe(n0 + 3);
  });

  it('X/Y verschieben die Mitte der Auswahl', () => {
    const pid = page().id;
    const a = addStand(pid, { cx: 0, cy: 0, w: 2, d: 2, rot: 0 });
    const b = addStand(pid, { cx: 10, cy: 4, w: 2, d: 2, rot: 0 });
    moveGroupTo(pid, [a, b], { x: 105 });
    expect(page().stands.map((x) => [x.cx, x.cy])).toEqual([
      [100, 0],
      [110, 4],
    ]);
  });
});

describe('Vorderseite (M3-03)', () => {
  it('setAreaFront dreht das Koordinatensystem, die Fläche bleibt; ein Undo-Schritt', () => {
    const pid = page().id;
    const id = addArea(pid, { cx: 25, cy: 5, w: 50, d: 10, rot: 0 });
    setAreaFront(pid, id, 1);
    expect(page().areas[0]).toMatchObject({ cx: 25, cy: 5, w: 10, d: 50, rot: 270 });
    s().undo();
    expect(page().areas[0]).toMatchObject({ w: 50, d: 10, rot: 0 });
  });
});

describe('Löschen, Kopieren, Einfügen, Duplizieren (M3-16, M3-17)', () => {
  it('Duplizieren: 1 m versetzt, Platznummer leer, Kopie ausgewählt', () => {
    const pid = page().id;
    const id = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    updateStands(pid, [id], { nr: '5', nrLocked: true, name: 'A' }, 'x');
    duplicateSelection();
    const copy = page().stands[1]!;
    expect(copy).toMatchObject({ cx: 1, cy: 1, nr: '', nrLocked: false, name: 'A' });
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [copy.id] });
  });

  it('Kopieren und Einfügen auf derselben Page versetzt, auf einer anderen Page an gleicher Stelle', () => {
    const pid = page().id;
    addStand(pid, { cx: 2, cy: 3, w: 3, d: 3, rot: 0 });
    copySelection();
    paste(null);
    paste(null);
    expect(page().stands.map((x) => [x.cx, x.cy])).toEqual([
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    addPage();
    paste({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    expect(page().stands.map((x) => [x.cx, x.cy])).toEqual([[2, 3]]);
  });

  it('nach Ausschneiden auf derselben Page ebenfalls 1 m versetzt (QA-M3-L3)', () => {
    addStand(page().id, { cx: 2, cy: 3, w: 3, d: 3, rot: 0 });
    cutSelection();
    paste(null);
    expect(page().stands[0]).toMatchObject({ cx: 3, cy: 4 });
  });

  it('außerhalb des sichtbaren Bereichs wird mittig eingefügt', () => {
    addStand(page().id, { cx: 500, cy: 500, w: 3, d: 3, rot: 0 });
    cutSelection();
    expect(page().stands).toHaveLength(0);
    paste({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
    expect(page().stands[0]).toMatchObject({ cx: 10, cy: 5 });
  });

  it('Löschen der Auswahl ist ein Undo-Schritt', () => {
    const pid = page().id;
    const a = addArea(pid, { cx: 0, cy: 0, w: 10, d: 5, rot: 0 });
    const b = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    select([a, b]);
    const n0 = past();
    deleteSelection();
    expect(page().areas.length + page().stands.length).toBe(0);
    expect(past()).toBe(n0 + 1);
    s().undo();
    expect(page().areas.length + page().stands.length).toBe(2);
  });
});

describe('Kategorien (M3-08)', () => {
  it('Löschen entfernt die Kategorie an allen Ständen; Undo stellt alles her', () => {
    const pid = page().id;
    const c = addCategory();
    const st = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    updateStands(pid, [st], { categoryId: c }, 'Kategorie zuordnen');
    deleteCategory(c);
    expect(s().project.categories).toHaveLength(0);
    expect(page().stands[0]!.categoryId).toBeNull();
    s().undo();
    expect(page().stands[0]!.categoryId).toBe(c);
    expect(s().project.categories).toHaveLength(1);
  });

  it('moveCategory sortiert um, ein Undo-Schritt', () => {
    addCategory();
    const b = addCategory();
    addCategory();
    const names = () => s().project.categories.map((c) => c.name);
    moveCategory(b, 0);
    expect(names()).toEqual(['Kategorie 2', 'Kategorie 1', 'Kategorie 3']);
    moveCategory(b, 99);
    expect(names()).toEqual(['Kategorie 1', 'Kategorie 3', 'Kategorie 2']);
    s().undo();
    expect(names()).toEqual(['Kategorie 2', 'Kategorie 1', 'Kategorie 3']);
  });

  it('neue Kategorien bekommen verschiedene Farben und Namen', () => {
    addCategory();
    addCategory();
    const [a, b] = s().project.categories;
    expect(a!.color).not.toBe(b!.color);
    expect(a!.name).not.toBe(b!.name);
  });
});

describe('Ebenen (M3-14)', () => {
  it('Ein-/Ausblenden ist kein Undo-Schritt und nimmt betroffene Objekte aus der Auswahl', () => {
    const pid = page().id;
    const a = addArea(pid, { cx: 0, cy: 0, w: 10, d: 5, rot: 0 });
    const b = addStand(pid, { cx: 0, cy: 0, w: 3, d: 3, rot: 0 });
    select([a, b]);
    const n0 = past();
    setLayer(pid, 'areas', { locked: true });
    expect(past()).toBe(n0);
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [b] });
    setLayer(pid, 'stands', { visible: false });
    expect(s().ui.selection).toBeNull();
  });
});

describe('Geschäftsformen (M12, #9)', () => {
  it('Form setzen: Grundform ohne Maßänderung, Vorlage mit Vorschlagsmaß; je ein Undo-Schritt', () => {
    const pid = page().id;
    addStand(pid, { cx: 10, cy: 10, w: 4, d: 3, rot: 30 });
    const id = page().stands[0]!.id;
    const n0 = past();
    setStandShape(pid, [id], { shape: 'ellipse' });
    expect(page().stands[0]).toMatchObject({ shape: 'ellipse', shapeTemplateId: null, w: 4, d: 3 });
    const tid = saveShapeTemplate(null, ' Karussell ', [{ kind: 'ellipse', x: 2, y: 1, w: 8, h: 8, rot: 0 }, { kind: 'rect', x: 5, y: 9, w: 2, h: 2, rot: 0 }])!;
    expect(s().project.shapeTemplates[0]).toMatchObject({ id: tid, name: 'Karussell', w: 8, d: 10 });
    setStandShape(pid, [id], { templateId: tid });
    expect(page().stands[0]).toMatchObject({ shape: 'ellipse', shapeTemplateId: tid, w: 8, d: 10, cx: 10, cy: 10, rot: 30 });
    expect(past()).toBe(n0 + 3);
    s().undo();
    expect(page().stands[0]).toMatchObject({ shapeTemplateId: null, w: 4, d: 3 });
  });

  it('Vorlage ändern: Stände behalten ihr Maß; löschen: Stände fallen auf die Grundform zurück (ein Undo-Schritt)', () => {
    const pid = page().id;
    addStand(pid, { cx: 0, cy: 0, w: 4, d: 3, rot: 0 });
    const id = page().stands[0]!.id;
    const tid = saveShapeTemplate(null, 'T', [{ kind: 'rect', x: 0, y: 0, w: 6, h: 6, rot: 0 }])!;
    setStandShape(pid, [id], { templateId: tid });
    saveShapeTemplate(tid, 'T2', [{ kind: 'rect', x: 0, y: 0, w: 2, h: 2, rot: 0 }, { kind: 'ellipse', x: 2, y: 0, w: 2, h: 2, rot: 0 }]);
    expect(s().project.shapeTemplates).toHaveLength(1);
    expect(s().project.shapeTemplates[0]).toMatchObject({ name: 'T2', w: 4, d: 2 });
    expect(page().stands[0]).toMatchObject({ w: 6, d: 6, shapeTemplateId: tid });
    expect(shapeTemplateUsage(s().project, tid)).toBe(1);
    const n0 = past();
    deleteShapeTemplate(tid);
    expect(past()).toBe(n0 + 1);
    expect(s().project.shapeTemplates).toEqual([]);
    expect(page().stands[0]).toMatchObject({ shape: 'rect', shapeTemplateId: null, w: 6, d: 6 });
    s().undo();
    expect(page().stands[0]!.shapeTemplateId).toBe(tid);
  });

  it('ohne brauchbares Teil wird keine Vorlage gespeichert', () => {
    expect(saveShapeTemplate(null, 'leer', [{ kind: 'rect', x: 0, y: 0, w: 0, h: 2, rot: 0 }])).toBeNull();
    expect(s().project.shapeTemplates).toEqual([]);
  });

  it('Duplizieren übernimmt die Form', () => {
    const pid = page().id;
    addStand(pid, { cx: 0, cy: 0, w: 4, d: 3, rot: 0 });
    setStandShape(pid, [page().stands[0]!.id], { shape: 'ellipse' });
    select([page().stands[0]!.id]);
    duplicateSelection();
    expect(page().stands.map((x) => x.shape)).toEqual(['ellipse', 'ellipse']);
  });
});


describe('#17 Grundflächen verwenden', () => {
  it('Abschalten behält oder löscht die Grundflächen, je ein Undo-Schritt; Auswahl verliert die Grundflächen', () => {
    const a = addArea(page().id, { cx: 0, cy: 0, w: 20, d: 8, rot: 0 });
    const st = addStand(page().id, { cx: 50, cy: 0, w: 3, d: 3, rot: 0 });
    select([a, st]);
    const n = past();
    setUseAreas(page().id, false);
    expect(page()).toMatchObject({ useAreas: false });
    expect(page().areas.map((x) => x.id)).toEqual([a]);
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [st] });
    expect(past()).toBe(n + 1);
    s().undo();
    expect(page().useAreas).toBe(true);
    setUseAreas(page().id, false, true);
    expect(page()).toMatchObject({ useAreas: false, areas: [], hiddenFree: [] });
    expect(past()).toBe(n + 1);
    s().undo();
    expect(page()).toMatchObject({ useAreas: true });
    expect(page().areas).toHaveLength(1);
  });

  it('mitkopierte Grundflächen werden auf einer Page ohne Grundflächen nicht eingefügt', () => {
    const a = addArea(page().id, { cx: 0, cy: 0, w: 20, d: 8, rot: 0 });
    const st = addStand(page().id, { cx: 50, cy: 0, w: 3, d: 3, rot: 0 });
    select([a, st]);
    copySelection();
    addPage();
    setUseAreas(page().id, false);
    paste(null);
    expect(page().areas).toEqual([]);
    expect(page().stands).toHaveLength(1);
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [page().stands[0]!.id] });
  });
});

describe('#16 Zusammengesetzte Form', () => {
  /** Importiertes B-06: Hauptkörper und zwei Ausleger als drei einzelne Stände. */
  const importB06 = () => {
    const pid = page().id;
    const main = addStand(pid, { cx: 0, cy: 0, w: 20, d: 12, rot: 0 });
    updateStands(pid, [main], { nr: 'B-06', name: 'Hip-Hop Fly', powerKw: 63 }, 'Daten');
    const left = addStand(pid, { cx: -11.25, cy: 0, w: 2.5, d: 7, rot: 0 });
    const right = addStand(pid, { cx: 11.25, cy: 0, w: 2.5, d: 7, rot: 0 });
    return { pid, main, left, right };
  };

  it('Zusammenfassen ist ein Undo-Schritt; Daten vom größten Teil; Rückgängig stellt die drei Stände wieder her', () => {
    const { pid, main, left, right } = importB06();
    const n = past();
    const id = mergeStandsOnPage(pid, [left, main, right]);
    expect(id).toBe(main);
    expect(past()).toBe(n + 1);
    expect(page().stands).toHaveLength(1);
    expect(page().stands[0]).toMatchObject({ id: main, nr: 'B-06', name: 'Hip-Hop Fly', powerKw: 63, w: 25, d: 12, cx: 0, cy: 0 });
    expect(page().stands[0]!.parts).toHaveLength(3);
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [main] });
    s().undo();
    expect(page().stands.map((x) => x.id)).toEqual([main, left, right]);
    expect(page().stands[0]).toMatchObject({ w: 20, parts: null });
    s().redo();
    expect(page().stands).toHaveLength(1);
  });

  it('Teile bearbeiten, Frontmeter von Hand, Form auflösen – je ein Undo-Schritt', () => {
    const { pid, main, left, right } = importB06();
    mergeStandsOnPage(pid, [main, left, right]);
    const st = () => page().stands.find((x) => x.id === main)!;
    let n = past();
    // linken Ausleger um 1 m nach links: B × T wächst, der Hauptkörper bleibt auf dem Plan
    const meters = standPartsInMeters(st());
    const li = meters.findIndex((p) => p.w === 2.5 && p.x === 0);
    meters[li] = { ...meters[li]!, x: -1 };
    expect(setStandParts(pid, main, meters)).toBe(true);
    expect(st()).toMatchObject({ w: 26, cx: -0.5 });
    expect(past()).toBe(n + 1);
    setFrontOverride(pid, [main], 24);
    expect(st().frontOverride).toBe(24);
    setFrontOverride(pid, [main], null);
    expect(st().frontOverride).toBeNull();
    expect(past()).toBe(n + 3);
    n = past();
    const ids = dissolveStandOnPage(pid, main);
    expect(ids).toHaveLength(3);
    expect(past()).toBe(n + 1);
    expect(page().stands.find((x) => x.id === main)).toMatchObject({ w: 20, d: 12, cx: 0, parts: null, nr: 'B-06' });
    s().undo();
    expect(page().stands).toHaveLength(1);
  });

  it('B × T ändern: gedrehte Teile gestreckt, Hüllrechteck neu eingepasst (ein Undo-Schritt)', () => {
    const pid = page().id;
    const id = addStand(pid, { cx: 0, cy: 0, w: 4, d: 4, rot: 0 });
    setStandShape(pid, [id], { own: true });
    setStandParts(pid, id, [{ kind: 'rect', x: 0, y: 0, w: 4, h: 4, rot: 0 }, { kind: 'rect', x: 5, y: 1, w: 2, h: 2, rot: 45 }]);
    const w0 = page().stands[0]!.w;
    const n = past();
    setRectField(pid, [id], 'w', 2 * w0);
    expect(past()).toBe(n + 1);
    const st = page().stands[0]!;
    expect(st.w).not.toBe(Math.round(2 * w0 * 100) / 100);
    expect(st.parts).toHaveLength(2);
    s().undo();
    expect(page().stands[0]!.w).toBe(w0);
  });

  it('„Eigene Form“ übernimmt die gezeichneten Teile; eine Grundform entfernt sie und die Frontmeter von Hand', () => {
    const pid = page().id;
    const id = addStand(pid, { cx: 0, cy: 0, w: 8, d: 4, rot: 0 });
    const tid = saveShapeTemplate(null, 'L', [{ kind: 'rect', x: 0, y: 0, w: 8, h: 2, rot: 0 }, { kind: 'rect', x: 0, y: 2, w: 4, h: 2, rot: 0 }], true)!;
    expect(s().project.shapeTemplates[0]!.occupies).toBe(true);
    setStandShape(pid, [id], { templateId: tid });
    setFrontOverride(pid, [id], 5);
    setStandShape(pid, [id], { own: true });
    expect(page().stands[0]).toMatchObject({ shapeTemplateId: null, frontOverride: 5 });
    expect(page().stands[0]!.parts).toHaveLength(2);
    setStandShape(pid, [id], { shape: 'rect' });
    expect(page().stands[0]).toMatchObject({ parts: null, frontOverride: null, shape: 'rect' });
    // Vorlage ohne „belegt wie gezeichnet“: Frontmeter von Hand der Stände entfallen
    setStandShape(pid, [id], { templateId: tid });
    setFrontOverride(pid, [id], 5);
    saveShapeTemplate(tid, 'L', [{ kind: 'rect', x: 0, y: 0, w: 8, h: 4, rot: 0 }], false);
    expect(page().stands[0]!.frontOverride).toBeNull();
  });
});
