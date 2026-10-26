import { useStartPage, type StartTab } from '../../state/startPage';
import { useStore } from '../../state/store';
import { keyLabel } from '../shortcuts/tip';
import { FreeSpaceList } from './FreeSpaceList';
import { InfraTable } from './InfraTable';
import { ProjectSettings } from './ProjectSettings';
import { StandTable } from './StandTable';
import { StatsBar } from './StatsBar';

const TABS: { id: StartTab; label: string; shortcut: string }[] = [
  { id: 'stands', label: 'Geschäfte', shortcut: 'start.stands' },
  { id: 'free', label: 'Freiflächen', shortcut: 'start.free' },
  { id: 'infra', label: 'Infrastruktur', shortcut: 'start.infra' },
  { id: 'settings', label: 'Einstellungen', shortcut: 'start.settings' },
];

/**
 * Start-Page (M6, spec.md §7): Kopf, Kennzahlen-Leiste, darunter die Unter-Tabs Geschäfte, Freiflächen,
 * Infrastruktur (M7) und Einstellungen. Deren Inhalt füllt die Resthöhe und scrollt selbst.
 */
export function StartPage() {
  const name = useStore((s) => s.project.name);
  const pages = useStore((s) => s.project.pages.length);
  const tab = useStartPage((s) => s.tab);
  const setTab = useStartPage((s) => s.setTab);
  return (
    <section className="startpage" aria-label="Start-Page">
      <header className="sp-head">
        <h1>{name}</h1>
        <span className="sub">
          {pages} {pages === 1 ? 'Festplatz' : 'Festplätze'}
        </span>
      </header>
      <StatsBar />
      <div className="sp-tabs" role="tablist" aria-label="Bereiche der Start-Page">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`sp-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`sp-panel-${t.id}`}
            className={`sp-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
            title={`${t.label} (${keyLabel(t.shortcut)})`}
          >
            {t.label}
            {t.id !== 'settings' && <TabCount tab={t.id} />}
          </button>
        ))}
      </div>
      <div className="sp-body" role="tabpanel" id={`sp-panel-${tab}`} aria-labelledby={`sp-tab-${tab}`}>
        {tab === 'stands' && <StandTable />}
        {tab === 'free' && <FreeSpaceList />}
        {tab === 'infra' && <InfraTable />}
        {tab === 'settings' && <ProjectSettings />}
      </div>
    </section>
  );
}

function TabCount({ tab }: { tab: StartTab }) {
  const n = useStore((s) => (tab === 'stands' ? s.project.pages.reduce((k, p) => k + p.stands.length, 0) : tab === 'infra' ? s.project.pages.reduce((k, p) => k + p.infra.length, 0) : -1));
  if (n < 0) return null;
  return <span className="sp-count">{n}</span>;
}
