import { describe, expect, it } from 'vitest';
import { fmt, fmtInput, parseNum } from './format';

/** Deterministischer Zufallsgenerator, damit der Test reproduzierbar bleibt. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('Zahlenformat für Eingabefelder (QA-M2-01)', () => {
  it('keine Tausendertrennzeichen in Eingabefeldern, wohl aber in Anzeigen', () => {
    expect(fmtInput(1000)).toBe('1000');
    expect(fmtInput(1234567.5)).toBe('1234567,5');
    expect(fmtInput(-12000.25)).toBe('-12000,25');
    expect(fmt(1000)).toBe('1.000');
    expect(fmt(1234567.5)).toBe('1.234.567,5');
  });

  it('Komma und Punkt werden als Dezimaltrenner gelesen; Gruppierung wird abgelehnt', () => {
    expect(parseNum('1,5')).toBe(1.5);
    expect(parseNum('1.5')).toBe(1.5);
    expect(parseNum(' 1000 ')).toBe(1000);
    expect(parseNum('1.000')).toBe(1); // Punkt = Dezimaltrenner, wie vorgegeben
    expect(parseNum('-0,25')).toBe(-0.25);
    expect(parseNum(',5')).toBe(0.5);
    for (const bad of ['', 'abc', '1,000,5', '1.234,56', '1,2,3', '1e3', '--1', '1 m']) expect(parseNum(bad)).toBeNaN();
  });

  it('parse(format(x)) === x für eine breite Wertemenge', () => {
    const r = rng(20261010);
    const values: number[] = [0, 1, -1, 999, 1000, 1001, 1200, 1250, 9999.99, 10000, 123456.78, 1e9, -1e9, 0.01, 0.1, 0.5, 2.25];
    for (let i = 0; i < 20000; i++) {
      const magnitude = 10 ** Math.floor(r() * 10); // 1 … 1e9
      const sign = r() < 0.2 ? -1 : 1;
      for (const digits of [0, 1, 2, 4]) {
        const f = 10 ** digits;
        values.push((sign * Math.round(r() * magnitude * f)) / f);
      }
    }
    for (const digits of [0, 1, 2, 4]) {
      const f = 10 ** digits;
      for (const raw of values) {
        const x = Math.round(raw * f) / f; // Werte mit höchstens `digits` Nachkommastellen
        const back = parseNum(fmtInput(x, digits));
        // -0 und 0 gelten als gleich
        expect(back === x || (back === 0 && x === 0)).toBe(true);
      }
    }
  }, 30_000); // 80.000 Werte; unter Last länger als das Standardlimit von 5 s

  it('erneutes Formatieren eines gelesenen Werts ist stabil (Fokus rein/raus ändert nichts)', () => {
    for (const s of ['1000', '1234,5', '0,25', '-3', '12000,75']) {
      expect(fmtInput(parseNum(s), 2)).toBe(s);
      expect(fmtInput(parseNum(fmtInput(parseNum(s), 2)), 2)).toBe(s);
    }
  });
});
