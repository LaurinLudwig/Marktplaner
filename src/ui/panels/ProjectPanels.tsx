import { loadListInteractive } from '../../app/categoryLists';
import { confirm } from '../../app/dialogs';
import { LABEL_PLACEHOLDERS } from '../../core/label';
import { MIN_FREE_WIDTH } from '../../core/freeSpace';
import type { Category, FestplatzPage, LayerId } from '../../core/model/types';
import { SNAP_GAP_LIMITS } from '../../core/model/schema';
import { DEFAULT_STAND_COLOR } from '../../core/objects';
import {
  addCategory,
  categoryUsage,
  deleteCategory,
  setDefaultStandColor,
  setLabelFontSize,
  setLabelTemplate,
  setMinFreeWidth,
  setSnapGap,
  setWarningsEnabled,
  updateCategory,
} from '../../state/objects';
import { setLayer } from '../../state/pageSettings';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { tip } from '../shortcuts/tip';
import { ColorField, NativeColor } from './ColorField';
import { NumberField } from './NumberField';
import { TextField } from './TextField';

/** Projektweite Beschriftung (Projekteinstellungen der Start-Page, M6-05; bis M5 in der Seitenleiste). */
export function LabelPanel() {
  const template = useStore((s) => s.project.settings.labelTemplate);
  const fontSize = useStore((s) => s.project.settings.labelFontSize);
  return (
    <section className="panel" aria-label="Beschriftung">
      <div className="panel-head">
        <span>Beschriftung</span>
        <span className="panel-badge muted">projektweit</span>
      </div>
      <div className="panel-body form">
        <TextField id="label-template" label="Vorlage für Geschäfte" value={template} multiline rows={3} onCommit={setLabelTemplate} />
        <p className="hint">Platzhalter: {LABEL_PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}. Leere Zeilen entfallen. Cmd/Strg+Enter übernimmt.</p>
        <div className="fields-2">
          <NumberField id="label-size" label="Schriftgröße" unit="m" value={fontSize} min={0.05} max={20} step={0.1} onCommit={setLabelFontSize} />
          <p className="hint align-end">in Planeinheiten, gilt auch für Grundflächen</p>
        </div>
      </div>
    </section>
  );
}

/** Freiflächen und Warnungen (projektweit, Projekteinstellungen; M4-03, M4-09, M4-10, M5-10, M6-07). */
export function FreeSpacePanel() {
  const minWidth = useStore((s) => s.project.settings.minFreeWidth);
  const warnOutside = useStore((s) => s.project.settings.warnOutside);
  const warnOverlap = useStore((s) => s.project.settings.warnOverlap);
  const warnDuplicateNr = useStore((s) => s.project.settings.warnDuplicateNr);
  return (
    <section className="panel" aria-label="Freiflächen und Warnungen">
      <div className="panel-head">
        <span>Freiflächen &amp; Warnungen</span>
        <span className="panel-badge muted">projektweit</span>
      </div>
      <div className="panel-body form">
        <div className="fields-2">
          <NumberField id="free-min-width" label="Mindestbreite" unit="m" value={minWidth} min={MIN_FREE_WIDTH.min} max={MIN_FREE_WIDTH.max} step={0.1} onCommit={setMinFreeWidth} />
          <p className="hint align-end">schmalere Lücken werden nicht als Freifläche angezeigt</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={warnOutside} onChange={(e) => setWarningsEnabled('outside', e.target.checked)} />
          Warnung, wenn ein Geschäft außerhalb der Grundflächen steht
        </label>
        <label className="check">
          <input type="checkbox" checked={warnOverlap} onChange={(e) => setWarningsEnabled('overlap', e.target.checked)} />
          Warnung, wenn sich Geschäfte überlappen
        </label>
        <label className="check">
          <input type="checkbox" checked={warnDuplicateNr} onChange={(e) => setWarningsEnabled('duplicate', e.target.checked)} />
          Warnung bei doppelten Platznummern
        </label>
      </div>
    </section>
  );
}

/** Kategorien (projektweit, Projekteinstellungen): anlegen, umbenennen, umfärben, löschen; mit Zahl der Geschäfte. */
/** Fang an Nachbarständen (#2): Abstand, mit dem ein Stand neben einem anderen einrastet. */
export function SnapPanel() {
  const gap = useStore((s) => s.project.settings.snapGap);
  return (
    <section className="panel" aria-label="Fang">
      <div className="panel-head">
        <span>Fang</span>
        <span className="panel-badge muted">projektweit</span>
      </div>
      <div className="panel-body form">
        <div className="fields-2">
          <NumberField id="snap-gap" label="Abstand zu Nachbarständen" unit="m" value={gap} min={SNAP_GAP_LIMITS.min} max={SNAP_GAP_LIMITS.max} step={0.1} digits={2} onCommit={setSnapGap} />
          <p className="hint align-end">Gasse beim Einrasten neben einem Stand; 0 = bündig</p>
        </div>
      </div>
    </section>
  );
}

export function CategoryPanel() {
  const categories = useStore((s) => s.project.categories);
  const defaultColor = useStore((s) => s.project.settings.defaultStandColor);
  return (
    <section className="panel" aria-label="Kategorien">
      <div className="panel-head">
        <span>Kategorien</span>
        <span className="panel-badge muted">projektweit</span>
        <div className="spacer" />
        <button type="button" className="icon-btn" onClick={() => void loadListInteractive()} {...tip({ label: 'Kategorieliste laden …', side: 'bottom' })}>
          <Icon name="loadList" size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => addCategory()} {...tip({ label: 'Kategorie anlegen', side: 'bottom' })}>
          <Icon name="add" size={16} />
        </button>
      </div>
      <div className="panel-body form">
        <ColorField
          id="default-stand-color"
          label="Standardfarbe (Geschäfte ohne Kategorie)"
          value={defaultColor}
          onCommit={setDefaultStandColor}
          onReset={() => setDefaultStandColor(DEFAULT_STAND_COLOR)}
          resetLabel="Standardfarbe zurücksetzen (Grau)"
          canReset={defaultColor.toLowerCase() !== DEFAULT_STAND_COLOR}
        />
        {!categories.length && <p>Noch keine Kategorien. Mit „+“ anlegen oder eine fertige Liste laden; Geschäfte übernehmen die Farbe ihrer Kategorie.</p>}
        {categories.map((c) => (
          <CategoryRow key={c.id} cat={c} />
        ))}
      </div>
    </section>
  );
}

async function confirmDeleteCategory(cat: Category) {
  const n = categoryUsage(useStore.getState().project, cat.id);
  if (n > 0) {
    const ok = await confirm(
      'Kategorie löschen',
      `„${cat.name}“ wird von ${n} ${n === 1 ? 'Geschäft' : 'Geschäften'} verwendet. Diese verlieren die Kategorie (Farbe: eigene Farbe bzw. Standardfarbe). Rückgängig mit Strg/Cmd+Z möglich.`,
      'Löschen',
      true,
    );
    if (!ok) return;
  }
  deleteCategory(cat.id);
}

function CategoryRow({ cat }: { cat: Category }) {
  const used = useStore((s) => categoryUsage(s.project, cat.id));
  return (
    <div className="cat-row" data-testid="category-row">
      <NativeColor id={`cat-color-${cat.id}`} value={cat.color} label={`Farbe von „${cat.name}“`} onCommit={(color) => updateCategory(cat.id, { color })} />
      <TextField id={`cat-name-${cat.id}`} className="grow" label="Name" value={cat.name} onCommit={(name) => name.trim() && updateCategory(cat.id, { name: name.trim() })} />
      <span className="cat-usage" data-testid="category-usage" {...tip({ label: `${used} ${used === 1 ? 'Geschäft' : 'Geschäfte'} mit dieser Kategorie`, side: 'top' })}>
        {used}
      </span>
      <button type="button" className="icon-btn" onClick={() => void confirmDeleteCategory(cat)} {...tip({ label: `Kategorie „${cat.name}“ löschen`, side: 'top' })}>
        <Icon name="delete" size={16} />
      </button>
    </div>
  );
}

const LAYER_LABEL: Record<LayerId, string> = {
  background: 'Hintergrund',
  areas: 'Grundflächen',
  free: 'Freiflächen',
  stands: 'Geschäfte',
  infra: 'Infrastruktur',
  labels: 'Beschriftung',
  sheet: 'Blatt',
};

/** Ebenen der Page: ein-/ausblenden und sperren (Ansichtseinstellung; Hintergrund-Sperre wie in §1). */
export function LayersPanel({ page }: { page: FestplatzPage }) {
  const present: LayerId[] = [];
  if (page.background) present.push('background');
  if (page.areas.length) present.push('areas');
  if (page.areas.length) present.push('free');
  if (page.stands.length) present.push('stands');
  if (page.infra.length) present.push('infra');
  if (page.areas.length || page.stands.length || page.infra.length) present.push('labels');
  // Das Blatt (M7) gibt es auf jeder Page; die Liste erscheint ab dem ersten Objekt
  if (present.length) present.push('sheet');
  return (
    <section className="panel" aria-label="Ebenen">
      <div className="panel-head">Ebenen</div>
      <div className="panel-body">
        {!present.length && <p>Ebenen erscheinen, sobald es Objekte gibt.</p>}
        <ul className="layers">
          {present.map((id) => {
            const l = page.layers[id];
            const locked = id === 'background' ? !!page.background?.locked : l.locked;
            return (
              <li key={id} className={l.visible ? '' : 'off'}>
                <button
                  type="button"
                  className="icon-btn"
                  aria-pressed={l.visible}
                  onClick={() => setLayer(page.id, id, { visible: !l.visible })}
                  {...tip({ label: `${LAYER_LABEL[id]} ${l.visible ? 'ausblenden' : 'einblenden'}`, side: 'top' })}
                >
                  <Icon name={l.visible ? 'visible' : 'hidden'} size={16} />
                </button>
                {id === 'labels' || id === 'free' ? (
                  <span className="icon-btn-placeholder" />
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-pressed={locked}
                    onClick={() => setLayer(page.id, id, { locked: !locked })}
                    {...tip({ label: `${LAYER_LABEL[id]} ${locked ? 'entsperren' : 'sperren'}`, side: 'top' })}
                  >
                    <Icon name={locked ? 'lock' : 'unlock'} size={16} />
                  </button>
                )}
                <span className="layer-name">{LAYER_LABEL[id]}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
