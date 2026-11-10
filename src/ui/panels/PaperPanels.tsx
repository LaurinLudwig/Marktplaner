import { runCommand } from '../../app/commands';
import { fmt } from '../../core/format';
import { SHEET_FORMATS, type FestplatzPage, type SheetFormat } from '../../core/model/types';
import { MARGIN_LIMITS, SCALE_LIMITS, TARGET_WIDTH_LIMITS } from '../../core/model/schema';
import { PAPER_KIND_LABEL, pagePaper } from '../../core/paper';
import { anchorToPaper, dinPrintHint, exceedsPdfLimit, isFreeFormat, paperSizeText, PDF_MAX_MM, scaleText, SHEET_FORMAT_LABEL, shownOnPaper, TITLE_BLOCK_MAX_TEXT_LINES } from '../../core/sheet';
import { fixSheetScale, setPaperVisible, setSheet, setTitleBlockField, setTitleBlockText, todayText } from '../../state/paper';
import { useStore, type PaperElement } from '../../state/store';
import { memberPages } from '../../core/verbund';
import { verbundOfRef } from '../../core/verbundView';
import { keyLabel, tip } from '../shortcuts/tip';
import { NumberField } from './NumberField';
import { TextField } from './TextField';

const CORNER_LABEL = { tl: 'oben links', tr: 'oben rechts', bl: 'unten links', br: 'unten rechts' } as const;

/**
 * Bereich „Blatt“ der Festplatz-Page (M7, spec.md §8): Papierformat (A4–A0, „Plan“ oder „Ausschnitt“, #13),
 * Ausrichtung, Maßstab (fest, an Seite anpassen bzw. über die Zielbreite), Rand, Schriftfeld, Legende, Maßstabsbalken
 * und Nordpfeil ein-/ausblenden. Jede Änderung ist ein Undo-Schritt.
 */
export function SheetPanel({ page }: { page: FestplatzPage }) {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => (s.ui.selection?.kind === 'paper' ? s.ui.selection.element : null));
  const paper = pagePaper(page, project);
  const { frame } = paper;
  const s = page.sheet;
  const free = isFreeFormat(s.format);
  const auto = s.scale === null;
  return (
    <section className="panel" aria-label="Blatt">
      <div className="panel-head">
        <span>Blatt</span>
        {selected === 'sheet' && <span className="panel-badge">ausgewählt</span>}
        <span className="panel-badge" data-testid="sheet-scale">
          {free ? paperSizeText(frame.paper) : s.format} · {scaleText(frame.scale)}
        </span>
      </div>
      <div className="panel-body form">
        <div className="fields-2">
          <div className="field">
            <label htmlFor="sheet-format">Format</label>
            <SheetFormatSelect id="sheet-format" page={page} />
          </div>
          {!free && (
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
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => (e.target.checked ? setSheet(page.id, { scale: null }) : fixSheetScale(page.id))} />
          {free ? 'Maßstab über Zielbreite' : 'An Seite anpassen'}
        </label>
        <div className={free ? 'fields-2' : undefined}>
          <NumberField
            id="sheet-scale-input"
            label="Maßstab 1:"
            value={auto ? null : s.scale}
            placeholder={auto ? `${fmt(frame.scale, 0)} (${free ? 'Zielbreite' : 'angepasst'})` : undefined}
            min={SCALE_LIMITS.min}
            max={SCALE_LIMITS.max}
            step={50}
            digits={0}
            onCommit={(n) => setSheet(page.id, { scale: n })}
          />
          {free && (
            <NumberField
              id="sheet-target-width"
              label="Zielbreite"
              unit="mm"
              value={s.targetWidth}
              min={TARGET_WIDTH_LIMITS.min}
              max={TARGET_WIDTH_LIMITS.max}
              step={10}
              digits={0}
              disabled={!auto}
              onCommit={(n) => setSheet(page.id, { targetWidth: n })}
            />
          )}
        </div>
        {s.format === 'plan' && (
          <div className="nr-row">
            <NumberField
              id="sheet-margin"
              className="grow"
              label="Rand"
              unit="mm"
              value={s.margin}
              placeholder={`${fmt(frame.margin ?? 0, 0)} (automatisch)`}
              min={MARGIN_LIMITS.min}
              max={MARGIN_LIMITS.max}
              step={1}
              digits={0}
              onCommit={(n) => setSheet(page.id, { margin: n })}
              onClear={() => setSheet(page.id, { margin: null })}
            />
            <button type="button" className="btn" disabled={s.margin === null} onClick={() => setSheet(page.id, { margin: null })}>
              Automatisch
            </button>
          </div>
        )}
        {s.format === 'region' && (
          <button type="button" className="btn wide" onClick={() => useStore.getState().setUi({ tool: 'sheetRegion', selection: null })}>
            Ausschnitt aufziehen
          </button>
        )}
        <p className="hint" data-testid="sheet-hint">
          {s.format === 'plan'
            ? `Das Blatt umfasst den Inhalt mit Rand (automatisch 3 % der längeren Seite, mindestens 10 mm) und wächst um die eingeblendeten Papier-Elemente. Papier ${paperSizeText(frame.paper)}.`
            : s.format === 'region'
              ? `Exportiert wird genau der Ausschnitt (${fmt(frame.bounds.maxX - frame.bounds.minX, 2)} × ${fmt(frame.bounds.maxY - frame.bounds.minY, 2)} m, Papier ${paperSizeText(frame.paper)}). Blatt auswählen, dann am Rahmen verschieben oder an den Griffen die Größe ändern.`
              : auto
                ? 'Das Blatt umschließt den Inhalt mit 10 mm Rand und lässt Platz für die eingeblendeten Papier-Elemente. Ein fester Maßstab lässt das Blatt per Ziehen am Rahmen verschieben.'
                : 'Blatt verschieben: Rahmen oder Marke mit dem Auswahlwerkzeug ziehen.'}
        </p>
        {frame.targetTooNarrow && (
          <p className="warn-chip" data-testid="sheet-target-too-narrow">
            Zielbreite {fmt(s.targetWidth, 0)} mm ist kleiner als Schriftfeld, Legende und die anderen eingeblendeten Papier-Elemente mit Rand – das Blatt wird {fmt(frame.paper.w, 0)} mm breit.
          </p>
        )}
        <SheetLimitHint paper={frame.paper} />
        {free && <DinPrintHint paper={frame.paper} scale={frame.scale} />}
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

/** Auswahl des Formats: „Plan“, „Ausschnitt“, A4–A0 (#13). Auch im Export-Dialog. */
export function SheetFormatSelect({ id, page, ariaLabel }: { id?: string; page: FestplatzPage; ariaLabel?: string }) {
  return (
    <select id={id} aria-label={ariaLabel} value={page.sheet.format} onChange={(e) => setSheet(page.id, { format: e.target.value as SheetFormat })}>
      {SHEET_FORMATS.map((f) => (
        <option key={f} value={f}>
          {SHEET_FORMAT_LABEL[f]}
        </option>
      ))}
    </select>
  );
}

/** Warnung, wenn eine Seite länger ist als 5 080 mm (200 Zoll): Dort schneiden PDF-Reader ab (#13). */
export function SheetLimitHint({ paper }: { paper: { w: number; h: number } }) {
  if (!exceedsPdfLimit(paper)) return null;
  return (
    <p className="warn-chip" data-testid="sheet-too-large">
      Das Blatt ist länger als {fmt(PDF_MAX_MM, 0)} mm. Viele PDF-Programme zeigen und drucken so große Seiten nicht vollständig; einen größeren Maßstab oder eine kleinere Zielbreite wählen.
    </p>
  );
}

/** Druck-Hinweis für freie Blätter (#13): passendes DIN-Format in Originalgröße und verkleinert. */
function DinPrintHint({ paper, scale }: { paper: { w: number; h: number }; scale: number }) {
  const { fits, reduced } = dinPrintHint(paper);
  const name = (c: { format: string; orientation: string }) => `${c.format} ${c.orientation === 'landscape' ? 'quer' : 'hoch'}`;
  const parts = [
    fits && `in Originalgröße auf ${name(fits)}`,
    reduced && `verkleinert auf ${name(reduced)} (${fmt(reduced.factor * 100, 0)} %, dann etwa ${scaleText(Math.round(scale / reduced.factor))})`,
  ].filter(Boolean);
  return (
    <p className="hint" data-testid="sheet-print-hint">
      Druck auf DIN-Papier: {parts.join(', ')}.
    </p>
  );
}

/** Seitenleiste bei ausgewähltem Papier-Element (M7, M8): Lage, Felder des Schriftfelds, Hinweise. */
export function PaperElementPanel({ page, element }: { page: FestplatzPage; element: PaperElement }) {
  const project = useStore((s) => s.project);
  // Gesamtansicht eines Verbunds (#15 Teil c): Papier-Elemente des Verbunds; Norden kommt vom ersten Mitglied
  const verbund = verbundOfRef(project, page.id);
  const first = verbund ? memberPages(project, verbund)[0] : undefined;
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
            <TextField id="tb-text" label={verbund ? 'Freitext der Gesamtansicht' : 'Freitext dieser Page'} value={page.titleBlockText} multiline onCommit={(t) => setTitleBlockText(page.id, t)} />
            {lines > TITLE_BLOCK_MAX_TEXT_LINES && <p className="hint">Nur die ersten {TITLE_BLOCK_MAX_TEXT_LINES} Zeilen erscheinen im Schriftfeld.</p>}
            <TitleBlockFields />
            <p className="hint">
              Projektname: „{project.name}“, {verbund ? 'Verbund' : 'Festplatz'}: „{page.name}“ (umbenennen per Doppelklick auf den Tab).
            </p>
          </>
        )}
        {element === 'legend' && (
          <p className="hint">Die Einträge entstehen automatisch aus dem, was {verbund ? 'auf allen Plätzen des Verbunds' : 'auf der Page'} sichtbar ist (Ebenen).</p>
        )}
        {element === 'scaleBar' && <p className="hint">Länge und Einteilung folgen dem Maßstab des Blatts.</p>}
        {element === 'northArrow' && (
          <p className="hint">
            {verbund
              ? `Der Pfeil folgt der Nordrichtung des ersten Platzes im Verbund${first ? ` („${first.name}“)` : ''}, gedreht mit seiner Lage im Verbund; einstellen in dessen Einzelansicht.`
              : 'Der Pfeil folgt der Nordrichtung der Page (Bereich „Festplatz“).'}
          </p>
        )}
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
