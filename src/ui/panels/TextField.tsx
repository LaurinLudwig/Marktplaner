import { useRef, useState } from 'react';

interface Props {
  id: string;
  label: string;
  /** null = unterschiedliche Werte (Mehrfachauswahl): leeres Feld, eine Eingabe gilt für alle. */
  value: string | null;
  onCommit: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
}

/**
 * Textfeld, das wie NumberField erst beim Verlassen bzw. mit Enter übernimmt: ein Undo-Schritt pro
 * Feldbearbeitung statt pro Taste. Mehrzeilig: Enter = neue Zeile, Cmd/Strg+Enter übernimmt.
 * Esc verwirft die Eingabe.
 */
export function TextField({ id, label, value, onCommit, multiline, rows = 3, placeholder, className }: Props) {
  const [text, setText] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  const skipBlurCommit = useRef(false);

  const [shown, setShown] = useState(value);
  if (value !== shown && !focused) {
    setShown(value);
    setText(value ?? '');
  }

  const commit = () => {
    if (!edited) return;
    setEdited(false);
    if (text !== value) onCommit(text);
    // Wieder den gespeicherten Wert zeigen: Übernimmt der Aufrufer die Eingabe, kommt der neue Wert
    // im selben Rendern als `value` zurück; weist er sie ab (z. B. leerer Name), steht wieder der
    // gültige Wert im Feld (QA-M3-06).
    setText(value ?? '');
  };

  const common = {
    id,
    value: text,
    placeholder,
    spellCheck: false,
    autoComplete: 'off',
    title: value === null ? 'Unterschiedliche Werte – eine Eingabe gilt für alle ausgewählten Objekte' : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (skipBlurCommit.current) skipBlurCommit.current = false;
      else commit();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setEdited(true);
      setText(e.target.value);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setText(value ?? '');
        setEdited(false);
        skipBlurCommit.current = true;
        e.currentTarget.blur();
      }
    },
  };

  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <span className="inp">{multiline ? <textarea {...common} rows={rows} /> : <input {...common} />}</span>
    </div>
  );
}
