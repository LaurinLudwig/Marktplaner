import { useState } from 'react';
import type { SnapResult } from '../../../core/snap';
import { setClockwiseCenter } from '../../../state/numbering';
import { useStore } from '../../../state/store';
import { SnapMarker } from './SnapMarker';
import type { ToolContext, ToolHandlers } from './types';

/**
 * „Mittelpunkt setzen“ für die Nummerierung im Uhrzeigersinn (M5-02): ein Klick setzt den Mittelpunkt
 * (fängt an Objekten) und kehrt zum Auswahlwerkzeug zurück. Esc bricht ab.
 */
export function useCenterTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const [hover, setHover] = useState<SnapResult | null>(null);
  const done = () => useStore.getState().setUi({ tool: 'select' });
  return {
    onPointerDown(p) {
      if (!active) return false;
      const point = ctx.snap(p.world)?.point ?? p.world;
      setClockwiseCenter(ctx.page.id, point);
      done();
      return true;
    },
    onPointerMove(p) {
      if (active) setHover(ctx.snap(p.world));
    },
    onPointerUp() {},
    onKeyDown(e) {
      if (!active || e.key !== 'Escape') return false;
      done();
      return true;
    },
    overlay: active ? <SnapMarker snap={hover} toScreen={ctx.toScreen} /> : null,
    panel: active ? <div className="tool-hint">Mittelpunkt der Nummerierung anklicken · Esc = abbrechen</div> : null,
    cursor: active ? 'cursor-crosshair' : undefined,
  };
}
