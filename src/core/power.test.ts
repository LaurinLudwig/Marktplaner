import { describe, expect, it } from 'vitest';
import { createPage } from './model/defaults';
import type { Connection, FestplatzPage } from './model/types';
import { createStand } from './objects';
import { checkPowerChange, pagePower, powerLevel, powerPercentLabel, projectPower } from './power';

/** M5: Strom (spec.md §6). */

const stand = (powerKw: number, connection: Connection | null = null) => createStand({ cx: 0, cy: 0, w: 3, d: 3, rot: 0 }, { powerKw, connection });
const page = (stands: number[], limit: number | null = null, block = false): FestplatzPage => ({
  ...createPage('P'),
  stands: stands.map((kw) => stand(kw)),
  powerLimitKw: limit,
  blockOverLimit: block,
});

describe('M5 Strom', () => {
  it('Stufen: grün, gelb ab 90 %, rot über dem Limit; ohne Limit keine Stufe', () => {
    expect(powerLevel(89.9, 100)).toBe('ok');
    expect(powerLevel(90, 100)).toBe('warn');
    expect(powerLevel(100, 100)).toBe('warn');
    expect(powerLevel(100.1, 100)).toBe('over');
    expect(powerLevel(500, null)).toBe('none');
  });

  it('Grenze 90 % ohne Gleitkomma-Reste (QA-M5-02): 11,7 von 13 kW und 0,99 von 1,1 kW sind gelb', () => {
    expect(powerLevel(11.7, 13)).toBe('warn');
    expect(powerLevel(0.99, 1.1)).toBe('warn');
    expect(powerLevel(11.699, 13)).toBe('ok');
    expect(powerLevel(0.1 + 0.2, 0.3)).toBe('warn');
  });

  it('Prozentangabe passt zur Farbe: abgerundet, über dem Limit mit Nachkommastelle bzw. „über 100 %“', () => {
    expect(powerPercentLabel(89.9, 100)).toBe('89 %');
    expect(powerPercentLabel(11.7, 13)).toBe('90 %');
    expect(powerPercentLabel(100, 100)).toBe('100 %');
    expect(powerPercentLabel(100.1, 100)).toBe('100,1 %');
    expect(powerPercentLabel(100.04, 100)).toBe('über 100 %');
    expect(powerPercentLabel(150, 100)).toBe('150 %');
    expect(powerPercentLabel(5, null)).toBe('');
  });

  it('Summe aller Stände der Page, ohne Gleitkomma-Reste, mit Anteil am Limit', () => {
    const p = pagePower(page([0.1, 0.2, 3], 10));
    expect(p.sumKw).toBe(3.3);
    expect(p.ratio).toBeCloseTo(0.33);
    expect(p.level).toBe('ok');
    expect(pagePower(page([1, 2])).ratio).toBeNull();
  });

  it('Anzahl und kW je Anschlussart', () => {
    const p = { ...createPage('P'), stands: [stand(3, '230V'), stand(11, 'CEE16'), stand(5, 'CEE16'), stand(22, 'CEE32'), stand(0)] };
    expect(pagePower(p).byConnection).toEqual({
      '230V': { count: 1, kw: 3 },
      CEE16: { count: 2, kw: 16 },
      CEE32: { count: 1, kw: 22 },
      none: { count: 1, kw: 0 },
    });
  });

  it('Projektsumme für die Start-Page (M6)', () => {
    const r = projectPower({ pages: [page([1, 2], 5), page([4])] });
    expect(r.sumKw).toBe(7);
    expect(r.pages.map((p) => [p.sumKw, p.level])).toEqual([
      [3, 'ok'],
      [4, 'none'],
    ]);
  });

  describe('Prüfung einer Änderung', () => {
    const withStands = (p: FestplatzPage, kws: number[]) => ({ ...p, stands: kws.map((kw) => stand(kw)) });

    it('Erhöhung über das Limit: blockiert nur, wenn eingeschaltet; „crossed“ beim ersten Überschreiten', () => {
      const p = page([50, 40], 100, true);
      const [c] = checkPowerChange([p], [withStands(p, [50, 60])]);
      expect(c).toMatchObject({ before: 90, after: 110, limitKw: 100, blocked: true, crossed: true });
      const q = { ...p, blockOverLimit: false };
      expect(checkPowerChange([q], [withStands(q, [50, 60])])[0]).toMatchObject({ blocked: false });
    });

    it('bis genau zum Limit, Senkungen und gleichbleibende Summen sind nie betroffen', () => {
      const p = page([50, 40], 100, true);
      expect(checkPowerChange([p], [withStands(p, [50, 50])])).toEqual([]);
      const over = page([80, 40], 100, true);
      expect(checkPowerChange([over], [withStands(over, [80, 30])])).toEqual([]);
      expect(checkPowerChange([over], [withStands(over, [40, 80])])).toEqual([]);
      // schon darüber und weiter erhöht: blockiert, aber kein erstes Überschreiten
      expect(checkPowerChange([over], [withStands(over, [80, 41])])[0]).toMatchObject({ blocked: true, crossed: false });
    });

    it('ohne Limit oder ohne Änderung der Stände nichts', () => {
      const p = page([50], null, true);
      expect(checkPowerChange([p], [withStands(p, [500])])).toEqual([]);
      const q = page([50], 10, true);
      expect(checkPowerChange([q], [{ ...q, name: 'neu' }])).toEqual([]);
    });
  });
});
