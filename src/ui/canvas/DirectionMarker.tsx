import { directionOf } from '../../core/numbering';
import type { FestplatzPage, Vec } from '../../core/model/types';

/** Abstand der Marken „1“ und „→“ von den Punkten, in Bildschirmpixeln. */
const LABEL_PX = 16;

/**
 * Eigene Richtung der Nummerierung (#12, Muster: ClockwiseMarker): Pfeil von A nach B mit den Marken „1“ an A und
 * „→“ an B, in Bildschirmkoordinaten. Sichtbar, solange der Modus aktiv ist; kein Plan-Objekt, nicht im PDF. Die
 * Punkte zieht das Auswahlwerkzeug (useSelectTool, Treffer über `directionHandleAt`).
 */
export function DirectionMarker({ page, toScreen }: { page: FestplatzPage; toScreen: (p: Vec) => Vec }) {
  const dir = page.numberingMode === 'direction' ? directionOf(page) : null;
  if (!dir) return null;
  const a = toScreen(dir.from);
  const b = toScreen(dir.to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // Einheitsvektor A → B auf dem Bildschirm; liegen die Punkte aufeinander, zeigen die Marken nach rechts
  const u = len > 0.5 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
  const n = { x: -u.y, y: u.x };
  const head = (k: number) => `${b.x - u.x * 12 + n.x * k} ${b.y - u.y * 12 + n.y * k}`;
  const one = { x: a.x - u.x * LABEL_PX, y: a.y - u.y * LABEL_PX };
  const arrow = { x: b.x + u.x * LABEL_PX, y: b.y + u.y * LABEL_PX };
  return (
    <g className="direction-marker" data-testid="direction-marker">
      {len > 0.5 && <path className="shaft" d={`M${a.x} ${a.y}L${b.x} ${b.y}`} />}
      {len > 12 && <path className="head" d={`M${head(5)}L${b.x} ${b.y}L${head(-5)}`} />}
      <circle className="end" data-testid="direction-from" cx={a.x} cy={a.y} r={5} />
      <circle className="end" data-testid="direction-to" cx={b.x} cy={b.y} r={4} />
      <text x={one.x} y={one.y}>
        1
      </text>
      <text x={arrow.x} y={arrow.y}>
        →
      </text>
    </g>
  );
}

/** Trefferradius der Punkte A und B für das Auswahlwerkzeug, in Bildschirmpixeln. */
export const DIRECTION_HANDLE_PX = 8;

/** Welcher Punkt der eigenen Richtung liegt am Bildschirmpunkt `screen` (B hat Vorrang, wenn beide aufeinanderliegen)? */
export function directionHandleAt(page: FestplatzPage, toScreen: (p: Vec) => Vec, screen: Vec): 'from' | 'to' | null {
  const dir = page.numberingMode === 'direction' ? directionOf(page) : null;
  if (!dir) return null;
  const near = (p: Vec) => {
    const q = toScreen(p);
    return Math.hypot(q.x - screen.x, q.y - screen.y) <= DIRECTION_HANDLE_PX;
  };
  return near(dir.to) ? 'to' : near(dir.from) ? 'from' : null;
}
