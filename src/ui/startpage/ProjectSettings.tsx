import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { NumberingScope } from '../../core/model/types';
import { formatNr, NUMBERING_LIMITS } from '../../core/numbering';
import { setNumberingDigits, setNumberingScope, setNumberingStart } from '../../state/numbering';
import { setProjectName } from '../../state/pages';
import { useStore } from '../../state/store';
import { NumberField } from '../panels/NumberField';
import { CategoryPanel, FreeSpacePanel, LabelPanel, PricingPanel, SnapPanel } from '../panels/ProjectPanels';
import { TextField } from '../panels/TextField';
import { InfraTypesPanel, InfraWarningsPanel, TitleBlockSettingsPanel } from './InfraSettings';
import { ShapeTemplatesPanel } from './ShapeTemplates';

/**
 * Projekteinstellungen (M6-05, spec.md §7): alles Projektweite an einer Stelle. Seitenbezogenes (Präfix, Modus,
 * Stromlimit, Blockieren) bleibt in der Seitenleiste der Festplatz-Page.
 *
 * Aufteilung: so viele Spalten, wie nebeneinander passen (mindestens `MIN_COL` breit, 1 bis n); jedes Panel kommt in
 * dieser Reihenfolge in die gerade kürzeste Spalte. Neu verteilt wird nur, wenn sich die Spaltenzahl ändert, damit
 * beim Bearbeiten (z. B. eine Kategorie mehr) kein Panel samt Eingabefeld in eine andere Spalte springt.
 */
const PANELS: { key: string; panel: ReactNode }[] = [
  { key: 'project', panel: <ProjectPanel /> },
  { key: 'numbering', panel: <NumberingCirclePanel /> },
  { key: 'label', panel: <LabelPanel /> },
  { key: 'titleBlock', panel: <TitleBlockSettingsPanel /> },
  { key: 'free', panel: <FreeSpacePanel /> },
  { key: 'snap', panel: <SnapPanel /> },
  { key: 'safety', panel: <InfraWarningsPanel /> },
  { key: 'categories', panel: <CategoryPanel /> },
  { key: 'pricing', panel: <PricingPanel /> },
  { key: 'shapes', panel: <ShapeTemplatesPanel /> },
  { key: 'infraTypes', panel: <InfraTypesPanel /> },
];
const MIN_COL = 340;
const GAP = 16;

/** Panel-Index → Spalte: jedes Panel in die bis dahin kürzeste Spalte (bei Gleichstand die linke). */
function distribute(heights: readonly number[], n: number): number[] {
  const cols = Array.from({ length: n }, () => 0);
  return heights.map((h) => {
    const c = cols.indexOf(Math.min(...cols));
    cols[c]! += h + GAP;
    return c;
  });
}

export function ProjectSettings() {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(1);
  const [assign, setAssign] = useState<number[]>(() => PANELS.map(() => 0));

  // Spaltenzahl aus der Breite
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setN(Math.max(1, Math.floor((el.clientWidth + GAP) / (MIN_COL + GAP))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bei neuer Spaltenzahl die aktuellen Höhen messen und verteilen
  useLayoutEffect(() => {
    const heights = PANELS.map((p) => ref.current?.querySelector<HTMLElement>(`[data-panel="${p.key}"]`)?.offsetHeight ?? 0);
    setAssign(distribute(heights, n));
  }, [n]);

  return (
    <div className="sp-settings" data-testid="project-settings">
      <div className="sp-settings-cols" ref={ref} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {Array.from({ length: n }, (_, c) => (
          <div key={c} className="sp-settings-col">
            {PANELS.map((p, i) =>
              (assign[i] ?? 0) % n === c ? (
                <div key={p.key} data-panel={p.key}>
                  {p.panel}
                </div>
              ) : null,
            )}
          </div>
        ))}
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
