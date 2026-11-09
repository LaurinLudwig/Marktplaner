import { runCommand } from '../../app/commands';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { ObjectPanel } from '../panels/ObjectPanel';
import { PagePanel } from '../panels/PagePanel';
import { PaperElementPanel, SheetPanel } from '../panels/PaperPanels';
import { PowerPanel } from '../panels/PowerPanel';
import { LayersPanel } from '../panels/ProjectPanels';
import { useSelectedObjects } from '../panels/selection';
import { tip } from '../shortcuts/tip';
import { OverviewPanel } from '../panels/OverviewPanel';
import { overviewTitle, pageView, verbundOfRef } from '../../core/verbundView';

/**
 * Rechte Seitenleiste: Eigenschaften der Auswahl (Objekte oder Papier-Element, sonst die Einstellungen der
 * Festplatz-Page samt Blatt), darunter
 * immer der Strom der Page (M5, auch bei Auswahl) und die Ebenen. Projektweites steht seit M6 in den
 * Projekteinstellungen der Start-Page (M6-07).
 */
export function Sidebar() {
  const page = useStore((s) => pageView(s.project, s.ui.activePage));
  // Gesamtansicht eines Verbunds (#15): ohne Auswahl der Bereich „Verbund“ statt der Page-Einstellungen, kein Strom
  const verbund = useStore((s) => verbundOfRef(s.project, s.ui.activePage));
  const sel = useSelectedObjects();
  const paper = useStore((s) => (s.ui.selection?.kind === 'paper' ? s.ui.selection.element : null));
  return (
    <aside className="sidebar" aria-label="Seitenleiste">
      <div className="sidebar-head">
        <span>{verbund ? overviewTitle(verbund) : page ? page.name : 'Eigenschaften'}</span>
        <div className="spacer" />
        <button type="button" className="icon-btn" onClick={() => runCommand('ui.sidebar')} {...tip({ shortcut: 'ui.sidebar', label: 'Seitenleiste ausblenden' })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="sidebar-scroll">
        {sel ? (
          <ObjectPanel key={sel.objects.map((o) => o.obj.id).join(',')} sel={sel} />
        ) : verbund ? (
          <OverviewPanel verbund={verbund} />
        ) : page && paper ? (
          <PaperElementPanel page={page} element={paper} />
        ) : (
          page && (
            <>
              <PagePanel page={page} />
              <SheetPanel page={page} />
            </>
          )
        )}
        {page && !verbund && <PowerPanel page={page} />}
        {page && <LayersPanel page={page} />}
      </div>
    </aside>
  );
}
