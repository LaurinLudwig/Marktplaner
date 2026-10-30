import type { SVGProps } from 'react';
import { isIcon, type Prim } from '../../../core/scene/prims';
import { iconPath } from '../../icons/infraIcons';

/**
 * Zeichnet ein Primitiv der gemeinsamen Szene (core/scene, M8) als SVG-Element. Der Stilschlüssel wird zur
 * CSS-Klasse (Design hell/dunkel, `vector-effect: non-scaling-stroke`); die Variante zur zweiten Klasse. Datenfarben:
 * Stände über `fill`, alles andere über `color` (CSS nutzt `currentColor`).
 *
 * `unit` skaliert Koordinaten (Beschriftung rechnet in Zentimetern, siehe ObjectsLayer); `sized` setzt Schriftgröße
 * und -schnitt am Text (Papier-Elemente), sonst kommen sie von der umgebenden Gruppe.
 */
type Extra = Omit<SVGProps<SVGElement>, 'ref' | 'points' | 'd'> & Record<`data-${string}`, string | undefined>;

export function PrimView({ p, unit = 1, sized = false, className, ...rest }: { p: Prim; unit?: number; sized?: boolean } & Extra) {
  const cls = [p.s, p.v, className].filter(Boolean).join(' ');
  const filled = p.s === 'stand' || p.s === 'stand-fill';
  const color = p.color && !filled ? { style: { color: p.color } } : {};
  const common = { className: cls, ...color, ...(rest as object) };
  switch (p.t) {
    case 'poly':
      return <polygon {...common} points={p.pts.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`).join(' ')} {...(p.s === 'stand' ? { fill: p.color } : {})} />;
    case 'rect':
      return <rect {...common} x={p.x} y={p.y} width={p.w} height={p.h} />;
    case 'line':
      // `unit` wie beim Text: Führungslinien der Standbeschriftung (#9) liegen in der Zentimeter-Gruppe der Beschriftung
      return <line {...common} x1={p.a.x * unit} y1={p.a.y * unit} x2={p.b.x * unit} y2={p.b.y * unit} strokeWidth={p.width} strokeDasharray={p.dash?.join(' ')} />;
    case 'path': {
      const d = isIcon(p) ? iconPath(p.icon) : p.d;
      const at = p.at;
      const transform = at ? `translate(${at.x} ${at.y})${at.rot ? ` rotate(${at.rot})` : ''} scale(${at.k})` : undefined;
      return <path {...common} d={d} transform={transform} strokeWidth={p.width} strokeDasharray={p.dash?.join(' ')} {...(filled ? { fill: p.color } : {})} />;
    }
    case 'text': {
      const size = sized ? { fontSize: p.size * unit, ...(p.weight !== 400 ? { fontWeight: p.weight } : {}) } : {};
      if (p.lines.length === 1)
        return (
          <text {...common} {...size} textAnchor={p.anchor === 'start' ? undefined : p.anchor} x={p.x * unit} y={p.y * unit}>
            {p.lines[0]}
          </text>
        );
      return (
        <text {...common} {...size} textAnchor={p.anchor === 'start' ? undefined : p.anchor}>
          {p.lines.map((line, i) => (
            <tspan key={i} x={p.x * unit} y={(p.y + i * p.lineHeight) * unit}>
              {line}
            </tspan>
          ))}
        </text>
      );
    }
  }
}

/**
 * Die Beschriftung rechnet in Zentimetern (Gruppe scale(0.01)). So bleiben die Schriftgrößen im
 * SVG zweistellig; sehr kleine font-size-Werte unter großem Skalierungsfaktor werden in WebKit
 * sonst ungenau gesetzt.
 */
export const CM = 100;

/** Mehrere Primitive ohne eigene Attribute. */
export function Prims({ prims, unit, sized }: { prims: readonly Prim[]; unit?: number; sized?: boolean }) {
  return prims.map((p, i) => <PrimView key={i} p={p} unit={unit} sized={sized} />);
}

