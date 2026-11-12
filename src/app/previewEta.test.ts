import { describe, expect, it } from 'vitest';
import { lastDuration, rememberDuration, remainingSeconds } from './previewEta';

describe('remainingSeconds (#33)', () => {
  it('zählt von der Dauer der letzten Vorschau herunter', () => {
    expect(remainingSeconds(0, 0, 15_000)).toBe(15);
    expect(remainingSeconds(4_200, 0.4, 15_000)).toBe(11);
  });

  it('unter 2 s keine Zeit', () => {
    expect(remainingSeconds(13_500, 0.9, 15_000)).toBeNull();
    expect(remainingSeconds(0, 0, 1_400)).toBeNull();
  });

  it('länger als beim letzten Mal: aus dem Fortschritt hochrechnen', () => {
    expect(remainingSeconds(16_000, 0.5, 15_000)).toBe(16);
  });

  it('ohne Vorgänger: hochrechnen erst ab 5 % Fortschritt und 0,5 s Laufzeit', () => {
    expect(remainingSeconds(3_000, 0.25, null)).toBe(9);
    expect(remainingSeconds(3_000, 0.01, null)).toBeNull();
    expect(remainingSeconds(300, 0.4, null)).toBeNull();
    expect(remainingSeconds(3_000, 1, null)).toBeNull();
  });

  it('merkt sich die Dauer je Seite, sonst die letzte überhaupt', () => {
    rememberDuration('a', 12_000);
    rememberDuration('b', 3_000);
    expect(lastDuration('a')).toBe(12_000);
    expect(lastDuration('c')).toBe(3_000);
  });
});
