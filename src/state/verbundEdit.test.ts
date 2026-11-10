import { beforeEach, describe, expect, it } from 'vitest';
import { createPage, createProject, createVerbund } from '../core/model/defaults';
import type { Area, FestplatzPage, Project, Stand } from '../core/model/types';
import { createArea, createStand } from '../core/objects';
import { applyTransform, mergedPage, pageEnv, pagePivot, placementOf, transformPageContent, verbundRef } from '../core/verbund';
import { decodeProjectFile, encodeProjectFile } from '../core/fileFormat';
import { cachedWarningData, countWarnings } from '../core/warnings';
import { alignPreview, fitRigid, NO_SESSION, sessionMove, sessionRotate, sessionTransform } from '../core/verbundView';
import {
  activePage,
  addArea,
  addStand,
  commitRects,
  copySelection,
  deleteObjects,
  duplicateSelection,
  moveBy,
  newObjectsPage,
  paste,
  reassignObjects,
  select,
  selectAll,
  setNewObjectsPage,
  setRectField,
  updateStands,
} from './objects';
import { hideFreeSpace } from './freeSpaces';
import { pageFree } from '../core/hiddenFree';
import { setNrLocked } from './numbering';
import { setLayer } from './pageSettings';
import { commitStandParts, dissolveStandOnPage, mergeStandsOnPage, setStandParts } from './shapes';
import { refitStand } from '../core/compound';
import { cyclePage } from './pages';
import { projectForSave, useStore } from './store';
import { movePageContent } from './verbund';

const s = () => useStore.getState();
const past = () => s().history.past.length;
const REF = verbundRef('g');
const pageById = (id: string) => s().project.pages.find((p) => p.id === id)!;
const ids = (id: string) => {
  const p = pageById(id);
  return [...p.areas, ...p.stands, ...p.infra].map((o) => o.id);
};
/** Objekt in der Gesamtansicht (im System des Verbunds, #27). */
const worldOf = (id: string) => {
  const m = mergedPage(s().project, s().project.groups[0]!);
  return [...m.areas, ...m.stands, ...m.infra].find((o) => o.id === id)!;
};
const area = (id: string, cx: number, cy: number, w: number, d: number): Area => ({ ...createArea({ cx, cy, w, d, rot: 0 }), id });
const stand = (id: string, cx: number, cy: number): Stand => ({ ...createStand({ cx, cy, w: 3, d: 3, rot: 0 }), id });

/** Müllerwiese (A) und Ziegelturm (B) im Verbund „Unterstadt“; die Grundflächen überschneiden sich bei x = 15…20. */
function load() {
  const base = createProject('T');
  const a: FestplatzPage = { ...createPage('Müllerwiese'), id: 'A', areas: [area('aA', 10, 5, 20, 10)], stands: [stand('sA', 5, 5)] };
  const b: FestplatzPage = { ...createPage('Ziegelturm'), id: 'B', areas: [area('aB', 25, 5, 20, 10)], stands: [stand('sB', 30, 5)] };
  const project: Project = { ...base, pages: [a, b], groups: [{ ...createVerbund('Unterstadt', ['A', 'B']), id: 'g' }] };
  s().loadBundle({ project, assets: {} }, { path: null, name: null });
  s().setUi({ activePage: REF });
}

beforeEach(load);

describe('#15 Gesamtansicht: Mutationen nach Besitzer gruppiert', () => {
  it('aktive Page ist die Gesamtansicht mit den Objekten beider Plätze; Auswahl über Platzgrenzen', () => {
    expect(activePage()?.id).toBe(REF);
    selectAll();
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: ['aA', 'aB', 'sA', 'sB'] });
  });

  it('Verschieben über zwei Pages: ein Undo-Schritt, Besitz bleibt; Undo und Redo', () => {
    const before = past();
    commitRects(REF, { sA: { cx: 6, cy: 5, w: 3, d: 3, rot: 0 }, sB: { cx: 18, cy: 5, w: 3, d: 3, rot: 0 } }, 'Verschieben');
    expect(past()).toBe(before + 1);
    expect(pageById('A').stands[0]).toMatchObject({ id: 'sA', cx: 6 });
    // sB steht jetzt auch auf Müllerwiese – gehört aber weiter dem Ziegelturm
    expect(pageById('B').stands[0]).toMatchObject({ id: 'sB', cx: 18 });
    s().undo();
    expect(pageById('A').stands[0]!.cx).toBe(5);
    expect(pageById('B').stands[0]!.cx).toBe(30);
    s().redo();
    expect(pageById('B').stands[0]!.cx).toBe(18);
  });

  it('Pfeiltasten, Feldänderung und Attribute über zwei Pages je ein Schritt', () => {
    const before = past();
    moveBy(REF, ['sA', 'sB'], 1, 0, 'Verschieben');
    setRectField(REF, ['sA', 'sB'], 'rot', 90);
    updateStands(REF, ['sA', 'sB'], { name: 'Imbiss' }, 'Name ändern');
    setNrLocked(REF, ['sA', 'sB'], true);
    expect(past()).toBe(before + 4);
    for (const id of ['A', 'B']) expect(pageById(id).stands[0]).toMatchObject({ rot: 90, name: 'Imbiss', nrLocked: true });
    expect(pageById('A').stands[0]!.cx).toBe(6);
    expect(pageById('B').stands[0]!.cx).toBe(31);
  });

  it('Löschen über zwei Pages: ein Undo-Schritt, Undo stellt beide wieder her', () => {
    const before = past();
    deleteObjects(REF, ['sA', 'sB']);
    expect(past()).toBe(before + 1);
    expect(pageById('A').stands).toEqual([]);
    expect(pageById('B').stands).toEqual([]);
    s().undo();
    expect(ids('A')).toEqual(['aA', 'sA']);
    expect(ids('B')).toEqual(['aB', 'sB']);
    s().redo();
    expect(pageById('B').stands).toEqual([]);
  });

  it('Zusammenfassen über zwei Plätze: der Stand bleibt auf dem Platz des größten Ausgangsstands, ein Schritt', () => {
    const before = past();
    const id = mergeStandsOnPage(REF, ['sA', 'sB']);
    expect(past()).toBe(before + 1);
    const all = [...pageById('A').stands, ...pageById('B').stands];
    expect(all.map((x) => x.id)).toEqual([id]);
  });

  it('Ebenen der Gesamtansicht gehören dem Verbund (kein Undo-Schritt)', () => {
    const before = past();
    setLayer(REF, 'stands', { locked: true });
    expect(s().project.groups[0]!.layers.stands.locked).toBe(true);
    expect(pageById('A').layers.stands.locked).toBe(false);
    expect(past()).toBe(before);
  });

  it('Ansicht der Gesamtansicht wird im Verbund gespeichert', () => {
    s().setView(REF, { scale: 3, tx: 1, ty: 2 });
    expect(projectForSave(s()).groups[0]!.view).toEqual({ scale: 3, tx: 1, ty: 2 });
  });
});

describe('#15 Zuordnung neuer Objekte', () => {
  it('auf einer Grundfläche → deren Platz; auf zwei oder keiner → „Neue Objekte auf“', () => {
    const one = addStand(REF, { cx: 5, cy: 2, w: 2, d: 2, rot: 0 });
    expect(pageById('A').stands.some((x) => x.id === one)).toBe(true);
    const onB = addStand(REF, { cx: 30, cy: 2, w: 2, d: 2, rot: 0 });
    expect(pageById('B').stands.some((x) => x.id === onB)).toBe(true);
    expect(newObjectsPage('g')).toBe('A');
    const both = addStand(REF, { cx: 17.5, cy: 2, w: 2, d: 2, rot: 0 });
    expect(pageById('A').stands.some((x) => x.id === both)).toBe(true);
    setNewObjectsPage('g', 'B');
    const both2 = addStand(REF, { cx: 17.5, cy: 8, w: 2, d: 2, rot: 0 });
    const none = addStand(REF, { cx: 100, cy: 100, w: 2, d: 2, rot: 0 });
    expect(pageById('B').stands.map((x) => x.id)).toEqual(expect.arrayContaining([both2, none]));
    // Neues Objekt ist ausgewählt; je Anlegen ein Undo-Schritt
    expect(s().ui.selection).toEqual({ kind: 'objects', ids: [none] });
  });

  it('Grundfläche: auf den Platz „Neue Objekte auf“', () => {
    setNewObjectsPage('g', 'B');
    const id = addArea(REF, { cx: 100, cy: 100, w: 10, d: 10, rot: 0 });
    expect(pageById('B').areas.some((a) => a.id === id)).toBe(true);
  });

  it('Verschieben ändert die Zuordnung nie', () => {
    commitRects(REF, { sA: { cx: 30, cy: 5, w: 3, d: 3, rot: 0 } }, 'Verschieben');
    expect(pageById('A').stands.map((x) => x.id)).toEqual(['sA']);
    expect(pageById('B').stands.map((x) => x.id)).toEqual(['sB']);
  });

  it('Einfügen in der Gesamtansicht: jede Kopie nach ihrer Grundfläche', () => {
    s().setUi({ activePage: 'A' });
    select(['sA']);
    copySelection();
    s().setUi({ activePage: REF });
    // Gleiche Lage wie das Original (andere Page), 1 m versetzt beim zweiten Mal – beide auf Müllerwiese
    paste(null);
    expect(pageById('A').stands).toHaveLength(2);
    // Kopie eines Stands vom Ziegelturm, eingefügt in der Gesamtansicht: nach Lage auf dem Ziegelturm
    s().setUi({ activePage: 'B' });
    select(['sB']);
    copySelection();
    s().setUi({ activePage: REF });
    const before = past();
    paste(null);
    expect(past()).toBe(before + 1);
    expect(pageById('B').stands).toHaveLength(2);
  });

  it('Duplizieren im Überschneidungsbereich: die Kopie gehört dem Platz des Originals', () => {
    commitRects(REF, { sB: { cx: 16, cy: 4, w: 3, d: 3, rot: 0 } }, 'Verschieben');
    setNewObjectsPage('g', 'A');
    select(['sB']);
    duplicateSelection();
    expect(pageById('B').stands).toHaveLength(2);
    expect(pageById('A').stands).toHaveLength(1);
  });
});

describe('#15 Umhängen (Feld „Festplatz“)', () => {
  it('Mehrfachauswahl wechselt in die Liste der anderen Page, ein Undo-Schritt', () => {
    const before = past();
    expect(reassignObjects(['sA', 'sB'], 'B')).toBe(1);
    expect(past()).toBe(before + 1);
    expect(pageById('A').stands).toEqual([]);
    expect(pageById('B').stands.map((x) => x.id)).toEqual(['sB', 'sA']);
    expect(reassignObjects(['sA'], 'B')).toBe(0);
    s().undo();
    expect(pageById('A').stands.map((x) => x.id)).toEqual(['sA']);
  });

  it('Grundfläche nimmt ihre ausgeblendeten Freiflächen mit (Ausblenden in der Gesamtansicht landet beim Besitzer)', () => {
    const p = s().project;
    const fs = pageFree(pageById('A'), { minFreeWidth: p.settings.minFreeWidth, infraTypes: p.infraTypes, verbund: p }).find((x) => x.areaId === 'aA')!.free[0]!;
    hideFreeSpace(REF, fs);
    expect(pageById('A').hiddenFree.map((h) => h.key)).toEqual([fs.key]);
    reassignObjects(['aA'], 'B');
    expect(pageById('B').areas.map((a) => a.id)).toEqual(['aB', 'aA']);
    expect(pageById('A').hiddenFree).toEqual([]);
    expect(pageById('B').hiddenFree.map((h) => h.key)).toEqual([fs.key]);
  });

  it('Nummer, Schloss, Strom und Attribute bleiben; Stromlimit des Ziel-Platzes blockiert wie beim Ändern', () => {
    s().change('Attribute', (p) => {
      Object.assign(p.pages[0]!.stands[0]!, { nr: 'M-01', nrLocked: true, powerKw: 5, name: 'Waffeln' });
      Object.assign(p.pages[1]!, { powerLimitKw: 4, blockOverLimit: true });
    });
    const before = past();
    expect(reassignObjects(['sA'], 'B')).toBe(0);
    expect(past()).toBe(before);
    expect(pageById('A').stands.map((x) => x.id)).toEqual(['sA']);
    s().change('Limit', (p) => void (p.pages[1]!.powerLimitKw = 10));
    expect(reassignObjects(['sA'], 'B')).toBe(1);
    expect(pageById('B').stands.find((x) => x.id === 'sA')).toMatchObject({ nr: 'M-01', nrLocked: true, powerKw: 5, name: 'Waffeln', cx: 5, cy: 5 });
  });

  it('keine Grundfläche auf eine Page ohne Grundflächen (#17)', async () => {
    s().change('ohne', (p) => void (p.pages[1]!.useAreas = false));
    expect(reassignObjects(['aA'], 'B')).toBe(0);
    expect(pageById('A').areas.map((a) => a.id)).toEqual(['aA']);
    // Nicht still: Hinweis, dass der Platz keine Grundflächen verwendet; Stände einer gemischten Auswahl wechseln trotzdem
    const { useToasts } = await import('../app/notify');
    expect(useToasts.getState().toasts.at(-1)?.text).toBe('„Ziegelturm“ verwendet keine Grundflächen: Die Grundfläche bleibt auf ihrem Platz.');
    expect(reassignObjects(['aA', 'sA'], 'B')).toBe(1);
    expect(pageById('B').stands.map((x) => x.id)).toEqual(['sB', 'sA']);
    expect(pageById('A').areas.map((a) => a.id)).toEqual(['aA']);
  });
});

describe('#15 Ausrichten', () => {
  it('Ziehen = Verschiebung der ganzen Page (#27: nur ihre Lage), ein Undo-Schritt', () => {
    const before = past();
    const b0 = pageById('B');
    expect(movePageContent('B', { dx: 2.004, dy: -1, rot: 0, pivot: { x: 0, y: 0 } })).toBe(true);
    expect(past()).toBe(before + 1);
    expect(worldOf('sB')).toMatchObject({ cx: 32, cy: 4 });
    expect(worldOf('aB')).toMatchObject({ cx: 27, cy: 4 });
    expect(worldOf('sA').cx).toBe(5);
    // Der Inhalt der Page bleibt in ihren eigenen Koordinaten
    expect(pageById('B')).toBe(b0);
    expect(placementOf(s().project.groups[0], 'B')).toEqual({ x: 2, y: -1, rot: 0 });
    s().undo();
    expect(worldOf('sB')).toMatchObject({ cx: 30, cy: 5 });
  });

  it('Punkte (2 Paare): Ecken des Ziegelturms auf die passenden Punkte, Drehung und Verschiebung', () => {
    // Ziegelturm soll um 90° gedreht und verschoben werden: seine Grundflächen-Ecken (15|0) und (35|0) auf (40|20) und (40|40)
    const r = fitRigid([
      { a: { x: 15, y: 0 }, b: { x: 40, y: 20 } },
      { a: { x: 35, y: 0 }, b: { x: 40, y: 40 } },
    ])!;
    expect(r.rot).toBeCloseTo(90, 6);
    expect(movePageContent('B', r.t)).toBe(true);
    const ar = worldOf('aB');
    // Mitte der Grundfläche (25|5) liegt nach der Bewegung bei (35|30), Drehung 90°
    const expected = applyTransform({ ...r.t, rot: 90 }, { x: 25, y: 5 });
    expect(ar.cx).toBeCloseTo(expected.x, 1);
    expect(ar.cy).toBeCloseTo(expected.y, 1);
    expect(ar.rot).toBe(90);
    // Einzelansicht ungedreht
    expect(pageById('B').areas[0]).toMatchObject({ cx: 25, cy: 5, rot: 0 });
  });

  it('Punkte (4 Paare): „Anwenden“ ist ein Undo-Schritt mit Redo; die Vorschau (Lage, #27) ändert das Projekt nicht und zeigt das Ergebnis', () => {
    const truth = { dx: -12.5, dy: 30.25, rot: 200, pivot: { x: 0, y: 0 } };
    const as = [
      { x: 15, y: 0 },
      { x: 35, y: 0 },
      { x: 35, y: 10 },
      { x: 30, y: 5 },
    ];
    const r = fitRigid(as.map((a) => ({ a, b: applyTransform(truth, a) })))!;
    const before = past();
    const project = s().project;
    const preview = alignPreview(s().project.groups[0]!, pageById('B'), r.t);
    expect(s().project).toBe(project);
    expect(movePageContent('B', r.t, { precise: true })).toBe(true);
    expect(past()).toBe(before + 1);
    // Die Vorschau-Lage ist die gespeicherte Lage, ihre Rechtecke die Weltlage nach dem Übernehmen
    const stored = placementOf(s().project.groups[0], 'B');
    expect(stored.x).toBeCloseTo(preview.placement.x, 7);
    expect(stored.y).toBeCloseTo(preview.placement.y, 7);
    expect(stored.rot).toBeCloseTo(preview.placement.rot, 7);
    expect(worldOf('sB').cx).toBeCloseTo(preview.rects.sB!.cx, 6);
    expect(worldOf('sB').cy).toBeCloseTo(preview.rects.sB!.cy, 6);
    const moved = worldOf('sB');
    const target = applyTransform(truth, { x: 30, y: 5 });
    expect(Math.hypot(moved.cx - target.x, moved.cy - target.y)).toBeLessThanOrEqual(0.005);
    expect(moved.rot).toBeCloseTo(200, 6);
    // Einzelansicht unverändert (#27)
    expect(pageById('B').stands[0]).toMatchObject({ cx: 30, cy: 5, rot: 0 });
    s().undo();
    expect(worldOf('sB')).toMatchObject({ cx: 30, cy: 5, rot: 0 });
    expect(pageById('A').stands[0]!.cx).toBe(5);
    s().redo();
    expect(worldOf('sB').cx).toBeCloseTo(target.x, 6);
    expect(worldOf('sB').cy).toBeCloseTo(target.y, 6);
  });

  it('manuelle Sitzung: mehrfach ziehen und drehen, „Fertig“ = ein Undo-Schritt wie die Einzelschritte nacheinander', () => {
    const start = pageById('B');
    const pivot = pagePivot(start);
    // Ziehen, Drehgriff (90° um die bewegte Mitte), erneut ziehen, Gradfeld (+7,25°), Drehgriff mit Shift (15°-Schritte)
    let session = sessionMove(NO_SESSION, { x: 10.004, y: -3 });
    const c1 = { x: pivot.x + session.dx, y: pivot.y + session.dy };
    session = sessionRotate(session, c1, { x: c1.x + 10, y: c1.y }, { x: c1.x, y: c1.y + 10 });
    expect(session.rot).toBe(90);
    session = sessionMove(session, { x: -2.5, y: 4 });
    session = { ...session, rot: session.rot + 7.25 };
    const c2 = { x: pivot.x + session.dx, y: pivot.y + session.dy };
    const rotated = sessionRotate(session, c2, { x: c2.x + 10, y: c2.y }, { x: c2.x + 10, y: c2.y + 1 }, true);
    expect(rotated.rot % 15).toBe(0);
    expect(session).toEqual({ dx: 7.5, dy: 1, rot: 97.25 });
    const t = sessionTransform(session, pivot)!;
    // Vorschau verändert nichts; „Abbrechen“ = nichts übernehmen
    const project = s().project;
    alignPreview(s().project.groups[0]!, start, t);
    expect(s().project).toBe(project);
    const before = past();
    expect(movePageContent('B', t, { precise: true })).toBe(true);
    expect(past()).toBe(before + 1);
    // Vergleich: dieselben Schritte einzeln (Drehungen jeweils um die bewegte Mitte)
    let seq = transformPageContent(start, { dx: 10, dy: -3, rot: 0, pivot: { x: 0, y: 0 } }, { round: false });
    seq = transformPageContent(seq, { dx: 0, dy: 0, rot: 90, pivot: c1 }, { round: false });
    seq = transformPageContent(seq, { dx: -2.5, dy: 4, rot: 0, pivot: { x: 0, y: 0 } }, { round: false });
    seq = transformPageContent(seq, { dx: 0, dy: 0, rot: 7.25, pivot: c2 }, { round: false });
    // #27: in der Gesamtansicht (Lage), die Einzelansicht bleibt
    const got = mergedPage(s().project, s().project.groups[0]!);
    const gotB = got.stands.filter((x) => x.id === 'sB');
    for (const [i, o] of gotB.entries()) {
      expect(o.cx).toBeCloseTo(seq.stands[i]!.cx, 6);
      expect(o.cy).toBeCloseTo(seq.stands[i]!.cy, 6);
      expect(o.rot).toBeCloseTo(seq.stands[i]!.rot, 6);
    }
    expect(worldOf('aB').cx).toBeCloseTo(seq.areas[0]!.cx, 6);
    expect(pageById('B')).toBe(start);
    s().undo();
    expect(worldOf('sB')).toMatchObject({ cx: 30, cy: 5, rot: 0 });
    expect(past()).toBe(before);
    s().redo();
    expect(worldOf('sB').cx).toBeCloseTo(seq.stands[0]!.cx, 6);
  });

  it('manuelle Sitzung ohne Änderung: nichts zu übernehmen', () => {
    expect(sessionTransform(NO_SESSION, pagePivot(pageById('B')))).toBeNull();
    expect(sessionTransform(null, { x: 0, y: 0 })).toBeNull();
    const before = past();
    expect(movePageContent('B', { dx: 0, dy: 0, rot: 0, pivot: { x: 0, y: 0 } }, { precise: true })).toBe(false);
    expect(past()).toBe(before);
  });
});

describe('#15 Ausrichten: Genauigkeit und Speichern', () => {
  /** Starre Bewegung wie `applyTransform`, für die erwarteten Zielpunkte. */
  const truth = { dx: 37.21, dy: -12.807, rot: 3.7234, pivot: { x: 0, y: 0 } };

  it('Punkte in 200 m Abstand treffen beide Paare auf ≤ 0,005 m (Drehung nicht auf 0,1° gerundet)', () => {
    // Zwei Marker-Stände auf dem Ziegelturm, 200 m auseinander
    s().change('Marker', (p) => {
      p.pages[1]!.stands.push(stand('m1', 30, 5), stand('m2', 230, 5));
    });
    const a1 = { x: 30, y: 5 };
    const a2 = { x: 230, y: 5 };
    const b1 = applyTransform(truth, a1);
    const b2 = applyTransform(truth, a2);
    const r = fitRigid([
      { a: a1, b: b1 },
      { a: a2, b: b2 },
    ])!;
    expect(r.max).toBeLessThan(1e-9);
    const before = past();
    expect(movePageContent('B', r.t, { precise: true })).toBe(true);
    expect(past()).toBe(before + 1);
    const m = worldOf;
    expect(Math.hypot(m('m1').cx - b1.x, m('m1').cy - b1.y)).toBeLessThanOrEqual(0.005);
    expect(Math.hypot(m('m2').cx - b2.x, m('m2').cy - b2.y)).toBeLessThanOrEqual(0.005);
    expect(m('m1').rot).toBeCloseTo(3.7234, 6);
    // Zum Vergleich: mit der Rundung von „Ziehen“ (0,1°) läge der ferne Punkt deutlich daneben
    s().undo();
    movePageContent('B', r.t);
    expect(Math.hypot(m('m2').cx - b2.x, m('m2').cy - b2.y)).toBeGreaterThan(0.01);
  });

  it('bündige Stände bleiben nach der feinen Drehung ohne Warnung (Gesamtansicht und Einzelansicht)', () => {
    // 20 bündige Stände auf der Grundfläche des Ziegelturms (x 15–35 → hier eigene, längere Grundfläche)
    s().change('bündig', (p) => {
      const pg = p.pages[1]!;
      pg.areas = [area('aL', 60, -5, 90, 10)];
      pg.stands = Array.from({ length: 20 }, (_, i) => ({ ...stand(`b${i}`, 16.5 + 3 * i, -1.5) }));
    });
    const p0 = s().project;
    const count = (pg: FestplatzPage, p: Project) => countWarnings(cachedWarningData(pg.stands, pg.infra, pageEnv(p, pg), p).page, pg.stands, p.settings);
    expect(count(pageById('B'), p0)).toMatchObject({ outside: 0, overlap: 0 });
    for (const rot of [0.0137, 17.3456, 123.4567, 271.98765]) {
      expect(movePageContent('B', { dx: 12.3456, dy: -7.891, rot, pivot: { x: 60.123, y: -5 } }, { precise: true })).toBe(true);
      const p = s().project;
      // Gesamtansicht: Stände der Ziegelturm-Liste im System des Verbunds
      const m = mergedPage(p, p.groups[0]!);
      const own = { ...m, stands: m.stands.filter((x) => x.id.startsWith('b')) };
      expect(count(own, p), `${rot}°`).toMatchObject({ outside: 0, overlap: 0 });
      expect(count(pageById('B'), p), `${rot}° Einzelansicht`).toMatchObject({ outside: 0, overlap: 0 });
      s().undo();
    }
  });

  it('feine Drehung bleibt beim Speichern und Laden erhalten (Lage ungerundet, Inhalt unverändert)', () => {
    s().change('Hintergrund', (p) => {
      p.pages[1]!.background = {
        assetId: 'bg.png',
        fileName: 'plan.png',
        kind: 'image',
        pxSize: { w: 1000, h: 800 },
        transform: { x: 0, y: 0, rot: 0, metersPerPx: 0.1 },
        opacity: 1,
        locked: true,
      } as FestplatzPage['background'];
    });
    const b0 = pageById('B');
    expect(movePageContent('B', { dx: 1.2345, dy: 0, rot: 3.7234, pivot: { x: 25, y: 5 } }, { precise: true })).toBe(true);
    expect(pageById('B')).toBe(b0);
    const saved = projectForSave(s());
    const loaded = decodeProjectFile(encodeProjectFile({ project: saved, assets: { 'bg.png': new Uint8Array([1]) } })).project;
    expect(loaded.groups[0]!.placements).toEqual(saved.groups[0]!.placements);
    expect(loaded.groups[0]!.placements.B!.rot).toBe(3.7234);
    const after = loaded.pages.find((p) => p.id === 'B')!;
    expect(after.stands.map((x) => [x.cx, x.cy, x.rot])).toEqual(b0.stands.map((x) => [x.cx, x.cy, x.rot]));
    expect(after.background!.transform).toEqual(b0.background!.transform);
    expect(after.northAngle).toBe(0);
    // In der Gesamtansicht gedreht
    const bg = mergedPage(loaded, loaded.groups[0]!);
    expect(bg.stands.find((x) => x.id === 'sB')!.rot).toBeCloseTo(3.7234, 8);
  });
});

/**
 * #27: Ziegelturm (B) liegt im Verbund um 90° gedreht und verschoben: welt = R(90°) · lokal + (100, 0), d. h.
 * (x, y) ↦ (100 − y, x). Änderungen in der Gesamtansicht arbeiten in Weltkoordinaten und landen lokal korrekt.
 */
describe('#27 Gesamtansicht bei gedrehter Lage', () => {
  const P = { x: 100, y: 0, rot: 90 };
  const toW = (q: { x: number; y: number }) => ({ x: 100 - q.y, y: q.x });
  beforeEach(() => {
    s().change('Lage', (p) => {
      p.groups[0]!.placements.B = { ...P };
    });
  });
  const near = (o: { cx: number; cy: number; rot: number }, e: { cx: number; cy: number; rot: number }) => {
    expect(o.cx).toBeCloseTo(e.cx, 9);
    expect(o.cy).toBeCloseTo(e.cy, 9);
    expect(o.rot).toBeCloseTo(e.rot, 9);
  };

  it('Gesamtansicht zeigt den Platz gedreht, die Einzelansicht bleibt ungedreht', () => {
    const w = toW({ x: 30, y: 5 });
    near(worldOf('sB'), { cx: w.x, cy: w.y, rot: 90 });
    expect(pageById('B').stands[0]).toMatchObject({ cx: 30, cy: 5, rot: 0 });
    // Gleiche IDs, Besitz unverändert
    expect(worldOf('sB').id).toBe('sB');
  });

  it('Verschieben (Ziehen, Pfeiltasten) und Felder: Weltwerte, lokal zurückgerechnet und gerundet', () => {
    const w = worldOf('sB');
    // Ziehen in der Welt um (+2, 0) = lokal um (0, −2)
    commitRects(REF, { sB: { ...w, cx: w.cx + 2 } }, 'Verschieben');
    expect(pageById('B').stands[0]).toMatchObject({ cx: 30, cy: 3, rot: 0 });
    near(worldOf('sB'), { cx: w.cx + 2, cy: w.cy, rot: 90 });
    // Pfeiltaste nach unten (Welt +y) = lokal +x
    moveBy(REF, ['sB'], 0, 1, 'Verschieben');
    expect(pageById('B').stands[0]).toMatchObject({ cx: 31, cy: 3 });
    // Feld „Drehung“ zeigt und setzt die Weltdrehung: 120° in der Welt = 30° lokal
    setRectField(REF, ['sB'], 'rot', 120);
    expect(pageById('B').stands[0]!.rot).toBe(30);
    near(worldOf('sB'), { ...worldOf('sB'), rot: 120 });
    // Breite bleibt Breite
    setRectField(REF, ['sB'], 'w', 4);
    expect(pageById('B').stands[0]!.w).toBe(4);
    // Mehrfachauswahl über beide Plätze: Weltdrehung 0 gilt für beide (Müllerwiese ohne Lage)
    setRectField(REF, ['sA', 'sB'], 'rot', 0);
    expect(pageById('A').stands[0]!.rot).toBe(0);
    expect(pageById('B').stands[0]!.rot).toBe(270);
  });

  it('Drehen per Geste: Weltdrehung minus Drehung der Lage', () => {
    const w = worldOf('sB');
    commitRects(REF, { sB: { ...w, rot: 135 } }, 'Drehen');
    expect(pageById('B').stands[0]!.rot).toBe(45);
  });

  it('Beschriftung von Hand: Weltversatz, lokal zurückgedreht', () => {
    updateStands(REF, ['sB'], { labelOffset: { x: 0, y: 3 } }, 'Beschriftung verschieben');
    expect(pageById('B').stands[0]!.labelOffset).toEqual({ x: 3, y: 0 });
    const wl = (worldOf('sB') as Stand).labelOffset!;
    expect(wl.x).toBeCloseTo(0, 9);
    expect(wl.y).toBeCloseTo(3, 9);
  });

  it('Zeichnen: Zuordnung über die Grundfläche in der Welt, gespeichert lokal', () => {
    // Grundfläche des Ziegelturms lokal (15…35 | 0…10) liegt in der Welt bei x 90…100, y 15…35
    const id = addStand(REF, { cx: 95, cy: 25, w: 2, d: 2, rot: 0 });
    const own = pageById('B').stands.find((x) => x.id === id)!;
    expect(own).toMatchObject({ cx: 25, cy: 5, rot: 270 });
    near(worldOf(id), { cx: 95, cy: 25, rot: 0 });
    // Bei (5|5) liegt in der Welt nur die Müllerwiese
    const id2 = addStand(REF, { cx: 5, cy: 5, w: 2, d: 2, rot: 0 });
    expect(pageById('A').stands.some((x) => x.id === id2)).toBe(true);
  });

  it('Einfügen und Duplizieren: an der Weltposition, lokal gespeichert; Kopieren aus der Einzelansicht', () => {
    select(['sB']);
    duplicateSelection();
    const copy = s().ui.selection!.kind === 'objects' ? (s().ui.selection as { ids: string[] }).ids[0]! : '';
    const w = worldOf('sB');
    near(worldOf(copy), { cx: w.cx + 1, cy: w.cy + 1, rot: 90 });
    expect(pageById('B').stands.find((x) => x.id === copy)).toMatchObject({ cx: 31, cy: 4, rot: 0 });
    // Kopieren in der Einzelansicht des Ziegelturms, Einfügen in der Gesamtansicht: dieselbe Stelle der Gesamtansicht
    s().setUi({ activePage: 'B', selection: { kind: 'objects', ids: ['sB'] } });
    copySelection();
    s().setUi({ activePage: REF, selection: null });
    paste(null);
    const pasted = (s().ui.selection as { ids: string[] }).ids[0]!;
    near(worldOf(pasted), { cx: w.cx, cy: w.cy, rot: 90 });
    expect(pageById('B').stands.find((x) => x.id === pasted)).toMatchObject({ cx: 30, cy: 5, rot: 0 });
  });

  it('Umhängen A → B: lokal A → Welt → lokal B, die Weltposition bleibt', () => {
    const w = worldOf('sA');
    expect(reassignObjects(['sA'], 'B')).toBe(1);
    const moved = pageById('B').stands.find((x) => x.id === 'sA')!;
    // Welt (5|5) = lokal B (5, 95), Drehung −90°
    expect(moved.cx).toBeCloseTo(5, 9);
    expect(moved.cy).toBeCloseTo(95, 9);
    expect(moved.rot).toBe(270);
    near(worldOf('sA'), { cx: w.cx, cy: w.cy, rot: 0 });
    s().undo();
    expect(pageById('A').stands[0]).toMatchObject({ id: 'sA', cx: 5, cy: 5, rot: 0 });
  });

  it('Freifläche ausblenden in der Gesamtansicht: landet beim Besitzer und wirkt in dessen Einzelansicht (achsenbezogen)', () => {
    const p = s().project;
    const ctx = { minFreeWidth: p.settings.minFreeWidth, infraTypes: p.infraTypes, verbund: p };
    const overview = activePage()!;
    const fsW = pageFree(overview, ctx).find((x) => x.areaId === 'aB')!.free[0]!;
    const fsL = pageFree(pageById('B'), ctx).find((x) => x.areaId === 'aB')!.free[0]!;
    // dieselbe Freifläche in Welt und Einzelansicht: gleicher Schlüssel, gleiches Achsenintervall
    expect([fsW.key, fsW.start, fsW.end].map((v) => (typeof v === 'number' ? +v.toFixed(6) : v))).toEqual([fsL.key, fsL.start, fsL.end].map((v) => (typeof v === 'number' ? +v.toFixed(6) : v)));
    hideFreeSpace(REF, fsW);
    expect(pageById('B').hiddenFree.map((h) => h.key)).toEqual([fsW.key]);
    const after = pageFree(pageById('B'), { ...ctx, verbund: s().project }).find((x) => x.areaId === 'aB')!;
    expect(after.hidden.map((h) => h.key)).toEqual([fsW.key]);
  });

  it('Zusammenfassen über die Platzgrenze: Ergebnis im System des Besitzers', () => {
    // sB 3 × 3 m (Welt um sB), sA größer → der Stand bleibt auf der Müllerwiese
    s().change('groß', (p) => {
      p.pages[0]!.stands[0]!.w = 5;
    });
    const merged = mergeStandsOnPage(REF, ['sA', 'sB'])!;
    expect(pageById('A').stands.map((x) => x.id)).toEqual([merged]);
    expect(pageById('B').stands).toHaveLength(0);
    const w = worldOf(merged) as Stand;
    // Die Teile liegen in der Welt dort, wo die Ausgangsstände lagen: einer bei (5|5), einer bei der Weltlage von sB
    expect(w.parts).toHaveLength(2);
    expect(pageById('A').stands[0]!.rot).toBeCloseTo(w.rot, 9);
  });
});

/**
 * #27: Eigene Form in der Gesamtansicht bei einer feinen Lage-Drehung (wie nach „Ausrichten“, nicht auf 0,1°). Die
 * Weltdrehung eines Stands ist dann keine Zehntelzahl; wird sie in der Welt gerundet, landet der Stand nach dem
 * Zurückrechnen bis zu 0,1° gedreht. Ergebnis wie in der Einzelansicht.
 */
describe('#27 Eigene Form bei feiner Lage-Drehung', () => {
  const PARTS = [
    { kind: 'rect' as const, x: 0.37, y: 0.11, w: 3.13, h: 2.77, rot: 0 },
    { kind: 'rect' as const, x: 3.5, y: 0.11, w: 2.05, h: 1.9, rot: 0 },
  ];
  /** Lage des Ziegelturms und ein gedrehter Stand mit eigener Form; liefert eine Momentaufnahme zum Vergleich. */
  function setup(rot: number) {
    s().change('Lage', (p) => {
      p.groups[0]!.placements.B = { x: 12.345, y: -6.789, rot };
      p.pages[1]!.stands.push({ ...createStand({ cx: 30.37, cy: 4.21, w: 6, d: 3, rot: 12.3 }), id: 'c', parts: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1, rot: 0 }] });
    });
    return structuredClone(s().project);
  }
  const reload = (project: Project) => s().loadBundle({ project, assets: {} }, { path: null, name: null });
  const standC = () => pageById('B').stands.find((x) => x.id === 'c')!;
  const ROTS = [3.7234, 123.456, 271.25, 359.987];

  it('Teile ändern (Seitenleiste): in der Gesamtansicht wie in der Einzelansicht, die Drehung bleibt', () => {
    for (const rot of ROTS) {
      const snap = setup(rot);
      const before = past();
      expect(setStandParts(REF, 'c', PARTS)).toBe(true);
      expect(past()).toBe(before + 1);
      const overview = standC();
      expect(overview.rot, `${rot}°`).toBe(12.3);
      reload(snap);
      setStandParts('B', 'c', PARTS);
      expect(overview, `${rot}°`).toEqual(standC());
      load();
    }
  });

  it('Teile ändern per Geste (Hüllrechteck in der Welt eingepasst): die Drehung bleibt', () => {
    for (const rot of ROTS) {
      setup(rot);
      const fit = refitStand(worldOf('c'), PARTS)!;
      commitStandParts(REF, 'c', fit.rect, fit.parts, 'Teil verschieben');
      expect(standC().rot, `${rot}°`).toBe(12.3);
      // Die Teile bleiben in der Welt an ihrem Platz (bis auf die Rundung auf 0,01 m)
      const w = worldOf('c');
      expect(Math.hypot(w.cx - fit.rect.cx, w.cy - fit.rect.cy)).toBeLessThanOrEqual(0.0075);
      load();
    }
  });

  it('Form auflösen: in der Gesamtansicht wie in der Einzelansicht', () => {
    for (const rot of ROTS) {
      setup(rot);
      setStandParts('B', 'c', PARTS);
      const snap = structuredClone(s().project);
      const pieces = dissolveStandOnPage(REF, 'c');
      expect(pieces).toHaveLength(2);
      const overview = pageById('B').stands.map((x) => [x.cx, x.cy, x.w, x.d, x.rot, x.shape]);
      reload(snap);
      dissolveStandOnPage('B', 'c');
      expect(overview, `${rot}°`).toEqual(pageById('B').stands.map((x) => [x.cx, x.cy, x.w, x.d, x.rot, x.shape]));
      load();
    }
  });

  it('Zusammenfassen: gespeichert wie jedes Übernehmen (0,01 m / 0,1° in den Koordinaten des Besitzers), Drehung des Ausgangsstands', () => {
    for (const rot of ROTS) {
      setup(rot);
      const id = mergeStandsOnPage(REF, ['c', 'sB'])!;
      const m = pageById('B').stands.find((x) => x.id === id)!;
      expect(m.rot, `${rot}°`).toBe(12.3);
      expect(Math.round(m.cx * 100) / 100).toBe(m.cx);
      expect(Math.round(m.cy * 100) / 100).toBe(m.cy);
      load();
    }
  });
});

describe('#15 Gesamtansicht: Form, Tab-Wechsel', () => {
  it('Form auflösen: alle Teile bleiben auf dem Platz des Stands, ein Schritt', () => {
    // Zwei Teile in Metern ab der linken oberen Ecke des 3 × 3 m großen Stands
    expect(
      setStandParts(REF, 'sB', [
        { kind: 'rect', x: 0, y: 0, w: 1, h: 3, rot: 0 },
        { kind: 'rect', x: 2, y: 0, w: 1, h: 3, rot: 0 },
      ]),
    ).toBe(true);
    const before = past();
    const pieces = dissolveStandOnPage(REF, 'sB');
    expect(pieces).toHaveLength(2);
    expect(past()).toBe(before + 1);
    expect(pageById('B').stands.map((x) => x.id)).toEqual(pieces);
    expect(pageById('A').stands.map((x) => x.id)).toEqual(['sA']);
  });

  it('Tab-Wechsel zwischen Gesamt- und Einzelansicht hebt die Auswahl auf; Ctrl+Tab hält an der Gesamtansicht', () => {
    select(['sA', 'sB']);
    s().setUi({ activePage: 'A' });
    expect(s().ui.selection).toBeNull();
    s().setUi({ activePage: REF });
    select(['sB']);
    cyclePage(1);
    expect(s().ui.activePage).toBe('A');
    expect(s().ui.selection).toBeNull();
    cyclePage(-1);
    expect(s().ui.activePage).toBe(REF);
    cyclePage(-1);
    expect(s().ui.activePage).toBe('start');
  });
});

describe('#15 Sperren in der Gesamtansicht', () => {
  it('Nummerierung, Hintergrund, Kalibrieren und Page-Befehle gesperrt; Ausrichten nur hier; Schriftfeld und Legende frei (Teil c)', async () => {
    const { COMMANDS, runCommand } = await import('../app/commands');
    const enabled = (id: string) => COMMANDS[id]!.enabled?.() !== false;
    const locked = ['numbering.renumber', 'numbering.lockAll', 'numbering.unlockAll', 'file.importBackground', 'tool.calibrate', 'view.grid', 'page.duplicate', 'page.delete'];
    s().change('Nr', (p) => {
      p.pages[0]!.stands[0]!.nr = '1';
      p.pages[1]!.stands[0]!.nrLocked = true;
    });
    expect(locked.filter(enabled)).toEqual([]);
    expect(enabled('tool.align')).toBe(true);
    for (const id of ['tool.select', 'tool.stand', 'tool.area', 'tool.infra', 'edit.selectAll', 'page.rename', 'tool.titleBlock', 'view.legend']) expect(enabled(id)).toBe(true);
    expect(runCommand('numbering.renumber')).toBe(false);
    expect(COMMANDS['numbering.renumber']!.disabledMessage).toContain('Gesamtansicht');
    // In der Einzelansicht: Ausrichten gesperrt, Fixierungen und Page-Befehle wieder möglich
    s().setUi({ activePage: 'A' });
    expect(enabled('tool.align')).toBe(false);
    expect(enabled('numbering.lockAll')).toBe(true);
    expect(enabled('page.delete')).toBe(true);
  });

  it('Die Gesamtansicht gilt nur, solange der Verbund Mitglieder hat', () => {
    expect(s().ui.activePage).toBe(REF);
    s().change('leer', (p) => void (p.groups[0]!.pageIds = []));
    expect(s().ui.activePage).toBe('A');
    s().undo();
    s().setUi({ activePage: REF });
    expect(s().ui.activePage).toBe(REF);
  });
});
