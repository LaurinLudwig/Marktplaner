import { useMemo } from 'react';
import { runCommand } from '../../app/commands';
import { fmt } from '../../core/format';
import type { FestplatzPage, NumberingMode } from '../../core/model/types';
import { clockwiseOf, directionOf, formatNr, isCircularMode, isLinearMode, nrLockTargets, renumberIssue } from '../../core/numbering';
import { setClockwiseCenter, setClockwiseStart, setDirectionPoint, setNumberingMode, setPrefix } from '../../state/numbering';
import { openProjectSettings } from '../../app/startPageNav';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { keyLabel, tip } from '../shortcuts/tip';
import { NumberField } from './NumberField';
import { TextField } from './TextField';

/** Richtungen der linearen Nummerierung (#12): feste Richtungen an den Achsen der Zeichenfläche und eigene. */
const DIRECTIONS: { id: NumberingMode; text: string; label: string; desc: string }[] = [
  { id: 'frontLtr', text: '→', label: 'Links → rechts', desc: 'Nach der Mitte von links nach rechts; bei gleicher Lage das obere zuerst' },
  { id: 'rightToLeft', text: '←', label: 'Rechts → links', desc: 'Nach der Mitte von rechts nach links; bei gleicher Lage das obere zuerst' },
  { id: 'topToBottom', text: '↓', label: 'Oben → unten', desc: 'Nach der Mitte von oben nach unten; bei gleicher Lage das linke zuerst' },
  { id: 'bottomToTop', text: '↑', label: 'Unten → oben', desc: 'Nach der Mitte von unten nach oben; bei gleicher Lage das linke zuerst' },
  { id: 'direction', text: 'eigene', label: 'Eigene Richtung', desc: 'Richtung über zwei Punkte A → B auf dem Plan, z. B. für schräge Straßen' },
];

/**
 * Nummerierung der Festplatz-Page (M5, spec.md §5): Modus in zwei Stufen („Linear“ + Richtung, „Kreis“ + Drehsinn,
 * „Manuell“; #12), Präfix, die Einstellungen des Modus; Neu nummerieren; alle Fixierungen lösen bzw. alle Nummern
 * fixieren (#14). Den projektweiten Nummernkreis zeigt sie nur an (Einstellung seit M6 in den Projekteinstellungen der
 * Start-Page).
 */
export function NumberingPanel({ page }: { page: FestplatzPage }) {
  const numbering = useStore((s) => s.project.settings.numbering);
  const unnumbered = page.stands.filter((s) => !s.nr.trim()).length;
  const fixed = page.stands.filter((s) => s.nrLocked).length;
  // #14: Zahl der Stände, die „Alle Fixierungen lösen“ bzw. „Alle Nummern fixieren“ im Nummernkreis ändern würde
  // (am Projekt festgemacht, nicht an jeder Store-Änderung wie Zoomen oder Verschieben der Ansicht)
  const project = useStore((s) => s.project);
  const [toUnlock, toLock] = useMemo(() => [nrLockTargets(project, page.id, false).length, nrLockTargets(project, page.id, true).length], [project, page.id]);
  const circleText = numbering.scope === 'global' ? 'Auf allen Festplätzen (Nummernkreis global durchgehend)' : 'Auf diesem Festplatz';
  const manual = page.numberingMode === 'manual';
  // Hindernis im Nummernkreis (#12: eigene Richtung mit A = B), als Text, damit der Selektor stabil bleibt
  const issue = useStore((s) => {
    const i = renumberIssue(s.project, page.id);
    return i ? (i.pageId === page.id ? i.message : `${i.pageName}: ${i.message}`) : null;
  });
  const modeCanRun = numbering.scope === 'global' || !manual;
  const canRun = modeCanRun && !issue;
  const mode = page.numberingMode;
  return (
    <section className="panel" aria-label="Nummerierung">
      <div className="panel-head">Nummerierung</div>
      <div className="panel-body form">
        <div className="field">
          <label htmlFor="nr-mode">Modus</label>
          {/* Erste Stufe: Der Wert jeder Gruppe ist der Modus, den die Page damit bekommt (bisherige Richtung bzw. Drehsinn) */}
          <select id="nr-mode" value={mode} onChange={(e) => setNumberingMode(page.id, e.target.value as NumberingMode)}>
            <option value={isLinearMode(mode) ? mode : 'frontLtr'}>Linear in einer Richtung</option>
            <option value={isCircularMode(mode) ? mode : 'clockwise'}>Kreis um einen Mittelpunkt</option>
            <option value="manual">Manuell</option>
          </select>
        </div>
        <TextField id="nr-prefix" label="Präfix dieses Festplatzes" value={page.prefix} placeholder="z. B. A-" onCommit={(v) => setPrefix(page.id, v.trim())} />

        {isLinearMode(mode) && <LinearSettings page={page} />}
        {isCircularMode(mode) && <CircleSettings page={page} />}
        {issue && (
          <p className="warn-chip" role="alert" data-testid="nr-issue">
            {issue}
          </p>
        )}

        <p className="hint" data-testid="nr-circle">
          Nummernkreis: {numbering.scope === 'global' ? 'global durchgehend' : 'pro Festplatz'}, ab {numbering.start}, {numbering.digits} {numbering.digits === 1 ? 'Stelle' : 'Stellen'} (Beispiel{' '}
          {formatNr(page.prefix, numbering.start, numbering.digits)}).{' '}
          <button type="button" className="link-btn" onClick={() => openProjectSettings()}>
            Projekteinstellungen
          </button>
        </p>
        <p className="hint" data-testid="nr-status">
          {page.stands.length} {page.stands.length === 1 ? 'Stand' : 'Stände'}
          {unnumbered > 0 && `, ${unnumbered} ohne Nummer`}
          {fixed > 0 && `, ${fixed} fixiert`}
        </p>
        {(toUnlock > 0 || toLock > 0) && (
          <p className="hint nr-lock-actions" data-testid="nr-lock-actions">
            {toUnlock > 0 && (
              <button type="button" className="link-btn" onClick={() => runCommand('numbering.unlockAll')} {...tip({ label: 'Alle Fixierungen lösen', desc: `${circleText}; die Nummern bleiben. ${fmt(toUnlock, 0)} ${toUnlock === 1 ? 'Stand' : 'Stände'}.`, ariaLabel: false })}>
                <Icon name="unlock" size={12} /> Alle Fixierungen lösen
              </button>
            )}
            {toLock > 0 && (
              <button type="button" className="link-btn" onClick={() => runCommand('numbering.lockAll')} {...tip({ label: 'Alle Nummern fixieren', desc: `${circleText}; Stände ohne Nummer bleiben offen. ${fmt(toLock, 0)} ${toLock === 1 ? 'Stand' : 'Stände'}.`, ariaLabel: false })}>
                <Icon name="lock" size={12} /> Alle Nummern fixieren
              </button>
            )}
          </p>
        )}
        <button type="button" className="btn primary wide" disabled={!canRun} onClick={() => runCommand('numbering.renumber')} {...tip({ shortcut: 'numbering.renumber', desc: 'Vorschau alt → neu, dann übernehmen', ariaLabel: false })}>
          Neu nummerieren … {keyLabel('numbering.renumber') && <kbd>{keyLabel('numbering.renumber')}</kbd>}
        </button>
        {manual && <p className="hint">{modeCanRun ? 'Diese Page wird manuell nummeriert; ihre Nummern bleiben belegt.' : 'Manuell: Nummern im Feld „Platznummer“ der Geschäfte eintragen.'}</p>}
      </div>
    </section>
  );
}

/** Zweite Stufe „Linear“: Richtung; bei „eigene Richtung“ Start- und Zielpunkt (#12). */
function LinearSettings({ page }: { page: FestplatzPage }) {
  const mode = page.numberingMode;
  const dir = mode === 'direction' ? directionOf(page) : null;
  const current = DIRECTIONS.find((d) => d.id === mode);
  return (
    <>
      <div className="field">
        <label>Richtung</label>
        <div className="seg seg-direction" role="group" aria-label="Richtung">
          {DIRECTIONS.map((d) => (
            <button key={d.id} type="button" aria-pressed={mode === d.id} onClick={() => setNumberingMode(page.id, d.id)} {...tip({ label: d.label, desc: d.desc })}>
              {d.text}
            </button>
          ))}
        </div>
      </div>
      {mode !== 'direction' && current && <p className="hint">{current.desc}, unabhängig von den Grundflächen.</p>}
      {mode === 'direction' && (
        <>
          <div className="fields-2">
            <NumberField id="nr-ax" label="A X" unit="m" value={dir?.from.x ?? null} step={1} onCommit={(x) => setDirectionPoint(page.id, 'from', { x })} />
            <NumberField id="nr-ay" label="A Y" unit="m" value={dir?.from.y ?? null} step={1} onCommit={(y) => setDirectionPoint(page.id, 'from', { y })} />
            <NumberField id="nr-bx" label="B X" unit="m" value={dir?.to.x ?? null} step={1} onCommit={(x) => setDirectionPoint(page.id, 'to', { x })} />
            <NumberField id="nr-by" label="B Y" unit="m" value={dir?.to.y ?? null} step={1} onCommit={(y) => setDirectionPoint(page.id, 'to', { y })} />
          </div>
          <button type="button" className="btn wide" onClick={() => useStore.getState().setUi({ tool: 'numberDirection', selection: null })} {...tip({ label: 'Richtung setzen', desc: 'Erst Startpunkt A, dann Zielpunkt B anklicken; fängt an Standmitten und Ecken der Grundflächen', ariaLabel: false })}>
            <Icon name="center" size={16} /> Richtung auf dem Plan setzen
          </button>
          <p className="hint">Nummeriert nach der Lage der Standmitte entlang A → B; bei gleicher Lage zuerst der Stand links vom Pfeil. A und B lassen sich mit dem Auswahlwerkzeug ziehen.</p>
        </>
      )}
    </>
  );
}

/** Zweite Stufe „Kreis“: Drehsinn, Mittelpunkt und Startrichtung. */
function CircleSettings({ page }: { page: FestplatzPage }) {
  const cw = clockwiseOf(page);
  return (
    <>
      <div className="field">
        <label htmlFor="nr-sense">Drehsinn</label>
        <select id="nr-sense" value={page.numberingMode} onChange={(e) => setNumberingMode(page.id, e.target.value as NumberingMode)}>
          <option value="clockwise">im Uhrzeigersinn</option>
          <option value="counterClockwise">gegen den Uhrzeigersinn</option>
        </select>
      </div>
      <div className="fields-3">
        <NumberField id="nr-cx" label="Mitte X" unit="m" value={cw?.center.x ?? null} step={1} onCommit={(x) => setClockwiseCenter(page.id, { x })} />
        <NumberField id="nr-cy" label="Mitte Y" unit="m" value={cw?.center.y ?? null} step={1} onCommit={(y) => setClockwiseCenter(page.id, { y })} />
        <NumberField id="nr-start" label="Start" unit="°" value={page.clockwise?.startAngle ?? 0} step={15} digits={1} min={-360} max={360} onCommit={(a) => setClockwiseStart(page.id, a)} />
      </div>
      <button type="button" className="btn wide" onClick={() => useStore.getState().setUi({ tool: 'numberCenter', selection: null })} {...tip({ label: 'Mittelpunkt setzen', desc: 'Auf die Zeichenfläche klicken; fängt an Objekten', ariaLabel: false })}>
        <Icon name="center" size={16} /> Mittelpunkt auf dem Plan setzen
      </button>
      <p className="hint">Start in Grad im Uhrzeigersinn ab Norden des Plans (0° = Norden).</p>
    </>
  );
}
