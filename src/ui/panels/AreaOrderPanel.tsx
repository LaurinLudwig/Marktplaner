import { changeUseAreas } from '../../app/areasToggle';
import { areaLabel } from '../../core/label';
import type { FestplatzPage } from '../../core/model/types';
import { moveArea } from '../../state/numbering';
import { select } from '../../state/objects';
import { Icon } from '../icons/Icon';
import { tip } from '../shortcuts/tip';

/**
 * Grundflächen der Page: Schalter „Grundflächen verwenden“ (#17, spec.md §2) und, ab zwei Grundflächen, ihre
 * Reihenfolge (spec.md §4, §5): Bei Überlappung gewinnt die obere. Für die Nummerierung spielt sie keine Rolle.
 */
export function AreaOrderPanel({ page }: { page: FestplatzPage }) {
  const hidden = page.useAreas ? 0 : page.areas.length;
  return (
    <section className="panel" aria-label="Grundflächen">
      <div className="panel-head">Grundflächen</div>
      <div className="panel-body form">
        <label className="check" title="Aus: offener Platz ohne Grundflächen, z. B. Stände rund um einen Brunnen">
          <input type="checkbox" data-testid="use-areas" checked={page.useAreas} onChange={(e) => void changeUseAreas(page.id, e.target.checked)} />
          Grundflächen verwenden
        </label>
        {!page.useAreas && (
          <p className="hint" data-testid="use-areas-hint">
            Ohne Grundflächen: keine Warnung „außerhalb“, keine Freiflächen, kein Fang an der Vorderseite.
            {hidden > 0 && (hidden === 1 ? ' Eine Grundfläche ist ausgeblendet und wirkt nicht.' : ` ${hidden} Grundflächen sind ausgeblendet und wirken nicht.`)}
          </p>
        )}
        {page.useAreas && page.areas.length >= 2 && (
          <>
            <ol className="area-order" data-testid="area-order">
              {page.areas.map((a, i) => (
                <li key={a.id}>
                  <span className="area-order-nr">{i + 1}</span>
                  <button type="button" className="area-order-name" onClick={() => select([a.id])} title="Grundfläche auswählen">
                    {a.name.trim() ? areaLabel(a) : `ohne Namen · ${areaLabel(a)}`}
                  </button>
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveArea(page.id, a.id, -1)} {...tip({ label: 'Nach oben (gewinnt bei Überlappung)', side: 'top' })}>
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="icon-btn" disabled={i === page.areas.length - 1} onClick={() => moveArea(page.id, a.id, 1)} {...tip({ label: 'Nach unten', side: 'top' })}>
                    <Icon name="down" size={16} />
                  </button>
                </li>
              ))}
            </ol>
            <p className="hint">Überlappen sich Grundflächen, gewinnt die obere: Die untere rechnet ihre Freiflächen nur mit ihrem Rest.</p>
          </>
        )}
      </div>
    </section>
  );
}
