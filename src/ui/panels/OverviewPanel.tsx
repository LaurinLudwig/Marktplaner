import { runCommand } from '../../app/commands';
import { openProjectSettings } from '../../app/startPageNav';
import type { Verbund } from '../../core/model/types';
import { memberPages } from '../../core/verbund';
import { useStore } from '../../state/store';
import { VerbundCard } from '../startpage/VerbundSettings';
import { tip } from '../shortcuts/tip';

/**
 * Seitenleiste der Gesamtansicht ohne Auswahl (#15, spec.md §12): statt der Page-Einstellungen der Bereich „Verbund“
 * (Name, Mitglieder, Reihenfolge, Lage; dieselbe Karte wie in den Projekteinstellungen) und ein Hinweis, was nur in
 * der Einzelansicht geht, mit Links zu den Plätzen.
 */
export function OverviewPanel({ verbund }: { verbund: Verbund }) {
  const pages = useStore((s) => s.project.pages);
  const setUi = useStore((s) => s.setUi);
  const members = memberPages({ pages }, verbund);
  return (
    <>
      <section className="panel" aria-label="Verbund" data-testid="overview-verbund">
        <div className="panel-head">
          <span>Verbund</span>
          <div className="spacer" />
          <button type="button" className="link-btn" onClick={openProjectSettings} {...tip({ label: 'Alle Verbünde in den Projekteinstellungen', side: 'bottom' })}>
            Alle Verbünde …
          </button>
        </div>
        <div className="panel-body form">
          <VerbundCard verbund={verbund} />
          <button type="button" className="btn" onClick={() => runCommand('tool.align')} {...tip({ shortcut: 'tool.align', label: 'Ausrichten', desc: 'Platz ziehen, drehen oder über zwei Punktpaare ausrichten', ariaLabel: false })}>
            Plätze ausrichten …
          </button>
        </div>
      </section>
      <section className="panel" aria-label="Einzelansicht">
        <div className="panel-head">Nur in der Einzelansicht</div>
        <div className="panel-body form">
          <p className="hint" data-testid="overview-locked">
            Nummerierung und „Neu nummerieren“, Mittelpunkt und Richtung der Nummerierung, Hintergrund importieren und kalibrieren sowie die
            Einstellungen eines Platzes (Raster, Norden, Strom, Grundflächen) gehen nur in der Einzelansicht des Festplatzes.
          </p>
          <div className="overview-members">
            {members.map((p) => (
              <button key={p.id} type="button" className="link-btn" onClick={() => setUi({ activePage: p.id })} {...tip({ label: `${p.name} öffnen`, side: 'top' })}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
