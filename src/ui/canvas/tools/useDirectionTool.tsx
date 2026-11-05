import { useEffect, useState } from 'react';
import type { Vec } from '../../../core/model/types';
import { findSnap, pointSnapSource, type SnapResult } from '../../../core/snap';
import { setNumberingDirection, toolFitsMode } from '../../../state/numbering';
import { useStore } from '../../../state/store';
import { SnapMarker } from './SnapMarker';
import { SNAP_PX, type ToolContext, type ToolHandlers } from './types';

/** Fang für Start- und Zielpunkt der eigenen Richtung (#12): Standmitten und Grundflächen-Ecken sichtbarer Ebenen. */
export function directionSnap(ctx: ToolContext, p: Vec): SnapResult | null {
  const L = ctx.page.layers;
  const source = pointSnapSource(L.areas.visible ? ctx.page.areas : [], L.stands.visible ? ctx.page.stands : []);
  return findSnap(p, [source], SNAP_PX / ctx.view.scale);
}

const sameCm = (a: Vec, b: Vec) => Math.round(a.x * 100) === Math.round(b.x * 100) && Math.round(a.y * 100) === Math.round(b.y * 100);

/**
 * „Richtung setzen“ für die Nummerierung in eigener Richtung (#12, Muster: useCenterTool): erst Startpunkt A, dann
 * Zielpunkt B anklicken (Fang an Standmitten und Grundflächen-Ecken, Cmd/Strg aus). Der zweite Klick übernimmt beide
 * Punkte als einen Undo-Schritt und kehrt zum Auswahlwerkzeug zurück; ein Klick auf A selbst wird ignoriert. Esc
 * bricht ab.
 */
export function useDirectionTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const [hover, setHover] = useState<SnapResult | null>(null);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [from, setFrom] = useState<Vec | null>(null);
  // Anderes Werkzeug oder andere Page gewählt (nicht nur Leertaste zum Verschieben der Ansicht): angefangenen
  // Startpunkt verwerfen, sonst ginge A einer Page in die Richtung der nächsten ein (Zurücksetzen beim Rendern)
  const selected = useStore((s) => s.ui.tool === 'numberDirection');
  const key = selected ? ctx.page.id : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setFrom(null);
    setHover(null);
  }
  const done = () => {
    setFrom(null);
    setHover(null);
    useStore.getState().setUi({ tool: 'select' });
  };
  // Page nicht (mehr) im Modus „eigene Richtung“ (Moduswechsel, Undo, andere Page): zurück zum Auswahlwerkzeug
  const fits = toolFitsMode('numberDirection', ctx.page.numberingMode);
  useEffect(() => {
    if (selected && !fits) useStore.getState().setUi({ tool: 'select' });
  }, [selected, fits]);
  const pointAt = (world: Vec, modKey: boolean) => {
    const s = modKey ? null : directionSnap(ctx, world);
    return { snap: s, point: s?.point ?? world };
  };
  const toScreen = ctx.toScreen;
  const a = from ? toScreen(from) : null;
  const b = from && cursor ? toScreen(cursor) : null;
  return {
    onPointerDown(p) {
      if (!active) return false;
      if (!fits) {
        done();
        return true;
      }
      const { point } = pointAt(p.world, p.modKey);
      if (!from) {
        setFrom(point);
        setCursor(point);
        return true;
      }
      if (sameCm(from, point)) return true;
      setNumberingDirection(ctx.page.id, { from, to: point });
      done();
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      const r = pointAt(p.world, p.modKey);
      setHover(r.snap);
      setCursor(r.point);
    },
    onPointerUp() {},
    onKeyDown(e) {
      if (!active || e.key !== 'Escape') return false;
      done();
      return true;
    },
    overlay: active ? (
      <>
        <g className="direction-marker preview">
          {a && b && <path className="shaft" d={`M${a.x} ${a.y}L${b.x} ${b.y}`} />}
          {a && <circle cx={a.x} cy={a.y} r={5} />}
        </g>
        <SnapMarker snap={hover} toScreen={toScreen} />
      </>
    ) : null,
    panel: active ? (
      <div className="tool-hint">{from ? 'Zielpunkt B anklicken (Richtung A → B)' : 'Startpunkt A der Nummerierung anklicken'} · fängt an Standmitten und Ecken der Grundflächen · Esc = abbrechen</div>
    ) : null,
    cursor: active ? 'cursor-crosshair' : undefined,
  };
}
