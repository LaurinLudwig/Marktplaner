/**
 * Tastenkombinationen als Text, z. B. "Mod+Shift+Z", "Ctrl+Tab", "Alt+1", "?", "Mod+Plus".
 * - Mod = Cmd auf macOS, Strg auf Windows.
 * - Buchstaben werden über `event.key` erkannt (QWERTZ: Z bleibt Z). Mit Alt liefert macOS
 *   Sonderzeichen, dann wird auf `event.code` zurückgegriffen.
 * - Ziffern werden über `event.code` erkannt (Digit/Numpad), unabhängig von Shift/Alt.
 * - Symbole (? + - =) ignorieren Shift, weil sie je nach Tastaturlayout Shift brauchen.
 */

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface Combo {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const ALIASES: Record<string, string> = { plus: '+', minus: '-', space: ' ', esc: 'escape', del: 'delete' };

export function parseCombo(text: string): Combo {
  const parts = text.split('+');
  // "Mod++" → letztes Element leer
  const rawKey = text.endsWith('++') ? '+' : parts.pop()!;
  const mods = new Set(parts.filter(Boolean).map((p) => p.toLowerCase()));
  const lower = rawKey.toLowerCase();
  return {
    mod: mods.has('mod'),
    ctrl: mods.has('ctrl'),
    shift: mods.has('shift'),
    alt: mods.has('alt'),
    key: ALIASES[lower] ?? lower,
  };
}

const isSymbol = (k: string) => k.length === 1 && !/[a-z0-9 ]/.test(k);

export function matches(combo: Combo, e: KeyLike, isMac: boolean): boolean {
  const wantMeta = isMac && combo.mod;
  const wantCtrl = combo.ctrl || (!isMac && combo.mod);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== combo.alt) return false;
  const k = combo.key;
  if (!isSymbol(k) && e.shiftKey !== combo.shift) return false;
  if (/^[0-9]$/.test(k)) return e.code === `Digit${k}` || e.code === `Numpad${k}`;
  if (/^[a-z]$/.test(k)) return e.altKey ? e.code === `Key${k.toUpperCase()}` : e.key.toLowerCase() === k;
  if (k === '+') return e.key === '+' || e.code === 'NumpadAdd' || (e.key === '=' && e.code === 'Equal');
  if (k === '-') return e.key === '-' || e.code === 'NumpadSubtract';
  return e.key.toLowerCase() === k;
}

const MAC_SYMBOLS = { mod: '⌘', ctrl: '⌃', shift: '⇧', alt: '⌥' };
const KEY_NAMES: Record<string, string> = {
  ' ': 'Leertaste',
  tab: 'Tab',
  escape: 'Esc',
  delete: 'Entf',
  backspace: '⌫',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  pageup: 'Bild ↑',
  pagedown: 'Bild ↓',
  enter: 'Enter',
  ziehen: 'Ziehen',
};

/** Anzeige im Tooltip: macOS „⌘⇧Z“, Windows „Strg+Umschalt+Z“. */
export function formatCombo(text: string, isMac: boolean): string {
  const c = parseCombo(text);
  const key = KEY_NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key.replace(/^f(\d+)$/, 'F$1'));
  if (isMac) {
    return (c.ctrl ? MAC_SYMBOLS.ctrl : '') + (c.alt ? MAC_SYMBOLS.alt : '') + (c.shift ? MAC_SYMBOLS.shift : '') + (c.mod ? MAC_SYMBOLS.mod : '') + key;
  }
  const mods = [c.mod || c.ctrl ? 'Strg' : '', c.shift ? 'Umschalt' : '', c.alt ? 'Alt' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
