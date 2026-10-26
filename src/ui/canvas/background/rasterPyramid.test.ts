import { describe, expect, it } from 'vitest';
import { chooseLevel, needsPyramid, tilesFor, TILE, type Pyramid } from './rasterPyramid';

// 12000 × 9000 (108 MP) → Übersicht 1/8 (1500 px), Stufen 0, 1, 2
const pyr = { w: 12000, h: 9000, overviewFactor: 8, maxLevel: 2 } as unknown as Pyramid;

describe('Rasterpyramide (QA-M2-03)', () => {
  it('kachelt erst große Bilder', () => {
    expect(needsPyramid({ w: 1000, h: 800 })).toBe(false);
    expect(needsPyramid({ w: 4000, h: 3000 })).toBe(false);
    expect(needsPyramid({ w: 8000, h: 6000 })).toBe(true);
    expect(needsPyramid({ w: 5000, h: 100 })).toBe(true);
  });

  it('wählt die gröbste Stufe, die noch mindestens Bildschirmauflösung hat', () => {
    expect(chooseLevel(pyr, 0.1)).toBeNull(); // Übersicht (1/8) reicht
    expect(chooseLevel(pyr, 0.2)).toBe(2); // 1/4 ≥ 0,2
    expect(chooseLevel(pyr, 0.3)).toBe(1); // 1/2 ≥ 0,3
    expect(chooseLevel(pyr, 1)).toBe(0);
    expect(chooseLevel(pyr, 4)).toBe(0); // stärker vergrößert: Originalauflösung
  });

  it('liefert nur die sichtbaren Kacheln und schneidet am Bildrand ab', () => {
    const t = tilesFor(pyr, 0, { minX: 100, minY: 100, maxX: 1100, maxY: 600 });
    expect(t.map((x) => [x.tx, x.ty])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    const edge = tilesFor(pyr, 2, { minX: 11000, minY: 8500, maxX: 12000, maxY: 9000 });
    const last = edge.at(-1)!;
    expect(last.x + last.w).toBe(12000);
    expect(last.y + last.h).toBe(9000);
    expect(TILE * 4).toBe(2048);
  });
});
