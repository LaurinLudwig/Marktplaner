import { useEffect, useRef, useState } from 'react';
import { useDialogs } from '../../app/dialogs';
import { openRecent } from '../../app/fileActions';
import { runCommand } from '../../app/commands';
import { APP_NAME, APP_VERSION } from '../../core/appInfo';
import { folderOf } from '../../core/recentFiles';
import { useRecent } from '../../state/recent';
import { useStore } from '../../state/store';
import { keyLabel } from '../shortcuts/tip';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Startbildschirm (#11, spec.md Bedienung): „Neues Projekt“, „Öffnen …“ und „Zuletzt geöffnet“. Erscheint beim Start
 * der Desktop-App ohne Projekt; Pfeiltasten wählen, Enter öffnet, Esc schließt (das leere Projekt bleibt).
 */
export function StartScreen() {
  const open = useStore((s) => s.ui.startScreen);
  // Bei jedem Öffnen neu eingehängt: Auswahl beginnt oben
  return open ? <StartScreenBody /> : null;
}

function StartScreenBody() {
  const setUi = useStore((s) => s.setUi);
  const files = useRecent((s) => s.files);
  const missing = useRecent((s) => s.missing);
  const [sel, setSelState] = useState(0);
  const selRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const setSel = (i: number) => {
    selRef.current = i;
    setSelState(i);
  };

  useEffect(() => listRef.current?.focus(), []);

  useEffect(() => {
    // Vor dem globalen Handler: Pfeile, Enter und Esc gehören dem Startbildschirm, außer eine Meldung liegt darüber
    const onKey = (e: KeyboardEvent) => {
      if (useDialogs.getState().queue.length) return;
      const n = useRecent.getState().files.length;
      const move = (i: number) => {
        selRef.current = i;
        setSelState(i);
      };
      if (e.key === 'Escape') setUi({ startScreen: false });
      else if (e.key === 'ArrowDown' && n) move(Math.min(n - 1, selRef.current + 1));
      else if (e.key === 'ArrowUp' && n) move(Math.max(0, selRef.current - 1));
      else if (e.key === 'Enter' && n && !(e.target instanceof HTMLButtonElement)) {
        const f = useRecent.getState().files[selRef.current];
        if (f) void openRecent(f.path);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setUi, setSelState, selRef]);

  return (
    <div className="start-screen" role="dialog" aria-modal="true" aria-label="Startbildschirm">
      <div className="start-card">
        <section className="start-intro">
          <img src="/favicon.svg" alt="" width="96" height="96" />
          <h1>{APP_NAME}</h1>
          <p className="start-version">Version {APP_VERSION}</p>
          <div className="start-actions">
            <button type="button" className="btn primary wide" onClick={() => runCommand('file.new')}>
              Neues Projekt {keyLabel('file.new') && <kbd>{keyLabel('file.new')}</kbd>}
            </button>
            <button type="button" className="btn wide" onClick={() => runCommand('file.open')}>
              Öffnen … {keyLabel('file.open') && <kbd>{keyLabel('file.open')}</kbd>}
            </button>
          </div>
        </section>
        <section className="start-recent" aria-labelledby="start-recent-head">
          <h2 id="start-recent-head">Zuletzt geöffnet</h2>
          {files.length === 0 ? (
            <p className="start-empty">Noch keine Projekte geöffnet. Mit „Öffnen …“ ein Projekt wählen; es erscheint danach hier.</p>
          ) : (
            <div className="start-list" role="listbox" aria-label="Zuletzt geöffnete Projekte" tabIndex={0} ref={listRef}>
              {files.map((f, i) => {
                const gone = missing.has(f.path);
                return (
                  <div
                    key={f.path}
                    role="option"
                    aria-selected={i === sel}
                    data-testid="recent-item"
                    className={`start-item${i === sel ? ' sel' : ''}${gone ? ' gone' : ''}`}
                    onPointerEnter={() => setSel(i)}
                    onClick={() => void openRecent(f.path)}
                  >
                    <strong>{f.name}</strong>
                    <span className="start-folder">{gone ? 'Datei nicht gefunden' : folderOf(f.path)}</span>
                    <span className="start-date">{when(f.openedAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
