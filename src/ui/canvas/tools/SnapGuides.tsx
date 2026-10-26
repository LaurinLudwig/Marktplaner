import type { Vec } from '../../../core/model/types';
import type { Guide } from '../../../core/moveSnap';

/**
 * Hilfslinien beim Einrasten (wie die intelligenten Hilfslinien in Illustrator), in
 * Bildschirmkoordinaten: Vorderseite der Grundfläche mit Namen, gemeinsame Kante beim Anliegen,
 * gestrichelte Fluchtlinie, Querstrich am Ende der Vorderseite.
 */
export function SnapGuides({ guides, toScreen }: { guides: readonly Guide[]; toScreen: (p: Vec) => Vec }) {
  return (
    <g className="snap-guides" data-testid="snap-guides">
      {guides.map((g, i) => {
        const a = toScreen(g.a);
        const b = toScreen(g.b);
        return (
          <g key={i} data-kind={g.kind}>
            <line className={g.kind} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            {/* Am linken Ende der Vorderseite: Die Mitte trägt bereits die Grundflächen-Beschriftung */}
            {g.kind === 'front' && (
              <text x={a.x} y={a.y + 16} textAnchor="start">
                Vorderseite · {g.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
