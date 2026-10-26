import { clockwiseStartDirection, defaultClockwiseCenter } from '../../core/numbering';
import type { FestplatzPage, Vec } from '../../core/model/types';

/**
 * Mittelpunkt und Startrichtung der Nummerierung im Uhrzeigersinn (M5-02): Fadenkreuz mit Strahl und
 * Drehpfeil, in Bildschirmkoordinaten. Kein Plan-Objekt, nicht im PDF.
 */
export function ClockwiseMarker({ page, toScreen }: { page: FestplatzPage; toScreen: (p: Vec) => Vec }) {
  const center = page.clockwise?.center ?? defaultClockwiseCenter(page);
  if (page.numberingMode !== 'clockwise' || !center) return null;
  const c = toScreen(center);
  const dir = (clockwiseStartDirection(page.clockwise ?? { center, startAngle: 0 }, page.northAngle) * Math.PI) / 180;
  const ray = { x: c.x + Math.sin(dir) * 60, y: c.y - Math.cos(dir) * 60 };
  const arc = (a: number) => ({ x: c.x + Math.sin(dir + a) * 22, y: c.y - Math.cos(dir + a) * 22 });
  const a0 = arc(0.35);
  const a1 = arc(1.4);
  return (
    <g className="clockwise-marker" data-testid="clockwise-marker">
      <circle cx={c.x} cy={c.y} r={7} />
      <path d={`M${c.x - 12} ${c.y}H${c.x + 12}M${c.x} ${c.y - 12}V${c.y + 12}`} />
      <path className="ray" d={`M${c.x} ${c.y}L${ray.x} ${ray.y}`} />
      <path className="arc" d={`M${a0.x} ${a0.y}A22 22 0 0 1 ${a1.x} ${a1.y}`} />
    </g>
  );
}
