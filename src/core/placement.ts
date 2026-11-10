/**
 * Lage eines Festplatzes im Verbund (#27, spec.md §12): starre Abbildungen (Drehung + Verschiebung, Maßstab 1) zwischen
 * dem eigenen Koordinatensystem einer Page und dem gemeinsamen System ihres Verbunds. Reine Rechnung ohne Oberfläche.
 *
 * Konvention (`Placement`, model/types.ts): welt = R(rot) · lokal + (x, y), `rot` in Grad im Uhrzeigersinn um den
 * Ursprung der Page.
 *
 * Objekte (Grundflächen, Stände, Infrastruktur) und Hintergründe werden für Ansichten nicht gespeichert, sondern als
 * zwischengespeicherte Kopien abgebildet (`placedObject`, `placedList`, `placedBackground`): Dieselbe Eingabe mit
 * derselben Lage liefert dieselbe Kopie, damit die Zwischenspeicher der Freiflächen und Warnungen und die
 * memo-Komponenten der Zeichenfläche weiter treffen. Mit der Identität kommt das Original selbst zurück.
 */
import { normAngle } from './geometry/rect';
import { rotate } from './geometry/vec';
import type { Background, Placement, Rect, Vec } from './model/types';

/** Keine Verschiebung, keine Drehung. */
export const IDENTITY: Placement = Object.freeze({ x: 0, y: 0, rot: 0 });

export const isIdentity = (p: Placement) => p.x === 0 && p.y === 0 && normAngle(p.rot) === 0;

export const samePlacement = (a: Placement, b: Placement) => a === b || (a.x === b.x && a.y === b.y && a.rot === b.rot);

/** Punkt abbilden: R(rot) · v + (x, y). */
export function applyPlacement(p: Placement, v: Vec): Vec {
  const r = p.rot ? rotate(v, p.rot) : v;
  return { x: r.x + p.x, y: r.y + p.y };
}

/** Richtung (z. B. Beschriftungsversatz) abbilden: nur drehen. */
export const rotateVector = (p: Placement, v: Vec): Vec => (p.rot ? rotate(v, p.rot) : v);

/** Hintereinander: erst `b`, dann `a` (a ∘ b). */
export function composePlacement(a: Placement, b: Placement): Placement {
  const t = applyPlacement(a, { x: b.x, y: b.y });
  return { x: t.x, y: t.y, rot: a.rot + b.rot };
}

/** Umkehrung: lokal = R(−rot) · (welt − (x, y)). */
export function invertPlacement(p: Placement): Placement {
  const t = rotate({ x: p.x, y: p.y }, -p.rot);
  return { x: -t.x, y: -t.y, rot: -p.rot };
}

/**
 * Abbildung aus dem System von `from` in das von `to`, beide als Lage im selben gemeinsamen System:
 * to⁻¹ ∘ from. Gleiche Lagen ergeben exakt die Identität.
 */
export function relativePlacement(to: Placement, from: Placement): Placement {
  if (samePlacement(to, from)) return IDENTITY;
  return composePlacement(invertPlacement(to), from);
}

/** Gleitkomma-Reste entfernen (10⁻⁸), Drehung auf 0 … 360°. */
const fine = (n: number) => {
  const r = Math.round(n * 1e8) / 1e8;
  return Object.is(r, -0) ? 0 : r;
};

/** Lage zum Speichern: Gleitkomma-Reste unter 10⁻⁸ entfernt, Drehung auf 0 … 360°. */
export function cleanPlacement(p: Placement): Placement {
  return { x: fine(p.x), y: fine(p.y), rot: normAngle(fine(normAngle(p.rot))) };
}

/**
 * Starre Bewegung in der Form „um `pivot` drehen, dann verschieben“ (core/verbund.ts `PageTransform`) als Lage:
 * p ↦ R(p − pivot) + pivot + d = R · p + (pivot + d − R · pivot).
 */
export function placementOfTransform(t: { dx: number; dy: number; rot: number; pivot: Vec }): Placement {
  const rp = t.rot ? rotate(t.pivot, t.rot) : t.pivot;
  return { x: t.pivot.x + t.dx - rp.x, y: t.pivot.y + t.dy - rp.y, rot: t.rot };
}

// ---------- Objekte abbilden ----------

/** Was ein abbildbares Objekt hat: ein Rechteck und bei Ständen den Versatz der Beschriftung. */
type Placeable = Rect & { labelOffset?: Vec | null };

/**
 * Objekt abbilden (Grundfläche, Stand, Infrastruktur oder reines Rechteck): Mitte abgebildet, Drehung + `rot`; Punkte
 * (Breite und Tiefe 0, Marker) behalten ihre Drehung 0; ein von Hand verschobener Beschriftungsversatz (`labelOffset`,
 * relativ zur Standmitte in den Achsen des Plans) wird mitgedreht. Teile einer eigenen Form hängen relativ am Stand und
 * bleiben unverändert. `round: true` entfernt nur Gleitkomma-Reste (10⁻⁸) – für gespeicherte Werte, die nicht neu
 * gerundet werden (Umhängen, „Platz in der Einzelansicht drehen“). Liefert immer eine neue Kopie.
 */
export function placeObject<T extends Placeable>(p: Placement, o: T, opts: { round?: boolean } = {}): T {
  const pos = opts.round ? fine : (n: number) => n;
  const c = applyPlacement(p, { x: o.cx, y: o.cy });
  const point = o.w === 0 && o.d === 0;
  const out: T = { ...o, cx: pos(c.x), cy: pos(c.y), rot: point ? o.rot : normAngle(opts.round ? fine(normAngle(o.rot + p.rot)) : o.rot + p.rot) };
  if (o.labelOffset && p.rot) {
    const v = rotate(o.labelOffset, p.rot);
    out.labelOffset = { x: pos(v.x), y: pos(v.y) };
  }
  return out;
}

/** Hintergrund abbilden: Ecke (x, y) abgebildet, Drehung + `rot`; Maßstab und Kalibrierung bleiben. */
export function placeBackground(p: Placement, bg: Background): Background {
  const c = applyPlacement(p, { x: bg.transform.x, y: bg.transform.y });
  return { ...bg, transform: { ...bg.transform, x: c.x, y: c.y, rot: normAngle(bg.transform.rot + p.rot) } };
}

// ---------- Zwischengespeicherte Kopien ----------

interface Entry<T> {
  p: Placement;
  out: T;
}

/** Je Eingabe die zuletzt verwendeten Lagen (ein Objekt kann z. B. Nachbar mehrerer Pages und Teil der Gesamtansicht sein). */
const MAX_ENTRIES = 4;

function cached<K extends object, T>(cache: WeakMap<K, Entry<T>[]>, key: K, p: Placement, make: () => T): T {
  const list = cache.get(key);
  if (list) {
    const i = list.findIndex((e) => samePlacement(e.p, p));
    if (i >= 0) {
      const e = list[i]!;
      if (i > 0) {
        list.splice(i, 1);
        list.unshift(e);
      }
      return e.out;
    }
  }
  const out = make();
  const entry = { p: { x: p.x, y: p.y, rot: p.rot }, out };
  if (list) {
    list.unshift(entry);
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  } else cache.set(key, [entry]);
  return out;
}

const objectCache = new WeakMap<object, Entry<object>[]>();
const listCache = new WeakMap<readonly object[], Entry<readonly object[]>[]>();
const bgCache = new WeakMap<Background, Entry<Background>[]>();

/** Abgebildetes Objekt, zwischengespeichert je Objekt und Lage; mit der Identität das Objekt selbst. */
export function placedObject<T extends Placeable>(p: Placement, o: T): T {
  if (isIdentity(p)) return o;
  return cached(objectCache, o, p, () => placeObject(p, o)) as T;
}

/** Abgebildete Liste, zwischengespeichert je Liste und Lage; jedes Objekt über `placedObject`. */
export function placedList<T extends Placeable>(p: Placement, list: readonly T[]): readonly T[] {
  if (isIdentity(p) || !list.length) return list;
  return cached(listCache, list, p, () => list.map((o) => placedObject(p, o))) as readonly T[];
}

/** Abgebildeter Hintergrund, zwischengespeichert; mit der Identität der Hintergrund selbst. */
export function placedBackground(p: Placement, bg: Background): Background {
  if (isIdentity(p)) return bg;
  return cached(bgCache, bg, p, () => placeBackground(p, bg));
}

/** Objekt aus dem System der Page in das des Verbunds (Welt). */
export const toWorld = <T extends Placeable>(p: Placement, o: T, opts: { round?: boolean } = {}): T => placeObject(p, o, opts);

/** Objekt aus dem System des Verbunds (Welt) in das der Page. */
export const toLocal = <T extends Placeable>(p: Placement, o: T, opts: { round?: boolean } = {}): T => placeObject(invertPlacement(p), o, opts);
