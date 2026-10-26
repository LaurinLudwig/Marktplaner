import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { exportCurrentList } from '../../app/exportCsv';
import { jumpToInfra } from '../../app/jump';
import { displayedInfraRows } from '../../app/startPageData';
import { fmt, fmtInput, parseNum } from '../../core/format';
import type { InfraRow, InfraSortColumn } from '../../core/infraTable';
import { CONNECTION_LABEL } from '../../core/label';
import type { Connection } from '../../core/model/types';
import { toggleSort } from '../../core/standTable';
import { updateInfra } from '../../state/objects';
import { useStartPage } from '../../state/startPage';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { InfraIconView } from '../icons/infraIcons';
import { tip } from '../shortcuts/tip';

const COLS: { id: InfraSortColumn | 'jump' | 'connection' | 'warn'; label: string; width: number; num?: boolean }[] = [
  { id: 'jump', label: '', width: 30 },
  { id: 'page', label: 'Festplatz', width: 130 },
  { id: 'type', label: 'Typ', width: 160 },
  { id: 'label', label: 'Bezeichnung', width: 170 },
  { id: 'size', label: 'Maße', width: 110, num: true },
  { id: 'power', label: 'Strom (kW)', width: 90, num: true },
  { id: 'connection', label: 'Anschluss', width: 110 },
  { id: 'warn', label: 'Warnung', width: 130 },
  { id: 'note', label: 'Notiz', width: 220 },
];
const template = COLS.map((c) => `${c.width}px`).join(' ');
const width = COLS.reduce((n, c) => n + c.width, 0);
const isSortCol = (c: string): c is InfraSortColumn => !['jump', 'connection', 'warn'].includes(c);
const CONNECTIONS: (Connection | null)[] = [null, '230V', 'CEE16', 'CEE32'];

/**
 * Infrastrukturliste der Start-Page (M7-09, spec.md §7): alle Infrastruktur-Objekte über alle Festplätze, Filter
 * nach Festplatz, Typ und „mit Warnung“, Sortierung per Spaltenkopf. Bezeichnung, Notiz und bei Rechteck-Typen Strom
 * und Anschluss sind direkt editierbar (Enter oder Verlassen übernimmt, Esc verwirft; ein Undo-Schritt je Änderung).
 */
export function InfraTable() {
  const project = useStore((s) => s.project);
  const sp = useStartPage();
  const { infraFilter: f, infraSort: sort } = sp;
  const { all, rows } = useMemo(() => displayedInfraRows(project, { infraFilter: f, infraSort: sort }), [project, f, sort]);
  const narrow = all.filter((r) => r.narrow).length;
  const active = f.pageId !== null || f.typeId !== null || f.withWarning || f.search !== '';
  return (
    <div className="sp-list" data-testid="infra-list">
      <div className="sp-toolbar">
        <label className="search">
          <Icon name="search" size={14} />
          <input type="search" placeholder="Bezeichnung, Notiz, Typ …" aria-label="Infrastruktur suchen" value={f.search} onChange={(e) => sp.setInfraFilter({ search: e.target.value })} />
        </label>
        <select aria-label="Festplatz" value={f.pageId ?? ''} onChange={(e) => sp.setInfraFilter({ pageId: e.target.value || null })} data-testid="infra-filter-page">
          <option value="">alle Festplätze</option>
          {project.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select aria-label="Typ" value={f.typeId ?? ''} onChange={(e) => sp.setInfraFilter({ typeId: e.target.value || null })} data-testid="infra-filter-type">
          <option value="">alle Typen</option>
          {project.infraTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={f.withWarning} onChange={(e) => sp.setInfraFilter({ withWarning: e.target.checked })} />
          mit Warnung{narrow ? ` (${narrow})` : ''}
        </label>
        <span className="hint" data-testid="infra-count">
          {rows.length === all.length ? `${all.length} ${all.length === 1 ? 'Objekt' : 'Objekte'}` : `${rows.length} von ${all.length} Objekten`}
        </span>
        {active && (
          <button type="button" className="link-btn" onClick={() => sp.setInfraFilter({ pageId: null, typeId: null, withWarning: false, search: '' })}>
            Filter zurücksetzen
          </button>
        )}
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => void exportCurrentList()} {...tip({ shortcut: 'start.exportCsv', desc: 'Angezeigte Zeilen, für Excel', ariaLabel: false })}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>
      <div className="vt it-table" role="grid" aria-label="Infrastruktur" aria-rowcount={rows.length + 1} data-testid="infra-grid">
        <div className="vt-inner static" style={{ width }}>
          <div className="vt-head" role="row" style={{ gridTemplateColumns: template }}>
            {COLS.map((c) => {
              const k = isSortCol(c.id) ? sort.findIndex((s) => s.col === c.id) : -1;
              const dir = k >= 0 ? sort[k]!.dir : null;
              return (
                <div key={c.id} role="columnheader" className={`vt-th${c.num ? ' num' : ''}${isSortCol(c.id) ? ' sortable' : ''}`} onClick={(e) => isSortCol(c.id) && sp.setInfraSort(toggleSort(sort, c.id, e.shiftKey))}>
                  {c.id === 'jump' ? <Icon name="jump" size={14} /> : c.label}
                  {dir && <Icon name={dir === 'asc' ? 'sortUp' : 'sortDown'} size={12} />}
                </div>
              );
            })}
          </div>
          {rows.map((r, i) => (
            <Row key={r.obj.id} row={r} odd={i % 2 === 1} />
          ))}
          {!rows.length && <div className="vt-empty static">{all.length ? 'Kein Objekt passt zum Filter.' : 'Noch keine Infrastruktur. Auf einer Festplatz-Page mit dem Werkzeug „Infrastruktur“ (I) anlegen.'}</div>}
        </div>
      </div>
      <div className="sp-sums" data-testid="infra-sums">
        <span>
          Σ <b>{rows.length}</b> {rows.length === 1 ? 'Objekt' : 'Objekte'}
        </span>
        <span>
          <b>{fmt(rows.reduce((n, r) => n + r.obj.powerKw, 0))}</b> kW
        </span>
      </div>
    </div>
  );
}

function Row({ row: r, odd }: { row: InfraRow; odd: boolean }) {
  const set = (patch: Parameters<typeof updateInfra>[2], label: string) => updateInfra(r.pageId, [r.obj.id], patch, label);
  const rect = r.type.geometry === 'rect';
  return (
    <div role="row" className={`vt-row static${odd ? ' odd' : ''}`} style={{ gridTemplateColumns: template }} data-testid="infra-row">
      <div role="gridcell" className="vt-td">
        <button type="button" className="icon-btn" onClick={() => jumpToInfra(r.pageId, r.obj.id)} {...tip({ label: 'Zum Objekt springen', side: 'right' })}>
          <Icon name="jump" size={14} />
        </button>
      </div>
      <div role="gridcell" className="vt-td muted">
        {r.pageName}
      </div>
      <div role="gridcell" className="vt-td">
        <span className="it-type" style={{ color: r.type.color }}>
          <InfraIconView name={r.type.icon} size={14} />
        </span>{' '}
        {r.type.label}
      </div>
      <div role="gridcell" className="vt-td">
        <InlineText value={r.obj.label} label="Bezeichnung" onCommit={(label) => set({ label: label.trim() }, 'Bezeichnung ändern')} />
      </div>
      <div role="gridcell" className="vt-td num">
        {r.dims}
      </div>
      <div role="gridcell" className="vt-td num">
        {rect && <InlineNumber value={r.obj.powerKw} label="Strom" onCommit={(powerKw) => set({ powerKw }, 'Strom ändern')} />}
      </div>
      <div role="gridcell" className="vt-td">
        {rect && (
          <select className="cell-input" aria-label="Anschlussart" value={r.obj.connection ?? ''} onChange={(e) => set({ connection: (e.target.value || null) as Connection | null }, 'Anschlussart ändern')}>
            {CONNECTIONS.map((c) => (
              <option key={c ?? ''} value={c ?? ''}>
                {c ? CONNECTION_LABEL[c] : '–'}
              </option>
            ))}
          </select>
        )}
      </div>
      <div role="gridcell" className="vt-td">
        {r.narrow && <span className="chip overlap">zu eng</span>}
      </div>
      <div role="gridcell" className="vt-td">
        <InlineText value={r.obj.note} label="Notiz" onCommit={(note) => set({ note }, 'Notiz ändern')} />
      </div>
    </div>
  );
}

/** Kurze Eingabe in einer Zelle: Enter oder Verlassen übernimmt, Esc verwirft. Kurzbefehle greifen hier nicht. */
function InlineText({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null && text !== value) onCommit(text);
    setText(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') {
      setText(null);
      e.currentTarget.blur();
    }
  };
  return <input className="cell-input" aria-label={label} value={text ?? value} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />;
}

function InlineNumber({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null) {
      const v = parseNum(text);
      if (Number.isFinite(v) && v >= 0 && v <= 10000 && v !== value) onCommit(Math.round(v * 1000) / 1000);
    }
    setText(null);
  };
  return (
    <input
      className="cell-input num"
      aria-label={label}
      inputMode="decimal"
      value={text ?? fmtInput(value, 3)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setText(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
