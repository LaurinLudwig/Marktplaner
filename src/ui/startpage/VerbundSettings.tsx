import { useState } from 'react';
import { confirm } from '../../app/dialogs';
import { fmt } from '../../core/format';
import type { FestplatzPage, Verbund } from '../../core/model/types';
import { groupOf, pagePivot } from '../../core/verbund';
import { useStore } from '../../state/store';
import { addMember, addVerbund, deleteVerbund, moveMember, movePageContent, removeMember, renameVerbund } from '../../state/verbund';
import { Icon } from '../icons/Icon';
import { NumberField } from '../panels/NumberField';
import { TextField } from '../panels/TextField';
import { tip } from '../shortcuts/tip';

/**
 * Festplatz-Verbünde in den Projekteinstellungen (#15, spec.md „Verbund / Gesamtansicht“): anlegen, umbenennen,
 * löschen; Mitglieder aufnehmen, herausnehmen und ordnen; je Mitglied die Lage (verschieben und drehen der ganzen
 * Page samt Hintergrund). Jede Änderung ist ein Undo-Schritt.
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
    `Verbund „${g.name}“ löschen? Die Festplätze bleiben an ihrer jetzigen Lage und zeigen keine Nachbarn mehr. Rückgängig mit Strg/Cmd+Z möglich.`,
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
              <button type="button" className={`icon-btn${lageOf === p.id ? ' active' : ''}`} data-testid="verbund-lage" onClick={() => setLageOf(lageOf === p.id ? null : p.id)} {...tip({ label: `Lage von „${p.name}“ ändern`, desc: 'Verschieben und drehen der ganzen Page', side: 'top' })}>
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
            {lageOf === p.id && <LageEditor page={p} />}
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
 * Lage eines Mitglieds (#15): Verschiebung in m und Drehung in Grad im Uhrzeigersinn um die Mitte der Page
 * (`pagePivot`). „Anwenden“ verschiebt bzw. dreht die ganze Page samt Hintergrund und allen Objekten (ein Undo-Schritt)
 * und setzt die Felder zurück.
 */
function LageEditor({ page }: { page: FestplatzPage }) {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [rot, setRot] = useState(0);
  const pivot = pagePivot(page);
  const apply = () => {
    if (movePageContent(page.id, { dx, dy, rot, pivot })) {
      setDx(0);
      setDy(0);
      setRot(0);
    }
  };
  return (
    <div className="verbund-lage form" data-testid="verbund-lage-editor">
      <div className="fields-3">
        <NumberField id={`lage-dx-${page.id}`} label="Verschieben X" unit="m" value={dx} step={1} digits={2} min={-100000} max={100000} onCommit={setDx} />
        <NumberField id={`lage-dy-${page.id}`} label="Verschieben Y" unit="m" value={dy} step={1} digits={2} min={-100000} max={100000} onCommit={setDy} />
        <NumberField id={`lage-rot-${page.id}`} label="Drehen" unit="°" value={rot} step={1} digits={1} min={-360} max={360} onCommit={setRot} />
      </div>
      <p className="hint">
        Drehpunkt: Mitte des Festplatzes ({fmt(pivot.x)} / {fmt(pivot.y)} m), Drehung im Uhrzeigersinn. Verschiebt bzw. dreht die ganze Page samt
        Hintergrund, Grundflächen, Ständen, Infrastruktur, Blatt und Nummerierungs-Mittelpunkt.
      </p>
      <button type="button" className="btn primary" data-testid="verbund-lage-apply" onClick={apply}>
        Anwenden
      </button>
    </div>
  );
}
