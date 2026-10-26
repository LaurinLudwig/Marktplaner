import { areaLabel } from '../../core/label';
import type { FestplatzPage } from '../../core/model/types';
import { moveArea } from '../../state/numbering';
import { select } from '../../state/objects';
import { Icon } from '../icons/Icon';
import { tip } from '../shortcuts/tip';

/**
 * Reihenfolge der Grundflächen der Page (spec.md §4, §5): Bei Überlappung gewinnt die obere. Für die
 * Nummerierung spielt sie keine Rolle. Erscheint ab zwei Grundflächen.
 */
export function AreaOrderPanel({ page }: { page: FestplatzPage }) {
  if (page.areas.length < 2) return null;
  return (
    <section className="panel" aria-label="Grundflächen">
      <div className="panel-head">Grundflächen</div>
      <div className="panel-body form">
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
      </div>
    </section>
  );
}
