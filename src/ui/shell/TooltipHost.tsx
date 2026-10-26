import { useEffect, useState } from 'react';

interface TipState {
  label: string;
  desc?: string;
  keys?: string;
  x: number;
  y: number;
  side: string;
}

const DELAY_MS = 450;

/**
 * Ein globaler Tooltip für alle Elemente mit `data-tip` (siehe ui/shortcuts/tip.ts).
 * Zeigt Name, Taste und optional eine Kurzbeschreibung.
 */
export function TooltipHost() {
  const [tipState, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      current = el;
      timer = window.setTimeout(() => {
        if (!current || !document.contains(current)) return;
        const r = current.getBoundingClientRect();
        const side = current.dataset.tipSide ?? 'bottom';
        const pos =
          side === 'right' ? { x: r.right + 8, y: r.top + r.height / 2 } : side === 'top' ? { x: r.left + r.width / 2, y: r.top - 6 } : { x: r.left + r.width / 2, y: r.bottom + 6 };
        setTip({
          label: current.dataset.tip!,
          ...(current.dataset.tipDesc ? { desc: current.dataset.tipDesc } : {}),
          ...(current.dataset.tipKeys ? { keys: current.dataset.tipKeys } : {}),
          side,
          ...pos,
        });
      }, DELAY_MS);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tipState) return null;
  const transform =
    tipState.side === 'right' ? 'translateY(-50%)' : tipState.side === 'top' ? 'translate(-50%, -100%)' : 'translateX(-50%)';
  return (
    <div className="tooltip" role="tooltip" style={{ left: tipState.x, top: tipState.y, transform }} ref={keepInWindow}>
      <div className="t-head">
        <span>{tipState.label}</span>
        {tipState.keys && <kbd>{tipState.keys}</kbd>}
      </div>
      {tipState.desc && <div className="t-desc">{tipState.desc}</div>}
    </div>
  );
}

/** Schiebt den Tooltip zurück ins Fenster, falls er am Rand hinausragt. */
function keepInWindow(el: HTMLDivElement | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const dx = r.right > window.innerWidth - 4 ? window.innerWidth - 4 - r.right : r.left < 4 ? 4 - r.left : 0;
  if (dx) el.style.marginLeft = `${dx}px`;
}
