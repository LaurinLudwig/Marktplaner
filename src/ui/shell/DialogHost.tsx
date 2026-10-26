import { useEffect, useRef } from 'react';
import { useDialogs } from '../../app/dialogs';

/** Zeigt den vordersten Dialog der Warteschlange. Enter = Hauptaktion, Esc = Abbrechen. */
export function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        req.resolve(req.cancelId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;
  const primary = req.buttons.find((b) => b.variant === 'primary') ?? req.buttons.at(-1);
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && req.resolve(req.cancelId)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title">{req.title}</h2>
        <p id="dlg-msg">{req.message}</p>
        <div className="buttons">
          {req.buttons.map((b) => (
            <button
              key={b.id}
              ref={b === primary ? primaryRef : undefined}
              type="button"
              className={`btn${b.variant && b.variant !== 'default' ? ` ${b.variant}` : ''}`}
              onClick={() => req.resolve(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
