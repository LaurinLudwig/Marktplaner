/**
 * Deutung von Rad-Ereignissen auf der Zeichenfläche:
 * - Mausrad zoomt (SPEC: „Zoom mit Mausrad“).
 * - Trackpad: Zwei-Finger-Wischen verschiebt, Pinch zoomt.
 *   Chromium/WebView2 melden Pinch als Rad-Ereignis mit gesetzter Strg-Taste; Safari/WKWebView
 *   melden ihn als `gesturechange` (siehe Canvas.tsx).
 *
 * Browser verraten nicht direkt, ob ein Rad-Ereignis von Maus oder Trackpad kommt. Erkennung:
 * Mausräder liefern zeilenweise Deltas oder Vielfache von 120 im alten `wheelDeltaY`;
 * Trackpads liefern pixelgenaue, meist kleine Werte und oft auch horizontale Anteile.
 */

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  /** Veraltet, aber in Chromium und WebKit vorhanden; bei Mausrädern ein Vielfaches von 120. */
  wheelDeltaY?: number;
}

export type WheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

const LINE_PX = 33;

export function isMouseWheel(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0) return false;
  const legacy = e.wheelDeltaY;
  return legacy !== undefined && legacy !== 0 && Math.abs(legacy) >= 120 && legacy % 120 === 0;
}

/**
 * @param invertPan Einstellung „Wischrichtung umkehren“ (Menü). Standard: Richtung wie das System
 *   (wie Safari, Figma und die Tab-Leiste; die macOS-Einstellung „Natürliche Scrollrichtung“ wirkt
 *   bereits auf die Deltas).
 */
export function interpretWheel(e: WheelLike, invertPan = false): WheelAction {
  const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 400 : 1;
  if (e.ctrlKey) {
    // Pinch (oder Strg + Mausrad): feinere Deltas, daher stärkerer Faktor pro Pixel
    return { kind: 'zoom', factor: Math.exp(-e.deltaY * scale * 0.01) };
  }
  if (isMouseWheel(e)) {
    return { kind: 'zoom', factor: Math.exp(-e.deltaY * scale * 0.0015) };
  }
  const dir = invertPan ? 1 : -1;
  return { kind: 'pan', dx: dir * e.deltaX * scale, dy: dir * e.deltaY * scale };
}
