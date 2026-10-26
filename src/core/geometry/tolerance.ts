/**
 * Toleranzen für alle geometrischen Entscheidungen (spec.md Begriffe, QA-M4-01/-02).
 *
 * Zwei Dinge sind getrennt:
 * - Fachliche Toleranz TOL = 0,01 m: Eine Eindringtiefe bzw. ein Abstand bis EINSCHLIESSLICH 0,01 m gilt
 *   als bündig. Er belegt keine Fläche und löst weder eine Überlappungs- noch eine Außerhalb-Warnung aus.
 *   Erst mehr als 0,01 m zählt.
 * - Rechentoleranz EPS = 1e-6 m: Gleitkomma-Reste (z. B. 1,49 − 1,5 = −0,010000000000000009 oder Reste nach
 *   einer Drehung) dürfen eine Entscheidung nicht kippen. Die Grenze bei genau 0,01 m ist damit
 *   deterministisch, unabhängig von Koordinaten und Drehung.
 *
 * Regel: Geometrische Entscheidungen in src/core/ vergleichen nie direkt mit < oder >, sondern über diese
 * Funktionen.
 */

/** Fachliche Toleranz in Metern (= Speichergenauigkeit). */
export const TOL = 0.01;
/** Rechentoleranz in Metern. */
export const EPS = 1e-6;

/** Zählt fachlich: mehr als TOL (Eindringtiefe, Abstand nach außen). */
export const exceedsTol = (d: number) => d > TOL + EPS;
/** Bündig: höchstens TOL (einschließlich). */
export const withinTol = (d: number) => !exceedsTol(d);

/** a ≤ b mit Rechentoleranz. */
export const atMost = (a: number, b: number) => a <= b + EPS;
/** a ≥ b mit Rechentoleranz. */
export const atLeast = (a: number, b: number) => a >= b - EPS;
/** a < b, um mehr als die Rechentoleranz. */
export const lessThan = (a: number, b: number) => a < b - EPS;
/** a > b, um mehr als die Rechentoleranz. */
export const greaterThan = (a: number, b: number) => a > b + EPS;
/** Praktisch null (Rechentoleranz). */
export const isZero = (d: number) => Math.abs(d) <= EPS;

/**
 * Numerischer Kern (Vorzeichen von Kreuzprodukten beim Zuschneiden, in m²): nur innerhalb von
 * polygon.ts. Fachliche Entscheidungen nutzen die Funktionen oben.
 */
export const KERNEL_EPS = 1e-12;

/** Vergleich von Winkeln in Grad, z. B. „parallel“ (0,1° = Speichergenauigkeit der Drehung). */
export const ANGLE_TOL = 0.1;
/** Abweichung zweier Winkel modulo `period` (0 … period/2). */
export const angleDiff = (a: number, b: number, period: number) => {
  const d = (((a - b) % period) + period) % period;
  return Math.min(d, period - d);
};
/** Gleiche Richtung modulo `period` (z. B. 90: parallel oder senkrecht). */
export const sameAngle = (a: number, b: number, period: number) => angleDiff(a, b, period) <= ANGLE_TOL + 1e-9;
