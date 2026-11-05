import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon';

/** Knopf mit aufklappendem Bereich (Filter, Spalten); schließt bei Klick daneben und mit Esc. */
export function Popover({ label, active, children, testId }: { label: ReactNode; active?: boolean; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Bricht die Werkzeugleiste um, steht ein rechts ausgerichteter Bereich (z. B. „Spalten“) plötzlich links und
  // ragte aus dem Fenster: dann zur anderen Seite ausrichten (umgekehrt ebenso).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!open || !el) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.left < 0) Object.assign(el.style, { left: '0', right: 'auto' });
    else if (r.right > vw) Object.assign(el.style, { left: 'auto', right: '0' });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className="popover" ref={ref}>
      <button type="button" className={`btn filter-btn${active ? ' active' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)} data-testid={testId}>
        {label} <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="popover-body" ref={bodyRef}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Mehrfachauswahl als Filter: null = alle. Ein Haken weg → nur noch die übrigen; alle wieder an → null.
 */
export function MultiFilter<T extends string | null>({
  title,
  options,
  value,
  onChange,
  testId,
}: {
  title: string;
  options: { value: T; label: string }[];
  value: T[] | null;
  onChange: (v: T[] | null) => void;
  testId?: string;
}) {
  const on = (v: T) => value === null || value.includes(v);
  const toggle = (v: T, checked: boolean) => {
    const cur = value ?? options.map((o) => o.value);
    const next = checked ? [...cur, v] : cur.filter((x) => x !== v);
    onChange(next.length === options.length ? null : next);
  };
  const summary = value === null ? 'alle' : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? '1') : `${value.length} von ${options.length}`;
  return (
    <Popover
      testId={testId}
      active={value !== null}
      label={
        <>
          {title}: <b>{summary}</b>
        </>
      }
    >
      <div className="popover-list" role="group" aria-label={title}>
        <label className="check">
          <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : [])} />
          alle
        </label>
        {options.map((o) => (
          <label key={o.value ?? '∅'} className="check">
            <input type="checkbox" checked={on(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
            {o.label}
          </label>
        ))}
      </div>
    </Popover>
  );
}
