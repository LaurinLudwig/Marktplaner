import { runCommand } from '../../app/commands';
import { removeBackground } from '../../app/backgroundImport';
import { confirmScale } from '../../app/dialogs';
import { applyPaperScale, bgCenter, paperScaleDenominator, rotateAround, scaleWarnings } from '../../core/background';
import { fmt } from '../../core/format';
import type { Background, FestplatzPage } from '../../core/model/types';
import { setGridSize, setGridVisible, setNorthAngle, updateBackground } from '../../state/pageSettings';
import { saveGridOpacity, useStore } from '../../state/store';
import { keyLabel, tip } from '../shortcuts/tip';
import { NumberField } from './NumberField';
import { AreaOrderPanel } from './AreaOrderPanel';
import { NumberingPanel } from './NumberingPanel';

const KIND_LABEL = { pdf: 'PDF', svg: 'SVG', image: 'Bild' } as const;

/** Planmaßstab 1:n setzen, bei unplausiblem Ergebnis erst nachfragen (QA-M2-07). */
async function applyPaperScaleChecked(pageId: string, bg: Background, n: number) {
  const transform = applyPaperScale(bg.transform, n, bgCenter(bg.transform, bg.pxSize));
  const previous = bg.calibration || bg.paperScale ? bg.transform : null;
  if (!(await confirmScale(scaleWarnings(bg.kind, bg.pxSize, transform, previous)))) return;
  updateBackground(pageId, 'Planmaßstab setzen', { transform, paperScale: n, calibration: undefined });
}

/** Einstellungen der Festplatz-Page in der Seitenleiste: Hintergrund, Nummerierung, Grundflächen, Raster, Norden. */
export function PagePanel({ page }: { page: FestplatzPage }) {
  const bg = page.background;
  const selected = useStore((s) => s.ui.selection?.kind === 'background');
  const begin = useStore((s) => s.beginTransaction);
  const commit = useStore((s) => s.commitTransaction);
  const gridOpacity = useStore((s) => s.ui.gridOpacity);
  const setUi = useStore((s) => s.setUi);

  return (
    <>
      <section className="panel" aria-label="Hintergrund">
        <div className="panel-head">
          <span>Hintergrund</span>
          {selected && <span className="panel-badge">ausgewählt</span>}
        </div>
        <div className="panel-body form">
          {!bg ? (
            <>
              <p>Noch kein Plan. Möglich sind PDF, SVG, PNG und JPEG; die Datei wird in die Projektdatei eingebettet.</p>
              <button type="button" className="btn primary wide" onClick={() => runCommand('file.importBackground')} {...tip({ shortcut: 'file.importBackground', ariaLabel: false })}>
                Hintergrund importieren … {keyLabel('file.importBackground') && <kbd>{keyLabel('file.importBackground')}</kbd>}
              </button>
            </>
          ) : (
            <>
              <div className="bg-file" title={bg.fileName}>
                <strong>{bg.fileName}</strong>
                <span>
                  {KIND_LABEL[bg.kind]}
                  {bg.pdfPageCount && bg.pdfPageCount > 1 ? `, Seite ${bg.pdfPage} von ${bg.pdfPageCount}` : ''} · {fmt(bg.pxSize.w, 0)} × {fmt(bg.pxSize.h, 0)} {bg.kind === 'pdf' ? 'pt' : 'px'}
                </span>
                <span data-testid="bg-scale">
                  {bg.calibration ? 'Kalibriert' : bg.paperScale ? `Maßstab 1:${fmt(bg.paperScale, 1)}` : 'Nicht kalibriert'}: 1 {bg.kind === 'pdf' ? 'pt' : 'px'} = {fmt(bg.transform.metersPerPx, 4)} m · Plan {fmt(bg.pxSize.w * bg.transform.metersPerPx, 1)} × {fmt(bg.pxSize.h * bg.transform.metersPerPx, 1)} m
                </span>
              </div>
              <div className="row-buttons">
                <button type="button" className="btn" onClick={() => runCommand('tool.calibrate')} {...tip({ shortcut: 'tool.calibrate', desc: 'Zwei Punkte klicken, realen Abstand eingeben', ariaLabel: false })}>
                  Kalibrieren
                </button>
                <button type="button" className="btn" onClick={() => runCommand('file.importBackground')} {...tip({ shortcut: 'file.importBackground', label: 'Hintergrund ersetzen', desc: 'Neue Datei; Objekte und Position bleiben erhalten', ariaLabel: false })}>
                  Ersetzen …
                </button>
                <button type="button" className="btn danger" onClick={() => removeBackground(page.id)} {...tip({ label: 'Hintergrund entfernen', desc: 'Rückgängig mit Strg/Cmd+Z', ariaLabel: false })}>
                  Entfernen
                </button>
              </div>
              <div className="field">
                <label htmlFor="bg-opacity">Deckkraft</label>
                <span className="slider">
                  <input
                    id="bg-opacity"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(bg.opacity * 100)}
                    onPointerDown={() => begin('Deckkraft ändern')}
                    onPointerUp={() => commit()}
                    onChange={(e) => updateBackground(page.id, 'Deckkraft ändern', { opacity: Number(e.target.value) / 100 })}
                  />
                  <output htmlFor="bg-opacity">{Math.round(bg.opacity * 100)} %</output>
                </span>
              </div>
              <label className="check">
                <input type="checkbox" checked={bg.locked} onChange={(e) => updateBackground(page.id, e.target.checked ? 'Hintergrund sperren' : 'Hintergrund entsperren', { locked: e.target.checked })} />
                Gesperrt (nicht verschiebbar)
              </label>
              <div className="fields-2">
                <NumberField
                  id="bg-rot"
                  label="Drehung"
                  unit="°"
                  value={bg.transform.rot}
                  step={1}
                  digits={1}
                  min={-360}
                  max={360}
                  disabled={bg.locked}
                  onCommit={(rot) => updateBackground(page.id, 'Hintergrund drehen', { transform: rotateAround(bg.transform, rot, bgCenter(bg.transform, bg.pxSize)) })}
                />
                {bg.kind === 'pdf' && (
                  <NumberField
                    id="bg-paper-scale"
                    label="Planmaßstab 1:"
                    value={paperScaleDenominator(bg.transform)}
                    step={50}
                    digits={1}
                    min={1}
                    max={1_000_000}
                    disabled={bg.locked}
                    onCommit={(n) => void applyPaperScaleChecked(page.id, bg, n)}
                  />
                )}
              </div>
              <p className="hint">
                {bg.locked
                  ? 'Gesperrt: Position, Drehung und Maßstab sind geschützt. Kalibrieren (K) bleibt möglich.'
                  : 'Mit dem Auswahlwerkzeug (V) lässt sich der Plan verschieben.'}
              </p>
            </>
          )}
        </div>
      </section>
      <NumberingPanel page={page} />
      <AreaOrderPanel page={page} />
      <section className="panel" aria-label="Raster">
        <div className="panel-head">Raster</div>
        <div className="panel-body form">
          <div className="fields-2">
            <NumberField id="grid-size" label="Weite" unit="m" value={page.grid.size} step={0.5} digits={2} min={0.1} max={1000} onCommit={(size) => setGridSize(page.id, size)} />
            <label className="check align-end">
              <input type="checkbox" checked={page.grid.visible} onChange={(e) => setGridVisible(page.id, e.target.checked)} />
              Anzeigen
            </label>
          </div>
          {/* Pro Rechner, für alle Projekte (#1): kein Undo, keine Änderungsmarkierung */}
          <div className="field">
            <label htmlFor="grid-opacity">Deckkraft</label>
            <span className="slider">
              <input
                id="grid-opacity"
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(gridOpacity * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  setUi({ gridOpacity: v });
                  saveGridOpacity(v);
                }}
                {...tip({ label: 'Deckkraft des Rasters', desc: 'Gilt auf diesem Rechner für alle Projekte', ariaLabel: false })}
              />
              <output htmlFor="grid-opacity">{Math.round(gridOpacity * 100)} %</output>
            </span>
          </div>
        </div>
      </section>
      <section className="panel" aria-label="Norden">
        <div className="panel-head">Norden</div>
        <div className="panel-body form">
          <div className="fields-2">
            <NumberField id="north-angle" label="Nordrichtung" unit="°" value={page.northAngle} step={1} digits={1} min={-360} max={360} onCommit={(a) => setNorthAngle(page.id, a)} />
            <p className="hint align-end">0° = oben, im Uhrzeigersinn</p>
          </div>
        </div>
      </section>
    </>
  );
}
