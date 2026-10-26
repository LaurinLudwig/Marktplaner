import { describe, expect, it } from 'vitest';
import { adoptLegacyKeys } from './legacyKeys';

/** Minimaler Ersatz für localStorage (Vitest läuft ohne DOM). */
function memoryStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('Übernahme der localStorage-Schlüssel nach der Umbenennung (#10)', () => {
  it('kopiert schelmeplaner.* nach marktplaner.*, alte Einträge bleiben', () => {
    const s = memoryStorage({ 'schelmeplaner.theme': 'light', 'schelmeplaner.standColumns': '["note"]', fremd: 'x' });
    expect(adoptLegacyKeys(s)).toBe(2);
    expect(s.getItem('marktplaner.theme')).toBe('light');
    expect(s.getItem('marktplaner.standColumns')).toBe('["note"]');
    expect(s.getItem('schelmeplaner.theme')).toBe('light');
    expect(s.getItem('marktplaner.fremd')).toBeNull();
  });

  it('überschreibt vorhandene neue Schlüssel nicht und läuft beim zweiten Mal ins Leere', () => {
    const s = memoryStorage({ 'schelmeplaner.theme': 'light', 'marktplaner.theme': 'dark' });
    expect(adoptLegacyKeys(s)).toBe(0);
    expect(s.getItem('marktplaner.theme')).toBe('dark');
  });
});
