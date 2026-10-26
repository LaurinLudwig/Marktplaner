import { useEffect } from 'react';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { SHORTCUTS, type ShortcutGroup } from '../shortcuts/definitions';
import { formatCombo, IS_MAC } from '../shortcuts/keys';

const GROUPS: ShortcutGroup[] = ['Datei', 'Bearbeiten', 'Beim Ziehen', 'Werkzeuge', 'Ansicht', 'Pages', 'Start-Page', 'Fenster'];

/** Übersicht aller Tastaturkürzel (Taste ?). Liest direkt aus der zentralen Konfiguration. */
export function ShortcutsOverlay() {
  const open = useStore((s) => s.ui.shortcutsOpen);
  const setUi = useStore((s) => s.setUi);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ shortcutsOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setUi]);

  if (!open) return null;
  // Die neun „Zu Festplatz n“-Einträge zusammenfassen
  const rows = SHORTCUTS.filter((s) => !/^page\.goto[2-9]$/.test(s.id)).map((s) =>
    s.id === 'page.goto1' ? { ...s, label: 'Zu Festplatz 1 … 9', keys: [s.keys[0]!.replace('1', '1 … 9')] } : s,
  );
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && setUi({ shortcutsOpen: false })}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-label="Tastaturkürzel">
        <div className="head">
          <h2>Tastaturkürzel</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => setUi({ shortcutsOpen: false })}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="body">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              {rows
                .filter((s) => s.group === g)
                .map((s) => (
                  <div className="row" key={s.id}>
                    <span>{s.label}</span>
                    <span className="keys">
                      {s.keys.map((k) => (
                        <kbd key={k}>{k.includes('…') ? formatCombo(k.replace(' … 9', ''), IS_MAC).replace(/1$/, '1–9') : formatCombo(k, IS_MAC)}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
