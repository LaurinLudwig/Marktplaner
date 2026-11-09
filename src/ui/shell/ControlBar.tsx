import { runCommand } from '../../app/commands';
import { roundRect } from '../../core/geometry/rect';
import { typeMap } from '../../core/infra';
import { groupCenter } from '../../core/transform';
import { moveGroupTo, newObjectsPage, setNewObjectsPage, setRectField } from '../../state/objects';
import { memberPages } from '../../core/verbund';
import { overviewTitle, verbundOfRef } from '../../core/verbundView';
import type { Verbund } from '../../core/model/types';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { NumberField } from '../panels/NumberField';
import { common, dimSpec, selectionTitle, useSelectedObjects } from '../panels/selection';
import { tip } from '../shortcuts/tip';

/**
 * Kontextabhängige Steuerungsleiste: X, Y (Mittelpunkt), Breite, Tiefe und Drehung der Auswahl.
 * Bei Mehrfachauswahl verschieben X/Y die Mitte der Auswahl; unterschiedliche Werte bleiben leer,
 * eine Eingabe gilt für alle ausgewählten Objekte. Jede Eingabe ist ein Undo-Schritt.
 */
export function ControlBar() {
  const verbund = useStore((s) => verbundOfRef(s.project, s.ui.activePage));
  const pageName = useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePage)?.name ?? '');
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const bgSelected = useStore((s) => s.ui.selection?.kind === 'background');
  const sel = useSelectedObjects();
  return (
    <div className="controlbar">
      <span className="title">{verbund ? overviewTitle(verbund) : pageName}</span>
      {sel ? <SelectionFields sel={sel} /> : <span>{bgSelected ? 'Hintergrund ausgewählt' : 'Keine Auswahl'}</span>}
      <div className="spacer" />
      {verbund && <NewObjectsOn verbund={verbund} />}
      <button
        type="button"
        className="icon-btn"
        aria-pressed={sidebarOpen}
        onClick={() => runCommand('ui.sidebar')}
        {...tip({ shortcut: 'ui.sidebar', label: sidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden' })}
      >
        <Icon name={sidebarOpen ? 'sidebarClose' : 'sidebarOpen'} />
      </button>
    </div>
  );
}

/**
 * „Neue Objekte auf: …“ (#15, nur in der Gesamtansicht): Platz für neue Objekte, die auf mehreren oder auf keiner
 * Grundfläche stehen (sonst gehören sie dem Platz ihrer Grundfläche). Nur für die Sitzung, kein Undo-Schritt.
 */
function NewObjectsOn({ verbund }: { verbund: Verbund }) {
  const pages = useStore((s) => s.project.pages);
  useStore((s) => s.ui.newObjectsOn[verbund.id]);
  const members = memberPages({ pages }, verbund);
  const value = newObjectsPage(verbund.id) ?? '';
  return (
    <label
      className="cb-new-objects"
      {...tip({ label: 'Neue Objekte auf', desc: 'Neue Objekte gehören dem Platz, auf dessen Grundfläche sie stehen. Stehen sie auf mehreren oder auf keiner, gehören sie diesem Platz.', side: 'bottom', ariaLabel: false })}
    >
      <span>Neue Objekte auf:</span>
      <select data-testid="new-objects-on" value={value} onChange={(e) => setNewObjectsPage(verbund.id, e.target.value)}>
        {members.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectionFields({ sel }: { sel: NonNullable<ReturnType<typeof useSelectedObjects>> }) {
  const { page, objects } = sel;
  const ids = objects.map((o) => o.obj.id);
  const rects = objects.map((o) => roundRect(o.obj));
  const c = groupCenter(rects)!;
  const infraTypes = useStore((s) => s.project.infraTypes);
  const types = typeMap(infraTypes);
  const dims = dimSpec(objects, (id) => types.get(id)?.geometry);
  return (
    <div className="cb-fields" aria-label="Steuerungsleiste">
      <span className="cb-kind">{selectionTitle(objects, types)}</span>
      <NumberField className="inline" id="cb-x" label="X" unit="m" value={c.x} step={0.1} onCommit={(x) => moveGroupTo(page.id, ids, { x })} />
      <NumberField className="inline" id="cb-y" label="Y" unit="m" value={c.y} step={0.1} onCommit={(y) => moveGroupTo(page.id, ids, { y })} />
      {dims.w && <NumberField className="inline" id="cb-w" label={dims.w.label} unit="m" value={common(rects.map((r) => r.w))} min={dims.w.min} max={dims.w.max} step={0.1} onCommit={(v) => setRectField(page.id, ids, 'w', v)} />}
      {dims.d && <NumberField className="inline" id="cb-d" label={dims.d.label} unit="m" value={common(rects.map((r) => r.d))} min={dims.d.min} max={dims.d.max} step={0.1} onCommit={(v) => setRectField(page.id, ids, 'd', v)} />}
      {dims.rot && <NumberField className="inline" id="cb-rot" label="Drehung" unit="°" value={common(rects.map((r) => r.rot))} min={-360} max={360} step={1} digits={1} onCommit={(v) => setRectField(page.id, ids, 'rot', v)} />}
    </div>
  );
}
