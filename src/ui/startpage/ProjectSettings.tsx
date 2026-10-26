import type { NumberingScope } from '../../core/model/types';
import { formatNr, NUMBERING_LIMITS } from '../../core/numbering';
import { setNumberingDigits, setNumberingScope, setNumberingStart } from '../../state/numbering';
import { setProjectName } from '../../state/pages';
import { useStore } from '../../state/store';
import { NumberField } from '../panels/NumberField';
import { CategoryPanel, FreeSpacePanel, LabelPanel, SnapPanel } from '../panels/ProjectPanels';
import { TextField } from '../panels/TextField';
import { InfraTypesPanel, InfraWarningsPanel, TitleBlockSettingsPanel } from './InfraSettings';
import { ShapeTemplatesPanel } from './ShapeTemplates';

/**
 * Projekteinstellungen (M6-05, spec.md §7): alles Projektweite an einer Stelle. Seitenbezogenes (Präfix, Modus,
 * Stromlimit, Blockieren) bleibt in der Seitenleiste der Festplatz-Page.
 */
export function ProjectSettings() {
  return (
    <div className="sp-settings" data-testid="project-settings">
      <div className="sp-settings-col">
        <ProjectPanel />
        <NumberingCirclePanel />
        <LabelPanel />
        <TitleBlockSettingsPanel />
      </div>
      <div className="sp-settings-col">
        <FreeSpacePanel />
        <SnapPanel />
        <InfraWarningsPanel />
        <CategoryPanel />
        <ShapeTemplatesPanel />
      </div>
      <div className="sp-settings-col">
        <InfraTypesPanel />
      </div>
    </div>
  );
}

function ProjectPanel() {
  const name = useStore((s) => s.project.name);
  return (
    <section className="panel" aria-label="Projekt">
      <div className="panel-head">Projekt</div>
      <div className="panel-body form">
        <TextField id="project-name" label="Projektname" value={name} onCommit={(v) => void setProjectName(v)} />
        <p className="hint">Erscheint auf der Start-Page und im Schriftfeld der Pläne.</p>
      </div>
    </section>
  );
}

/** Nummernkreis (spec.md §5): bis M5 in der Seitenleiste, seit M6 hier. */
function NumberingCirclePanel() {
  const numbering = useStore((s) => s.project.settings.numbering);
  const prefix = useStore((s) => s.project.pages[0]?.prefix ?? '');
  return (
    <section className="panel" aria-label="Nummerierung">
      <div className="panel-head">Nummerierung</div>
      <div className="panel-body form">
        <div className="field">
          <label htmlFor="nr-scope">Zählung</label>
          <select id="nr-scope" value={numbering.scope} onChange={(e) => setNumberingScope(e.target.value as NumberingScope)}>
            <option value="perPage">pro Festplatz</option>
            <option value="global">global durchgehend (Reihenfolge der Tabs)</option>
          </select>
        </div>
        <div className="fields-2">
          <NumberField id="nr-start-number" label="Startnummer" value={numbering.start} step={1} digits={0} min={NUMBERING_LIMITS.start.min} max={NUMBERING_LIMITS.start.max} onCommit={setNumberingStart} />
          <NumberField id="nr-digits" label="Stellen" value={numbering.digits} step={1} digits={0} min={NUMBERING_LIMITS.digits.min} max={NUMBERING_LIMITS.digits.max} onCommit={setNumberingDigits} />
        </div>
        <p className="hint" data-testid="nr-example">
          Beispiel: {formatNr(prefix, numbering.start, numbering.digits)}, {formatNr(prefix, numbering.start + 1, numbering.digits)} …
        </p>
        <p className="hint">Modus und Präfix stellst du je Festplatz in der Seitenleiste ein; dort startet auch „Neu nummerieren“.</p>
      </div>
    </section>
  );
}
