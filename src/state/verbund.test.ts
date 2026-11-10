import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../core/model/defaults';
import { createStand } from '../core/objects';
import { addPage, deletePage } from './pages';
import { useStore } from './store';
import { applyPlacement } from '../core/placement';
import { mergedPage, pagePivot, placementOf } from '../core/verbund';
import { addMember, addVerbund, deleteVerbund, moveMember, movePageContent, nextVerbundName, removeMember, renameVerbund, resetPlacement, rotatePageView, setPlacement, setPlacementRotation } from './verbund';

const st = () => useStore.getState();
const groups = () => st().project.groups.map((g) => [g.name, g.pageIds]);

beforeEach(() => {
  st().loadBundle({ project: createProject('T'), assets: {} }, { path: null, name: null });
});

describe('#15 Verbünde verwalten (je ein Undo-Schritt)', () => {
  it('anlegen, umbenennen, Mitglieder, Reihenfolge, löschen; alles rückgängig machbar', () => {
    const a = st().project.pages[0]!.id;
    const b = addPage();
    const c = addPage();
    const g = addVerbund();
    expect(groups()).toEqual([['Verbund', []]]);
    expect(nextVerbundName(st().project)).toBe('Verbund 2');
    expect(renameVerbund(g, '  Unterstadt ')).toBe(true);
    expect(renameVerbund(g, '   ')).toBe(false);
    addMember(g, a);
    addMember(g, b);
    addMember(g, b);
    addMember(g, 'gibt-es-nicht');
    moveMember(g, b, -1);
    expect(groups()).toEqual([['Unterstadt', [b, a]]]);
    // Eine Page gehört zu höchstens einem Verbund: Aufnehmen in einen anderen nimmt sie dort heraus
    const h = addVerbund('Oberstadt', [c, a]);
    expect(groups()).toEqual([
      ['Unterstadt', [b]],
      ['Oberstadt', [c, a]],
    ]);
    removeMember(h, c);
    deleteVerbund(g);
    expect(groups()).toEqual([['Oberstadt', [a]]]);
    // Lagen nur für Mitglieder (#27): Aufnehmen = Identität, Herausnehmen verwirft sie
    expect(st().project.groups[0]!.placements).toEqual({ [a]: { x: 0, y: 0, rot: 0 } });
    const steps = st().history.past.length;
    // Schritte: 2 Pages, Verbund, Umbenennen, 2 × Aufnehmen, Reihenfolge, Verbund, Herausnehmen, Löschen
    expect(steps).toBe(10);
    for (let i = 0; i < 7; i++) st().undo();
    expect(groups()).toEqual([['Verbund', []]]);
  });

  it('Löschen einer Page nimmt sie aus ihrem Verbund, Undo stellt beides wieder her', () => {
    const a = st().project.pages[0]!.id;
    const b = addPage();
    addVerbund('Unterstadt', [a, b]);
    setPlacement(b, { x: 3 });
    deletePage(b);
    expect(groups()).toEqual([['Unterstadt', [a]]]);
    expect(st().project.groups[0]!.placements).toEqual({ [a]: { x: 0, y: 0, rot: 0 } });
    st().undo();
    expect(groups()).toEqual([['Unterstadt', [a, b]]]);
    expect(st().project.groups[0]!.placements[b]).toEqual({ x: 3, y: 0, rot: 0 });
  });

  /** Page mit einem Stand und einer Beschriftung von Hand, im Verbund mit einer zweiten Page. */
  function setup() {
    const a = st().project.pages[0]!.id;
    const b = addPage();
    st().change('Stand', (p) => {
      p.pages[0]!.stands.push({ ...createStand({ cx: 10, cy: 5, w: 3, d: 3, rot: 0 }), id: 's', labelOffset: { x: 2, y: 0 } });
    });
    const g = addVerbund('Unterstadt', [a, b]);
    return { a, b, g };
  }
  const placement = (id: string) => placementOf(st().project.groups[0], id);
  const expectNear = (r: { cx: number; cy: number; rot: number }, e: { cx: number; cy: number; rot: number }) => {
    expect(r.cx).toBeCloseTo(e.cx, 9);
    expect(r.cy).toBeCloseTo(e.cy, 9);
    expect(r.rot).toBeCloseTo(e.rot, 9);
  };
  const worldStand = () => mergedPage(st().project, st().project.groups[0]!).stands.find((x) => x.id === 's')!;

  it('Lage ändern (#27): nur die Lage ändert sich, der Inhalt der Page bleibt gleich; ein Undo-Schritt, Ansicht bleibt', () => {
    const { a } = setup();
    st().setView(a, { scale: 10, tx: 0, ty: 0 });
    const page0 = st().project.pages[0]!;
    const json0 = JSON.stringify(page0);
    const before = st().history.past.length;
    expect(movePageContent(a, { dx: 5.004, dy: -2, rot: 90.04, pivot: { x: 0, y: 0 } })).toBe(true);
    expect(st().history.past.length).toBe(before + 1);
    // Inhalt unverändert (dieselbe Page, byte-gleich), Lage = Drehung 90° um den Ursprung, dann (5, −2)
    expect(st().project.pages[0]).toBe(page0);
    expect(JSON.stringify(st().project.pages[0])).toBe(json0);
    expect(placement(a)).toEqual({ x: 5, y: -2, rot: 90 });
    // In der Gesamtansicht liegt der Stand gedreht an seiner neuen Stelle, die Beschriftung mitgedreht
    expectNear(worldStand(), { cx: 0, cy: 8, rot: 90 });
    expect(worldStand().labelOffset!.x).toBeCloseTo(0, 9);
    expect(worldStand().labelOffset!.y).toBeCloseTo(2, 9);
    // Die Einzelansicht ändert sich nicht, ihre Ansicht auch nicht
    expect(st().views[a]).toEqual({ scale: 10, tx: 0, ty: 0 });
    // Ein zweiter Schritt komponiert: um den Weltpunkt (0, 8) um 90° drehen
    expect(movePageContent(a, { dx: 0, dy: 0, rot: 90, pivot: { x: 0, y: 8 } })).toBe(true);
    expectNear(worldStand(), { cx: 0, cy: 8, rot: 180 });
    // Nichts zu tun: kein Undo-Schritt
    expect(movePageContent(a, { dx: 0.001, dy: 0, rot: 0, pivot: { x: 0, y: 0 } })).toBe(false);
    st().undo();
    st().undo();
    expect(placement(a)).toEqual({ x: 0, y: 0, rot: 0 });
    expect(worldStand()).toBe(st().project.pages[0]!.stands[0]);
    st().redo();
    expect(placement(a)).toEqual({ x: 5, y: -2, rot: 90 });
    expect(JSON.stringify(st().project.pages[0])).toBe(json0);
    expect(st().views[a]).toEqual({ scale: 10, tx: 0, ty: 0 });
  });

  it('Lage ändern ohne Verbund: nichts zu tun; „precise“ rundet nicht', () => {
    const a = st().project.pages[0]!.id;
    expect(movePageContent(a, { dx: 5, dy: 0, rot: 0, pivot: { x: 0, y: 0 } })).toBe(false);
    setup();
    expect(movePageContent(a, { dx: 0.123456, dy: 0, rot: 0.123456, pivot: { x: 0, y: 0 } }, { precise: true })).toBe(true);
    expect(placement(a).x).toBeCloseTo(0.123456, 8);
    expect(placement(a).rot).toBe(0.123456);
  });

  it('Lage direkt setzen (Projekteinstellungen): X/Y, Drehung um die Mitte, Zurücksetzen; je ein Undo-Schritt', () => {
    const { a } = setup();
    const before = st().history.past.length;
    expect(setPlacement(a, { x: 12.5 })).toBe(true);
    expect(setPlacement(a, { y: -7.25 })).toBe(true);
    expect(setPlacement(a, { y: -7.25 })).toBe(false);
    expect(placement(a)).toEqual({ x: 12.5, y: -7.25, rot: 0 });
    // Drehung um die Mitte des Platzes in der Gesamtansicht: die Mitte bleibt, wo sie ist
    const c = { x: 22.5, y: -2.25 };
    expect(setPlacementRotation(a, 30, c)).toBe(true);
    expect(placement(a).rot).toBe(30);
    expect(worldStand().cx).toBeCloseTo(22.5, 8);
    expect(worldStand().cy).toBeCloseTo(-2.25, 8);
    expect(worldStand().rot).toBe(30);
    expect(resetPlacement(a)).toBe(true);
    expect(placement(a)).toEqual({ x: 0, y: 0, rot: 0 });
    expect(st().history.past.length).toBe(before + 4);
    st().undo();
    expect(placement(a).rot).toBe(30);
  });

  it('„Platz in der Einzelansicht drehen“: Inhalt dreht lokal, die Lage gleicht aus, Weltpositionen bleiben; Ansicht folgt, ein Undo-Schritt', () => {
    const { a } = setup();
    st().change('Grundfläche', (p) => {
      p.pages[0]!.areas.push({ id: 'ar', name: '', cx: 10, cy: 8, w: 20, d: 4, rot: 0 });
    });
    expect(movePageContent(a, { dx: 3, dy: 4, rot: 12.5, pivot: { x: 1, y: 2 } }, { precise: true })).toBe(true);
    const world0 = worldStand();
    const area0 = mergedPage(st().project, st().project.groups[0]!).areas[0]!;
    st().setView(a, { scale: 10, tx: 0, ty: 0 });
    const pivot = pagePivot(st().project.pages[0]!);
    const before = st().history.past.length;
    expect(rotatePageView(a, -12.5)).toBe(true);
    expect(st().history.past.length).toBe(before + 1);
    // lokal gedreht (um die Mitte des Platzes): wieder gerade
    const local = st().project.pages[0]!.stands[0]!;
    expect(local.rot).toBe(347.5);
    expect(placement(a).rot).toBe(25);
    // In der Gesamtansicht unverändert (bis auf Gleitkomma-Reste)
    const w = worldStand();
    expect(w.cx).toBeCloseTo(world0.cx, 6);
    expect(w.cy).toBeCloseTo(world0.cy, 6);
    expect(w.rot).toBeCloseTo(world0.rot, 6);
    expect(w.labelOffset!.x).toBeCloseTo(world0.labelOffset!.x, 6);
    expect(w.labelOffset!.y).toBeCloseTo(world0.labelOffset!.y, 6);
    const area = mergedPage(st().project, st().project.groups[0]!).areas[0]!;
    expect(area.cx).toBeCloseTo(area0.cx, 6);
    expect(area.cy).toBeCloseTo(area0.cy, 6);
    // Die Ansicht folgt: die Mitte des Platzes bleibt an ihrer Bildschirmstelle
    const v = st().views[a]!;
    const screen = (q: { x: number; y: number }) => ({ x: q.x * v.scale + v.tx, y: q.y * v.scale + v.ty });
    expect(screen(pivot)).toEqual({ x: pivot.x * 10, y: pivot.y * 10 });
    // Undo stellt Inhalt, Lage und Ansicht zurück
    st().undo();
    expect(st().project.pages[0]!.stands[0]!.rot).toBe(0);
    expect(placement(a).rot).toBe(12.5);
    expect(st().views[a]).toEqual({ scale: 10, tx: 0, ty: 0 });
    // Ein Punkt der Welt: Lage · lokal
    const p = applyPlacement(placement(a), { x: 10, y: 5 });
    expect(p.x).toBeCloseTo(world0.cx, 9);
    // Ohne Drehung kein Undo-Schritt
    expect(rotatePageView(a, 0)).toBe(false);
  });
});
