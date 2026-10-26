import type { SnapResult } from '../../../core/snap';
import type { Vec } from '../../../core/model/types';

/** Anzeige des Fangpunkts: Quadrat für Ecken, Raute für Kanten. */
export function SnapMarker({ snap, toScreen }: { snap: SnapResult | null; toScreen: (p: Vec) => Vec }) {
  if (!snap) return null;
  const p = toScreen(snap.point);
  return snap.kind === 'corner' ? (
    <rect className="snap-marker" x={p.x - 5} y={p.y - 5} width={10} height={10} />
  ) : (
    <path className="snap-marker" d={`M${p.x} ${p.y - 6}L${p.x + 6} ${p.y}L${p.x} ${p.y + 6}L${p.x - 6} ${p.y}Z`} />
  );
}
