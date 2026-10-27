import { useEffect, useRef, useState } from 'react';
import {
  closeCategoryListManager,
  deleteListInteractive,
  exportListInteractive,
  importListInteractive,
  useCategoryListManager,
} from '../../app/categoryLists';
import { notify } from '../../app/notify';
import { BUILTIN_CATEGORY_LISTS, type CategoryList } from '../../core/categoryLists';
import { renameOwnList, saveCategoriesAsList, useCategoryLists } from '../../state/categoryLists';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { TextField } from '../panels/TextField';
import { tip } from '../shortcuts/tip';

/**
 * Kategorielisten verwalten (#2): Kategorien des Projekts als eigene Liste speichern, eigene Listen umbenennen und
 * löschen, Listen als Datei exportieren und importieren. Eigene Listen gelten für diesen Rechner.
 */
export function CategoryListManager() {
  const open = useCategoryListManager((s) => s.open);
  return open ? <ManagerBody /> : null;
}

function ManagerBody() {
  const own = useCategoryLists((s) => s.lists);
  const error = useCategoryLists((s) => s.error);
  const categories = useStore((s) => s.project.categories);
  const projectName = useStore((s) => s.project.name);
  const [name, setName] = useState(projectName);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      // Esc in einem Namensfeld verwirft nur die Eingabe
      if (e.key !== 'Escape' || (e.target instanceof HTMLInputElement && e.target.closest('.clm-list'))) return;
      e.preventDefault();
      e.stopPropagation();
      closeCategoryListManager();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const save = () => {
    if (!categories.length) return;
    const added = saveCategoriesAsList(name, categories);
    notify(`Kategorieliste „${added.name}“ gespeichert.`, 'success');
  };

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeCategoryListManager()}>
      <div className="dialog cat-list-manager" role="dialog" aria-modal="true" aria-labelledby="clm-title">
        <h2 id="clm-title">Kategorielisten</h2>
        <form
          className="clm-save"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="field grow">
            <label htmlFor="clm-name">Kategorien dieses Projekts als Liste speichern</label>
            <input id="clm-name" ref={nameRef} className="clm-input" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" />
          </div>
          <button type="submit" className="btn primary" disabled={!categories.length}>
            Speichern
          </button>
        </form>
        {!categories.length && <p className="hint">Das Projekt hat noch keine Kategorien.</p>}
        {error && (
          <p className="warn-chip" role="alert">
            {error}
          </p>
        )}
        <div className="clm-list" role="list" aria-label="Kategorielisten">
          {BUILTIN_CATEGORY_LISTS.map((l) => (
            <ListRow key={l.id} list={l} />
          ))}
          {own.map((l) => (
            <ListRow key={l.id} list={l} />
          ))}
        </div>
        <p className="hint">Eigene Listen gelten für diesen Rechner. Zum Weitergeben exportieren; die Datei lässt sich auf einem anderen Rechner importieren.</p>
        <div className="buttons">
          <button type="button" className="btn" onClick={() => void importListInteractive()}>
            Importieren …
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={closeCategoryListManager}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function ListRow({ list }: { list: CategoryList }) {
  const n = list.entries.length;
  return (
    <div className="clm-row" role="listitem" aria-label={list.name} data-testid="category-list-row">
      {list.builtin ? (
        <span className="clm-name">
          {list.name} <span className="hint">mitgeliefert</span>
        </span>
      ) : (
        <TextField id={`clm-${list.id}`} className="grow" label="Name" value={list.name} onCommit={(name) => renameOwnList(list.id, name)} />
      )}
      <span className="clm-count">
        {n} {n === 1 ? 'Kategorie' : 'Kategorien'}
      </span>
      <button type="button" className="icon-btn" onClick={() => void exportListInteractive(list)} {...tip({ label: `„${list.name}“ exportieren …`, side: 'top' })}>
        <Icon name="download" size={16} />
      </button>
      {!list.builtin && (
        <button type="button" className="icon-btn" onClick={() => void deleteListInteractive(list)} {...tip({ label: `„${list.name}“ löschen`, side: 'top' })}>
          <Icon name="delete" size={16} />
        </button>
      )}
    </div>
  );
}
