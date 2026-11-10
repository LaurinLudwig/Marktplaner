import { useState } from 'react';
import { confirm } from '../../app/dialogs';
import { fmt } from '../../core/format';
import type { FestplatzPage, Verbund } from '../../core/model/types';
import { groupOf, pagePivot, placementOf, worldPage } from '../../core/verbund';
import { useStore } from '../../state/store';
import { addMember, addVerbund, deleteVerbund, moveMember, removeMember, renameVerbund, resetPlacement, setPlacement, setPlacementRotation } from '../../state/verbund';
import { Icon } from '../icons/Icon';
import { NumberField } from '../panels/NumberField';
import { TextField } from '../panels/TextField';
import { tip } from '../shortcuts/tip';

/**
 * Festplatz-Verbünde in den Projekteinstellungen (#15, spec.md „Verbund / Gesamtansicht“): anlegen, umbenennen,
 * löschen; Mitglieder aufnehmen, herausnehmen und ordnen; je Mitglied die Lage im Verbund (Verschiebung und Drehung,
 * #27 – der Inhalt der Page und ihre Einzelansicht bleiben). Jede Änderung ist ein Undo-Schritt.
 */
export function VerbundPanel() {
  const groups = useStore((s) => s.project.groups);
  return (
    <section className="panel" aria-label="Festplatz-Verbünde" data-testid="verbund-panel">
      <div className="panel-head">
        <span>Festplatz-Verbünde</span>
        <div className="spacer" />
        <button type="button" className="icon-btn" data-testid="verbund-add" onClick={() => addVerbund()} {...tip({ label: 'Verbund anlegen', side: 'bottom' })}>
          <Icon name="add" size={16} />
        </button>
      </div>
      <div className="panel-body form">
        {!groups.length && (
          <p>
            Noch kein Verbund. Plätze, die aneinandergrenzen und sich am Rand überschneiden (z. B. „Unterstadt“), lassen sich mit „+“ zu einem
            Verbund zusammenfassen. Dann zeigt jeder Platz die Stände der Nachbarplätze blass an und rechnet Freiflächen und Warnungen mit ihnen.
          </p>
        )}
        {groups.map((g) => (
          <VerbundCard key={g.id} verbund={g} />
        ))}
      </div>
    </section>
  );
}

async function confirmDelete(g: Verbund) {
  const ok = await confirm(
    'Verbund löschen',
    `Verbund „${g.name}“ löschen? Die Festplätze bleiben unverändert (eigene Koordinaten), ihre Lage im Verbund geht verloren und sie zeigen keine Nachbarn mehr. Rückgängig mit Strg/Cmd+Z möglich.`,
    'Löschen',
    true,
  );
  if (ok) deleteVerbund(g.id);
}

export function VerbundCard({ verbund: g }: { verbund: Verbund }) {
  const pages = useStore((s) => s.project.pages);
  const groups = useStore((s) => s.project.groups);
  const [lageOf, setLageOf] = useState<string | null>(null);
  const members = g.pageIds.flatMap((id) => pages.find((p) => p.id === id) ?? []);
  // Eine Page gehört zu höchstens einem Verbund: angeboten werden nur Pages ohne Verbund
  const free = pages.filter((p) => !groupOf({ groups }, p.id));
  return (
    <div className="verbund-card" data-testid="verbund-row" data-id={g.id}>
      <div className="verbund-head">
        <TextField id={`verbund-name-${g.id}`} label="Name" value={g.name} onCommit={(v) => void renameVerbund(g.id, v)} className="grow" />
        <button type="button" className="icon-btn align-end" data-testid="verbund-delete" onClick={() => void confirmDelete(g)} {...tip({ label: `Verbund „${g.name}“ löschen`, side: 'top' })}>
          <Icon name="delete" size={16} />
        </button>
      </div>
      <div className="field">
        <label>Festplätze</label>
        {!members.length && <p className="hint">Noch keine Festplätze. Unten einen Festplatz aufnehmen.</p>}
        {members.map((p, i) => (
          <div key={p.id}>
            <div className="cat-row verbund-member" data-testid="verbund-member" data-id={p.id}>
              <span className="grow">{p.name}</span>
              <button type="button" className={`icon-btn${lageOf === p.id ? ' active' : ''}`} data-testid="verbund-lage" onClick={() => setLageOf(lageOf === p.id ? null : p.id)} {...tip({ label: `Lage von „${p.name}“ ändern`, desc: 'Verschiebung und Drehung im Verbund; die Einzelansicht bleibt', side: 'top' })}>
                <Icon name="center" size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveMember(g.id, p.id, -1)} {...tip({ label: 'Nach oben', side: 'top' })}>
                <Icon name="up" size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={i === members.length - 1} onClick={() => moveMember(g.id, p.id, 1)} {...tip({ label: 'Nach unten', side: 'top' })}>
                <Icon name="down" size={16} />
              </button>
              <button type="button" className="icon-btn" data-testid="verbund-member-remove" onClick={() => removeMember(g.id, p.id)} {...tip({ label: `„${p.name}“ aus dem Verbund nehmen`, side: 'top' })}>
                <Icon name="close" size={16} />
              </button>
            </div>
            {lageOf === p.id && <LageEditor verbund={g} page={p} />}
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor={`verbund-add-${g.id}`}>Festplatz aufnehmen</label>
        <select
          id={`verbund-add-${g.id}`}
          data-testid="verbund-member-add"
          value=""
          disabled={!free.length}
          onChange={(e) => {
            if (e.target.value) addMember(g.id, e.target.value);
          }}
        >
          <option value="">{free.length ? 'Festplatz wählen …' : 'alle Festplätze sind in einem Verbund'}</option>
          {free.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Lage eines Mitglieds im Verbund (#15, #27): zeigt und setzt die gespeicherte Lage direkt – Verschiebung X/Y in m und
 * Drehung in Grad im Uhrzeigersinn. Die Drehung dreht den Platz in der Gesamtansicht um seine Mitte (die Verschiebung
 * passt sich an), X/Y verschieben ihn. Jede Eingabe ist ein Undo-Schritt; nur die Lage ändert sich, der Inhalt der Page,
 * ihre Einzelansicht und ihr Einzel-PDF bleiben unverändert.
 */
function LageEditor({ verbund, page }: { verbund: Verbund; page: FestplatzPage }) {
  const p = placementOf(verbund, page.id);
  const identity = p.x === 0 && p.y === 0 && p.rot === 0;
  const rotShown = p.rot > 180 ? p.rot - 360 : p.rot;
  // Mitte des Platzes in der Gesamtansicht (Drehpunkt für die Drehung)
  const pivot = () => pagePivot(worldPage(verbund, page));
  return (
    <div className="verbund-lage form" data-testid="verbund-lage-editor">
      <div className="fields-3">
        <NumberField id={`lage-x-${page.id}`} label="Verschiebung X" unit="m" value={p.x} step={1} digits={2} min={-100000} max={100000} onCommit={(x) => void setPlacement(page.id, { x })} />
        <NumberField id={`lage-y-${page.id}`} label="Verschiebung Y" unit="m" value={p.y} step={1} digits={2} min={-100000} max={100000} onCommit={(y) => void setPlacement(page.id, { y })} />
        <NumberField id={`lage-rot-${page.id}`} label="Drehung" unit="°" value={rotShown} step={1} digits={3} min={-360} max={360} onCommit={(rot) => void setPlacementRotation(page.id, rot, pivot())} />
      </div>
      <p className="hint">
        Lage von „{page.name}“ in der Gesamtansicht: Verschiebung des Ursprungs und Drehung im Uhrzeigersinn um die Mitte des Platzes (
        {fmt(pivot().x)} / {fmt(pivot().y)} m). Ändert nur, wo der Platz im Verbund liegt – seine Einzelansicht, Nummerierung und sein PDF bleiben
        unverändert. Genauer ausrichten mit dem Werkzeug „Ausrichten“ in der Gesamtansicht.
      </p>
      <button type="button" className="btn" data-testid="verbund-lage-reset" disabled={identity} onClick={() => resetPlacement(page.id)}>
        Lage zurücksetzen
      </button>
    </div>
  );
}
