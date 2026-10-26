import { useLayoutEffect, useState, type RefObject } from 'react';

/** Feste Zeilenhöhe der Start-Page-Listen in px (CSS `--row-h`). */
export const ROW_H = 24;
const OVERSCAN = 8;

/**
 * Virtualisierung mit fester Zeilenhöhe (M6-10): Nur die sichtbaren Zeilen ± Puffer werden gezeichnet, damit
 * 500+ Zeilen flüssig bleiben. `headH` = Höhe des festen Kopfs im selben Scrollbereich.
 */
export function useVirtualRows(ref: RefObject<HTMLElement | null>, count: number, headH: number) {
  const [box, setBox] = useState({ top: 0, h: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setBox({ top: el.scrollTop, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [ref]);
  const visible = Math.max(1, Math.floor((box.h - headH) / ROW_H));
  const start = Math.max(0, Math.floor(box.top / ROW_H) - OVERSCAN);
  const end = Math.min(count, Math.ceil((box.top + box.h) / ROW_H) + OVERSCAN);
  return { start, end, visible };
}

/** Scrollt so, dass Zeile `index` unter dem festen Kopf vollständig sichtbar ist. */
export function scrollRowIntoView(el: HTMLElement, index: number, headH: number, footH = 0) {
  const top = index * ROW_H;
  const viewH = el.clientHeight - headH - footH;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW_H > el.scrollTop + viewH) el.scrollTop = top + ROW_H - viewH;
}
