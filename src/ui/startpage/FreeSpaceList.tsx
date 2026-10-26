import { useLayoutEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { exportCurrentList } from '../../app/exportCsv';
import { jumpToFreeSpace } from '../../app/jump';
import { allFreeRows, displayedFreeRows } from '../../app/startPageData';
import { fmt } from '../../core/format';
import { defaultFreeSort, isFitFilterActive, sumFreeSpaces, type FreeSortColumn, type FreeSpaceRow } from '../../core/freeSpaceList';
import { toggleSort } from '../../core/standTable';
import { hideFreeSpace, showFreeSpace } from '../../state/freeSpaces';
import { useStartPage } from '../../state/startPage';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { NumberField } from '../panels/NumberField';
import { tip } from '../shortcuts/tip';
import { MultiFilter } from './Popover';
import { ROW_H, scrollRowIntoView, useVirtualRows } from './useVirtualRows';

const COLS: { id: FreeSortColumn | 'jump' | 'clipped' | 'hide'; label: string; width: number; num?: boolean }[] = [
  { id: 'jump', label: '', width: 30 },
  { id: 'page', label: 'Festplatz', width: 140 },
  { id: 'area', label: 'Grundfläche', width: 180 },
  { id: 'w', label: 'Breite (m)', width: 90, num: true },
  { id: 'd', label: 'Tiefe (m)', width: 90, num: true },
  { id: 'size', label: 'Fläche (m²)', width: 100, num: true },
  { id: 'clipped', label: 'Hinweis', width: 220 },
  { id: 'hide', label: '', width: 130 },
];
const HEAD_H = ROW_H + 2;
const template = COLS.map((c) => `${c.width}px`).join(' ');
const width = COLS.reduce((n, c) => n + c.width, 0);
const isSortCol = (c: string): c is FreeSortColumn => c !== 'jump' && c !== 'clipped' && c !== 'hide';

/**
 * Freiflächenliste (M6-02, spec.md §7): alle Freiflächen aller Festplätze, Filter „passt für B × T“, Sprung per
 * Klick oder Enter. Die Zeilen tragen den stabilen Schlüssel der Freifläche (§4) als React-Key.
 */
export function FreeSpaceList() {
  const project = useStore((s) => s.project);
  const sp = useStartPage();
  const all = useMemo(() => allFreeRows(project), [project]);
  const { freeFilter, freeSort } = sp;
  const rows = useMemo(() => displayedFreeRows(all, { freeFilter, freeSort }), [all, freeFilter, freeSort]);
  const sums = sumFreeSpaces(rows);
  // Ausgeblendete (#8) zählen in „n Freiflächen“ nicht mit, nur im Schalter
  const hiddenCount = useMemo(() => all.filter((r) => r.hidden).length, [all]);
  const shownTotal = all.length - hiddenCount;
  const shownRows = rows.filter((r) => !r.hidden).length;
  const sort = sp.freeSort ?? defaultFreeSort(isFitFilterActive(sp.freeFilter));
  const f = sp.freeFilter;

  const ref = useRef<HTMLDivElement>(null);
  const { start, end, visible } = useVirtualRows(ref, rows.length, HEAD_H);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = useStartPage.getState().freeScroll;
    return () => useStartPage.getState().set({ freeScroll: el.scrollTop });
  }, []);
  const active = rows.findIndex((r) => r.ref.key === sp.freeActive && r.ref.pageId === useStartPage.getState().freeActivePage);
  useLayoutEffect(() => {
    if (active >= 0 && ref.current) scrollRowIntoView(ref.current, active, HEAD_H);
  }, [active]);

  const select = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (r) sp.set({ freeActive: r.ref.key, freeActivePage: r.ref.pageId });
  };
  const jump = (r: FreeSpaceRow) => {
    sp.set({ freeActive: r.ref.key, freeActivePage: r.ref.pageId });
    jumpToFreeSpace(r.ref);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const i = active;
    let handled = true;
    if (e.key === 'ArrowDown') select(i + 1);
    else if (e.key === 'ArrowUp') select(i < 0 ? 0 : i - 1);
    else if (e.key === 'PageDown') select(i + visible);
    else if (e.key === 'PageUp') select(i - visible);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(rows.length - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && rows[i]) jump(rows[i]!);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      /* verschlucken: keine Kurzbefehle der Zeichenfläche */
    } else handled = false;
    if (handled) e.preventDefault();
  };

  return (
    <div className="sp-list" data-testid="free-list">
      <div className="sp-toolbar">
        <MultiFilter testId="free-filter-page" title="Festplatz" options={project.pages.map((p) => ({ value: p.id, label: p.name }))} value={f.pages} onChange={(pages) => sp.setFreeFilter({ pages })} />
        <span className="fit-label">Passt für einen Stand mit mindestens</span>
        <NumberField id="fit-w" className="compact" label="Breite" unit="m" value={f.minW} min={0.01} max={2000} step={1} placeholder="B" onCommit={(minW) => sp.setFreeFilter({ minW })} onClear={() => sp.setFreeFilter({ minW: null })} />
        <span>×</span>
        <NumberField id="fit-d" className="compact" label="Tiefe" unit="m" value={f.minD} min={0.01} max={2000} step={1} placeholder="T" onCommit={(minD) => sp.setFreeFilter({ minD })} onClear={() => sp.setFreeFilter({ minD: null })} />
        <span className="hint" data-testid="free-count">
          {shownRows === shownTotal ? `${shownTotal} ${shownTotal === 1 ? 'Freifläche' : 'Freiflächen'}` : `${shownRows} von ${shownTotal} Freiflächen`}
        </span>
        {(isFitFilterActive(f) || f.pages) && (
          <button type="button" className="link-btn" onClick={() => sp.setFreeFilter({ pages: null, minW: null, minD: null })}>
            Filter zurücksetzen
          </button>
        )}
        <div className="spacer" />
        <label className="check" data-testid="free-show-hidden" {...tip({ label: 'Per Rechtsklick auf der Zeichenfläche oder hier ausgeblendete Freiflächen mit anzeigen', ariaLabel: false })}>
          <input type="checkbox" checked={!!f.showHidden} disabled={!hiddenCount && !f.showHidden} onChange={(e) => sp.setFreeFilter({ showHidden: e.target.checked })} />
          ausgeblendete zeigen ({hiddenCount})
        </label>
        <span className="hint">ab {fmt(project.settings.minFreeWidth)} m Breite (Projekteinstellungen)</span>
        <button type="button" className="btn" onClick={() => void exportCurrentList()} {...tip({ shortcut: 'start.exportCsv', desc: 'Angezeigte Zeilen, für Excel', ariaLabel: false })}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>
      <div ref={ref} className="vt" role="grid" tabIndex={0} aria-label="Freiflächen" aria-rowcount={rows.length + 1} onKeyDown={onKeyDown} onFocus={(e) => e.target === e.currentTarget && active < 0 && select(0)} data-testid="free-grid">
        <div className="vt-inner" style={{ width, height: HEAD_H + rows.length * ROW_H }}>
          <div className="vt-head" role="row" style={{ gridTemplateColumns: template }}>
            {COLS.map((c) => {
              const k = isSortCol(c.id) ? sort.findIndex((s) => s.col === c.id) : -1;
              const dir = k >= 0 ? sort[k]!.dir : null;
              return (
                <div
                  key={c.id}
                  role="columnheader"
                  className={`vt-th${c.num ? ' num' : ''}${isSortCol(c.id) ? ' sortable' : ''}`}
                  onClick={(e) => isSortCol(c.id) && sp.setFreeSort(toggleSort(sort, c.id, e.shiftKey))}
                >
                  {c.id === 'jump' ? <Icon name="jump" size={14} /> : c.label}
                  {dir && <Icon name={dir === 'asc' ? 'sortUp' : 'sortDown'} size={12} />}
                </div>
              );
            })}
          </div>
          {rows.slice(start, end).map((r, j) => {
            const i = start + j;
            return (
              <div
                key={`${r.ref.pageId}|${r.ref.key}`}
                role="row"
                className={`vt-row link${i % 2 ? ' odd' : ''}${i === active ? ' current active-row' : ''}${r.hidden ? ' hidden-free' : ''}`}
                style={{ top: HEAD_H + i * ROW_H, gridTemplateColumns: template }}
                data-testid="free-row"
                onClick={() => jump(r)}
              >
                <div role="gridcell" className="vt-td">
                  <Icon name="jump" size={14} />
                </div>
                <div role="gridcell" className="vt-td muted">
                  {r.pageName}
                </div>
                <div role="gridcell" className="vt-td">
                  {r.areaName || <span className="muted">Grundfläche</span>}
                </div>
                <div role="gridcell" className="vt-td num">
                  {fmt(r.width)}
                </div>
                <div role="gridcell" className="vt-td num">
                  {fmt(r.depth)}
                </div>
                <div role="gridcell" className="vt-td num">
                  {fmt(r.size, 1)}
                </div>
                <div role="gridcell" className="vt-td muted">
                  {r.hidden && <span>ausgeblendet{r.clipped ? ' · ' : ''}</span>}
                  {r.clipped && <span title="Durch eine frühere Grundfläche angeschnitten; Breite und Tiefe sind Hüllmaße.">angeschnitten – Hüllmaße{r.usableDepth < r.depth - 0.005 ? `, durchgehend ${fmt(r.usableDepth)} m tief` : ''}</span>}
                </div>
                <div role="gridcell" className="vt-td">
                  <button
                    type="button"
                    className="link-btn"
                    data-testid={r.hidden ? 'free-unhide' : 'free-hide'}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (r.hidden) showFreeSpace(r.ref.pageId, r.ref.key);
                      else hideFreeSpace(r.ref.pageId, r.ref);
                    }}
                  >
                    {r.hidden ? 'wieder anzeigen' : 'ausblenden'}
                  </button>
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="vt-empty">{!shownTotal && hiddenCount ? 'Alle Freiflächen sind ausgeblendet („ausgeblendete zeigen“ oben rechts).' : all.length ? 'Keine Freifläche passt zum Filter.' : 'Keine Freiflächen. Sie entstehen automatisch auf Grundflächen neben den Ständen.'}</div>}
        </div>
      </div>
      <div className="sp-sums" data-testid="free-sums">
        <span>
          Σ <b>{sums.count}</b> {sums.count === 1 ? 'Freifläche' : 'Freiflächen'}
        </span>
        <span>
          <b>{fmt(sums.widthM)}</b> m Breite
        </span>
        <div className="spacer" />
        <span className="hint">Klick oder Enter springt zur Freifläche</span>
      </div>
    </div>
  );
}
