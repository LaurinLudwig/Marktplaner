import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './definitions';
import { parseCombo } from './keys';

/**
 * AltGr-Regel (spec.md Tastaturkürzel, CONTRIBUTING.md): Unter Windows ist AltGr = Strg+Alt. Kurzbefehle mit
 * Strg+Alt (bzw. Mod+Alt, unter Windows Strg) dürfen keine Taste nutzen, die auf deutschen Tastaturen per
 * AltGr ein Zeichen erzeugt.
 */
const ALTGR_KEYS = ['q', 'e', 'm', '2', '3', '7', '8', '9', '0', 'ß', '+', '<'];

describe('Kurzbefehle', () => {
  it('keine Strg+Alt- bzw. Mod+Alt-Kombination auf Tasten mit AltGr-Zeichen (deutsche Tastatur)', () => {
    const bad = SHORTCUTS.flatMap((def) =>
      def.keys.filter((k) => {
        const c = parseCombo(k);
        return c.alt && (c.mod || c.ctrl) && ALTGR_KEYS.includes(c.key.toLowerCase());
      }).map((k) => `${def.id}: ${k}`),
    );
    expect(bad).toEqual([]);
  });

  it('jede Kombination ist nur einmal vergeben', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const def of SHORTCUTS) {
      for (const k of def.keys) {
        if (k.endsWith('Ziehen')) continue;
        const c = parseCombo(k);
        const key = `${c.mod}|${c.ctrl}|${c.shift}|${c.alt}|${c.key.toLowerCase()}`;
        if (seen.has(key)) clashes.push(`${k}: ${seen.get(key)} und ${def.id}`);
        else seen.set(key, def.id);
      }
    }
    expect(clashes).toEqual([]);
  });
});
