import { useRef, useState } from 'react';
import { fmtInput, parseNum } from '../../core/format';

interface Props {
  id: string;
  label: string;
  /** null = unterschiedliche Werte (Mehrfachauswahl): das Feld bleibt leer, eine Eingabe gilt für alle. */
  value: number | null;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  /**
   * Wird erst bei Enter, Verlassen des Feldes oder Pfeiltasten aufgerufen (ein Undo-Schritt pro Eingabe).
   * Liefert die Funktion false, wurde der Wert abgewiesen; das Feld zeigt wieder den bisherigen Wert.
   */
  onCommit: (value: number) => void | boolean;
  /** Erlaubt ein leeres Feld (z. B. „kein Limit“); `value` null bedeutet dann „leer“. */
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Beschriftung nur für Screenreader (z. B. in der kompakten Steuerungsleiste). */
  className?: string;
}

/** Zahlenfeld mit deutscher Eingabe (Komma), Einheit, Grenzen und Pfeiltasten (Shift = ×10). */
const show = (v: number | null, digits: number) => (v === null ? '' : fmtInput(v, digits));

export function NumberField({ id, label, value, unit, min, max, step = 1, digits = 2, onCommit, onClear, placeholder, disabled, className }: Props) {
  const [text, setText] = useState(show(value, digits));
  const [bad, setBad] = useState(false);
  const [focused, setFocused] = useState(false);
  /** Hat der Nutzer seit dem Fokussieren getippt? Nur dann übernimmt das Verlassen den Text. */
  const [edited, setEdited] = useState(false);
  const skipBlurCommit = useRef(false);

  // Geänderten Wert von außen (z. B. Undo) sofort anzeigen, außer während der Eingabe
  const [shown, setShown] = useState(value);
  if (value !== shown && !focused) {
    setShown(value);
    setText(show(value, digits));
    setBad(false);
  }

  const valid = (n: number) => Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max);
  const clearing = (t: string) => !!onClear && t.trim() === '';

  const commit = () => {
    // Fokus rein/raus ohne Eingabe ändert nie den Wert (auch nicht durch Runden der Anzeige)
    if (!edited) return;
    if (clearing(text)) {
      setEdited(false);
      setBad(false);
      if (value !== null) onClear!();
      setText('');
      return;
    }
    const n = parseNum(text);
    if (!valid(n)) {
      setBad(true);
      return;
    }
    setEdited(false);
    setBad(false);
    if (n !== value && onCommit(n) === false) {
      setText(show(value, digits));
      return;
    }
    setText(fmtInput(n, digits));
  };

  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <span className="inp">
        <input
          id={id}
          className={`num${bad ? ' bad' : ''}`}
          value={text}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={bad}
          placeholder={placeholder}
          title={value === null && !onClear ? 'Unterschiedliche Werte – eine Eingabe gilt für alle ausgewählten Objekte' : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (skipBlurCommit.current) skipBlurCommit.current = false;
            else commit();
          }}
          onChange={(e) => {
            setEdited(true);
            setText(e.target.value);
            setBad(!clearing(e.target.value) && !valid(parseNum(e.target.value)));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter selbst verbrauchen: sonst bestätigt er eine dadurch geöffnete Rückfrage gleich mit
              e.preventDefault();
              // Verlassen des Feldes übernimmt den Wert (genau ein Undo-Schritt)
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setText(show(value, digits));
              setBad(false);
              setEdited(false);
              skipBlurCommit.current = true;
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const base = Number.isFinite(parseNum(text)) ? parseNum(text) : value;
              if (base === null) return;
              let n = Math.round((base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)) * 1e6) / 1e6;
              if (min !== undefined) n = Math.max(min, n);
              if (max !== undefined) n = Math.min(max, n);
              setBad(false);
              setEdited(false);
              setText(onCommit(n) === false ? show(value, digits) : fmtInput(n, digits));
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </div>
  );
}
