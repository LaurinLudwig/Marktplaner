import { fmt } from '../../core/format';
import { powerPercentLabel, type PowerSummary } from '../../core/power';

const LEVEL_TEXT = { ok: '', warn: 'ab 90 % des Limits', over: 'Limit überschritten', none: '' } as const;

/**
 * Strombalken (spec.md §6): grün, gelb ab 90 %, rot über dem Limit, mit „84 / 100 kW (84 %)“. Seitenleiste
 * (M5-08) und Kennzahlen der Start-Page (M6-01). Ohne Limit nichts.
 */
export function PowerMeter({ power, compact }: { power: Pick<PowerSummary, 'sumKw' | 'limitKw' | 'ratio' | 'level'>; compact?: boolean }) {
  const p = power;
  if (p.limitKw === null) return null;
  const pct = powerPercentLabel(p.sumKw, p.limitKw);
  return (
    <div className="power-meter" data-testid="power-meter" data-level={p.level}>
      <div
        className={`power-bar ${p.level}`}
        role="meter"
        aria-label="Stromsumme gegenüber dem Limit"
        aria-valuemin={0}
        aria-valuemax={p.limitKw}
        aria-valuenow={p.sumKw}
        aria-valuetext={`${fmt(p.sumKw)} von ${fmt(p.limitKw)} kW`}
      >
        <span style={{ width: `${Math.min(100, (p.ratio ?? 0) * 100)}%` }} />
      </div>
      <span className="power-text">
        {fmt(p.sumKw)} / {fmt(p.limitKw)} kW ({pct}){!compact && LEVEL_TEXT[p.level] && ` · ${LEVEL_TEXT[p.level]}`}
      </span>
    </div>
  );
}
