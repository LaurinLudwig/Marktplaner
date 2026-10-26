import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { exportCurrentList, STAND_COLUMN_ORDER } from '../../app/exportCsv';
import { jumpToStand } from '../../app/jump';
import { connectionText, displayedStandRows } from '../../app/startPageData';
import { fmt, fmtInput, parseNum } from '../../core/format';
import { CONNECTION_LABEL } from '../../core/label';
import type { Connection, Stand } from '../../core/model/types';
import { LIMITS } from '../../core/objects';
import { CONNECTION_KEYS, type ConnectionKey } from '../../core/power';
import { isFilterActive, sumRows, toggleSort, EMPTY_STAND_FILTER, type StandRow, type StandSortColumn } from '../../core/standTable';
import { setNrLocked } from '../../state/numbering';
import { setRectField, updateStands } from '../../state/objects';
import { HIDEABLE_COLUMNS, useStartPage, type ActiveCell, type StandColumn } from '../../state/startPage';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { keyLabel, tip } from '../shortcuts/tip';
import { MultiFilter, Popover } from './Popover';
import { ROW_H, scrollRowIntoView, useVirtualRows } from './useVirtualRows';

/**
 * Geschäftstabelle der Start-Page (M6-03, M6-04, M6-08, spec.md §7): alle Stände aller Festplätze, sortier- und
 * filterbar, direkt editierbar mit den Regeln der Seitenleiste (dieselben State-Funktionen), virtualisiert.
 *
 * Tastatur (Grid): Die Tabelle ist ein einziges fokussierbares Element mit aktiver Zelle. Sie verarbeitet ihre
 * Tasten selbst und ruft dafür preventDefault auf; der globale Handler (app/keyboard.ts) lässt solche Tasten aus.
 * Undo/Redo und Speichern bleiben global.
 */

type Col = StandColumn | 'jump';
type EditKind = 'text' | 'num' | 'select';

interface ColDef {
  id: Col;
  label: string;
  width: number;
  num?: boolean;
  edit?: EditKind;
  sort?: StandSortColumn;
}

const COLS: Record<Col, ColDef> = {
  jump: { id: 'jump', label: '', width: 30 },
  page: { id: 'page', label: 'Festplatz', width: 120, sort: 'page' },
  nr: { id: 'nr', label: 'Nr', width: 92, edit: 'text', sort: 'nr' },
  name: { id: 'name', label: 'Name', width: 180, edit: 'text', sort: 'name' },
  owner: { id: 'owner', label: 'Eigentümer', width: 150, edit: 'text', sort: 'owner' },
  ware: { id: 'ware', label: 'Ware', width: 150, edit: 'text', sort: 'ware' },
  category: { id: 'category', label: 'Kategorie', width: 120, edit: 'select', sort: 'category' },
  w: { id: 'w', label: 'B (m)', width: 66, num: true, edit: 'num', sort: 'w' },
  d: { id: 'd', label: 'T (m)', width: 66, num: true, edit: 'num', sort: 'd' },
  power: { id: 'power', label: 'Strom (kW)', width: 84, num: true, edit: 'num', sort: 'power' },
  connection: { id: 'connection', label: 'Anschluss', width: 92, edit: 'select', sort: 'connection' },
  warnings: { id: 'warnings', label: 'Warnungen', width: 130, sort: 'warnings' },
  note: { id: 'note', label: 'Notiz', width: 200, edit: 'text', sort: 'note' },
};

const COLUMN_LABEL: Record<StandColumn, string> = {
  page: 'Festplatz',
  nr: 'Nummer',
  name: 'Name',
  owner: 'Eigentümer',
  ware: 'Ware',
  category: 'Kategorie',
  w: 'Breite',
  d: 'Tiefe',
  power: 'Strom',
  connection: 'Anschlussart',
  warnings: 'Warnungen',
  note: 'Notiz',
};

/** Zahlenfelder wie in Seiten- und Steuerungsleiste: Grenzen und Nachkommastellen. */
const NUM: Record<'w' | 'd' | 'power', { min: number; max: number; digits: number }> = {
  w: { ...LIMITS.stand, digits: 2 },
  d: { ...LIMITS.stand, digits: 2 },
  power: { min: 0, max: 10000, digits: 2 },
};

const TEXT_FIELD: Record<'nr' | 'name' | 'owner' | 'ware' | 'note', { key: keyof Stand; label: string }> = {
  nr: { key: 'nr', label: 'Platznummer ändern' },
  name: { key: 'name', label: 'Geschäftsname ändern' },
  owner: { key: 'owner', label: 'Eigentümer ändern' },
  ware: { key: 'ware', label: 'Ware ändern' },
  note: { key: 'note', label: 'Notiz ändern' },
};

const HEAD_H = ROW_H + 2;
const cellId = (standId: string, col: Col) => `sc-${standId}-${col}`;

/** Text einer Zelle zum Bearbeiten. */
function editText(s: Stand, col: Col): string {
  switch (col) {
    case 'w':
      return fmtInput(s.w);
    case 'd':
      return fmtInput(s.d);
    case 'power':
      return fmtInput(s.powerKw);
    case 'nr':
    case 'name':
    case 'owner':
    case 'ware':
    case 'note':
      return s[col];
    default:
      return '';
  }
}

const numValid = (col: 'w' | 'd' | 'power', n: number) => Number.isFinite(n) && n >= NUM[col].min && n <= NUM[col].max;

/**
 * Übernimmt eine Zelle mit denselben Funktionen wie die Seitenleiste; ein Undo-Schritt. Liefert 'invalid' (Feld
 * bleibt offen, rot), 'rejected' (z. B. Stromlimit blockiert; Wert springt zurück) oder 'ok'.
 */
function commitCell(row: StandRow, col: Col, raw: string): 'ok' | 'invalid' | 'rejected' {
  const s = row.stand;
  if (col === 'w' || col === 'd' || col === 'power') {
    const n = parseNum(raw);
    if (!numValid(col, n)) return 'invalid';
    if (col === 'power') {
      if (n === s.powerKw) return 'ok';
      return updateStands(row.pageId, [s.id], { powerKw: n }, 'Strom ändern') ? 'ok' : 'rejected';
    }
    if (n !== s[col]) setRectField(row.pageId, [s.id], col, n);
    return 'ok';
  }
  if (col === 'nr' || col === 'name' || col === 'owner' || col === 'ware' || col === 'note') {
    const f = TEXT_FIELD[col];
    const v = col === 'nr' ? raw.trim() : raw;
    if (v !== s[f.key]) updateStands(row.pageId, [s.id], { [f.key]: v }, f.label);
    return 'ok';
  }
  return 'ok';
}

interface Editing {
  standId: string;
  col: Col;
  /** Startwert des Editors (getipptes Zeichen ersetzt den Inhalt). */
  initial: string;
}

export function StandTable() {
  const project = useStore((s) => s.project);
  const sp = useStartPage();
  const { standFilter: filter, standSort: sort, frozen, hidden, cell } = sp;
  const { all, rows, stale } = useMemo(() => displayedStandRows(project, { standFilter: filter, standSort: sort, frozen }), [project, filter, sort, frozen]);
  const sums = useMemo(() => sumRows(rows), [rows]);
  const cols = useMemo(() => (['jump', ...STAND_COLUMN_ORDER] as Col[]).filter((c) => c === 'jump' || c === 'name' || !hidden.includes(c as StandColumn)).map((c) => COLS[c]), [hidden]);
  const template = cols.map((c) => `${c.width}px`).join(' ');
  const width = cols.reduce((n, c) => n + c.width, 0);

  const gridRef = useRef<HTMLDivElement>(null);
  const { start, end, visible } = useVirtualRows(gridRef, rows.length, HEAD_H);
  const [editing, setEditing] = useState<Editing | null>(null);

  // Scrollposition über Seitenwechsel behalten
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.scrollTop = useStartPage.getState().standScroll;
    return () => useStartPage.getState().set({ standScroll: el.scrollTop });
  }, []);

  const rowIndex = cell ? rows.findIndex((r) => r.stand.id === cell.standId) : -1;
  const colIndex = cell ? cols.findIndex((c) => c.id === cell.col) : -1;
  const activeRow = rowIndex >= 0 ? rows[rowIndex]! : null;

  // Aktive Zelle sichtbar halten
  const activeCellId = activeRow && cell ? cellId(activeRow.stand.id, cell.col) : null;
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || rowIndex < 0 || !activeCellId) return;
    scrollRowIntoView(el, rowIndex, HEAD_H);
    document.getElementById(activeCellId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [rowIndex, activeCellId]);

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });
  const setCell = (c: ActiveCell | null) => sp.setCell(c);
  const moveTo = (ri: number, ci: number) => {
    if (!rows.length) return;
    const r = rows[Math.max(0, Math.min(rows.length - 1, ri))]!;
    const c = cols[Math.max(0, Math.min(cols.length - 1, ci))]!;
    setCell({ standId: r.stand.id, col: c.id });
  };
  const freeze = () => sp.freeze(rows.map((r) => r.stand.id));

  const startEdit = (row: StandRow, col: Col, initial?: string) => {
    const def = COLS[col];
    if (!def.edit) return;
    setCell({ standId: row.stand.id, col });
    setEditing({ standId: row.stand.id, col, initial: initial ?? editText(row.stand, col) });
  };
  const endEdit = (move?: { dr: number; dc: number }) => {
    setEditing(null);
    if (move && rowIndex >= 0) {
      let ci = colIndex + move.dc;
      // Tab springt zur nächsten bearbeitbaren Zelle
      while (move.dc && ci >= 0 && ci < cols.length && !cols[ci]!.edit) ci += move.dc;
      moveTo(rowIndex + move.dr, ci < 0 || ci >= cols.length ? colIndex : ci);
    }
    focusGrid();
  };

  const clearCell = (row: StandRow, col: Col) => {
    if (col !== 'nr' && col !== 'name' && col !== 'owner' && col !== 'ware' && col !== 'note') return;
    if (!row.stand[TEXT_FIELD[col].key]) return;
    freeze();
    commitCell(row, col, '');
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const row = activeRow;
    const col = cell?.col;
    let handled = true;
    if (!row || !col) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter'].includes(e.key) && rows.length) moveTo(0, cols.findIndex((c) => c.id === 'name'));
      else handled = false;
    } else if (e.key === 'ArrowDown') moveTo(rowIndex + 1, colIndex);
    else if (e.key === 'ArrowUp') moveTo(rowIndex - 1, colIndex);
    else if (e.key === 'ArrowRight') moveTo(rowIndex, colIndex + 1);
    else if (e.key === 'ArrowLeft') moveTo(rowIndex, colIndex - 1);
    else if (e.key === 'PageDown') moveTo(rowIndex + visible, colIndex);
    else if (e.key === 'PageUp') moveTo(rowIndex - visible, colIndex);
    else if (e.key === 'Home') moveTo(mod ? 0 : rowIndex, mod ? colIndex : 0);
    else if (e.key === 'End') moveTo(mod ? rows.length - 1 : rowIndex, mod ? colIndex : cols.length - 1);
    else if (e.key === 'Enter' && mod) jumpToStand(row.pageId, row.stand.id);
    else if (e.key === 'Enter' || e.key === 'F2') {
      if (col === 'jump') jumpToStand(row.pageId, row.stand.id);
      else startEdit(row, col);
    } else if (e.key === ' ' && !mod) {
      if (col === 'nr') setNrLocked(row.pageId, [row.stand.id], !row.stand.nrLocked);
      else if (COLS[col].edit === 'select') startEdit(row, col);
      else if (col === 'jump') jumpToStand(row.pageId, row.stand.id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) clearCell(row, col);
    else if (e.key.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey)) {
      // Getipptes Zeichen beginnt die Bearbeitung und ersetzt den Inhalt (wie in Excel); in nicht bearbeitbaren
      // Zellen wird es verschluckt, damit keine Kurzbefehle der Zeichenfläche greifen
      const kind = COLS[col].edit;
      if (kind === 'text' || kind === 'num') startEdit(row, col, e.key);
    } else handled = false;
    if (handled) e.preventDefault();
  };

  const onHeadClick = (c: ColDef, add: boolean) => c.sort && sp.setStandSort(toggleSort(sort, c.sort, add));

  return (
    <div className="sp-list" data-testid="stand-table">
      <StandToolbar total={all.length} shown={rows.length} stale={stale} />
      <div
        ref={gridRef}
        className="vt"
        role="grid"
        tabIndex={0}
        aria-label="Geschäfte"
        aria-rowcount={rows.length + 1}
        aria-colcount={cols.length}
        aria-activedescendant={activeCellId ?? undefined}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.target === e.currentTarget && !useStartPage.getState().cell && rows.length && moveTo(0, cols.findIndex((c) => c.id === 'name'))}
        data-testid="stand-grid"
      >
        <div className="vt-inner" style={{ width, height: HEAD_H + rows.length * ROW_H }}>
          <div className="vt-head" role="row" aria-rowindex={1} style={{ gridTemplateColumns: template }}>
            {cols.map((c) => {
              const k = sort.findIndex((s) => s.col === c.sort);
              const dir = k >= 0 ? sort[k]!.dir : null;
              return (
                <div
                  key={c.id}
                  role="columnheader"
                  aria-sort={k === 0 ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`vt-th${c.num ? ' num' : ''}${c.sort ? ' sortable' : ''}`}
                  onClick={(e) => onHeadClick(c, e.shiftKey)}
                  title={c.sort ? 'Klick sortiert, erneuter Klick kehrt um; Shift+Klick: weitere Sortierstufe' : undefined}
                >
                  {c.id === 'jump' ? <Icon name="jump" size={14} /> : c.label}
                  {dir && <Icon name={dir === 'asc' ? 'sortUp' : 'sortDown'} size={12} />}
                  {dir && sort.length > 1 && <sup>{k + 1}</sup>}
                </div>
              );
            })}
          </div>
          {rows.slice(start, end).map((r, i) => (
            <Row
              key={r.stand.id}
              row={r}
              index={start + i}
              cols={cols}
              template={template}
              cell={cell?.standId === r.stand.id ? cell.col : null}
              editing={editing?.standId === r.stand.id ? editing : null}
              onCell={(col) => {
                setCell({ standId: r.stand.id, col });
                focusGrid();
              }}
              onEdit={(col) => startEdit(r, col)}
              onEndEdit={endEdit}
              onCommitted={freeze}
            />
          ))}
          {!rows.length && <div className="vt-empty">{all.length ? 'Kein Geschäft passt zu Suche und Filter.' : 'Noch keine Geschäfte. Sie entstehen auf den Festplatz-Pages mit dem Geschäfts-Werkzeug.'}</div>}
        </div>
      </div>
      <div className="sp-sums" data-testid="stand-sums">
        <span>
          Σ <b>{fmt(sums.count, 0)}</b> {sums.count === 1 ? 'Geschäft' : 'Geschäfte'}
        </span>
        <span>
          <b>{fmt(sums.frontM)}</b> m Frontmeter
        </span>
        <span>
          <b>{fmt(sums.powerKw)}</b> kW
        </span>
        {CONNECTION_KEYS.filter((k) => sums.byConnection[k]).map((k) => (
          <span key={k}>
            {k === 'none' ? 'ohne Anschluss' : CONNECTION_LABEL[k]}: <b>{sums.byConnection[k]}</b>
          </span>
        ))}
        <div className="spacer" />
        <span className="hint">Enter bearbeitet · Leertaste fixiert die Nummer · Cmd/Strg+Enter springt zum Stand</span>
      </div>
    </div>
  );
}

function Row({
  row,
  index,
  cols,
  template,
  cell,
  editing,
  onCell,
  onEdit,
  onEndEdit,
  onCommitted,
}: {
  row: StandRow;
  index: number;
  cols: ColDef[];
  template: string;
  cell: Col | null;
  editing: Editing | null;
  onCell: (col: Col) => void;
  onEdit: (col: Col) => void;
  onEndEdit: (move?: { dr: number; dc: number }) => void;
  onCommitted: () => void;
}) {
  const s = row.stand;
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      className={`vt-row${index % 2 ? ' odd' : ''}${cell ? ' current' : ''}`}
      style={{ top: HEAD_H + index * ROW_H, gridTemplateColumns: template }}
      data-testid="stand-row"
      data-stand-id={s.id}
    >
      {cols.map((c) => (
        <div
          key={c.id}
          id={cellId(s.id, c.id)}
          role="gridcell"
          aria-readonly={!c.edit}
          className={`vt-td${c.num ? ' num' : ''}${cell === c.id ? ' active' : ''}${c.edit ? ' editable' : ''}`}
          data-col={c.id}
          onMouseDown={(e) => {
            if (editing?.col === c.id) return;
            if (e.button === 0 && !(e.target as HTMLElement).closest('button')) {
              e.preventDefault();
              onCell(c.id);
            }
          }}
          onDoubleClick={() => c.edit && onEdit(c.id)}
        >
          {editing?.col === c.id ? <CellEditor row={row} col={c} editing={editing} onEnd={onEndEdit} onCommitted={onCommitted} /> : <CellView row={row} col={c.id} />}
        </div>
      ))}
    </div>
  );
}

function CellView({ row, col }: { row: StandRow; col: Col }) {
  const s = row.stand;
  switch (col) {
    case 'jump':
      return (
        <button type="button" className="icon-btn jump-btn" tabIndex={-1} onClick={() => jumpToStand(row.pageId, s.id)} {...tip({ label: 'Zum Stand springen', desc: 'Wechselt auf den Festplatz, zoomt hin und wählt ihn aus', shortcut: undefined, side: 'right' })}>
          <Icon name="jump" size={14} />
        </button>
      );
    case 'page':
      return <span className="muted">{row.pageName}</span>;
    case 'nr':
      return (
        <>
          <span className="grow">{s.nr}</span>
          <button
            type="button"
            className={`icon-btn mini nr-lock${s.nrLocked ? ' on' : ''}`}
            tabIndex={-1}
            aria-pressed={s.nrLocked}
            onClick={() => setNrLocked(row.pageId, [s.id], !s.nrLocked)}
            {...tip({ label: s.nrLocked ? 'Fixierung lösen' : 'Nummer fixieren', desc: 'Leertaste in der Zelle', side: 'top' })}
          >
            <Icon name={s.nrLocked ? 'lock' : 'unlock'} size={12} />
          </button>
        </>
      );
    case 'name':
    case 'owner':
    case 'ware':
    case 'note':
      return <span title={s[col].length > 24 ? s[col] : undefined}>{s[col].replace(/\n/g, ' ')}</span>;
    case 'category':
      return <span className={row.categoryName ? '' : 'muted'}>{row.categoryName ?? '–'}</span>;
    case 'w':
      return <>{fmt(s.w)}</>;
    case 'd':
      return <>{fmt(s.d)}</>;
    case 'power':
      return <>{s.powerKw ? fmt(s.powerKw) : ''}</>;
    case 'connection':
      return <span className={s.connection ? '' : 'muted'}>{connectionText(row) || '–'}</span>;
    case 'warnings':
      return <WarnChips row={row} />;
  }
}

function WarnChips({ row }: { row: StandRow }) {
  const pages = useStore((s) => s.project.pages);
  const w = row.warnings;
  if (!w.outside && !w.overlap && !w.duplicate) return null;
  const dupNames = row.duplicates
    .map((d) => {
      const p = pages.find((x) => x.id === d.pageId);
      const st = p?.stands.find((x) => x.id === d.standId);
      return st ? `${st.name || 'Geschäft'} (${p!.name})` : '';
    })
    .filter(Boolean)
    .join(', ');
  return (
    <span className="warn-chips" data-testid="row-warnings">
      {w.infra && <span className="chip overlap">Infrastruktur</span>}
      {w.overlap && <span className="chip overlap">Überlappung</span>}
      {w.outside && <span className="chip">außerhalb</span>}
      {w.duplicate && (
        <span className="chip" title={`Nummer ${row.stand.nr.trim()} auch bei: ${dupNames}`}>
          doppelte Nr
        </span>
      )}
    </span>
  );
}

const CONNECTIONS: (Connection | null)[] = [null, '230V', 'CEE16', 'CEE32'];

function CellEditor({ row, col, editing, onEnd, onCommitted }: { row: StandRow; col: ColDef; editing: Editing; onEnd: (move?: { dr: number; dc: number }) => void; onCommitted: () => void }) {
  const [text, setText] = useState(editing.initial);
  const [bad, setBad] = useState(false);
  const done = useRef(false);
  const categories = useStore((s) => s.project.categories);
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = (move?: { dr: number; dc: number }) => {
    if (done.current) return;
    const result = commitCell(row, col.id, text);
    if (result === 'invalid') {
      setBad(true);
      return;
    }
    done.current = true;
    if (result === 'ok' && text !== editText(row.stand, col.id)) onCommitted();
    onEnd(move);
  };
  const cancel = () => {
    done.current = true;
    onEnd();
  };

  if (col.edit === 'select') {
    const isCat = col.id === 'category';
    const value = isCat ? (row.stand.categoryId ?? '') : (row.stand.connection ?? '');
    return (
      <select
        ref={ref}
        className="cell-editor"
        aria-label={col.label}
        defaultValue={value}
        onChange={(e) => {
          done.current = true;
          const v = e.target.value || null;
          onCommitted();
          if (isCat) updateStands(row.pageId, [row.stand.id], { categoryId: v }, 'Kategorie zuordnen');
          else updateStands(row.pageId, [row.stand.id], { connection: v as Connection | null }, 'Anschlussart ändern');
          onEnd();
        }}
        onBlur={() => !done.current && cancel()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            done.current = true;
            onEnd(e.key === 'Tab' ? { dr: 0, dc: e.shiftKey ? -1 : 1 } : undefined);
          }
        }}
      >
        {isCat ? (
          <>
            <option value="">keine Kategorie</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </>
        ) : (
          CONNECTIONS.map((c) => (
            <option key={c ?? ''} value={c ?? ''}>
              {c ? CONNECTION_LABEL[c] : 'keine Angabe'}
            </option>
          ))
        )}
      </select>
    );
  }

  const numCol = col.id === 'w' || col.id === 'd' || col.id === 'power' ? col.id : null;
  return (
    <input
      ref={ref}
      className={`cell-editor${col.num ? ' num' : ''}${bad ? ' bad' : ''}`}
      aria-label={col.label}
      aria-invalid={bad}
      value={text}
      spellCheck={false}
      autoComplete="off"
      inputMode={numCol ? 'decimal' : undefined}
      onChange={(e) => {
        setText(e.target.value);
        setBad(!!numCol && !numValid(numCol, parseNum(e.target.value)));
      }}
      onBlur={() => {
        if (done.current) return;
        // Klick daneben: gültige Eingabe übernehmen, ungültige verwerfen
        if (numCol && !numValid(numCol, parseNum(text))) cancel();
        else finish();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finish({ dr: 1, dc: 0 });
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          finish({ dr: 0, dc: e.shiftKey ? -1 : 1 });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    />
  );
}

// ---------- Werkzeugleiste: Suche, Filter, Spalten, Export ----------

function StandToolbar({ total, shown, stale }: { total: number; shown: number; stale: boolean }) {
  const sp = useStartPage();
  const pages = useStore((s) => s.project.pages);
  const categories = useStore((s) => s.project.categories);
  const f = sp.standFilter;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sp.focusSearch) searchRef.current?.select();
  }, [sp.focusSearch]);
  const connOptions: { value: ConnectionKey; label: string }[] = CONNECTION_KEYS.map((k) => ({ value: k, label: k === 'none' ? 'ohne Angabe' : CONNECTION_LABEL[k] }));
  return (
    <div className="sp-toolbar">
      <label className="search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          id="sp-search"
          type="search"
          placeholder="Name, Eigentümer, Ware …"
          aria-label="Geschäfte suchen"
          value={f.search}
          onChange={(e) => sp.setStandFilter({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && f.search) {
              e.preventDefault();
              sp.setStandFilter({ search: '' });
            } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault();
              document.querySelector<HTMLElement>('[data-testid="stand-grid"]')?.focus();
            }
          }}
          title={`Suche (${keyLabel('start.search')})`}
        />
      </label>
      <MultiFilter testId="filter-page" title="Festplatz" options={pages.map((p) => ({ value: p.id, label: p.name }))} value={f.pages} onChange={(v) => sp.setStandFilter({ pages: v })} />
      <MultiFilter
        testId="filter-category"
        title="Kategorie"
        options={[...categories.map((c) => ({ value: c.id as string | null, label: c.name })), { value: null, label: 'ohne Kategorie' }]}
        value={f.categories}
        onChange={(v) => sp.setStandFilter({ categories: v })}
      />
      <MultiFilter testId="filter-connection" title="Anschluss" options={connOptions} value={f.connections} onChange={(connections) => sp.setStandFilter({ connections })} />
      <label className="check">
        <input type="checkbox" checked={f.withWarning} onChange={(e) => sp.setStandFilter({ withWarning: e.target.checked })} />
        mit Warnung
      </label>
      <label className="check">
        <input type="checkbox" checked={f.withoutNr} onChange={(e) => sp.setStandFilter({ withoutNr: e.target.checked })} />
        ohne Nummer
      </label>
      <span className="hint" data-testid="stand-count">
        {shown === total ? `${total} ${total === 1 ? 'Geschäft' : 'Geschäfte'}` : `${shown} von ${total} Geschäften`}
      </span>
      {isFilterActive(f) && (
        <button type="button" className="link-btn" onClick={() => sp.setStandFilter(EMPTY_STAND_FILTER)}>
          Filter zurücksetzen
        </button>
      )}
      {stale && (
        <button type="button" className="btn stale" onClick={() => sp.unfreeze()} data-testid="resort" {...tip({ label: 'Neu sortieren', desc: 'Nach der Änderung steht die Reihenfolge still, damit die Zeile nicht wegspringt.', ariaLabel: false })}>
          <Icon name="refresh" size={14} /> Sortierung veraltet
        </button>
      )}
      <div className="spacer" />
      <Popover testId="columns" label={<><Icon name="columns" size={14} /> Spalten</>}>
        <div className="popover-list" role="group" aria-label="Spalten">
          {HIDEABLE_COLUMNS.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={!sp.hidden.includes(c)} onChange={(e) => sp.setHidden(c, !e.target.checked)} />
              {COLUMN_LABEL[c]}
            </label>
          ))}
          <p className="hint">Gilt auf diesem Rechner. Name ist immer sichtbar.</p>
        </div>
      </Popover>
      <button type="button" className="btn" onClick={() => void exportCurrentList()} {...tip({ shortcut: 'start.exportCsv', desc: 'Angezeigte Zeilen und Spalten, für Excel', ariaLabel: false })}>
        <Icon name="download" size={14} /> CSV
      </button>
    </div>
  );
}
