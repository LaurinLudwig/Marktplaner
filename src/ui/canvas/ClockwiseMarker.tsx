import { clockwiseOf, clockwiseStartDirection, isCircularMode } from '../../core/numbering';
import type { FestplatzPage, Vec } from '../../core/model/types';

/**
 * Mittelpunkt und Startrichtung der Nummerierung im bzw. gegen den Uhrzeigersinn (M5-02, #12): Fadenkreuz mit
 * Strahl und Drehpfeil im Drehsinn, in Bildschirmkoordinaten. Kein Plan-Objekt, nicht im PDF.
 */
export function ClockwiseMarker({ page, toScreen }: { page: FestplatzPage; toScreen: (p: Vec) => Vec }) {
  const cw = isCircularMode(page.numberingMode) ? clockwiseOf(page) : null;
  if (!cw) return null;
  const sense = page.numberingMode === 'clockwise' ? 1 : -1;
  const c = toScreen(cw.center);
  const dir = (clockwiseStartDirection(cw, page.northAngle) * Math.PI) / 180;
  const ray = { x: c.x + Math.sin(dir) * 60, y: c.y - Math.cos(dir) * 60 };
  const arc = (a: number) => ({ x: c.x + Math.sin(dir + a) * 22, y: c.y - Math.cos(dir + a) * 22 });
  const a0 = arc(0.35 * sense);
  const a1 = arc(1.4 * sense);
  return (
    <g className="clockwise-marker" data-testid="clockwise-marker" data-sense={sense === 1 ? 'cw' : 'ccw'}>
      <circle cx={c.x} cy={c.y} r={7} />
      <path d={`M${c.x - 12} ${c.y}H${c.x + 12}M${c.x} ${c.y - 12}V${c.y + 12}`} />
      <path className="ray" d={`M${c.x} ${c.y}L${ray.x} ${ray.y}`} />
      <path className="arc" d={`M${a0.x} ${a0.y}A22 22 0 0 ${sense === 1 ? 1 : 0} ${a1.x} ${a1.y}`} />
    </g>
  );
}
