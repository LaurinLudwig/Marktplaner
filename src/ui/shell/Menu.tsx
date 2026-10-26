import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keyLabel } from '../shortcuts/tip';

type Action = { label: string; onSelect: () => void; shortcut?: string; disabled?: boolean; danger?: boolean; checked?: boolean; detail?: string };
/** Untermenü (#11: „Zuletzt geöffnet“): öffnet seitlich bei Hover, Klick oder Pfeil rechts. */
type Sub = { label: string; submenu: MenuItem[]; disabled?: boolean };
export type MenuItem = Action | Sub | 'separator';

const isSub = (i: MenuItem): i is Sub => i !== 'separator' && 'submenu' in i;

/** Popup-Menü an fester Position; schließt bei Klick daneben, Esc oder Auswahl. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Im Fenster halten
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.min(x, window.innerWidth - r.width - 4), top: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div className="menu" role="menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

/** Einträge einer Ebene; ein Untermenü liegt im DOM innerhalb des Hauptmenüs (Klick darin zählt nicht als „daneben“). */
function MenuItems({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<{ index: number; left: number; top: number } | null>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const subOwner = useRef<HTMLButtonElement | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const r = subRef.current?.getBoundingClientRect();
    if (!openSub || !r) return setSubPos(null);
    setSubPos({ left: Math.min(openSub.left, window.innerWidth - r.width - 4), top: Math.min(openSub.top, window.innerHeight - r.height - 4) });
  }, [openSub]);

  const showSub = (index: number, el: HTMLButtonElement) => {
    subOwner.current = el;
    const r = el.getBoundingClientRect();
    setOpenSub({ index, left: r.right - 2, top: r.top - 4 });
  };

  return (
    <>
      {items.map((item, i) => {
        if (item === 'separator') return <hr key={i} />;
        if (isSub(item))
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSub?.index === i}
              className={`has-sub${openSub?.index === i ? ' open' : ''}`}
              disabled={item.disabled}
              onPointerEnter={(e) => showSub(i, e.currentTarget)}
              onClick={(e) => showSub(i, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  showSub(i, e.currentTarget);
                  requestAnimationFrame(() => subRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
                }
              }}
            >
              <span className="grow">{item.label}</span>
              <span className="sub-arrow">▸</span>
            </button>
          );
        return (
          <button
            key={i}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            onPointerEnter={() => setOpenSub(null)}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.checked !== undefined && <span className="check-mark">{item.checked ? '✓' : ''}</span>}
            <span className="grow">{item.label}</span>
            {item.detail && <span className="sub-folder">{item.detail}</span>}
            {item.shortcut && keyLabel(item.shortcut) && <kbd>{keyLabel(item.shortcut)}</kbd>}
          </button>
        );
      })}
      {openSub && isSub(items[openSub.index]!) && (
        <div
          className="menu submenu"
          role="menu"
          ref={subRef}
          style={{ position: 'fixed', left: subPos?.left ?? openSub.left, top: subPos?.top ?? openSub.top, visibility: subPos ? 'visible' : 'hidden' }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              e.stopPropagation();
              setOpenSub(null);
              subOwner.current?.focus();
            }
          }}
        >
          <MenuItems items={(items[openSub.index] as Sub).submenu} onClose={onClose} />
        </div>
      )}
    </>
  );
}
