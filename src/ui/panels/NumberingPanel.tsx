import { useMemo } from 'react';
import { runCommand } from '../../app/commands';
import { fmt } from '../../core/format';
import type { FestplatzPage, NumberingMode } from '../../core/model/types';
import { defaultClockwiseCenter, formatNr, nrLockTargets } from '../../core/numbering';
import { setClockwiseCenter, setClockwiseStart, setNumberingMode, setPrefix } from '../../state/numbering';
import { openProjectSettings } from '../../app/startPageNav';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { keyLabel, tip } from '../shortcuts/tip';
import { NumberField } from './NumberField';
import { TextField } from './TextField';

const MODES: { id: NumberingMode; label: string }[] = [
  { id: 'frontLtr', label: 'Links → rechts über den Festplatz' },
  { id: 'clockwise', label: 'Im Uhrzeigersinn um einen Mittelpunkt' },
  { id: 'manual', label: 'Manuell' },
];

/**
 * Nummerierung der Festplatz-Page (M5, spec.md §5): Modus, Präfix, im Uhrzeigersinn Mittelpunkt und
 * Startrichtung; Neu nummerieren; alle Fixierungen lösen bzw. alle Nummern fixieren (#14). Den projektweiten Nummernkreis zeigt sie nur an (Einstellung seit M6 in den
 * Projekteinstellungen der Start-Page).
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
  const canRun = numbering.scope === 'global' || !manual;
  const center = page.clockwise?.center ?? defaultClockwiseCenter(page);
  return (
    <section className="panel" aria-label="Nummerierung">
      <div className="panel-head">Nummerierung</div>
      <div className="panel-body form">
        <div className="field">
          <label htmlFor="nr-mode">Modus</label>
          <select id="nr-mode" value={page.numberingMode} onChange={(e) => setNumberingMode(page.id, e.target.value as NumberingMode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <TextField id="nr-prefix" label="Präfix dieses Festplatzes" value={page.prefix} placeholder="z. B. A-" onCommit={(v) => setPrefix(page.id, v.trim())} />

        {page.numberingMode === 'frontLtr' && <p className="hint">Alle Geschäfte von links nach rechts nach ihrer Mitte, unabhängig von den Grundflächen; bei gleicher Lage das obere zuerst.</p>}

        {page.numberingMode === 'clockwise' && (
          <>
            <div className="fields-3">
              <NumberField id="nr-cx" label="Mitte X" unit="m" value={center?.x ?? null} step={1} onCommit={(x) => setClockwiseCenter(page.id, { x })} />
              <NumberField id="nr-cy" label="Mitte Y" unit="m" value={center?.y ?? null} step={1} onCommit={(y) => setClockwiseCenter(page.id, { y })} />
              <NumberField id="nr-start" label="Start" unit="°" value={page.clockwise?.startAngle ?? 0} step={15} digits={1} min={-360} max={360} onCommit={(a) => setClockwiseStart(page.id, a)} />
            </div>
            <button type="button" className="btn wide" onClick={() => useStore.getState().setUi({ tool: 'numberCenter', selection: null })} {...tip({ label: 'Mittelpunkt setzen', desc: 'Auf die Zeichenfläche klicken; fängt an Objekten', ariaLabel: false })}>
              <Icon name="center" size={16} /> Mittelpunkt auf dem Plan setzen
            </button>
            <p className="hint">Start in Grad im Uhrzeigersinn ab Norden des Plans (0° = Norden).</p>
          </>
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
        {manual && <p className="hint">{canRun ? 'Diese Page wird manuell nummeriert; ihre Nummern bleiben belegt.' : 'Manuell: Nummern im Feld „Platznummer“ der Geschäfte eintragen.'}</p>}
      </div>
    </section>
  );
}
