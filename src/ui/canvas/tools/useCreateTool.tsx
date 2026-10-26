import { useState } from 'react';
import { fmt } from '../../../core/format';
import type { Vec } from '../../../core/model/types';
import { AREA_DEFAULT, MIN_DRAW_SIZE } from '../../../core/objects';
import { addArea, addStand, standDefaultSize } from '../../../state/objects';
import type { ToolContext, ToolHandlers } from './types';

/** Unterhalb dieser Mausbewegung (px) gilt die Geste als Klick. */
const CLICK_PX = 4;

const HINT = {
  area: (size: string) => `Grundfläche: Rechteck aufziehen oder klicken (${size}) · Esc bricht ab`,
  stand: (size: string) => `Geschäft: klicken (${size}) oder Rechteck aufziehen · Esc bricht ab`,
};

/**
 * Grundflächen-Werkzeug (F) und Geschäfts-Werkzeug (G): Rechteck aufziehen (achsenparallel,
 * Vorderseite unten) oder klicken für das Standardmaß. Unter 0,5 m in einer Richtung zählt das
 * Aufziehen als Klick. Das Werkzeug bleibt aktiv; das neue Objekt ist ausgewählt. Anlegen ist ein
 * Undo-Schritt.
 */
export function useCreateTool(ctx: ToolContext, kind: 'area' | 'stand', active: boolean): ToolHandlers {
  const [draft, setDraft] = useState<{ a: Vec; b: Vec; screen: Vec } | null>(null);

  const key = active ? ctx.page.id : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setDraft(null);
  }

  const defaultSize = () => (kind === 'area' ? AREA_DEFAULT : standDefaultSize());

  const handlers: ToolHandlers = {
    onPointerDown(p) {
      if (!active) return false;
      setDraft({ a: p.world, b: p.world, screen: p.screen });
      return true;
    },
    onPointerMove(p) {
      if (active && draft) setDraft({ ...draft, b: p.world });
    },
    onPointerUp(p) {
      if (!active || !draft) return;
      setDraft(null);
      const w = Math.abs(p.world.x - draft.a.x);
      const d = Math.abs(p.world.y - draft.a.y);
      const clicked = Math.hypot(p.screen.x - draft.screen.x, p.screen.y - draft.screen.y) < CLICK_PX || w < MIN_DRAW_SIZE || d < MIN_DRAW_SIZE;
      const size = defaultSize();
      const rect = clicked
        ? { cx: draft.a.x, cy: draft.a.y, w: size.w, d: size.d, rot: 0 }
        : { cx: (draft.a.x + p.world.x) / 2, cy: (draft.a.y + p.world.y) / 2, w, d, rot: 0 };
      if (kind === 'area') addArea(ctx.page.id, rect);
      else addStand(ctx.page.id, rect);
    },
    onKeyDown(e) {
      if (!active || e.key !== 'Escape' || !draft) return false;
      setDraft(null);
      return true;
    },
    overlay: null,
    panel: null,
    cursor: active ? 'cursor-crosshair' : undefined,
  };

  if (active) {
    if (draft) {
      const p = ctx.toScreen(draft.a);
      const q = ctx.toScreen(draft.b);
      const w = Math.abs(draft.b.x - draft.a.x);
      const d = Math.abs(draft.b.y - draft.a.y);
      handlers.overlay = (
        <g className={`create-overlay ${kind}`}>
          <rect className="create-ghost" x={Math.min(p.x, q.x)} y={Math.min(p.y, q.y)} width={Math.abs(q.x - p.x)} height={Math.abs(q.y - p.y)} />
          {(w > 0 || d > 0) && (
            <text className="create-dims" x={Math.max(p.x, q.x) + 8} y={Math.max(p.y, q.y) + 14}>
              {fmt(w)} × {fmt(d)} m
            </text>
          )}
        </g>
      );
    } else {
      const s = defaultSize();
      handlers.panel = <div className="tool-hint">{HINT[kind](`${fmt(s.w)} × ${fmt(s.d)} m`)}</div>;
    }
  }
  return handlers;
}
