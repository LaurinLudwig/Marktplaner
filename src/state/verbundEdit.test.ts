import { beforeEach, describe, expect, it } from 'vitest';
import { createPage, createProject, createVerbund } from '../core/model/defaults';
import type { Area, FestplatzPage, Project, Stand } from '../core/model/types';
import { createArea, createStand } from '../core/objects';
import { applyTransform, pageEnv, verbundRef } from '../core/verbund';
import { decodeProjectFile, encodeProjectFile } from '../core/fileFormat';
import { cachedWarningData, countWarnings } from '../core/warnings';
import { twoPointTransform } from '../core/verbundView';
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
import { dissolveStandOnPage, mergeStandsOnPage, setStandParts } from './shapes';
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

  it('keine Grundfläche auf eine Page ohne Grundflächen (#17)', () => {
    s().change('ohne', (p) => void (p.pages[1]!.useAreas = false));
    expect(reassignObjects(['aA'], 'B')).toBe(0);
    expect(pageById('A').areas.map((a) => a.id)).toEqual(['aA']);
  });
});

describe('#15 Ausrichten', () => {
  it('Ziehen = Verschiebung der ganzen Page, ein Undo-Schritt', () => {
    const before = past();
    expect(movePageContent('B', { dx: 2.004, dy: -1, rot: 0, pivot: { x: 0, y: 0 } })).toBe(true);
    expect(past()).toBe(before + 1);
    expect(pageById('B').stands[0]).toMatchObject({ cx: 32, cy: 4 });
    expect(pageById('B').areas[0]).toMatchObject({ cx: 27, cy: 4 });
    expect(pageById('A').stands[0]!.cx).toBe(5);
    s().undo();
    expect(pageById('B').stands[0]).toMatchObject({ cx: 30, cy: 5 });
  });

  it('2-Punkt-Ausrichtung: Ecken des Ziegelturms auf die passenden Punkte, Drehung und Verschiebung', () => {
    // Ziegelturm ist um 90° gedreht und verschoben: seine Grundflächen-Ecken (15|0) und (35|0) sollen auf (40|20) und (40|40)
    const a1 = { x: 15, y: 0 };
    const a2 = { x: 35, y: 0 };
    const b1 = { x: 40, y: 20 };
    const b2 = { x: 40, y: 40 };
    const r = twoPointTransform(a1, a2, b1, b2)!;
    expect(r.rot).toBeCloseTo(90, 6);
    expect(movePageContent('B', r.t)).toBe(true);
    const ar = pageById('B').areas[0]!;
    // Mitte der Grundfläche (25|5) liegt nach der Bewegung bei (35|30), Drehung 90°
    const expected = applyTransform({ ...r.t, rot: 90 }, { x: 25, y: 5 });
    expect(ar.cx).toBeCloseTo(expected.x, 1);
    expect(ar.cy).toBeCloseTo(expected.y, 1);
    expect(ar.rot).toBe(90);
  });
});

describe('#15 Ausrichten: Genauigkeit und Speichern', () => {
  /** Starre Bewegung wie `applyTransform`, für die erwarteten Zielpunkte. */
  const truth = { dx: 37.21, dy: -12.807, rot: 3.7234, pivot: { x: 0, y: 0 } };

  it('2-Punkt-Ausrichtung mit Punkten in 200 m Abstand trifft beide Paare auf ≤ 0,005 m (Drehung nicht auf 0,1° gerundet)', () => {
    // Zwei Marker-Stände auf dem Ziegelturm, 200 m auseinander
    s().change('Marker', (p) => {
      p.pages[1]!.stands.push(stand('m1', 30, 5), stand('m2', 230, 5));
    });
    const a1 = { x: 30, y: 5 };
    const a2 = { x: 230, y: 5 };
    const b1 = applyTransform(truth, a1);
    const b2 = applyTransform(truth, a2);
    const r = twoPointTransform(a1, a2, b1, b2)!;
    expect(r.deviation).toBeLessThan(1e-9);
    const before = past();
    expect(movePageContent('B', r.t, { precise: true })).toBe(true);
    expect(past()).toBe(before + 1);
    const m = (id: string) => pageById('B').stands.find((x) => x.id === id)!;
    expect(Math.hypot(m('m1').cx - b1.x, m('m1').cy - b1.y)).toBeLessThanOrEqual(0.005);
    expect(Math.hypot(m('m2').cx - b2.x, m('m2').cy - b2.y)).toBeLessThanOrEqual(0.005);
    expect(m('m1').rot).toBeCloseTo(3.7234, 6);
    // Zum Vergleich: mit der Rundung von „Lage“ (0,1°) läge der ferne Punkt deutlich daneben
    s().undo();
    movePageContent('B', r.t);
    expect(Math.hypot(m('m2').cx - b2.x, m('m2').cy - b2.y)).toBeGreaterThan(0.01);
  });

  it('bündige Stände bleiben nach der feinen Drehung ohne Warnung', () => {
    // 20 bündige Stände auf der Grundfläche des Ziegelturms (x 15–35 → hier eigene, längere Grundfläche)
    s().change('bündig', (p) => {
      const pg = p.pages[1]!;
      pg.areas = [area('aL', 60, -5, 90, 10)];
      pg.stands = Array.from({ length: 20 }, (_, i) => ({ ...stand(`b${i}`, 16.5 + 3 * i, -1.5) }));
    });
    const p0 = s().project;
    const count = (pg: FestplatzPage) => countWarnings(cachedWarningData(pg.stands, pg.infra, pageEnv(p0, pg), p0).page, pg.stands, p0.settings);
    expect(count(pageById('B'))).toMatchObject({ outside: 0, overlap: 0 });
    for (const rot of [0.0137, 17.3456, 123.4567, 271.98765]) {
      expect(movePageContent('B', { dx: 12.3456, dy: -7.891, rot, pivot: { x: 60.123, y: -5 } }, { precise: true })).toBe(true);
      const p = s().project;
      const pg = pageById('B');
      const w = cachedWarningData(pg.stands, pg.infra, pageEnv(p, pg), p);
      expect(countWarnings(w.page, pg.stands, p.settings), `${rot}°`).toMatchObject({ outside: 0, overlap: 0 });
      s().undo();
    }
  });

  it('feine Drehung bleibt beim Speichern und Laden erhalten (Objekte, Hintergrund, Nordrichtung)', () => {
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
    expect(movePageContent('B', { dx: 1.2345, dy: 0, rot: 3.7234, pivot: { x: 25, y: 5 } }, { precise: true })).toBe(true);
    const saved = projectForSave(s());
    const loaded = decodeProjectFile(encodeProjectFile({ project: saved, assets: { 'bg.png': new Uint8Array([1]) } })).project;
    const before = saved.pages.find((p) => p.id === 'B')!;
    const after = loaded.pages.find((p) => p.id === 'B')!;
    expect(after.stands.map((x) => [x.cx, x.cy, x.rot])).toEqual(before.stands.map((x) => [x.cx, x.cy, x.rot]));
    expect(after.areas.map((x) => [x.cx, x.cy, x.rot])).toEqual(before.areas.map((x) => [x.cx, x.cy, x.rot]));
    expect(after.stands[0]!.rot).toBe(3.7234);
    expect(after.northAngle).toBe(before.northAngle);
    expect(after.northAngle).toBeCloseTo(3.7234, 8);
    expect(after.background!.transform).toEqual(before.background!.transform);
    expect(after.background!.transform.rot).toBeCloseTo(3.7234, 8);
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
  it('Nummerierung, Hintergrund, Kalibrieren, Schriftfeld und Page-Befehle gesperrt; Ausrichten nur hier', async () => {
    const { COMMANDS, runCommand } = await import('../app/commands');
    const enabled = (id: string) => COMMANDS[id]!.enabled?.() !== false;
    const locked = ['numbering.renumber', 'numbering.lockAll', 'numbering.unlockAll', 'file.importBackground', 'tool.calibrate', 'tool.titleBlock', 'view.legend', 'view.grid', 'page.duplicate', 'page.delete'];
    s().change('Nr', (p) => {
      p.pages[0]!.stands[0]!.nr = '1';
      p.pages[1]!.stands[0]!.nrLocked = true;
    });
    expect(locked.filter(enabled)).toEqual([]);
    expect(enabled('tool.align')).toBe(true);
    for (const id of ['tool.select', 'tool.stand', 'tool.area', 'tool.infra', 'edit.selectAll', 'page.rename']) expect(enabled(id)).toBe(true);
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
