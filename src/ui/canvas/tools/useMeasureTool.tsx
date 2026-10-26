import { useState } from 'react';
import { fmt } from '../../../core/format';
import { constrainAngle, measure } from '../../../core/measure';
import type { SnapResult } from '../../../core/snap';
import type { Vec } from '../../../core/model/types';
import { SnapMarker } from './SnapMarker';
import type { ToolContext, ToolHandlers, ToolPointer } from './types';

interface State {
  a: Vec;
  b: Vec;
  /** placing = zweiter Punkt folgt dem Zeiger; done = Messung steht. */
  phase: 'placing' | 'done';
}

/**
 * Messwerkzeug (M): zwei Punkte klicken (oder ziehen), Abstand in Metern.
 * Die Messung bleibt sichtbar, bis das Werkzeug gewechselt wird; Esc löscht sie.
 * Shift beschränkt auf 45°-Schritte. Punkte fangen an Objekten (ab M3, siehe core/snap.ts).
 */
export function useMeasureTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const [m, setM] = useState<State | null>(null);
  const [hover, setHover] = useState<SnapResult | null>(null);
  const [downAt, setDownAt] = useState<Vec | null>(null);

  // Werkzeug- oder Seitenwechsel löscht die Messung (Zurücksetzen beim Rendern, wie von React empfohlen)
  const key = active ? ctx.page.id : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setM(null);
    setHover(null);
  }

  const resolve = (p: ToolPointer, from?: Vec): Vec => {
    const s = ctx.snap(p.world);
    if (s) return s.point;
    return from && p.shiftKey ? constrainAngle(from, p.world) : p.world;
  };

  const handlers: ToolHandlers = {
    onPointerDown(p) {
      if (!active) return false;
      if (m?.phase === 'placing') {
        setM({ ...m, b: resolve(p, m.a), phase: 'done' });
        return true;
      }
      const a = resolve(p);
      setM({ a, b: a, phase: 'placing' });
      setDownAt(p.screen);
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      setHover(ctx.snap(p.world));
      if (m?.phase === 'placing') setM({ ...m, b: resolve(p, m.a) });
    },
    onPointerUp(p) {
      if (!active || !downAt || m?.phase !== 'placing') return;
      // Gezogen statt geklickt: Loslassen setzt den zweiten Punkt
      if (Math.hypot(p.screen.x - downAt.x, p.screen.y - downAt.y) > 4) setM({ ...m, b: resolve(p, m.a), phase: 'done' });
      setDownAt(null);
    },
    onKeyDown(e) {
      if (!active || e.key !== 'Escape' || !m) return false;
      setM(null);
      return true;
    },
    overlay: null,
    panel: null,
  };

  if (active) {
    handlers.overlay = (
      <g className="measure-overlay">
        {m && <MeasureLine a={ctx.toScreen(m.a)} b={ctx.toScreen(m.b)} result={measure(m.a, m.b)} />}
        <SnapMarker snap={hover} toScreen={ctx.toScreen} />
      </g>
    );
    if (!m) handlers.panel = <div className="tool-hint">Messen: ersten Punkt klicken · Shift = 45°-Schritte</div>;
  }
  return handlers;
}

export function MeasureLine({ a, b, result, className = 'measure' }: { a: Vec; b: Vec; result: ReturnType<typeof measure>; className?: string }) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const label = `${fmt(result.distance)} m`;
  const sub = `${fmt(-result.angle, 1)}°`;
  return (
    <g className={className}>
      <line className="measure-line-halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <line className="measure-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <circle className="measure-end" cx={a.x} cy={a.y} r={3.5} />
      <circle className="measure-end" cx={b.x} cy={b.y} r={3.5} />
      {result.distance > 0 && (
        <g transform={`translate(${mid.x} ${mid.y - 16})`}>
          <rect className="measure-label-bg" x={-(label.length * 3.8 + 26)} y={-10} width={label.length * 7.6 + 52} height={20} rx={4} />
          <text className="measure-label" x={-6} y={0} textAnchor="middle" dominantBaseline="central">
            {label}
          </text>
          <text className="measure-sub" x={label.length * 3.8 + 2} y={0} textAnchor="middle" dominantBaseline="central">
            {sub}
          </text>
        </g>
      )}
    </g>
  );
}
