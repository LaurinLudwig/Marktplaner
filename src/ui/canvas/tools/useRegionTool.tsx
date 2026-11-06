import { useRef, useState } from 'react';
import type { Vec } from '../../../core/model/types';
import { REGION_MIN_M } from '../../../core/sheet';
import { setSheetRegion } from '../../../state/paper';
import { useStore } from '../../../state/store';
import type { ToolContext, ToolHandlers } from './types';

/**
 * „Ausschnitt aufziehen“ (#13, spec.md §8): Ziehen auf der Zeichenfläche legt den Ausschnitt des Blatts fest
 * (achsenparallel, mindestens 1 × 1 m) und schaltet das Blatt auf „Ausschnitt“ (ein Undo-Schritt). Danach ist das
 * Blatt ausgewählt (verschieben am Rahmen, Größe an den Griffen) und das Auswahlwerkzeug aktiv. Esc bricht ab.
 */
export function useRegionTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const start = useRef<Vec | null>(null);
  const [draft, setDraft] = useState<{ a: Vec; b: Vec } | null>(null);
  const locked = !ctx.page.layers.sheet.visible || ctx.page.layers.sheet.locked;
  const done = () => {
    start.current = null;
    setDraft(null);
    useStore.getState().setUi({ tool: 'select' });
  };
  const a = draft && ctx.toScreen(draft.a);
  const b = draft && ctx.toScreen(draft.b);
  return {
    onPointerDown(p) {
      if (!active || locked) return false;
      start.current = p.world;
      setDraft({ a: p.world, b: p.world });
      return true;
    },
    onPointerMove(p) {
      if (active && start.current) setDraft({ a: start.current, b: p.world });
    },
    onPointerUp(p) {
      const s = start.current;
      if (!active || !s) return;
      start.current = null;
      setDraft(null);
      const w = Math.abs(p.world.x - s.x);
      const h = Math.abs(p.world.y - s.y);
      // Ein Klick ohne Ziehen legt nichts fest
      if (w < REGION_MIN_M && h < REGION_MIN_M) return;
      const cx = (s.x + p.world.x) / 2;
      const cy = (s.y + p.world.y) / 2;
      const hw = Math.max(REGION_MIN_M, w) / 2;
      const hh = Math.max(REGION_MIN_M, h) / 2;
      setSheetRegion(ctx.page.id, { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }, 'Ausschnitt aufziehen');
      done();
      useStore.getState().setUi({ selection: { kind: 'paper', element: 'sheet' } });
    },
    onKeyDown(e) {
      if (!active || e.key !== 'Escape') return false;
      done();
      return true;
    },
    overlay:
      active && a && b ? (
        <rect className="marquee sheet-region-draft" data-testid="sheet-region-draft" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} />
      ) : null,
    panel: active ? (
      <div className="tool-hint">{locked ? 'Ausschnitt: Ebene „Blatt“ ist ausgeblendet oder gesperrt' : 'Ausschnitt des Blatts aufziehen · Esc = abbrechen'}</div>
    ) : null,
    cursor: active && !locked ? 'cursor-crosshair' : undefined,
  };
}
