import { SHORTCUT_BY_ID } from './definitions';
import { formatCombo, IS_MAC } from './keys';

export type TipSide = 'right' | 'bottom' | 'top';

/** Angezeigte Taste eines Shortcuts, z. B. „⌘S“ oder „Strg+S“. */
export function keyLabel(shortcutId: string): string | undefined {
  const def = SHORTCUT_BY_ID.get(shortcutId);
  return def?.keys[0] ? formatCombo(def.keys[0], IS_MAC) : undefined;
}

/**
 * Attribute für den globalen Tooltip (siehe TooltipHost). Name und Taste kommen aus der
 * zentralen Shortcut-Konfiguration, sofern `label` nicht angegeben ist.
 *
 * `ariaLabel` steuert den Namen für Screenreader: Standard ist der Tooltip-Name (für reine
 * Icon-Buttons nötig); ein eigener Text überschreibt ihn; `false` lässt den sichtbaren Inhalt gelten.
 */
export function tip(opts: { shortcut?: string; label?: string; desc?: string; side?: TipSide; ariaLabel?: string | false }) {
  const def = opts.shortcut ? SHORTCUT_BY_ID.get(opts.shortcut) : undefined;
  const keys = opts.shortcut ? keyLabel(opts.shortcut) : undefined;
  const label = opts.label ?? def?.label ?? '';
  return {
    'data-tip': label,
    ...(opts.ariaLabel === false ? {} : { 'aria-label': opts.ariaLabel ?? label }),
    ...(opts.desc ? { 'data-tip-desc': opts.desc } : {}),
    ...(keys ? { 'data-tip-keys': keys } : {}),
    'data-tip-side': opts.side ?? 'bottom',
  };
}
