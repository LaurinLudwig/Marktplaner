import { useEffect, useRef, useState } from 'react';
import { confirm } from '../../app/dialogs';
import { fmt } from '../../core/format';
import { STAND_SHAPES, type ShapePart, type ShapeTemplate, type StandShape } from '../../core/model/types';
import { normalizeParts, partsInMeters, SHAPE_LABEL, shapePaths } from '../../core/shape';
import { deleteShapeTemplate, nextTemplateName, saveShapeTemplate, shapeTemplateUsage } from '../../state/shapes';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { NumberField } from '../panels/NumberField';
import { tip } from '../shortcuts/tip';

/**
 * Formvorlagen in den Projekteinstellungen (M12, #9, spec.md §3 „Form“, §7): Liste mit Vorschau, Anlegen und
 * Bearbeiten im Editor, Löschen mit Rückfrage, wenn Stände die Vorlage verwenden.
 */
export function ShapeTemplatesPanel() {
  const templates = useStore((s) => s.project.shapeTemplates);
  const [editing, setEditing] = useState<ShapeTemplate | 'new' | null>(null);
  return (
    <section className="panel" aria-label="Formvorlagen">
      <div className="panel-head">
        <span>Formvorlagen</span>
        <span className="panel-badge muted">projektweit</span>
        <div className="spacer" />
        <button type="button" className="icon-btn" data-testid="shape-add" onClick={() => setEditing('new')} {...tip({ label: 'Formvorlage anlegen', side: 'bottom' })}>
          <Icon name="add" size={16} />
        </button>
      </div>
      <div className="panel-body form">
        {!templates.length && (
          <p>Noch keine Formvorlagen. Mit „+“ eine Form aus Rechtecken und Kreisen/Ovalen zusammensetzen; Geschäfte wählen sie in der Seitenleiste unter „Form“.</p>
        )}
        {templates.map((t) => (
          <TemplateRow key={t.id} tpl={t} onEdit={() => setEditing(t)} />
        ))}
      </div>
      {editing && <ShapeEditor tpl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

async function confirmDelete(tpl: ShapeTemplate) {
  const n = shapeTemplateUsage(useStore.getState().project, tpl.id);
  if (n > 0) {
    const ok = await confirm(
      'Formvorlage löschen',
      `„${tpl.name}“ wird von ${n} ${n === 1 ? 'Geschäft' : 'Geschäften'} verwendet. Diese bekommen wieder ihre Grundform (Rechteck bzw. Kreis/Oval); die Maße bleiben. Rückgängig mit Strg/Cmd+Z möglich.`,
      'Löschen',
      true,
    );
    if (!ok) return;
  }
  deleteShapeTemplate(tpl.id);
}

function TemplateRow({ tpl, onEdit }: { tpl: ShapeTemplate; onEdit: () => void }) {
  const used = useStore((s) => shapeTemplateUsage(s.project, tpl.id));
  return (
    <div className="cat-row shape-row" data-testid="shape-row">
      <ShapePreview w={tpl.w} d={tpl.d} parts={tpl.parts} size={36} />
      <span className="grow shape-name">
        {tpl.name}
        <span className="hint">
          {' '}
          · {fmt(tpl.w)} × {fmt(tpl.d)} m
        </span>
      </span>
      <span className="cat-usage" data-testid="shape-usage" {...tip({ label: `${used} ${used === 1 ? 'Geschäft' : 'Geschäfte'} mit dieser Form`, side: 'top' })}>
        {used}
      </span>
      <button type="button" className="icon-btn" onClick={onEdit} {...tip({ label: `Formvorlage „${tpl.name}“ bearbeiten`, side: 'top' })}>
        <Icon name="edit" size={16} />
      </button>
      <button type="button" className="icon-btn" onClick={() => void confirmDelete(tpl)} {...tip({ label: `Formvorlage „${tpl.name}“ löschen`, side: 'top' })}>
        <Icon name="delete" size={16} />
      </button>
    </div>
  );
}

/**
 * Vorschau einer Form im Hüllrechteck w × d (Meter): Füllung, äußere Kontur, Hüllrechteck gestrichelt, Vorderseite
 * (Unterkante) orange. Dieselbe Geometrie wie auf der Zeichenfläche (`shapePaths`).
 */
function ShapePreview({ w, d, parts, size, labels = false }: { w: number; d: number; parts: readonly ShapePart[]; size: number; labels?: boolean }) {
  const stand = { cx: 0, cy: 0, w, d, rot: 0, shape: 'rect' as StandShape };
  const { fill, outline } = shapePaths(stand, { id: '', name: '', w, d, parts: [...parts] });
  const pad = Math.max(w, d) * (labels ? 0.12 : 0.06);
  const k = size / Math.max(w + 2 * pad, d + 2 * pad);
  return (
    <svg
      className="shape-preview"
      width={(w + 2 * pad) * k}
      height={(d + 2 * pad) * k}
      viewBox={`${-w / 2 - pad} ${-d / 2 - pad} ${w + 2 * pad} ${d + 2 * pad}`}
      role="img"
      aria-label={`Vorschau ${fmt(w)} × ${fmt(d)} m`}
    >
      <rect className="sp-hull" x={-w / 2} y={-d / 2} width={w} height={d} />
      <path className="sp-fill" d={fill} />
      <path className="sp-outline" d={outline} />
      <line className="sp-front" x1={-w / 2} y1={d / 2} x2={w / 2} y2={d / 2} />
      {labels && (
        <text className="sp-label" x={0} y={d / 2 + pad * 0.75} fontSize={pad * 0.5} textAnchor="middle">
          Vorderseite
        </text>
      )}
    </svg>
  );
}

const newPart = (parts: readonly ShapePart[]): ShapePart => {
  if (!parts.length) return { kind: 'ellipse', x: 0, y: 0, w: 6, h: 6 };
  const right = Math.max(...parts.map((p) => p.x + p.w));
  const top = Math.min(...parts.map((p) => p.y));
  return { kind: 'rect', x: right, y: top, w: 3, h: 3 };
};

/**
 * Editor einer Formvorlage: Name und Teile (Art, X, Y, B, T in Metern; X/Y = linke obere Ecke, die Vorderseite ist
 * unten). Übernehmen ist ein Undo-Schritt; das Hüllrechteck der Teile wird das Vorschlagsmaß.
 */
function ShapeEditor({ tpl, onClose }: { tpl: ShapeTemplate | null; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [name, setName] = useState(tpl?.name ?? nextTemplateName(project));
  const [parts, setParts] = useState<ShapePart[]>(tpl ? partsInMeters(tpl) : [newPart([])]);
  const used = tpl ? shapeTemplateUsage(project, tpl.id) : 0;
  const n = normalizeParts(parts);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setPart = (i: number, patch: Partial<ShapePart>) => setParts((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const apply = () => {
    if (saveShapeTemplate(tpl?.id ?? null, name, parts)) onClose();
  };

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shape-editor" role="dialog" aria-modal="true" aria-labelledby="se-title" data-testid="shape-editor">
        <h2 id="se-title">{tpl ? 'Formvorlage bearbeiten' : 'Neue Formvorlage'}</h2>
        <div className="se-body">
          <div className="se-form form">
            <div className="field">
              <label htmlFor="se-name">Name</label>
              <span className="inp">
                <input ref={nameRef} id="se-name" value={name} onChange={(e) => setName(e.target.value)} />
              </span>
            </div>
            <div className="se-parts" role="table" aria-label="Teile">
              <div className="se-row se-head" role="row">
                <span role="columnheader">Art</span>
                <span role="columnheader">X</span>
                <span role="columnheader">Y</span>
                <span role="columnheader">B</span>
                <span role="columnheader">T</span>
                <span />
              </div>
              {parts.map((p, i) => (
                <div className="se-row" role="row" key={i} data-testid="shape-part">
                  <select aria-label={`Art von Teil ${i + 1}`} value={p.kind} onChange={(e) => setPart(i, { kind: e.target.value as StandShape })}>
                    {STAND_SHAPES.map((k) => (
                      <option key={k} value={k}>
                        {SHAPE_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <NumberField id={`se-x-${i}`} className="se-num" label={`X von Teil ${i + 1}`} unit="m" value={p.x} min={-100} max={100} step={0.5} onCommit={(x) => setPart(i, { x })} />
                  <NumberField id={`se-y-${i}`} className="se-num" label={`Y von Teil ${i + 1}`} unit="m" value={p.y} min={-100} max={100} step={0.5} onCommit={(y) => setPart(i, { y })} />
                  <NumberField id={`se-w-${i}`} className="se-num" label={`Breite von Teil ${i + 1}`} unit="m" value={p.w} min={0.1} max={100} step={0.5} onCommit={(w) => setPart(i, { w })} />
                  <NumberField id={`se-h-${i}`} className="se-num" label={`Tiefe von Teil ${i + 1}`} unit="m" value={p.h} min={0.1} max={100} step={0.5} onCommit={(h) => setPart(i, { h })} />
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={parts.length === 1}
                    onClick={() => setParts((ps) => ps.filter((_, k) => k !== i))}
                    {...tip({ label: `Teil ${i + 1} entfernen`, side: 'top' })}
                  >
                    <Icon name="delete" size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn" data-testid="shape-part-add" onClick={() => setParts((ps) => [...ps, newPart(ps)])}>
              Teil hinzufügen
            </button>
            <p className="hint">
              X/Y ist die linke obere Ecke eines Teils, die Vorderseite liegt unten. Die Teile dürfen sich überlappen. Belegung, Warnungen und Fang
              rechnen mit dem Hüllrechteck.
            </p>
          </div>
          <div className="se-preview">
            {n ? <ShapePreview w={n.w} d={n.d} parts={n.parts} size={220} labels /> : <p className="hint">Keine gültigen Teile.</p>}
            {n && (
              <p className="hint" data-testid="shape-size">
                Vorschlagsmaß {fmt(n.w)} × {fmt(n.d)} m
              </p>
            )}
          </div>
        </div>
        {used > 0 && (
          <p className="hint">
            {used} {used === 1 ? 'Geschäft verwendet' : 'Geschäfte verwenden'} diese Vorlage und {used === 1 ? 'behält' : 'behalten'} ihr Maß; die
            Form wird darauf gestreckt.
          </p>
        )}
        <div className="buttons">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn primary" disabled={!n} onClick={apply}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
