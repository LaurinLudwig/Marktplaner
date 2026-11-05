import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPage, createProject, DEFAULT_SHEET, LEGACY_SHEET } from './model/defaults';
import type { Corner, FestplatzPage, Sheet } from './model/types';
import { BUILTIN_PROFILES } from './exportProfiles';
import { createArea, createStand } from './objects';
import { exportFrame, pagePaper } from './paper';
import { pageScene } from './scene/page';
import {
  anchorToPaper,
  autoMargin,
  dinPrintHint,
  exceedsPdfLimit,
  formatText,
  mmToM,
  planPaper,
  regionOf,
  resizeBounds,
  sheetFrame,
  sheetLabel,
  shownOnPaper,
  titleBlockMeta,
  type SheetElement,
} from './sheet';
import type { Bounds } from './viewport';

/** Blatt ohne festes Papierformat (#13, spec.md §8): „Plan“ und „Ausschnitt“. */

const page = (sheet: Partial<Sheet>, patch: Partial<FestplatzPage> = {}): FestplatzPage => ({ ...createPage('Seestraße'), sheet: { ...DEFAULT_SHEET, ...sheet }, ...patch });
/** Grundfläche 200 × 50 m von (0, 0) bis (200, 50). */
const wide = [createArea({ cx: 100, cy: 25, w: 200, d: 50, rot: 0 })];
const content: Bounds = { minX: 0, minY: 0, maxX: 200, maxY: 50 };

describe('Plan: Papiermaß aus Inhalt × Maßstab', () => {
  it('neue Pages haben „Plan“ mit Maßstab aus der Zielbreite 841 mm und automatischem Rand', () => {
    expect(createPage('P').sheet).toEqual({ format: 'plan', orientation: 'landscape', scale: null, cx: 0, cy: 0, margin: null, targetWidth: 841, region: null });
  });

  it('200 × 50 m bei 1:200 = 1000 × 250 mm Inhalt, 30 mm Rand (3 %) → 1060 × 310 mm; Blatt folgt dem Inhalt', () => {
    const f = sheetFrame(page({ scale: 200, cx: 999, cy: 999 }, { areas: wide }), null);
    expect(f).toMatchObject({ kind: 'plan', scale: 200, paper: { w: 1060, h: 310 }, margin: 30, fit: false, movable: false });
    expect(f.bounds.minX).toBeCloseTo(-6);
    expect(f.bounds.maxX).toBeCloseTo(206);
    expect(f.bounds.minY).toBeCloseTo(-6);
    expect(f.bounds.maxY).toBeCloseTo(56);
  });

  it('Rand: Vorbelegung 3 % der längeren Seite auf volle mm, mindestens 10 mm; eingestellter Rand gilt', () => {
    expect(autoMargin({ w: 1000, h: 250 })).toBe(30);
    expect(autoMargin({ w: 1236, h: 341 })).toBe(37);
    expect(autoMargin({ w: 100, h: 50 })).toBe(10);
    expect(autoMargin({ w: 300, h: 900 })).toBe(27);
    // 20 × 10 m bei 1:200 = 100 × 50 mm: 3 mm wären zu wenig → 10 mm
    expect(planPaper({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 200, null)).toMatchObject({ w: 120, h: 70, margin: 10 });
    expect(planPaper(content, 200, 15)).toMatchObject({ w: 1030, h: 280, margin: 15 });
  });

  it('Papiermaß wird auf volle mm aufgerundet, der Rest verteilt sich auf beide Seiten', () => {
    // 100 × 33,33 m bei 1:300 = 333,33 × 111,11 mm, Rand 10 mm
    const p = planPaper({ minX: 0, minY: 0, maxX: 100, maxY: 33.333 }, 300, null);
    expect(p.w).toBe(354);
    expect(p.h).toBe(132);
    expect(p.left).toBeCloseTo(p.right);
    expect(p.left + p.right + mmToM(100, 1) * 1000 / 300 * 1000).toBeCloseTo(354, 6);
  });

  it('Zielbreite: kleinster Maßstab (volle 10), bei dem das Papier höchstens so breit ist', () => {
    const f = sheetFrame(page({ scale: null, targetWidth: 841 }, { areas: wide }), null);
    // 1:250 → 800 + 2 × 24 = 848 mm (zu breit), 1:260 → 769,2 + 2 × 23 → 816 mm
    expect(f.scale).toBe(260);
    expect(f.paper.w).toBe(816);
    expect(f.fit).toBe(true);
    expect(planPaper(content, 250, null).w).toBeGreaterThan(841);
    expect(sheetFrame(page({ scale: null, targetWidth: 2000 }, { areas: wide }), null).paper.w).toBeLessThanOrEqual(2000);
  });

  it('ohne Inhalt gilt der Hintergrund, sonst 100 × 100 m um den Ursprung', () => {
    const bg = { minX: 0, minY: 0, maxX: 400, maxY: 100 };
    const f = sheetFrame(page({ scale: 1000 }), bg);
    // 400 × 100 mm, Rand 12 mm
    expect(f.paper).toEqual({ w: 424, h: 124 });
    expect(sheetFrame(page({ scale: 1000 }), null).paper).toEqual({ w: 120, h: 120 });
  });
});

describe('Plan: Das Blatt wächst um die Papier-Elemente', () => {
  const tb: SheetElement = { corner: 'br', dx: 10, dy: 10, w: 180, h: 25 };
  const legend: SheetElement = { corner: 'bl', dx: 10, dy: 10, w: 60, h: 100 };

  it('Schriftfeld unten rechts: Band unten (kleinere Fläche als ein Band rechts)', () => {
    // unten: 10 + 25 + 3 = 38 mm → 1060 × 318; rechts wären 193 mm → 1223 × 310
    expect(planPaper(content, 200, null, [tb])).toMatchObject({ w: 1060, h: 318, left: 30, right: 30, top: 30, bottom: 38 });
  });

  it('hohe Legende unten links: Band links, Schriftfeld unten', () => {
    // Legende links (73 mm) + Schriftfeld unten (38 mm) = 1103 × 318 ist die kleinste Fläche
    const p = planPaper(content, 200, null, [tb, legend]);
    expect(p).toMatchObject({ w: 1103, h: 318, left: 73, bottom: 38 });
    const f = sheetFrame(page({ scale: 200 }, { areas: wide }), null, [tb, legend]);
    expect(f.bounds.minX).toBeCloseTo(-73 * 0.2);
    expect(f.paper).toEqual({ w: 1103, h: 318 });
  });

  it('Elemente an derselben Kante passen nebeneinander, sonst wird das Blatt breiter (Inhalt mittig)', () => {
    const tl: SheetElement = { corner: 'tl', dx: 10, dy: 10, w: 92, h: 14 };
    const tr: SheetElement = { corner: 'tr', dx: 10, dy: 10, w: 20, h: 20 };
    // Inhalt 10 × 400 m bei 1:1000 = 10 × 400 mm (Rand 12 mm): Maßstabsbalken oben, Nordpfeil rechts; oben müssen
    // 102 + 30 + 3 mm nebeneinander passen, das Blatt wird auf 135 mm verbreitert
    const p = planPaper({ minX: 0, minY: 0, maxX: 10, maxY: 400 }, 1000, null, [tl, tr]);
    expect(p).toMatchObject({ w: 135, h: 439, top: 27 });
    expect(p.left + 10 + p.right).toBeCloseTo(135);
    // flacher Inhalt: kleinste Fläche mit Bändern links und rechts
    expect(planPaper({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, null, [tl, tr])).toMatchObject({ w: 148, h: 30, left: 105, right: 33 });
  });

  it('Eigenschaft: kein Papier-Element liegt auf dem Inhalt, alle stehen ungekürzt an ihrer Ecke', () => {
    const corner = fc.constantFrom<Corner>('tl', 'tr', 'bl', 'br');
    const el = fc.record({ corner, dx: fc.integer({ min: 0, max: 40 }), dy: fc.integer({ min: 0, max: 40 }), w: fc.integer({ min: 10, max: 200 }), h: fc.integer({ min: 10, max: 150 }) });
    fc.assert(
      fc.property(fc.array(el, { maxLength: 4 }), fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 1000 }), fc.option(fc.integer({ min: 10, max: 60 }), { nil: null }), (els, wM, hM, k, margin) => {
        const n = k * 10;
        const b = { minX: 0, minY: 0, maxX: wM, maxY: hM };
        const p = planPaper(b, n, margin, els);
        const c = { x0: p.left, y0: p.top, x1: p.w - p.right, y1: p.h - p.bottom };
        const eps = 1e-6;
        if (Math.abs(c.x1 - c.x0 - (wM * 1000) / n) > eps || Math.abs(c.y1 - c.y0 - (hM * 1000) / n) > eps) return false;
        if (Math.min(p.left, p.right, p.top, p.bottom) < p.margin - eps) return false;
        return els.every((e) => {
          const at = anchorToPaper(e, e, p);
          const shown = shownOnPaper(e, e, p);
          const apart = at.x + e.w <= c.x0 + eps || at.x >= c.x1 - eps || at.y + e.h <= c.y0 + eps || at.y >= c.y1 - eps;
          return apart && Math.abs(at.x - shown.x) < eps && Math.abs(at.y - shown.y) < eps;
        });
      }),
      { numRuns: 400 },
    );
  });

  // Tester: Die kleinste Fläche legte bei schmalem Inhalt eine hohe Legende (rechts) über den Maßstabsbalken (oben)
  it('Elemente an verschiedenen Ecken überdecken sich nicht (hohe Legende rechts, breiter Balken oben, schmaler Inhalt)', () => {
    const tl: SheetElement = { corner: 'tl', dx: 10, dy: 10, w: 92, h: 14 };
    const br: SheetElement = { corner: 'br', dx: 10, dy: 10, w: 60, h: 100 };
    const p = planPaper({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, null, [tl, br]);
    const a = anchorToPaper(tl, tl, p);
    const b = anchorToPaper(br, br, p);
    expect(a.x + tl.w <= b.x || b.x + br.w <= a.x || a.y + tl.h <= b.y || b.y + br.h <= a.y).toBe(true);
    // Balken oben, Legende unten links neben dem Inhalt wäre größer; erlaubt ist z. B. beides oben/unten: 102 × 150 mm
    expect(p).toMatchObject({ w: 102, h: 150 });
  });

  it('Eigenschaft: Papier-Elemente an verschiedenen Ecken überdecken sich nie', () => {
    const corner = fc.constantFrom<Corner>('tl', 'tr', 'bl', 'br');
    const el = fc.record({ corner, dx: fc.integer({ min: 0, max: 40 }), dy: fc.integer({ min: 0, max: 40 }), w: fc.integer({ min: 10, max: 300 }), h: fc.integer({ min: 10, max: 300 }) });
    fc.assert(
      fc.property(fc.uniqueArray(el, { maxLength: 4, selector: (e) => e.corner }), fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 1000 }), (els, wM, hM, k) => {
        const p = planPaper({ minX: 0, minY: 0, maxX: wM, maxY: hM }, k * 10, null, els);
        const r = els.map((e) => ({ ...anchorToPaper(e, e, p), w: e.w, h: e.h }));
        return r.every((a, i) => r.every((b, j) => j <= i || a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6));
      }),
      { numRuns: 400 },
    );
  });

  it('Page: Schriftfeld, Legende, Maßstabsbalken und Nordpfeil liegen außerhalb des Inhalts, in mm gleich groß', () => {
    const p = createProject('P');
    const pg = p.pages[0]!;
    pg.sheet = { ...DEFAULT_SHEET, scale: 200 };
    pg.areas.push(...wide);
    const pp = pagePaper(pg, p);
    const k = 1000 / pp.frame.scale;
    const c = { minX: -pp.frame.bounds.minX * k, minY: -pp.frame.bounds.minY * k, maxX: (200 - pp.frame.bounds.minX) * k, maxY: (50 - pp.frame.bounds.minY) * k };
    for (const el of [pp.titleBlock, pp.legend!, pp.scaleBar, pp.northArrow]) {
      const tl = { x: (el.topLeft.x - pp.frame.bounds.minX) * k, y: (el.topLeft.y - pp.frame.bounds.minY) * k };
      const apart = c.maxX <= tl.x + 1e-6 || c.minX >= tl.x + el.layout.w - 1e-6 || c.maxY <= tl.y + 1e-6 || c.minY >= tl.y + el.layout.h - 1e-6;
      expect(apart).toBe(true);
    }
    expect(pp.titleBlock.layout.w).toBe(180);
    expect(pp.frame.paper.w).toBeGreaterThan(1060);
    // Schriftfeld nennt das freie Maß
    expect(pp.titleBlock.layout.texts[2]!.text).toBe(`Maßstab 1:200 bei Druck in Originalgröße (${formatText(pg.sheet, pp.frame.paper)})`);
    // Ohne sichtbare Papier-Elemente: nur Inhalt + Rand
    for (const kind of ['titleBlock', 'legend', 'scaleBar', 'northArrow'] as const) pg[kind].visible = false;
    expect(pagePaper(pg, p).frame.paper).toEqual({ w: 1060, h: 310 });
  });
});

describe('Ausschnitt', () => {
  it('Papiermaß = Ausschnitt / n; verschiebbar, Papier-Elemente liegen darüber und lassen das Maß unverändert', () => {
    const f = sheetFrame(page({ format: 'region', scale: 500, region: { cx: 10, cy: 20, w: 100, h: 40 } }), null, [{ corner: 'br', dx: 10, dy: 10, w: 180, h: 25 }]);
    expect(f).toMatchObject({ kind: 'region', scale: 500, paper: { w: 200, h: 80 }, movable: true, fit: false, margin: null });
    expect(f.bounds).toEqual({ minX: -40, minY: 0, maxX: 60, maxY: 40 });
  });

  it('Zielbreite: n auf volle 10 aufgerundet, Papier höchstens so breit; ohne Ausschnitt gilt der Inhalt', () => {
    const f = sheetFrame(page({ format: 'region', scale: null, targetWidth: 841, region: { cx: 0, cy: 0, w: 300, h: 60 } }), null);
    expect(f.scale).toBe(360);
    expect(f.paper.w).toBeCloseTo(833.33, 2);
    expect(f.fit).toBe(true);
    expect(sheetFrame(page({ format: 'region', scale: 500, region: null }, { areas: wide }), null).bounds).toEqual(content);
  });

  it('Aufziehen und Griffe: auf 0,01 m gerundet, mindestens 1 m, Gegenseite bleibt fest', () => {
    expect(regionOf({ minX: 0.006, minY: 1, maxX: 10.126, maxY: 1.2 })).toEqual({ cx: 5.07, cy: 1.1, w: 10.12, h: 1 });
    const b = { minX: 0, minY: 0, maxX: 100, maxY: 40 };
    expect(resizeBounds(b, 1, 0, { x: 150, y: 999 })).toEqual({ minX: 0, minY: 0, maxX: 150, maxY: 40 });
    expect(resizeBounds(b, -1, -1, { x: 20, y: -10 })).toEqual({ minX: 20, minY: -10, maxX: 100, maxY: 40 });
    // über die Gegenseite hinaus: bleibt 1 m groß
    expect(resizeBounds(b, 0, 1, { x: 0, y: -50 })).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 1 });
  });
});

describe('Grenzen, Anzeige, Druck-Hinweis', () => {
  it('Warnung ab mehr als 5 080 mm je Seite (200 Zoll)', () => {
    expect(exceedsPdfLimit({ w: 5080, h: 300 })).toBe(false);
    expect(exceedsPdfLimit({ w: 300, h: 5081 })).toBe(true);
    // 1100 m Inhalt bei 1:200 = 5500 mm
    expect(exceedsPdfLimit(sheetFrame(page({ scale: 200 }, { areas: [createArea({ cx: 550, cy: 25, w: 1100, d: 50, rot: 0 })] }), null).paper)).toBe(true);
    // Zielbreite bleibt immer unter der Grenze, solange sie selbst darunter liegt
    expect(exceedsPdfLimit(sheetFrame(page({ scale: null, targetWidth: 5000 }, { areas: [createArea({ cx: 550, cy: 25, w: 1100, d: 50, rot: 0 })] }), null).paper)).toBe(false);
  });

  it('Marke und Schriftfeld zeigen das freie Maß; DIN wie bisher', () => {
    const plan = sheetFrame(page({ scale: 200 }, { areas: wide }), null);
    expect(sheetLabel(DEFAULT_SHEET, plan)).toBe('1.060 × 310 mm · 1:200');
    expect(sheetLabel(DEFAULT_SHEET, { ...plan, fit: true })).toBe('1.060 × 310 mm · 1:200');
    const din = sheetFrame(page({ ...LEGACY_SHEET }, { areas: [createArea({ cx: 87.5, cy: 25, w: 175, d: 50, rot: 0 })] }), null);
    expect(sheetLabel(LEGACY_SHEET, din)).toBe('A3 quer · 1:440 (angepasst)');
    expect(titleBlockMeta({ scale: 200, format: formatText(DEFAULT_SHEET, plan.paper), dateText: '', version: '' })).toBe('Maßstab 1:200 bei Druck in Originalgröße (1.060 × 310 mm)');
  });

  it('Druck-Hinweis: kleinstes passendes DIN-Format und das nächstkleinere verkleinert', () => {
    expect(dinPrintHint({ w: 1060, h: 318 })).toEqual({
      fits: { format: 'A0', orientation: 'landscape', factor: 1189 / 1060 },
      reduced: { format: 'A1', orientation: 'landscape', factor: 841 / 1060 },
    });
    expect(dinPrintHint({ w: 100, h: 50 })).toMatchObject({ fits: { format: 'A4', orientation: 'landscape' }, reduced: null });
    expect(dinPrintHint({ w: 6000, h: 1000 })).toMatchObject({ fits: null, reduced: { format: 'A0', orientation: 'landscape' } });
  });
});

// Tester: Export-Dialog, gerasterte SVG-Hintergründe und Größenschätzung nahmen das Blatt mit den Ebenen der Page,
// das PDF das mit den Ebenen des Profils. Beim Plan ändert die Legende das Papiermaß.
describe('Blatt im PDF folgt den Ebenen des Export-Profils (#13)', () => {
  it('exportFrame = Blatt der PDF-Seite für jedes Profil; „Händler“ ohne Freiflächen hat ein anderes Papiermaß', () => {
    const p = createProject('P');
    const pg = p.pages[0]!;
    pg.sheet = { ...DEFAULT_SHEET, scale: 200 };
    pg.areas.push(...wide);
    // ein Stand an der Vorderkante, daneben bleibt Freifläche
    pg.stands.push(createStand({ cx: 5, cy: 2, w: 10, d: 4, rot: 0 }));
    expect(pagePaper(pg, p).legend!.layout.rows.map((r) => r.entry.kind)).toContain('free');
    for (const profile of BUILTIN_PROFILES) expect(exportFrame(pg, p, profile)).toEqual(pageScene(pg, p, profile).frame);
    const vendor = BUILTIN_PROFILES.find((x) => x.id === 'vendor')!;
    expect(exportFrame(pg, p, vendor).paper).not.toEqual(pagePaper(pg, p).frame.paper);
  });
});
