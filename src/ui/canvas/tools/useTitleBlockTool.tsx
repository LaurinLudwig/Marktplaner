import { worldToAnchor } from '../../../core/sheet';
import { placeTitleBlock } from '../../../state/paper';
import type { ToolContext, ToolHandlers } from './types';

/**
 * Schriftfeld-Werkzeug (T, M7, spec.md §8): Ein Klick setzt die linke obere Ecke des Schriftfelds an die
 * Klickstelle (Anker wie beim Ziehen: nächste Ecke des Blatts, auf dem Blatt begrenzt) und wählt es aus.
 */
export function useTitleBlockTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const locked = !ctx.page.layers.sheet.visible || ctx.page.layers.sheet.locked;
  return {
    onPointerDown(p) {
      if (!active || locked) return false;
      placeTitleBlock(ctx.page.id, worldToAnchor(ctx.paper.frame, p.world, ctx.paper.titleBlock.layout));
      return true;
    },
    onPointerMove() {},
    onPointerUp() {},
    onKeyDown: () => false,
    overlay: null,
    panel: active ? (
      <div className="tool-hint">{locked ? 'Schriftfeld: Ebene „Blatt“ ist ausgeblendet oder gesperrt' : 'Schriftfeld: klicken setzt die linke obere Ecke · verschieben mit dem Auswahlwerkzeug (V)'}</div>
    ) : null,
    cursor: active && !locked ? 'cursor-crosshair' : undefined,
  };
}
