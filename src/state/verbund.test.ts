import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../core/model/defaults';
import { createStand } from '../core/objects';
import { addPage, deletePage } from './pages';
import { useStore } from './store';
import { addMember, addVerbund, deleteVerbund, moveMember, movePageContent, nextVerbundName, removeMember, renameVerbund } from './verbund';

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
    deletePage(b);
    expect(groups()).toEqual([['Unterstadt', [a]]]);
    st().undo();
    expect(groups()).toEqual([['Unterstadt', [a, b]]]);
  });

  it('Lage ändern: ganze Page verschoben und gedreht, ein Undo-Schritt, Ansicht folgt', () => {
    const a = st().project.pages[0]!.id;
    st().change('Stand', (p) => {
      p.pages[0]!.stands.push({ ...createStand({ cx: 10, cy: 5, w: 3, d: 3, rot: 0 }), id: 's' });
    });
    st().setView(a, { scale: 10, tx: 0, ty: 0 });
    const before = st().history.past.length;
    expect(movePageContent(a, { dx: 5.004, dy: -2, rot: 90.04, pivot: { x: 0, y: 0 } })).toBe(true);
    expect(st().history.past.length).toBe(before + 1);
    expect(st().project.pages[0]!.stands[0]).toMatchObject({ cx: 0, cy: 8, rot: 90 });
    expect(st().views[a]).toEqual({ scale: 10, tx: -50, ty: 20 });
    // Nichts zu tun: kein Undo-Schritt
    expect(movePageContent(a, { dx: 0.001, dy: 0, rot: 0, pivot: { x: 0, y: 0 } })).toBe(false);
    st().undo();
    expect(st().project.pages[0]!.stands[0]).toMatchObject({ cx: 10, cy: 5, rot: 0 });
    // Undo und Redo führen die Ansicht mit dem Inhalt mit (sonst erschiene er danach versetzt)
    expect(st().views[a]).toEqual({ scale: 10, tx: 0, ty: 0 });
    st().redo();
    expect(st().views[a]).toEqual({ scale: 10, tx: -50, ty: 20 });
    // Nach Verschieben der Ansicht von Hand gilt bei Undo die Ansicht vor dem Anwenden
    st().setView(a, { scale: 20, tx: 7, ty: 8 });
    st().undo();
    expect(st().views[a]).toEqual({ scale: 10, tx: 0, ty: 0 });
  });

  it('Lage ändern ohne gespeicherte Ansicht: keine Ansicht, Undo ohne Ansicht', () => {
    const a = st().project.pages[0]!.id;
    expect(st().views[a]).toBeUndefined();
    st().change('Stand', (p) => {
      p.pages[0]!.stands.push({ ...createStand({ cx: 10, cy: 5, w: 3, d: 3, rot: 0 }), id: 's' });
    });
    expect(movePageContent(a, { dx: 5, dy: 0, rot: 0, pivot: { x: 0, y: 0 } })).toBe(true);
    st().undo();
    expect(st().views[a]).toBeUndefined();
    expect(st().project.pages[0]!.stands[0]!.cx).toBe(10);
  });
});
