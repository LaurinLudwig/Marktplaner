import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, redactProject } from './exportProfiles';
import { billedMeters, feesOf, fmtEuro, grossOf, hasPricing, standFee, sumFees } from './fee';
import { createPage, createProject } from './model/defaults';
import type { Category, PricingSettings, Project, Stand } from './model/types';
import { createStand } from './objects';
import { sortRows, standRows, sumRows } from './standTable';
import { projectStats } from './stats';

/** #5: Standgeld aus Frontmetern, Sonderpreise je Kategorie, MwSt. */

const pricing = (p: Partial<PricingSettings> = {}): PricingSettings => ({ perMeter: 25, roundUpMeters: false, vatRate: 19, ...p });
const cat = (id: string, price: Category['price']): Category => ({ id, name: id, color: '#aabbcc', minDistance: null, price });

describe('#5 Standgeld', () => {
  it('Projektpreis je Frontmeter; brutto mit MwSt, je Stand auf Cent gerundet', () => {
    expect(standFee({ w: 4.3 }, undefined, pricing())).toEqual({ net: 107.5, gross: 127.93, source: 'project', meters: 4.3, rate: 25 });
    expect(standFee({ w: 3 }, undefined, pricing({ vatRate: 7 }))!.gross).toBe(80.25);
    expect(standFee({ w: 3 }, undefined, pricing({ vatRate: 0 }))!.gross).toBe(75);
  });

  it('ohne Projektpreis und ohne Sonderpreis: kein Standgeld; Preis 0 ist ein Preis', () => {
    expect(standFee({ w: 4 }, undefined, pricing({ perMeter: null }))).toBeNull();
    expect(standFee({ w: 4 }, cat('a', null), pricing({ perMeter: null }))).toBeNull();
    expect(standFee({ w: 4 }, undefined, pricing({ perMeter: 0 }))).toMatchObject({ net: 0, gross: 0 });
  });

  it('Sonderpreis der Kategorie: eigener Preis je Frontmeter oder Pauschale, auch ohne Projektpreis', () => {
    expect(standFee({ w: 4 }, cat('a', { kind: 'perMeter', amount: 40 }), pricing())).toMatchObject({ net: 160, source: 'perMeter', rate: 40 });
    expect(standFee({ w: 12.5 }, cat('a', { kind: 'flat', amount: 500 }), pricing({ perMeter: null }))).toEqual({ net: 500, gross: 595, source: 'flat', meters: 12.5, rate: 500 });
  });

  it('angefangene Meter voll: 4,30 → 5, 4,00 → 4, 0,01 → 1; Pauschale unabhängig davon', () => {
    expect([4.3, 4, 0.01, 4.999].map((w) => billedMeters(w, true))).toEqual([5, 4, 1, 5]);
    expect(billedMeters(4.3, false)).toBe(4.3);
    expect(standFee({ w: 4.3 }, undefined, pricing({ roundUpMeters: true }))).toMatchObject({ net: 125, meters: 5 });
    expect(standFee({ w: 4.3 }, cat('a', { kind: 'flat', amount: 99 }), pricing({ roundUpMeters: true }))).toMatchObject({ net: 99, meters: 4.3 });
  });

  it('Rundung ohne Gleitkomma-Reste', () => {
    // 3,35 m × 19,99 € = 66,9665 → 66,97; brutto 79,6943 → 79,69
    expect(standFee({ w: 3.35 }, undefined, pricing({ perMeter: 19.99 }))).toMatchObject({ net: 66.97, gross: 79.69 });
    expect(grossOf(0.1 + 0.2, 0)).toBe(0.3);
  });

  it('Summen in Cent; Stände ohne Preis zählen nicht; nicht mehr vorhandene Kategorie = Projektpreis', () => {
    const cats = [cat('fg', { kind: 'flat', amount: 500 })];
    const fees = feesOf(
      [
        { w: 4.1, categoryId: null },
        { w: 3.3, categoryId: 'fg' },
        { w: 2.2, categoryId: 'weg' },
      ],
      cats,
      pricing({ perMeter: 0.1 }),
    );
    expect(fees.map((f) => f?.net)).toEqual([0.41, 500, 0.22]);
    expect(sumFees(fees)).toEqual({ net: 500.63, gross: 595.75, count: 3 });
    expect(sumFees([null, null])).toEqual({ net: 0, gross: 0, count: 0 });
  });

  it('hasPricing: Projektpreis oder mindestens ein Sonderpreis', () => {
    expect(hasPricing(pricing({ perMeter: null }), [cat('a', null)])).toBe(false);
    expect(hasPricing(pricing({ perMeter: 0 }), [])).toBe(true);
    expect(hasPricing(pricing({ perMeter: null }), [cat('a', { kind: 'flat', amount: 1 })])).toBe(true);
  });

  it('fmtEuro: deutsches Format, immer zwei Nachkommastellen', () => {
    expect([fmtEuro(1234.5), fmtEuro(0), fmtEuro(1_000_000)]).toEqual(['1.234,50 €', '0,00 €', '1.000.000,00 €']);
  });
});

describe('#5 Standgeld in Tabelle, Kennzahlen und Export', () => {
  const st = (cx: number, w: number, categoryId: string | null = null): Stand => createStand({ cx, cy: 0, w, d: 3, rot: 0 }, { categoryId });
  const project = (): Project => {
    const p = createProject('T');
    const a = { ...createPage('A'), stands: [st(0, 4), st(10, 3, 'fg'), st(20, 2, 'none')] };
    const b = { ...createPage('B'), stands: [st(0, 5)] };
    return {
      ...p,
      pages: [a, b],
      categories: [cat('fg', { kind: 'flat', amount: 500 }), cat('none', null)],
      settings: { ...p.settings, pricing: pricing({ perMeter: 10 }) },
    };
  };

  it('Zeilen tragen das Standgeld; sortierbar; Summenzeile netto und brutto', () => {
    const rows = standRows(project());
    expect(rows.map((r) => r.fee?.net)).toEqual([40, 500, 20, 50]);
    expect(sortRows(rows, [{ col: 'fee', dir: 'desc' }]).map((r) => r.fee?.net)).toEqual([500, 50, 40, 20]);
    expect(sumRows(rows).fee).toEqual({ net: 610, gross: 725.9, count: 4 });
  });

  it('ohne Preis: kein Standgeld, Stände ohne Preis stehen beim Sortieren am Ende', () => {
    const p = project();
    p.settings.pricing.perMeter = null;
    const rows = standRows(p);
    expect(rows.map((r) => r.fee?.net ?? null)).toEqual([null, 500, null, null]);
    expect(sortRows(rows, [{ col: 'fee', dir: 'asc' }])[0]!.fee?.net).toBe(500);
  });

  it('Kennzahlen je Festplatz und gesamt', () => {
    const s = projectStats(project(), () => []);
    expect(s.pages.map((p) => p.fee)).toEqual([
      { net: 560, gross: 666.4, count: 3 },
      { net: 50, gross: 59.5, count: 1 },
    ]);
    expect(s.total.fee).toEqual({ net: 610, gross: 725.9, count: 4 });
  });

  it('PDF-Datenschutz: ohne Feld „Standgeld“ fehlen alle Preise; kein mitgeliefertes Profil erlaubt es', () => {
    const intern = BUILTIN_PROFILES[0]!;
    expect(intern.fields).not.toContain('fee');
    const red = redactProject(project(), intern);
    expect(red.settings.pricing.perMeter).toBeNull();
    expect(red.categories.every((c) => c.price === null)).toBe(true);
    expect(standRows(red).every((r) => r.fee === null)).toBe(true);
    const allowed = redactProject(project(), { ...intern, fields: [...intern.fields, 'fee'] });
    expect(standRows(allowed).map((r) => r.fee?.net)).toEqual([40, 500, 20, 50]);
  });
});
