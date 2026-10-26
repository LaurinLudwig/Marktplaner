import { useEffect, useRef } from 'react';
import { PALETTE } from '../../core/objects';
import { Icon } from '../icons/Icon';
import { tip } from '../shortcuts/tip';

/**
 * Farbe wählen: feste Palette (ein Klick = ein Undo-Schritt) und Farbwähler des Systems. Der
 * Farbwähler übernimmt erst beim Schließen (natives `change`), damit es ein Undo-Schritt bleibt.
 */
export function ColorField({
  id,
  label,
  value,
  onCommit,
  onReset,
  resetLabel,
  canReset,
}: {
  id: string;
  label: string;
  value: string | null;
  onCommit: (color: string) => void;
  onReset?: () => void;
  resetLabel?: string;
  /** Zurücksetzen möglich (Standard: es ist eine Farbe gesetzt). */
  canReset?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="swatches" role="group" aria-label={label}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${value?.toLowerCase() === c ? ' on' : ''}`}
            style={{ background: c }}
            aria-pressed={value?.toLowerCase() === c}
            onClick={() => onCommit(c)}
            {...tip({ label: `Farbe ${c}`, side: 'top' })}
          />
        ))}
        <NativeColor id={id} value={value ?? '#a7adb3'} onCommit={onCommit} label={`${label}: eigene Farbe wählen`} />
        {onReset && (
          <button type="button" className="icon-btn" disabled={!(canReset ?? value !== null)} onClick={onReset} {...tip({ label: resetLabel ?? 'Zurücksetzen', side: 'top' })}>
            <Icon name="colorReset" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Systemfarbwähler, der nur beim Bestätigen (Schließen) übernimmt. */
export function NativeColor({ id, value, onCommit, label }: { id: string; value: string; onCommit: (c: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(onCommit);
  useEffect(() => {
    cb.current = onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = value;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => cb.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return <input ref={ref} id={id} type="color" className="color-input" defaultValue={value} {...tip({ label, side: 'top' })} />;
}
