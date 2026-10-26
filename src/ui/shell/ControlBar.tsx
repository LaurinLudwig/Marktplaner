import { runCommand } from '../../app/commands';
import { roundRect } from '../../core/geometry/rect';
import { typeMap } from '../../core/infra';
import { groupCenter } from '../../core/transform';
import { moveGroupTo, setRectField } from '../../state/objects';
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
  const pageName = useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePage)?.name ?? '');
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const bgSelected = useStore((s) => s.ui.selection?.kind === 'background');
  const sel = useSelectedObjects();
  return (
    <div className="controlbar">
      <span className="title">{pageName}</span>
      {sel ? <SelectionFields sel={sel} /> : <span>{bgSelected ? 'Hintergrund ausgewählt' : 'Keine Auswahl'}</span>}
      <div className="spacer" />
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
