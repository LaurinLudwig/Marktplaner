import { describe, expect, it } from 'vitest';
import { createPage, createProject, createVerbund } from './model/defaults';
import type { Area, FestplatzPage, Project, Stand, Vec } from './model/types';
import { createArea, createStand } from './objects';
import { applyTransform, mergedPage, pageEnv, verbundRef, type PageTransform } from './verbund';
import { createInfra } from './infra';
import { cachedWarningData } from './warnings';
import { alignPreview, assignObjects, copyFallback, fallbackPage, fitRigid, hasOverview, isVerbundRef, normRot, ownerPages, pageView, sessionMove, sessionRotate, tabOrder, verbundOfRef, type PointPair } from './verbundView';
import { effectivePage } from './derive';

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
  it('verbund:<id> löst den Verbund auf; die Sicht hat keinen Hintergrund, Blatt und Ebenen des Verbunds (Teil c), Identität bleibt', () => {
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
    // Teil c: Blatt, Papier-Elemente und Ebenen des Verbunds (auch die Ebene „Blatt“)
    expect(v.layers).toBe(g.layers);
    expect(v.sheet).toBe(g.sheet);
    expect(v.titleBlock).toBe(g.titleBlock);
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

describe('#26 Ausrichten nach Punktpaaren (fitRigid)', () => {
  const close = (p: Vec, q: Vec, digits = 9) => {
    expect(p.x).toBeCloseTo(q.x, digits);
    expect(p.y).toBeCloseTo(q.y, digits);
  };
  const pairsOf = (t: PageTransform, as: Vec[]): PointPair[] => as.map((a) => ({ a, b: applyTransform(t, a) }));
  /** Frühere 2-Punkt-Ausrichtung (#15 Teil b) als Vergleich: Mitte auf Mitte, Winkel zwischen a1→a2 und b1→b2. */
  const oldTwoPoint = (a1: Vec, a2: Vec, b1: Vec, b2: Vec) => {
    const angle = (p: Vec, q: Vec) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const rot = ((((angle(b1, b2) - angle(a1, a2) + 180) % 360) + 360) % 360) - 180;
    const ca = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
    return { dx: (b1.x + b2.x) / 2 - ca.x, dy: (b1.y + b2.y) / 2 - ca.y, rot, pivot: ca };
  };
  const pts: Vec[] = [
    { x: 12, y: 4 },
    { x: 180, y: -7 },
    { x: 95, y: 60 },
    { x: -30, y: 41 },
    { x: 66, y: -22 },
  ];

  it('reine Verschiebung', () => {
    const r = fitRigid([
      { a: { x: 0, y: 0 }, b: { x: 5, y: 3 } },
      { a: { x: 10, y: 0 }, b: { x: 15, y: 3 } },
    ])!;
    expect(r.rot).toBeCloseTo(0, 9);
    close(applyTransform(r.t, { x: 0, y: 0 }), { x: 5, y: 3 });
    expect(r.rms).toBeCloseTo(0, 9);
  });

  it('exakte Paare: exakte Lösung bei beliebigem Winkel, auch über 180°', () => {
    for (const rot of [0, 3.7234, 90, 179.9, 181, 250, 359.5, -45]) {
      const truth = { dx: 37.21, dy: -12.807, rot, pivot: { x: 0, y: 0 } };
      const r = fitRigid(pairsOf(truth, pts))!;
      expect(r.rot).toBeGreaterThan(-180);
      expect(r.rot).toBeLessThanOrEqual(180);
      expect(normRot(r.rot - rot)).toBeCloseTo(0, 9);
      for (const p of [...pts, { x: 500, y: -300 }]) close(applyTransform(r.t, p), applyTransform(truth, p), 8);
      expect(r.max).toBeLessThan(1e-9);
      expect(r.outlier).toBeNull();
    }
  });

  it('verrauschte Paare: bekannte Lösung der kleinsten Quadrate, Restabweichungen je Paar', () => {
    // Quadrat um (10|10); jeder Zielpunkt radial um 0,1 m (bzw. 0,3 m) nach außen verschoben: Rauschen ohne Schwerpunkt-
    // und Drehanteil (Σ n = 0, Σ p × n = 0), die Lösung ist also genau die wahre Bewegung, die Residuen das Rauschen
    const truth = { dx: 10, dy: 20, rot: 210, pivot: { x: 0, y: 0 } };
    const as = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const eps = [0.1, 0.3, 0.1, 0.3];
    const pairs = as.map((a, i) => {
      const b = applyTransform(truth, a);
      const c = applyTransform(truth, { x: 10, y: 10 });
      const len = Math.hypot(b.x - c.x, b.y - c.y);
      return { a, b: { x: b.x + ((b.x - c.x) / len) * eps[i]!, y: b.y + ((b.y - c.y) / len) * eps[i]! } };
    });
    const r = fitRigid(pairs)!;
    expect(normRot(r.rot - 210)).toBeCloseTo(0, 9);
    for (const p of as) close(applyTransform(r.t, p), applyTransform(truth, p));
    r.residuals.forEach((x, i) => expect(x).toBeCloseTo(eps[i]!, 9));
    expect(r.rms).toBeCloseTo(Math.sqrt((0.01 + 0.09 + 0.01 + 0.09) / 4), 9);
    expect(r.max).toBeCloseTo(0.3, 9);
  });

  it('verrauschte Paare: Lösung minimiert die Fehlerquadrate (keine kleine Änderung ist besser)', () => {
    const truth = { dx: -4, dy: 7, rot: 12, pivot: { x: 0, y: 0 } };
    const noise = [
      { x: 0.2, y: -0.1 },
      { x: -0.15, y: 0.05 },
      { x: 0.05, y: 0.3 },
      { x: -0.3, y: -0.1 },
      { x: 0.1, y: 0.2 },
    ];
    const pairs = pts.map((a, i) => {
      const b = applyTransform(truth, a);
      return { a, b: { x: b.x + noise[i]!.x, y: b.y + noise[i]!.y } };
    });
    const r = fitRigid(pairs)!;
    const sse = (t: PageTransform) =>
      pairs.reduce((s, p) => {
        const m = applyTransform(t, p.a);
        return s + (m.x - p.b.x) ** 2 + (m.y - p.b.y) ** 2;
      }, 0);
    const best = sse(r.t);
    expect(best).toBeCloseTo(r.rms * r.rms * pairs.length, 9);
    for (const d of [
      { dx: 0.01, dy: 0, rot: 0 },
      { dx: 0, dy: -0.01, rot: 0 },
      { dx: 0, dy: 0, rot: 0.01 },
      { dx: 0, dy: 0, rot: -0.01 },
    ])
      expect(sse({ ...r.t, dx: r.t.dx + d.dx, dy: r.t.dy + d.dy, rot: r.t.rot + d.rot })).toBeGreaterThan(best);
    expect(Math.abs(normRot(r.rot - 12))).toBeLessThan(0.5);
  });

  it('genau 2 Paare = frühere 2-Punkt-Ausrichtung (Mitte exakt, Winkel), auch bei abweichendem Abstand', () => {
    const cases: [Vec, Vec, Vec, Vec][] = [
      [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 100, y: 50 }, { x: 100, y: 60 }],
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10.2, y: 0 }],
      [{ x: 30, y: 5 }, { x: 230, y: 5 }, { x: 61.3, y: -8.1 }, { x: 260.9, y: 4.9 }],
    ];
    for (const [a1, a2, b1, b2] of cases) {
      const r = fitRigid([
        { a: a1, b: b1 },
        { a: a2, b: b2 },
      ])!;
      const old = oldTwoPoint(a1, a2, b1, b2);
      expect(normRot(r.rot - old.rot)).toBeCloseTo(0, 9);
      // Mitte von A1/A2 landet exakt auf der Mitte von B1/B2
      close(applyTransform(r.t, { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }), { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 });
      close(applyTransform(r.t, a1), applyTransform(old, a1));
      close(applyTransform(r.t, a2), applyTransform(old, a2));
    }
    // Abweichender Abstand (10 m / 10,2 m): je Paar die Hälfte, Maßstab bleibt 1
    const r = fitRigid([
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10.2, y: 0 } },
    ])!;
    expect(r.residuals[0]).toBeCloseTo(0.1, 9);
    expect(r.residuals[1]).toBeCloseTo(0.1, 9);
    expect(r.rms).toBeCloseTo(0.1, 9);
  });

  it('auffälliges Paar ab 4 Paaren: wird benannt, mit der mittleren Abweichung ohne es', () => {
    const truth = { dx: 37.21, dy: -12.807, rot: 23, pivot: { x: 0, y: 0 } };
    const pairs = pairsOf(truth, pts);
    pairs[2] = { a: pairs[2]!.a, b: { x: pairs[2]!.b.x + 1.5, y: pairs[2]!.b.y - 1 } };
    const r = fitRigid(pairs)!;
    expect(r.outlier).toMatchObject({ index: 2 });
    expect(r.outlier!.rmsWithout).toBeLessThan(1e-9);
    // Ohne das auffällige Paar: exakt
    const without = fitRigid(pairs.filter((_, i) => i !== 2))!;
    expect(without.max).toBeLessThan(1e-9);
    // Gleichmäßiges kleines Rauschen: kein Hinweis
    const noisy = pairsOf(truth, pts).map((p, i) => ({ a: p.a, b: { x: p.b.x + (i % 2 ? 0.004 : -0.004), y: p.b.y + (i % 3 ? 0.003 : -0.005) } }));
    expect(fitRigid(noisy)!.outlier).toBeNull();
    // Mit 3 Paaren keine Prüfung
    expect(fitRigid(pairs.slice(0, 3))!.outlier).toBeNull();
  });

  it('Grenzfälle: weniger als 2 Paare, alle A bzw. alle B an einer Stelle → null', () => {
    expect(fitRigid([])).toBeNull();
    expect(fitRigid([{ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }])).toBeNull();
    expect(
      fitRigid([
        { a: { x: 1, y: 1 }, b: { x: 0, y: 0 } },
        { a: { x: 1, y: 1 }, b: { x: 5, y: 0 } },
        { a: { x: 1, y: 1 }, b: { x: 5, y: 5 } },
      ]),
    ).toBeNull();
    expect(
      fitRigid([
        { a: { x: 0, y: 0 }, b: { x: 3, y: 3 } },
        { a: { x: 5, y: 0 }, b: { x: 3, y: 3 } },
      ]),
    ).toBeNull();
  });

  it('Vorschau: Objekte, Beschriftungen und Hintergrund aus einer Transformation (als Vorschau-Lage, #27)', () => {
    const { a } = setup();
    const page: FestplatzPage = { ...a, stands: [{ ...a.stands[0]!, labelOffset: { x: 4, y: 0 } }] };
    const t = { dx: 1, dy: 2, rot: 90, pivot: { x: 5, y: 5 } };
    const pv = alignPreview({ placements: {} }, page, t);
    // Vorschau-Lage: 90° um (5|5), dann (1|2) → welt = R(90°) · lokal + (11, 2)
    expect(pv.placement.rot).toBe(90);
    expect(pv.placement.x).toBeCloseTo(11, 9);
    expect(pv.placement.y).toBeCloseTo(2, 9);
    expect(pv.rects.sA!.cx).toBeCloseTo(6, 9);
    expect(pv.rects.sA!.cy).toBeCloseTo(7, 9);
    expect(pv.rects.sA!.rot).toBe(90);
    // mit vorhandener Lage: t wirkt in der Welt auf die bisherige Lage
    const moved = alignPreview({ placements: { [page.id]: { x: 100, y: 0, rot: 0 } } }, page, { dx: 1, dy: 0, rot: 0, pivot: { x: 0, y: 0 } });
    expect(moved.placement).toEqual({ x: 101, y: 0, rot: 0 });
    expect(moved.rects.sA).toMatchObject({ cx: 106, cy: 5 });
    expect(pv.labelOffsets.sA!.x).toBeCloseTo(0, 9);
    expect(pv.labelOffsets.sA!.y).toBeCloseTo(4, 9);
    expect(pv.rects.aA).toBeDefined();
    expect(pv.background).toBeNull();
    // effectivePage setzt die Beschriftung der Vorschau ein
    const shown = effectivePage(page, { pageId: page.id, rects: pv.rects, labelOffsets: pv.labelOffsets });
    expect(shown.stands[0]!.labelOffset).toEqual(pv.labelOffsets.sA);
    expect(shown.stands[0]!.cx).toBeCloseTo(6, 9);
  });

  it('weit entfernte Koordinaten (Stadtgrundkarte mit großem Ursprung): exakt, ohne Auslöschung', () => {
    const truth = { dx: -812.4, dy: 233.9, rot: -137.25, pivot: { x: 0, y: 0 } };
    const far = pts.map((p) => ({ x: p.x + 512_000, y: p.y + 5_270_000 }));
    const r = fitRigid(pairsOf(truth, far))!;
    expect(normRot(r.rot + 137.25)).toBeCloseTo(0, 7);
    expect(r.max).toBeLessThan(1e-6);
  });

  it('genau 4 Paare: ein falsches Paar wird erkannt, egal an welcher Stelle', () => {
    const truth = { dx: 5, dy: -3, rot: 71, pivot: { x: 0, y: 0 } };
    for (let bad = 0; bad < 4; bad++) {
      const pairs = pairsOf(truth, pts.slice(0, 4)).map((p, i) => (i === bad ? { a: p.a, b: { x: p.b.x + 0.8, y: p.b.y + 0.6 } } : p));
      expect(fitRigid(pairs)!.outlier).toMatchObject({ index: bad });
    }
  });

  it('Sitzung: Drehgriff über ±180° hinweg, Shift rastet die gesamte Drehung, Ziehen auf 0,01 m', () => {
    const c = { x: 10, y: 10 };
    // 170° + 20° (von rechts nach unten-rechts gedreht) = −170°
    const from = { x: 20, y: 10 };
    const to = { x: 10 + 10 * Math.cos((20 * Math.PI) / 180), y: 10 + 10 * Math.sin((20 * Math.PI) / 180) };
    expect(sessionRotate({ dx: 0, dy: 0, rot: 170 }, c, from, to).rot).toBeCloseTo(-170, 9);
    // Shift: 7° gesammelt + 5° gedreht = 12° → 15°
    const to5 = { x: 10 + 10 * Math.cos((5 * Math.PI) / 180), y: 10 + 10 * Math.sin((5 * Math.PI) / 180) };
    expect(sessionRotate({ dx: 0, dy: 0, rot: 7 }, c, from, to5, true).rot).toBe(15);
    expect(sessionMove({ dx: 1, dy: 2, rot: 3 }, { x: 0.12345, y: -0.006 })).toEqual({ dx: 1.12, dy: 1.99, rot: 3 });
  });

  it('mergedPage bleibt Grundlage: Sicht nutzt sie', () => {
    const { project, g } = setup();
    expect(pageView(project, verbundRef('g'))!.stands).toBe(mergedPage(project, g).stands);
  });
});

describe('#15 Warnungen der Gesamtansicht = Vereinigung der Einzelansichten', () => {
  it('Infrastruktur nur innerhalb desselben Platzes; Überlappung, Abstand und „außerhalb“ über Platzgrenzen', () => {
    const base = createProject('T');
    const categories = [{ id: 'c', name: 'Crêpes', color: '#ffffff', minDistance: 10, price: null }];
    const rtw = base.infraTypes.find((t) => t.id === 'ambulance')!;
    expect(rtw.keepClear).toBe(true);
    const cat = (s: Stand): Stand => ({ ...s, categoryId: 'c' });
    // A: Grundfläche x 0–20; B: x 15–35 (Überschneidung 15–20)
    const a: FestplatzPage = {
      ...createPage('A'),
      id: 'A',
      areas: [area('aA', 10, 5, 20, 10)],
      // sA1 überlappt sB1; sA2 zu nah an sB2 (gleiche Kategorie); sA3 steht im eigenen RTW-Feld
      stands: [stand('sA1', 16, 2), cat(stand('sA2', 12, 8)), stand('sA3', 3, 5)],
      // RTW-Feld von A über sA3 (eigen) und über sB3 (fremd)
      infra: [{ ...createInfra(rtw, { cx: 5, cy: 5, w: 10, d: 4, rot: 0 }), id: 'rA' }],
    };
    const b: FestplatzPage = {
      ...createPage('B'),
      id: 'B',
      areas: [area('aB', 25, 5, 20, 10)],
      // sB4 liegt außerhalb jeder Grundfläche
      stands: [stand('sB1', 17, 2), cat(stand('sB2', 18, 8)), stand('sB3', 8, 5), stand('sB4', 30, 20)],
    };
    const project: Project = { ...base, categories, pages: [a, b], groups: [{ ...createVerbund('U', ['A', 'B']), id: 'g' }] };
    const summary = (pg: FestplatzPage) => {
      const w = cachedWarningData(pg.stands, pg.infra, pageEnv(project, pg), project);
      const ids = (pred: (id: string) => boolean) => pg.stands.map((x) => x.id).filter(pred).toSorted();
      return {
        infra: ids((id) => w.infra.byStand.has(id)),
        infraPairs: pg.stands.flatMap((x) => (w.infra.byStand.get(x.id) ?? []).map((o) => `${x.id}>${o}`)).toSorted(),
        overlap: ids((id) => !!w.page.byStand.get(id)?.overlaps.length),
        outside: ids((id) => !!w.page.byStand.get(id)?.outside),
        distance: ids((id) => w.distance.has(id)),
      };
    };
    const whole = summary(pageView(project, verbundRef('g'))!);
    const sa = summary(a);
    const sb = summary(b);
    const keys = ['infra', 'infraPairs', 'overlap', 'outside', 'distance'] as const;
    const union = Object.fromEntries(keys.map((k) => [k, [...sa[k], ...sb[k]].toSorted()]));
    expect(whole).toEqual(union);
    // Erwartete Inhalte: sB3 im RTW-Feld von A warnt nicht, sA3 schon
    expect(whole).toEqual({ infra: ['sA3'], infraPairs: ['sA3>rA'], overlap: ['sA1', 'sB1'], outside: ['sB4'], distance: ['sA2', 'sB2'] });
  });
});
