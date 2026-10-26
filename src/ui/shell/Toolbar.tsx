import { useEffect, useRef, useState } from 'react';
import { COMMANDS, runCommand } from '../../app/commands';
import { useStore } from '../../state/store';
import { Icon } from '../icons/Icon';
import { InfraIconView } from '../icons/infraIcons';
import { keyLabel, tip } from '../shortcuts/tip';
import { TOOL_GROUPS, type ToolbarItem } from '../tools';
import { useInfraToolType } from '../canvas/tools/useInfraTool';

/** Vertikale Werkzeugleiste, nur Icons. Name, Beschreibung und Taste erscheinen im Tooltip. */
export function Toolbar() {
  const tool = useStore((s) => s.ui.tool);
  const gridVisible = useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePage)?.grid.visible ?? false);
  const snap = useStore((s) => s.project.settings.snap);
  // Neu rendern, wenn sich die Verfügbarkeit ändern kann (z. B. Hintergrund importiert)
  useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePage)?.background?.assetId);
  return (
    <nav className="toolbar" aria-label="Werkzeuge">
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <div className="sep" />}
          {group.map((item) => {
            const pending = !!item.milestone;
            const unavailable = !pending && COMMANDS[item.shortcut]?.enabled?.() === false;
            const pressed = item.kind === 'tool' ? item.tool === tool : item.snap ? snap[item.snap] : item.shortcut === 'view.grid' && gridVisible;
            if (item.flyout) return <InfraToolButton key={item.shortcut} item={item} pressed={pressed} />;
            return (
              <button
                key={item.shortcut}
                type="button"
                className={`tool${item.kind === 'toggle' ? ' toggle' : ''}`}
                aria-pressed={pressed}
                disabled={pending || unavailable}
                onClick={() => runCommand(item.shortcut)}
                {...tip({
                  shortcut: item.shortcut,
                  desc: pending
                    ? `${item.description} – folgt in ${item.milestone}`
                    : unavailable && item.disabledHint
                      ? `${item.description}. ${item.disabledHint}`
                      : item.description,
                  side: 'right',
                })}
              >
                <Icon name={item.icon} size={18} />
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Ab dieser Dauer (ms) öffnet langes Drücken die Werkzeuggruppe (wie in Illustrator). */
const LONG_PRESS_MS = 450;

/**
 * Aufklappbare Werkzeuggruppe „Infrastruktur“ (M7-04, spec.md Layout): Der Knopf zeigt das Symbol des zuletzt
 * genutzten Typs und aktiviert ihn. Dreieck, Rechtsklick oder langes Drücken öffnen die Liste aller Typen.
 */
function InfraToolButton({ item, pressed }: { item: ToolbarItem; pressed: boolean }) {
  const type = useInfraToolType();
  const types = useStore((s) => s.project.infraTypes);
  const setUi = useStore((s) => s.setUi);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const opened = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const unavailable = COMMANDS[item.shortcut]?.enabled?.() === false;

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [open]);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const choose = (id: string) => {
    setUi({ tool: 'infra', infraTypeId: id });
    setOpen(false);
  };
  return (
    <div className="tool-group" ref={wrap}>
      <button
        type="button"
        className="tool"
        data-testid="infra-tool"
        data-type={type?.id}
        aria-pressed={pressed}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={unavailable}
        onPointerDown={() => {
          opened.current = false;
          clearTimer();
          timer.current = window.setTimeout(() => {
            opened.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onClick={() => !opened.current && runCommand(item.shortcut)}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        {...tip({ shortcut: item.shortcut, label: type ? `Infrastruktur: ${type.label}` : 'Infrastruktur', desc: item.description, side: 'right', ariaLabel: 'Infrastruktur' })}
      >
        {type ? <InfraIconView name={type.icon} size={18} /> : <Icon name={item.icon} size={18} />}
      </button>
      <button type="button" className="tool-flyout-toggle" data-testid="infra-flyout-toggle" aria-label="Infrastruktur-Typ wählen" disabled={unavailable} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="tool-flyout" role="menu" aria-label="Infrastruktur-Typ">
          {types.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === type?.id} className="tool-flyout-item" onClick={() => choose(t.id)}>
              <InfraIconView name={t.icon} size={16} color={t.color} />
              <span>{t.label}</span>
            </button>
          ))}
          <div className="tool-flyout-hint">
            {keyLabel('tool.infra')} Werkzeug · {keyLabel('tool.infraNext')} nächster Typ
          </div>
        </div>
      )}
    </div>
  );
}
