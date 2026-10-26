import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './definitions';
import { formatCombo, matches, parseCombo, type KeyLike } from './keys';

const ev = (p: Partial<KeyLike>): KeyLike => ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...p });

describe('Shortcuts', () => {
  it('Mod ist Cmd auf macOS und Strg auf Windows', () => {
    const c = parseCombo('Mod+Z');
    expect(matches(c, ev({ key: 'z', metaKey: true }), true)).toBe(true);
    expect(matches(c, ev({ key: 'z', ctrlKey: true }), true)).toBe(false);
    expect(matches(c, ev({ key: 'z', ctrlKey: true }), false)).toBe(true);
    expect(matches(c, ev({ key: 'Z', metaKey: true, shiftKey: true }), true)).toBe(false);
  });

  it('QWERTZ: Buchstaben über key, mit Alt über code', () => {
    expect(matches(parseCombo('Z'), ev({ key: 'z', code: 'KeyY' }), true)).toBe(true);
    expect(matches(parseCombo('Mod+Alt+T'), ev({ key: '†', code: 'KeyT', metaKey: true, altKey: true }), true)).toBe(true);
  });

  it('Ziffern über code, Symbole ignorieren Shift', () => {
    expect(matches(parseCombo('Alt+1'), ev({ key: '¡', code: 'Digit1', altKey: true }), true)).toBe(true);
    expect(matches(parseCombo('?'), ev({ key: '?', shiftKey: true }), false)).toBe(true);
    expect(matches(parseCombo('Mod+Plus'), ev({ key: '+', code: 'BracketRight', metaKey: true }), true)).toBe(true);
    expect(matches(parseCombo('Mod+Plus'), ev({ key: '=', code: 'Equal', ctrlKey: true }), false)).toBe(true);
  });

  it('Anzeige je Plattform', () => {
    expect(formatCombo('Mod+Shift+Z', true)).toBe('⇧⌘Z');
    expect(formatCombo('Mod+Shift+Z', false)).toBe('Strg+Umschalt+Z');
    expect(formatCombo('Space', false)).toBe('Leertaste');
    expect(formatCombo('F2', true)).toBe('F2');
  });

  it('keine Kombination ist doppelt vergeben', () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) for (const k of s.keys) {
      const norm = JSON.stringify(parseCombo(k));
      expect(seen.get(norm), `${k} doppelt: ${s.id} / ${seen.get(norm)}`).toBeUndefined();
      seen.set(norm, s.id);
    }
  });
});
