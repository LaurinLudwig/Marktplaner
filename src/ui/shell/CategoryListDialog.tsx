import { useEffect, useRef, useState } from 'react';
import { lastNewProjectList, useCategoryListDialog, type ListDialogMode } from '../../app/categoryLists';
import { BUILTIN_CATEGORY_LISTS, EMPTY_LIST_ID, type ApplyMode } from '../../core/categoryLists';
import { useCategoryLists } from '../../state/categoryLists';

const APPLY_MODES: { id: ApplyMode; label: string; desc: string }[] = [
  { id: 'merge', label: 'Ergänzen', desc: 'nur fehlende Namen hinzufügen' },
  { id: 'replace', label: 'Ersetzen', desc: 'danach gilt genau diese Liste; gleichnamige Kategorien bleiben an ihren Geschäften' },
];

/** Auswahl einer Kategorieliste (#1, eigene Listen #2): beim neuen Projekt und über „Liste laden …“. Enter übernimmt, Esc bricht ab. */
export function CategoryListDialog() {
  const req = useCategoryListDialog((s) => s.request);
  // Bei jedem Öffnen neu eingehängt: Vorauswahl gilt neu
  return req ? <ListDialogBody key={req.mode} mode={req.mode} resolve={req.resolve} /> : null;
}

function ListDialogBody({ mode, resolve }: { mode: ListDialogMode; resolve: (c: { listId: string; apply: ApplyMode } | null) => void }) {
  const own = useCategoryLists((s) => s.lists);
  const lists = [...BUILTIN_CATEGORY_LISTS, ...own];
  const [listId, setListId] = useState(() => (mode === 'new' ? lastNewProjectList() : (lists[0]?.id ?? EMPTY_LIST_ID)));
  const [apply, setApply] = useState<ApplyMode>('merge');
  const okRef = useRef<HTMLButtonElement>(null);
  const list = lists.find((l) => l.id === listId) ?? null;

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      resolve(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [resolve]);

  const title = mode === 'new' ? 'Neues Projekt' : 'Kategorieliste laden';
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && resolve(null)}>
      <form
        className="dialog cat-list-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cl-title"
        onSubmit={(e) => {
          e.preventDefault();
          resolve({ listId, apply });
        }}
      >
        <h2 id="cl-title">{title}</h2>
        <div className="cl-body">
          <div className="field">
            <label htmlFor="cl-list">Kategorieliste</label>
            <select id="cl-list" value={listId} onChange={(e) => setListId(e.target.value)}>
              <optgroup label="Mitgeliefert">
                {BUILTIN_CATEGORY_LISTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.entries.length})
                  </option>
                ))}
              </optgroup>
              {own.length > 0 && (
                <optgroup label="Eigene Listen">
                  {own.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.entries.length})
                    </option>
                  ))}
                </optgroup>
              )}
              {mode === 'new' && <option value={EMPTY_LIST_ID}>leer (keine Kategorien)</option>}
            </select>
          </div>
          {mode === 'load' && (
            <div className="cl-modes" role="radiogroup" aria-label="Laden">
              {APPLY_MODES.map((m) => (
                <label key={m.id} className="check">
                  <input type="radio" name="cl-apply" checked={apply === m.id} onChange={() => setApply(m.id)} />
                  <span>
                    {m.label}
                    <span className="hint"> · {m.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <ul className="cl-preview" aria-label="Kategorien der Liste">
            {list ? (
              list.entries.map((e) => (
                <li key={e.name}>
                  <span className="cl-swatch" style={{ background: e.color }} />
                  {e.name}
                </li>
              ))
            ) : (
              <li className="hint">Das Projekt startet ohne Kategorien; sie lassen sich später anlegen oder laden.</li>
            )}
          </ul>
        </div>
        <div className="buttons">
          <button type="button" className="btn" onClick={() => resolve(null)}>
            Abbrechen
          </button>
          <button type="submit" className="btn primary" ref={okRef}>
            {mode === 'new' ? 'Anlegen' : 'Laden'}
          </button>
        </div>
      </form>
    </div>
  );
}
