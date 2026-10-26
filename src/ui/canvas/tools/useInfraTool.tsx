import { useState } from 'react';
import { fmt } from '../../../core/format';
import { clickRect, dragRect, lineEnds } from '../../../core/infra';
import { constrainAngle } from '../../../core/measure';
import type { InfraTypeDef, Vec } from '../../../core/model/types';
import type { SnapResult } from '../../../core/snap';
import { addInfra } from '../../../state/objects';
import { useStore } from '../../../state/store';
import { SnapMarker } from './SnapMarker';
import type { ToolContext, ToolHandlers, ToolPointer } from './types';

/** Unterhalb dieser Mausbewegung (px) gilt die Geste als Klick. */
const CLICK_PX = 4;

/** Typ des Werkzeugs: der zuletzt gewählte, sonst der erste. */
export function useInfraToolType(): InfraTypeDef | null {
  return useStore((s) => s.project.infraTypes.find((t) => t.id === s.ui.infraTypeId) ?? s.project.infraTypes[0] ?? null);
}

function hint(t: InfraTypeDef): string {
  if (t.geometry === 'point') return `${t.label}: klicken · Esc bricht ab`;
  if (t.geometry === 'line') return `${t.label}: Linie von A nach B ziehen oder klicken (${fmt(t.defaultW)} m) · Shift: 15°-Schritte · Esc bricht ab`;
  return `${t.label}: klicken (${fmt(t.defaultW)} × ${fmt(t.defaultD)} m) oder Rechteck aufziehen · Esc bricht ab`;
}

/**
 * Infrastruktur-Werkzeug (I, M7, spec.md §11) mit dem gewählten Typ: Klick legt ein Objekt im Standardmaß an,
 * Ziehen zieht ein Rechteck bzw. eine Linie von A nach B auf. Linienpunkte fangen an Objekten (Cmd/Strg: aus),
 * Shift beschränkt Linien auf 15°-Schritte. Das Werkzeug bleibt aktiv; das neue Objekt ist ausgewählt.
 */
export function useInfraTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const type = useInfraToolType();
  const [draft, setDraft] = useState<{ a: Vec; b: Vec; screen: Vec } | null>(null);
  const [hover, setHover] = useState<SnapResult | null>(null);

  const key = active ? `${ctx.page.id}|${type?.id}` : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setDraft(null);
    setHover(null);
  }

  const isLine = type?.geometry === 'line';
  /** Punkt einer Linie: Fang an Objekten, sonst Shift-Winkel; Rechtecke und Punkte ohne Fang. */
  const resolve = (p: ToolPointer, from?: Vec): Vec => {
    if (!isLine) return p.world;
    const s = p.modKey ? null : ctx.snap(p.world);
    if (s) return s.point;
    return from && p.shiftKey ? constrainAngle(from, p.world, 15) : p.world;
  };

  const handlers: ToolHandlers = {
    onPointerDown(p) {
      if (!active || !type) return false;
      setDraft({ a: resolve(p), b: resolve(p), screen: p.screen });
      return true;
    },
    onPointerMove(p) {
      if (!active || !type) return;
      if (isLine) setHover(p.modKey ? null : ctx.snap(p.world));
      if (draft) setDraft({ ...draft, b: resolve(p, draft.a) });
    },
    onPointerUp(p) {
      if (!active || !type || !draft) return;
      setDraft(null);
      const b = resolve(p, draft.a);
      const clicked = Math.hypot(p.screen.x - draft.screen.x, p.screen.y - draft.screen.y) < CLICK_PX;
      const rect = (!clicked && dragRect(type, draft.a, b)) || clickRect(type, draft.a);
      addInfra(ctx.page.id, type.id, rect);
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

  if (active && type) {
    if (draft) {
      const r = dragRect(type, draft.a, draft.b);
      const p = ctx.toScreen(draft.a);
      const q = ctx.toScreen(draft.b);
      if (type.geometry === 'line') {
        const [a, b] = r ? lineEnds(r).map(ctx.toScreen) : [p, q];
        handlers.overlay = (
          <g className="create-overlay infra">
            <line className="create-ghost" x1={a!.x} y1={a!.y} x2={b!.x} y2={b!.y} />
            {r && (
              <text className="create-dims" x={q.x + 8} y={q.y + 14}>
                {fmt(r.w)} m
              </text>
            )}
            <SnapMarker snap={hover} toScreen={ctx.toScreen} />
          </g>
        );
      } else if (type.geometry === 'rect') {
        const w = Math.abs(draft.b.x - draft.a.x);
        const d = Math.abs(draft.b.y - draft.a.y);
        handlers.overlay = (
          <g className="create-overlay infra">
            <rect className="create-ghost" x={Math.min(p.x, q.x)} y={Math.min(p.y, q.y)} width={Math.abs(q.x - p.x)} height={Math.abs(q.y - p.y)} />
            {(w > 0 || d > 0) && (
              <text className="create-dims" x={Math.max(p.x, q.x) + 8} y={Math.max(p.y, q.y) + 14}>
                {fmt(w)} × {fmt(d)} m
              </text>
            )}
          </g>
        );
      }
    } else {
      handlers.panel = <div className="tool-hint">{hint(type)}</div>;
      if (hover) handlers.overlay = <SnapMarker snap={hover} toScreen={ctx.toScreen} />;
    }
  }
  return handlers;
}
