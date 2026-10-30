import { useMemo } from 'react';
import { freeOf } from '../../app/startPageData';
import { showCategory, showInfraWarnings, showWarnings } from '../../app/startPageNav';
import { InfraIconView } from '../icons/infraIcons';
import { fmt } from '../../core/format';
import { CONNECTION_LABEL } from '../../core/label';
import { CONNECTION_KEYS, type ConnectionKey } from '../../core/power';
import { NO_CATEGORY, projectStats, type ByCategory } from '../../core/stats';
import type { WarningCount } from '../../core/warnings';
import { addPage } from '../../state/pages';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { PowerMeter } from '../panels/PowerMeter';
import { tip } from '../shortcuts/tip';

const CONN_SHORT: Record<ConnectionKey, string> = { ...CONNECTION_LABEL, none: 'ohne' };

/**
 * Kennzahlen-Leiste (M6-01, spec.md §7): „Gesamt“ und eine Karte je Festplatz mit Anzahl, Frontmeter, Strom gegen
 * das Limit, Anschlussarten und Warnzahl. Klick auf den Namen öffnet die Page, auf die Warnzahl die gefilterte Tabelle.
 */
export function StatsBar() {
  const pages = useStore((s) => s.project.pages);
  const settings = useStore((s) => s.project.settings);
  const infraTypes = useStore((s) => s.project.infraTypes);
  const categories = useStore((s) => s.project.categories);
  const setUi = useStore((s) => s.setUi);
  const stats = useMemo(() => projectStats({ pages, settings, infraTypes, categories }, freeOf(settings.minFreeWidth, infraTypes)), [pages, settings, infraTypes, categories]);
  const t = stats.total;
  return (
    <div className="sp-stats" data-testid="stats">
      <article className="stat-card total" data-testid="stat-total" aria-label="Gesamt">
        <h2>Gesamt</h2>
        <Figures stands={t.stands} frontM={t.frontM} freeFrontM={t.freeFrontM} />
        <div className="stat-power">
          <Icon name="bolt" size={14} /> {fmt(t.sumKw)} kW
        </div>
        <Connections by={t.byConnection} />
        <CategoryCounts by={t.byCategory} pageId={null} />
        <InfraCounts byType={t.infraByType} infraKw={t.infraKw} />
        <Warn count={t.warnings} pageId={null} />
      </article>
      {stats.pages.map((p) => (
        <article key={p.pageId} className="stat-card" data-testid="stat-page" aria-label={p.name}>
          <h2>
            <button type="button" className="link-btn" onClick={() => setUi({ activePage: p.pageId })} {...tip({ label: `${p.name} öffnen`, side: 'bottom' })}>
              {p.name}
            </button>
          </h2>
          <Figures stands={p.stands} frontM={p.frontM} freeFrontM={p.freeFrontM} />
          {p.power.limitKw === null ? (
            <div className="stat-power">
              <Icon name="bolt" size={14} /> {fmt(p.power.sumKw)} kW <span className="muted">· kein Limit</span>
            </div>
          ) : (
            <PowerMeter power={p.power} compact />
          )}
          <Connections by={p.power.byConnection} />
          <CategoryCounts by={p.byCategory} pageId={p.pageId} />
          <InfraCounts byType={p.infraByType} infraKw={p.power.infraKw} />
          <Warn count={p.warnings} pageId={p.pageId} />
        </article>
      ))}
      <button type="button" className="stat-card add card link" onClick={() => addPage()} {...tip({ shortcut: 'page.new', label: 'Neuer Festplatz', ariaLabel: false })}>
        <Icon name="add" size={16} /> Neuer Festplatz
      </button>
    </div>
  );
}

function Figures({ stands, frontM, freeFrontM }: { stands: number; frontM: number; freeFrontM: number }) {
  return (
    <dl className="stat-figures">
      <div>
        <dt>Geschäfte</dt>
        <dd data-testid="stat-stands">{fmt(stands, 0)}</dd>
      </div>
      <div>
        <dt>Frontmeter</dt>
        <dd data-testid="stat-front">{fmt(frontM)} m</dd>
      </div>
      <div title="Summe der Breiten aller Freiflächen ab der Mindestbreite">
        <dt>frei</dt>
        <dd data-testid="stat-free" className="free">
          {fmt(freeFrontM)} m
        </dd>
      </div>
    </dl>
  );
}

function Connections({ by }: { by: Record<ConnectionKey, { count: number; kw: number }> }) {
  const used = CONNECTION_KEYS.filter((k) => by[k].count > 0);
  if (!used.length) return null;
  return (
    <ul className="stat-conn" data-testid="stat-conn">
      {used.map((k) => (
        <li key={k}>
          <span>{CONN_SHORT[k]}</span>
          <span>
            {by[k].count} · {fmt(by[k].kw)} kW
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Anzahl, Frontmeter und Strom je Kategorie (#7): nur vorkommende, in der Reihenfolge der Kategorien, „ohne Kategorie“
 * zuletzt. Klick öffnet die Geschäftstabelle mit den Filtern Festplatz und Kategorie.
 */
function CategoryCounts({ by, pageId }: { by: ByCategory; pageId: string | null }) {
  const categories = useStore((s) => s.project.categories);
  const defaultColor = useStore((s) => s.project.settings.defaultStandColor);
  const rows = [
    ...categories.filter((c) => by[c.id]).map((c) => ({ id: c.id as string | null, name: c.name, color: c.color, f: by[c.id]! })),
    ...(by[NO_CATEGORY] ? [{ id: null, name: 'ohne Kategorie', color: defaultColor, f: by[NO_CATEGORY] }] : []),
  ];
  if (!rows.length) return null;
  return (
    <ul className="stat-cat" data-testid="stat-cat">
      {rows.map((r) => (
        <li key={r.id ?? ''}>
          <button
            type="button"
            className="link-btn"
            data-category={r.id ?? ''}
            onClick={() => showCategory(pageId, r.id)}
            {...tip({ label: `${r.name} – in der Tabelle zeigen`, side: 'bottom', ariaLabel: false })}
          >
            <span className="stat-cat-swatch" style={{ background: r.color }} />
            <span className={`stat-cat-name${r.id === null ? ' muted' : ''}`}>{r.name}</span>
            <span className="stat-cat-fig">
              {fmt(r.f.count, 0)} · {fmt(r.f.frontM)} m · {fmt(r.f.kw)} kW
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Anzahl je Infrastruktur-Typ (nur vorkommende, mit Symbol) und Strom der Infrastruktur (M7-09). */
function InfraCounts({ byType, infraKw }: { byType: Record<string, number>; infraKw: number }) {
  const types = useStore((s) => s.project.infraTypes);
  const used = types.filter((t) => byType[t.id]);
  if (!used.length) return null;
  return (
    <div className="stat-infra" data-testid="stat-infra">
      {used.map((t) => (
        <span key={t.id} data-type={t.id} {...tip({ label: `${byType[t.id]} × ${t.label}`, side: 'bottom' })}>
          <span style={{ color: t.color }}>
            <InfraIconView name={t.icon} size={13} />
          </span>
          {byType[t.id]}
        </span>
      ))}
      {infraKw > 0 && <span className="muted">davon Infrastruktur {fmt(infraKw)} kW</span>}
    </div>
  );
}

function Warn({ count, pageId }: { count: WarningCount; pageId: string | null }) {
  if (!count.stands && !count.narrow) return <div className="stat-ok">keine Warnungen</div>;
  const parts = [
    count.infra ? `${count.infra} in Freihalteflächen` : '',
    count.overlap ? `${count.overlap} Überlappung${count.overlap === 1 ? '' : 'en'}` : '',
    count.outside ? `${count.outside} außerhalb` : '',
    count.duplicate ? `${count.duplicate} mit doppelter Nummer` : '',
    count.distance ? `${count.distance} zu nah an gleicher Kategorie` : '',
  ].filter(Boolean);
  const severe = count.overlap > 0 || count.infra > 0;
  return (
    <div className="stat-warn-row">
      {count.stands > 0 && (
        <button
          type="button"
          className={`stat-warn${severe ? ' overlap' : ''}`}
          data-testid="stat-warn"
          onClick={() => showWarnings(pageId)}
          {...tip({ label: `${parts.join(', ')} – in der Tabelle zeigen`, side: 'bottom', ariaLabel: false })}
        >
          <Icon name="warning" size={14} /> {count.stands} {count.stands === 1 ? 'Warnung' : 'Warnungen'}
        </button>
      )}
      {count.narrow > 0 && (
        <button
          type="button"
          className="stat-warn overlap"
          data-testid="stat-warn-infra"
          onClick={() => showInfraWarnings(pageId)}
          {...tip({ label: `${count.narrow} Durchfahrt${count.narrow === 1 ? '' : 'en'} zu eng – in der Infrastrukturliste zeigen`, side: 'bottom', ariaLabel: false })}
        >
          <Icon name="warning" size={14} /> {count.narrow} Infrastruktur
        </button>
      )}
    </div>
  );
}
