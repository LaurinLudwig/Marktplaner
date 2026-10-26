import { runCommand } from '../../app/commands';
import { fmt } from '../../core/format';
import { PAPER_FORMATS, type FestplatzPage, type PaperFormat } from '../../core/model/types';
import { SCALE_LIMITS } from '../../core/model/schema';
import { PAPER_KIND_LABEL, pagePaper } from '../../core/paper';
import { anchorToPaper, scaleText, shownOnPaper, TITLE_BLOCK_MAX_TEXT_LINES } from '../../core/sheet';
import { fixSheetScale, setPaperVisible, setSheet, setTitleBlockField, setTitleBlockText, todayText } from '../../state/paper';
import { useStore, type PaperElement } from '../../state/store';
import { keyLabel, tip } from '../shortcuts/tip';
import { NumberField } from './NumberField';
import { TextField } from './TextField';

const CORNER_LABEL = { tl: 'oben links', tr: 'oben rechts', bl: 'unten links', br: 'unten rechts' } as const;

/**
 * Bereich „Blatt“ der Festplatz-Page (M7, spec.md §8): Papierformat, Ausrichtung, Maßstab (fest oder an Seite
 * anpassen), Schriftfeld, Legende, Maßstabsbalken und Nordpfeil ein-/ausblenden. Jede Änderung ist ein Undo-Schritt.
 */
export function SheetPanel({ page }: { page: FestplatzPage }) {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => (s.ui.selection?.kind === 'paper' ? s.ui.selection.element : null));
  const paper = pagePaper(page, project);
  const s = page.sheet;
  const fit = s.scale === null;
  return (
    <section className="panel" aria-label="Blatt">
      <div className="panel-head">
        <span>Blatt</span>
        {selected === 'sheet' && <span className="panel-badge">ausgewählt</span>}
        <span className="panel-badge" data-testid="sheet-scale">
          {s.format} · {scaleText(paper.frame.scale)}
        </span>
      </div>
      <div className="panel-body form">
        <div className="fields-2">
          <div className="field">
            <label htmlFor="sheet-format">Format</label>
            <select id="sheet-format" value={s.format} onChange={(e) => setSheet(page.id, { format: e.target.value as PaperFormat })}>
              {PAPER_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Ausrichtung</label>
            <div className="seg" role="group" aria-label="Ausrichtung">
              <button type="button" aria-pressed={s.orientation === 'portrait'} onClick={() => setSheet(page.id, { orientation: 'portrait' })}>
                hoch
              </button>
              <button type="button" aria-pressed={s.orientation === 'landscape'} onClick={() => setSheet(page.id, { orientation: 'landscape' })}>
                quer
              </button>
            </div>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={fit} onChange={(e) => (e.target.checked ? setSheet(page.id, { scale: null }) : fixSheetScale(page.id))} />
          An Seite anpassen
        </label>
        <NumberField
          id="sheet-scale-input"
          label="Maßstab 1:"
          value={fit ? null : s.scale}
          placeholder={fit ? `${fmt(paper.frame.scale, 0)} (angepasst)` : undefined}
          min={SCALE_LIMITS.min}
          max={SCALE_LIMITS.max}
          step={50}
          digits={0}
          onCommit={(n) => setSheet(page.id, { scale: n })}
        />
        <p className="hint">
          {fit
            ? 'Das Blatt umschließt den Inhalt mit 10 mm Rand und lässt Platz für die eingeblendeten Papier-Elemente. Ein fester Maßstab lässt das Blatt per Ziehen am Rahmen verschieben.'
            : 'Blatt verschieben: Rahmen oder Marke mit dem Auswahlwerkzeug ziehen.'}
        </p>
        <label className="check">
          <input type="checkbox" checked={page.titleBlock.visible} onChange={(e) => setPaperVisible(page.id, 'titleBlock', e.target.checked)} />
          Schriftfeld
        </label>
        <label className="check">
          <input type="checkbox" checked={page.legend.visible} onChange={(e) => setPaperVisible(page.id, 'legend', e.target.checked)} />
          Legende {keyLabel('view.legend') && <kbd>{keyLabel('view.legend')}</kbd>}
        </label>
        <label className="check">
          <input type="checkbox" checked={page.scaleBar.visible} onChange={(e) => setPaperVisible(page.id, 'scaleBar', e.target.checked)} />
          Maßstabsbalken
        </label>
        <label className="check">
          <input type="checkbox" checked={page.northArrow.visible} onChange={(e) => setPaperVisible(page.id, 'northArrow', e.target.checked)} />
          Nordpfeil
        </label>
        {page.legend.visible && !paper.legend && <p className="hint">Die Legende erscheint, sobald es Objekte auf der Page gibt.</p>}
        {!page.layers.sheet.visible && <p className="hint">Die Ebene „Blatt“ ist ausgeblendet.</p>}
      </div>
    </section>
  );
}

/** Seitenleiste bei ausgewähltem Papier-Element (M7, M8): Lage, Felder des Schriftfelds, Hinweise. */
export function PaperElementPanel({ page, element }: { page: FestplatzPage; element: PaperElement }) {
  const project = useStore((s) => s.project);
  if (element === 'sheet') return <SheetPanel page={page} />;
  const anchor = page[element];
  const title = PAPER_KIND_LABEL[element];
  // Passt der gespeicherte Abstand nach einem Formatwechsel nicht mehr, steht das Element am Blattrand (QA-M7-01)
  const pp = pagePaper(page, project);
  const el = pp[element];
  const raw = el && anchorToPaper(anchor, el.layout, pp.frame.paper);
  const shown = el && shownOnPaper(anchor, el.layout, pp.frame.paper);
  const atEdge = !!raw && !!shown && (Math.abs(raw.x - shown.x) > 0.01 || Math.abs(raw.y - shown.y) > 0.01);
  const lines = page.titleBlockText.split('\n').filter((l, i, a) => l || i < a.length - 1).length;
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-head">
        <span>{title}</span>
        <span className="panel-badge">ausgewählt</span>
      </div>
      <div className="panel-body form">
        <p className="hint" data-testid="paper-anchor">
          Ecke {CORNER_LABEL[anchor.corner]}, {fmt(anchor.dx, 0)} × {fmt(anchor.dy, 0)} mm vom Rand. Frei ziehen (fängt an den Blattecken, Cmd/Strg: ohne Fang) oder Pfeiltasten (1 mm, mit Shift 10 mm); Entf blendet aus.
        </p>
        {atEdge && (
          <p className="hint" data-testid="paper-at-edge">
            Auf diesem Format passt der Abstand nicht; das Element steht am Blattrand. Bei einem größeren Format steht es wieder an seiner Stelle.
          </p>
        )}
        {element === 'titleBlock' && (
          <>
            <TextField id="tb-text" label="Freitext dieser Page" value={page.titleBlockText} multiline onCommit={(t) => setTitleBlockText(page.id, t)} />
            {lines > TITLE_BLOCK_MAX_TEXT_LINES && <p className="hint">Nur die ersten {TITLE_BLOCK_MAX_TEXT_LINES} Zeilen erscheinen im Schriftfeld.</p>}
            <TitleBlockFields />
            <p className="hint">Projektname: „{project.name}“, Festplatz: „{page.name}“ (umbenennen per Doppelklick auf den Tab).</p>
          </>
        )}
        {element === 'legend' && <p className="hint">Die Einträge entstehen automatisch aus dem, was auf der Page sichtbar ist (Ebenen).</p>}
        {element === 'scaleBar' && <p className="hint">Länge und Einteilung folgen dem Maßstab des Blatts.</p>}
        {element === 'northArrow' && <p className="hint">Der Pfeil folgt der Nordrichtung der Page (Bereich „Festplatz“).</p>}
        <button type="button" className="btn" onClick={() => setPaperVisible(page.id, element, false)} {...tip({ shortcut: element === 'legend' ? 'view.legend' : undefined, label: `${title} ausblenden`, ariaLabel: false })}>
          {title} ausblenden
        </button>
        <button type="button" className="btn" onClick={() => runCommand('edit.deselect')}>
          Auswahl aufheben
        </button>
      </div>
    </section>
  );
}

/** Datum und Version des Schriftfelds: projektweit, gelten für alle Pages (auch in den Projekteinstellungen). */
export function TitleBlockFields() {
  const tb = useStore((s) => s.project.titleBlock);
  return (
    <>
      <div className="nr-row">
        <TextField id="tb-date" className="grow" label="Datum (alle Pages)" value={tb.dateText} placeholder="z. B. 12.10.2026" onCommit={(v) => setTitleBlockField('dateText', v)} />
        <button type="button" className="btn" onClick={() => setTitleBlockField('dateText', todayText())}>
          Heute
        </button>
      </div>
      <TextField id="tb-version" label="Version (alle Pages)" value={tb.version} placeholder="z. B. 3" onCommit={(v) => setTitleBlockField('version', v)} />
    </>
  );
}
