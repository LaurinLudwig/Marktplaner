import { expect, it } from 'vitest';
import type { Category, Stand } from './model/types';
import { createStand } from './objects';
import { distanceConflicts } from './warnings';

/**
 * #3 Lasttest (npm run test:perf, seriell): Die Abstandsprüfung läuft beim Ziehen bei jeder Mausbewegung neu.
 * Ungünstigster Fall: 500 Stände einer Kategorie mit 50 m Mindestabstand in einem engen Raster, fast alle Paare zu
 * nah. Gewertet wird der schnellste von mehreren Durchläufen; höchstens 100 ms (≈ 10 Aktualisierungen pro Sekunde).
 */

const suess: Category = { id: 'suess', name: 'Süßwaren', color: '#aabbcc', minDistance: 50 };

it('500 Stände einer Kategorie mit 50 m Mindestabstand schnell genug fürs Ziehen', () => {
  const stands: Stand[] = Array.from({ length: 500 }, (_, i) => ({
    ...createStand({ cx: (i % 25) * 6, cy: Math.floor(i / 25) * 8, w: 4, d: 3, rot: 0 }, { categoryId: 'suess' }),
    id: `s${i}`,
  }));
  let best = Infinity;
  for (let k = 0; k < 7; k++) {
    const t = performance.now();
    distanceConflicts([...stands], [suess]);
    best = Math.min(best, performance.now() - t);
  }
  expect(best).toBeLessThan(100);
});
