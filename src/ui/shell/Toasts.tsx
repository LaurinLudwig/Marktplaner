import { dismiss, useToasts } from '../../app/notify';

/** Hinweise unten mittig über der Statusleiste; manche mit Knopf (z. B. „Rückgängig“). */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => t.kind !== 'busy' && dismiss(t.id)}>
          {t.kind === 'busy' && <span className="spinner" aria-hidden="true" />}
          {t.text}
          {t.action && (
            <button
              type="button"
              className="link-btn toast-action"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
