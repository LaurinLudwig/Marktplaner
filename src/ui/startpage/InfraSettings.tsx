import { confirm } from '../../app/dialogs';
import { INFRA_ICONS, INFRA_LIMITS } from '../../core/infra';
import type { InfraGeometry, InfraTypeDef } from '../../core/model/types';
import { MIN_PASSAGE_LIMITS } from '../../core/model/schema';
import { setMinPassageWidth, setPassageWarningEnabled, setWarningsEnabled } from '../../state/objects';
import { addInfraType, deleteInfraType, infraTypeUsage, updateInfraType } from '../../state/infraTypes';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { INFRA_ICON_LABEL, InfraIconView } from '../icons/infraIcons';
import { NativeColor } from '../panels/ColorField';
import { NumberField } from '../panels/NumberField';
import { TitleBlockFields } from '../panels/PaperPanels';
import { TextField } from '../panels/TextField';
import { tip } from '../shortcuts/tip';

const GEOMETRY_LABEL: Record<InfraGeometry, string> = { rect: 'Rechteck', line: 'Linie', point: 'Punkt' };

/** Warnungen der Infrastruktur und Mindestbreite der Durchfahrt (projektweit, M7-07). */
export function InfraWarningsPanel() {
  const s = useStore((st) => st.project.settings);
  return (
    <section className="panel" aria-label="Infrastruktur-Warnungen">
      <div className="panel-head">
        <span>Sicherheit</span>
        <span className="panel-badge muted">projektweit</span>
      </div>
      <div className="panel-body form">
        <label className="check">
          <input type="checkbox" checked={s.warnInfra} onChange={(e) => setWarningsEnabled('infra', e.target.checked)} />
          Warnung, wenn ein Geschäft in einer Freihaltefläche steht (RTW-Platz, Durchfahrt, Sperre …)
        </label>
        <label className="check">
          <input type="checkbox" checked={s.warnPassageWidth} onChange={(e) => setPassageWarningEnabled(e.target.checked)} />
          Warnung, wenn eine enge Durchfahrt schmaler als die Mindestbreite ist
        </label>
        <div className="fields-2">
          <NumberField id="passage-min-width" label="Mindestbreite Durchfahrt" unit="m" value={s.minPassageWidth} min={MIN_PASSAGE_LIMITS.min} max={MIN_PASSAGE_LIMITS.max} step={0.1} onCommit={setMinPassageWidth} />
          <p className="hint align-end">lichte Breite, z. B. 3,5 m für Rettungswege</p>
        </div>
      </div>
    </section>
  );
}

/** Infrastruktur-Typen (M7-08): feste Typen anpassen, eigene anlegen, ändern und löschen. */
export function InfraTypesPanel() {
  const types = useStore((s) => s.project.infraTypes);
  return (
    <section className="panel" aria-label="Infrastruktur-Typen">
      <div className="panel-head">
        <span>Infrastruktur-Typen</span>
        <span className="panel-badge muted">projektweit</span>
        <div className="spacer" />
        <button type="button" className="icon-btn" onClick={() => addInfraType()} {...tip({ label: 'Eigenen Typ anlegen', desc: 'z. B. Bühne, Info-Stand, Feuerwehrzufahrt', side: 'bottom' })}>
          <Icon name="add" size={16} />
        </button>
      </div>
      <div className="panel-body form">
        {types.map((t) => (
          <InfraTypeRow key={t.id} type={t} />
        ))}
        <p className="hint">„belegt Fläche“: an dieser Stelle entsteht keine Freifläche. „freihalten“: ein Geschäft darin bekommt eine rote Warnung.</p>
      </div>
    </section>
  );
}

async function confirmDelete(t: InfraTypeDef) {
  const n = infraTypeUsage(useStore.getState().project, t.id);
  if (n > 0) {
    const ok = await confirm('Infrastruktur-Typ löschen', `„${t.label}“ wird von ${n} ${n === 1 ? 'Objekt' : 'Objekten'} verwendet. Diese werden mitgelöscht. Rückgängig mit Strg/Cmd+Z möglich.`, 'Löschen', true);
    if (!ok) return;
  }
  deleteInfraType(t.id);
}

function InfraTypeRow({ type: t }: { type: InfraTypeDef }) {
  const used = useStore((s) => infraTypeUsage(s.project, t.id));
  const lim = INFRA_LIMITS[t.geometry];
  const dims = t.geometry === 'rect' ? (['Breite', 'Tiefe'] as const) : t.geometry === 'line' ? (['Länge', 'Stärke'] as const) : null;
  return (
    <div className="infra-type-row" data-testid="infra-type-row" data-type={t.id}>
      <div className="cat-row">
        <NativeColor id={`it-color-${t.id}`} value={t.color} label={`Farbe von „${t.label}“`} onCommit={(color) => updateInfraType(t.id, { color })} />
        <span className="it-icon" style={{ color: t.color }}>
          <InfraIconView name={t.icon} size={18} />
        </span>
        <TextField id={`it-name-${t.id}`} className="grow" label="Name" value={t.label} onCommit={(label) => label.trim() && updateInfraType(t.id, { label: label.trim() })} />
        <span className="cat-usage" {...tip({ label: `${used} ${used === 1 ? 'Objekt' : 'Objekte'} dieses Typs`, side: 'top' })}>
          {used}
        </span>
        {!t.builtin ? (
          <button type="button" className="icon-btn" onClick={() => void confirmDelete(t)} {...tip({ label: `Typ „${t.label}“ löschen`, side: 'top' })}>
            <Icon name="delete" size={16} />
          </button>
        ) : (
          <span className="icon-btn-placeholder" />
        )}
      </div>
      <div className="it-fields">
        <div className="field">
          <label htmlFor={`it-geo-${t.id}`}>Geometrie</label>
          <select id={`it-geo-${t.id}`} value={t.geometry} disabled={t.builtin || used > 0} onChange={(e) => updateInfraType(t.id, { geometry: e.target.value as InfraGeometry })}>
            {(['rect', 'line', 'point'] as const).map((g) => (
              <option key={g} value={g}>
                {GEOMETRY_LABEL[g]}
              </option>
            ))}
          </select>
        </div>
        {!t.builtin && (
          <div className="field">
            <label htmlFor={`it-icon-${t.id}`}>Symbol</label>
            <select id={`it-icon-${t.id}`} value={t.icon} onChange={(e) => updateInfraType(t.id, { icon: e.target.value })}>
              {INFRA_ICONS.map((i) => (
                <option key={i} value={i}>
                  {INFRA_ICON_LABEL[i]}
                </option>
              ))}
            </select>
          </div>
        )}
        {dims && (
          <>
            <NumberField id={`it-w-${t.id}`} label={dims[0]} unit="m" value={t.defaultW} min={lim.w.min} max={lim.w.max} step={0.5} onCommit={(defaultW) => updateInfraType(t.id, { defaultW })} />
            <NumberField id={`it-d-${t.id}`} label={dims[1]} unit="m" value={t.defaultD} min={lim.d.min} max={lim.d.max} step={0.1} onCommit={(defaultD) => updateInfraType(t.id, { defaultD })} />
          </>
        )}
      </div>
      {t.geometry !== 'point' && (
        <div className="it-checks">
          <label className="check">
            <input type="checkbox" checked={t.occupiesArea} onChange={(e) => updateInfraType(t.id, { occupiesArea: e.target.checked })} />
            belegt Fläche
          </label>
          <label className="check">
            <input type="checkbox" checked={t.keepClear} onChange={(e) => updateInfraType(t.id, { keepClear: e.target.checked })} />
            freihalten
          </label>
        </div>
      )}
    </div>
  );
}

/** Projektweite Felder des Schriftfelds (M7-11): Datum und Version. */
export function TitleBlockSettingsPanel() {
  return (
    <section className="panel" aria-label="Schriftfeld">
      <div className="panel-head">
        <span>Schriftfeld</span>
        <span className="panel-badge muted">alle Pages</span>
      </div>
      <div className="panel-body form">
        <TitleBlockFields />
        <p className="hint">Projektname und Festplatz kommen automatisch dazu, der Maßstab aus dem Blatt der Page. Freitext und Lage stellst du je Page ein.</p>
      </div>
    </section>
  );
}
