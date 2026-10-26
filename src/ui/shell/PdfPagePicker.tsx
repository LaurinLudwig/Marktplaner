import { useEffect, useState } from 'react';
import { usePagePicker } from '../../app/pagePicker';

/** Seitenauswahl für mehrseitige PDFs mit Vorschaubildern. Esc oder Klick daneben bricht ab. */
export function PdfPagePicker() {
  const req = usePagePicker((s) => s.request);
  // Vorschaubilder gehören zur jeweiligen Anfrage
  const [store, setStore] = useState<{ req: typeof req; thumbs: Record<number, string> }>({ req: null, thumbs: {} });
  const thumbs = store.req === req ? store.thumbs : {};

  useEffect(() => {
    if (!req) return;
    const run = { alive: true };
    // Nacheinander rendern, damit die ersten Seiten schnell erscheinen
    void (async () => {
      for (let n = 1; n <= Math.min(req.pageCount, 60); n++) {
        if (!run.alive) return;
        try {
          const url = await req.thumbnail(n);
          if (run.alive) setStore((s) => ({ req, thumbs: { ...(s.req === req ? s.thumbs : {}), [n]: url } }));
        } catch {
          /* Vorschau ist nur Komfort */
        }
      }
    })();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        req.resolve(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      run.alive = false;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [req]);

  if (!req) return null;
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && req.resolve(null)}>
      <div className="dialog page-picker" role="dialog" aria-modal="true" aria-labelledby="pp-title">
        <h2 id="pp-title">Seite wählen</h2>
        <p>
          „{req.fileName}“ hat {req.pageCount} Seiten. Welche Seite ist der Plan? Nur diese Seite wird eingebettet.
        </p>
        <div className="page-grid">
          {Array.from({ length: req.pageCount }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className="page-thumb" onClick={() => req.resolve(n)} aria-label={`Seite ${n}`} autoFocus={n === 1}>
              <span className="thumb">{thumbs[n] ? <img src={thumbs[n]} alt="" /> : <span className="spinner" aria-hidden="true" />}</span>
              <span>Seite {n}</span>
            </button>
          ))}
        </div>
        <div className="buttons">
          <button type="button" className="btn" onClick={() => req.resolve(null)}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
