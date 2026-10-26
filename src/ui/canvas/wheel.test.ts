import { describe, expect, it } from 'vitest';
import { interpretWheel, type WheelLike } from './wheel';

const ev = (p: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...p });

describe('interpretWheel', () => {
  it('Mausrad (wheelDeltaY = Vielfaches von 120) zoomt', () => {
    const a = interpretWheel(ev({ deltaY: -100, wheelDeltaY: 120 }));
    expect(a.kind).toBe('zoom');
    expect(a.kind === 'zoom' && a.factor).toBeGreaterThan(1);
  });

  it('Mausrad im Zeilenmodus (Firefox) zoomt', () => {
    expect(interpretWheel(ev({ deltaY: 3, deltaMode: 1 })).kind).toBe('zoom');
  });

  it('Trackpad-Wischen verschiebt, auch diagonal', () => {
    // Systemrichtung: Inhalt bewegt sich gegen das Delta (wie natives Scrollen)
    expect(interpretWheel(ev({ deltaX: 4, deltaY: -7, wheelDeltaY: 21 }))).toEqual({ kind: 'pan', dx: -4, dy: 7 });
    // Einstellung „Wischrichtung umkehren“
    expect(interpretWheel(ev({ deltaX: 4, deltaY: -7, wheelDeltaY: 21 }), true)).toEqual({ kind: 'pan', dx: 4, dy: -7 });
    expect(interpretWheel(ev({ deltaY: 2.5, wheelDeltaY: -7 })).kind).toBe('pan');
  });

  it('Pinch (Strg gesetzt) zoomt, Auseinanderziehen vergrößert', () => {
    const a = interpretWheel(ev({ deltaY: -10, ctrlKey: true }));
    expect(a.kind).toBe('zoom');
    expect(a.kind === 'zoom' && a.factor).toBeCloseTo(Math.exp(0.1));
  });
});
