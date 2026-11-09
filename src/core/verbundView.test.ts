import { describe, expect, it } from 'vitest';
import { createPage, createProject, createVerbund } from './model/defaults';
import type { Area, FestplatzPage, Project, Stand, Vec } from './model/types';
import { createArea, createStand } from './objects';
import { applyTransform, mergedPage, verbundRef } from './verbund';
import { assignObjects, copyFallback, fallbackPage, hasOverview, isVerbundRef, ownerPages, pageView, tabOrder, twoPointTransform, verbundOfRef } from './verbundView';

const area = (id: string, cx: number, cy: number, w: number, d: number): Area => ({ ...createArea({ cx, cy, w, d, rot: 0 }), id });
const stand = (id: string, cx: number, cy: number, w = 3, d = 3): Stand => ({ ...createStand({ cx, cy, w, d, rot: 0 }), id });

/** Zwei Plätze, deren Grundflächen sich bei x = 15…20 überschneiden, dazu ein dritter Platz ohne Verbund. */
function setup() {
  const base = createProject('T');
  const a: FestplatzPage = { ...createPage('Müllerwiese'), id: 'A', areas: [area('aA', 10, 5, 20, 10)], stands: [stand('sA', 5, 5)] };
  const b: FestplatzPage = { ...createPage('Ziegelturm'), id: 'B', areas: [area('aB', 25, 5, 20, 10)], stands: [stand('sB', 30, 5)] };
  const c: FestplatzPage = { ...createPage('Escher'), id: 'C' };
  const g = { ...createVerbund('Unterstadt', ['A', 'B']), id: 'g' };
  const project: Project = { ...base, pages: [c, a, b], groups: [g] };
  return { project, g, a, b, c };
}

describe('#15 Gesamtansicht: Seitenreferenz und Sicht', () => {
  it('verbund:<id> löst den Verbund auf; die Sicht hat keinen Hintergrund und kein Blatt, Identität bleibt', () => {
    const { project, g } = setup();
    const ref = verbundRef('g');
    expect(isVerbundRef(ref)).toBe(true);
    expect(isVerbundRef('A')).toBe(false);
    expect(verbundOfRef(project, ref)).toBe(g);
    expect(verbundOfRef(project, 'verbund:x')).toBeNull();
    const v = pageView(project, ref)!;
    expect(v.id).toBe(ref);
    expect(v.stands.map((s) => s.id)).toEqual(['sA', 'sB']);
    expect(v.background).toBeNull();
    expect(v.layers.sheet).toEqual({ visible: false, locked: true });
    // Objekte sind dieselben wie in den Mitgliedern
    expect(v.stands[0]).toBe(project.pages[1]!.stands[0]);
    expect(pageView(project, ref)).toBe(v);
    expect(pageView(project, 'A')).toBe(project.pages[1]);
  });

  it('Verbund ohne Mitglieder hat keine Gesamtansicht', () => {
    const { project } = setup();
    const empty = { ...createVerbund('Leer'), id: 'e' };
    const p = { ...project, groups: [...project.groups, empty] };
    expect(hasOverview(p, empty)).toBe(false);
    expect(pageView(p, verbundRef('e'))).toBeNull();
  });

  it('ownerPages: Page selbst bzw. alle Mitglieder in der Reihenfolge des Verbunds', () => {
    const { project } = setup();
    expect(ownerPages(project, 'C').map((p) => p.id)).toEqual(['C']);
    expect(ownerPages(project, verbundRef('g')).map((p) => p.id)).toEqual(['A', 'B']);
    expect(ownerPages(project, 'gibt-es-nicht')).toEqual([]);
  });

  it('Tab „Unterstadt (gesamt)“ steht vor dem ersten Mitglied', () => {
    const { project } = setup();
    expect(tabOrder(project).map((t) => (t.kind === 'page' ? t.page.id : t.ref))).toEqual(['C', 'verbund:g', 'A', 'B']);
  });
});

describe('#15 Zuordnung neuer Objekte', () => {
  it('eine Grundfläche → deren Platz; mehrere oder keine → Ersatz-Platz', () => {
    const { project, g } = setup();
    const objs = { areas: [], stands: [stand('n1', 5, 5), stand('n2', 17.5, 5), stand('n3', 30, 5), stand('n4', 100, 100)], infra: [] };
    const toB = assignObjects(project, g, objs, () => 'B');
    expect(Object.fromEntries(toB)).toEqual({ n1: 'A', n2: 'B', n3: 'B', n4: 'B' });
    const toA = assignObjects(project, g, objs, () => 'A');
    expect(Object.fromEntries(toA)).toEqual({ n1: 'A', n2: 'A', n3: 'B', n4: 'A' });
  });

  it('Ersatz-Platz: Auswahl, solange Mitglied, sonst das erste Mitglied', () => {
    const { project, g } = setup();
    expect(fallbackPage(project, g, 'B')).toBe('B');
    expect(fallbackPage(project, g, 'C')).toBe('A');
    expect(fallbackPage(project, g, undefined)).toBe('A');
  });

  it('Kopien: ohne eindeutige Grundfläche der Platz des Originals', () => {
    const { project, g } = setup();
    const fb = copyFallback(project, { k: 'sB' }, 'A');
    const out = assignObjects(project, g, { areas: [], stands: [stand('k', 17.5, 5), stand('x', 17.5, 5)], infra: [] }, fb);
    expect(out.get('k')).toBe('B');
    expect(out.get('x')).toBe('A');
  });

  it('Grundflächen nur auf Plätze mit Grundflächen (#17)', () => {
    const { project, g } = setup();
    const p = { ...project, pages: project.pages.map((x) => (x.id === 'A' ? { ...x, useAreas: false } : x)) };
    const out = assignObjects(p, g, { areas: [area('nA', 100, 100, 5, 5)], stands: [], infra: [] }, () => 'A');
    expect(out.get('nA')).toBe('B');
  });
});

describe('#15 2-Punkt-Ausrichtung', () => {
  const close = (p: Vec, q: Vec) => {
    expect(p.x).toBeCloseTo(q.x, 9);
    expect(p.y).toBeCloseTo(q.y, 9);
  };

  it('reine Verschiebung', () => {
    const r = twoPointTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 }, { x: 15, y: 3 })!;
    expect(r.rot).toBeCloseTo(0, 9);
    expect(r.t.dx).toBeCloseTo(5, 9);
    expect(r.t.dy).toBeCloseTo(3, 9);
    expect(r.deviation).toBeCloseTo(0, 9);
  });

  it('Drehung um 90° im Uhrzeigersinn: beide Punktpaare treffen sich', () => {
    const a1 = { x: 10, y: 10 };
    const a2 = { x: 20, y: 10 };
    const b1 = { x: 100, y: 50 };
    const b2 = { x: 100, y: 60 };
    const r = twoPointTransform(a1, a2, b1, b2)!;
    expect(r.rot).toBeCloseTo(90, 9);
    close(applyTransform(r.t, a1), b1);
    close(applyTransform(r.t, a2), b2);
  });

  it('abweichender Abstand: Maßstab bleibt 1, Hinweis mit der Abweichung, Fehler je Paar die Hälfte', () => {
    const r = twoPointTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10.2, y: 0 })!;
    expect(r.from).toBeCloseTo(10, 9);
    expect(r.to).toBeCloseTo(10.2, 9);
    expect(r.deviation).toBeCloseTo(0.2, 9);
    const p1 = applyTransform(r.t, { x: 0, y: 0 });
    const p2 = applyTransform(r.t, { x: 10, y: 0 });
    expect(p2.x - p1.x).toBeCloseTo(10, 9);
    expect(p1.x).toBeCloseTo(0.1, 9);
  });

  it('zusammenfallende Punkte ergeben keine Richtung', () => {
    expect(twoPointTransform({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull();
  });

  it('Drehung −180 … 180', () => {
    const r = twoPointTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: -10, y: -0.0001 })!;
    expect(Math.abs(r.rot)).toBeLessThanOrEqual(180);
    expect(Math.abs(r.rot)).toBeCloseTo(180, 2);
  });

  it('mergedPage bleibt Grundlage: Sicht nutzt sie', () => {
    const { project, g } = setup();
    expect(pageView(project, verbundRef('g'))!.stands).toBe(mergedPage(project, g).stands);
  });
});
