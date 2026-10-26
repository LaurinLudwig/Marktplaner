import { fmt } from '../../core/format';
import { CONNECTION_LABEL } from '../../core/label';
import type { FestplatzPage } from '../../core/model/types';
import { CONNECTION_KEYS, pagePower, POWER_LIMIT, poweredInfra } from '../../core/power';
import { setBlockOverLimit, setPowerLimit } from '../../state/pageSettings';
import { NumberField } from './NumberField';
import { PowerMeter } from './PowerMeter';

/**
 * Strom der Festplatz-Page (M5-07 bis M5-11): Limit, Blockieren, Balken (grün, gelb ab 90 %, rot über
 * dem Limit) und Summen je Anschlussart. Immer sichtbar, auch bei Auswahl (spec.md §6).
 */
export function PowerPanel({ page }: { page: FestplatzPage }) {
  const p = pagePower(page);
  // Mit Infrastruktur-Objekten (M7) zählt die Tabelle Objekte statt nur Stände
  const withInfra = poweredInfra(page.infra).length > 0;
  const noun = (n: number) => (withInfra ? (n === 1 ? 'Objekt' : 'Objekte') : n === 1 ? 'Stand' : 'Stände');
  return (
    <section className="panel" aria-label="Strom">
      <div className="panel-head">
        <span>Strom</span>
        <span className={`panel-badge power-${p.level}`} data-testid="power-sum">
          {p.limitKw === null ? `${fmt(p.sumKw)} kW` : `${fmt(p.sumKw)} / ${fmt(p.limitKw)} kW`}
        </span>
      </div>
      <div className="panel-body form">
        <PowerMeter power={p} />
        <div className="fields-2">
          <NumberField
            id="power-limit"
            label="Limit"
            unit="kW"
            value={page.powerLimitKw}
            min={POWER_LIMIT.min}
            max={POWER_LIMIT.max}
            step={10}
            placeholder="kein Limit"
            onCommit={(v) => setPowerLimit(page.id, v)}
            onClear={() => setPowerLimit(page.id, null)}
          />
          <label className="check align-end">
            <input type="checkbox" checked={page.blockOverLimit} disabled={page.powerLimitKw === null} onChange={(e) => setBlockOverLimit(page.id, e.target.checked)} />
            Überschreitung blockieren
          </label>
        </div>
        <table className="power-table" data-testid="power-table">
          <tbody>
            {CONNECTION_KEYS.map((k) => (
              <tr key={k} className={p.byConnection[k].count ? '' : 'empty'}>
                <th>{k === 'none' ? 'ohne Angabe' : CONNECTION_LABEL[k]}</th>
                <td>
                  {p.byConnection[k].count} {noun(p.byConnection[k].count)}
                </td>
                <td>{fmt(p.byConnection[k].kw)} kW</td>
              </tr>
            ))}
          </tbody>
        </table>
        {withInfra && (
          <p className="hint" data-testid="power-infra">
            davon Infrastruktur {fmt(p.infraKw)} kW
          </p>
        )}
        <p className="hint">Es zählen alle Geschäfte und Infrastruktur-Objekte mit Strom des Festplatzes. Leeres Limit = kein Limit.</p>
      </div>
    </section>
  );
}
