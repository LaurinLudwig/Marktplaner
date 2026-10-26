import { useEffect, useState } from 'react';
import { fmt } from '../../core/format';

/** Zeitraum, über den Bildrate und längstes Bild gemessen werden. */
const WINDOW_MS = 2000;

/**
 * Einblendbare Anzeige der Bildrate (Cmd/Strg+Alt+F), um in der echten Desktop-App zu messen:
 * Bilder pro Sekunde und das längste Bild der letzten 2 s. Gemessen über requestAnimationFrame, also
 * die Bilder, die der Browser tatsächlich zeichnet. HTML über der Zeichenfläche, nicht Teil des SVG
 * (erscheint deshalb nie im PDF-Export). Standardmäßig aus; nur eingeblendet läuft die Messung.
 */
export function FpsMeter() {
  const [stats, setStats] = useState<{ fps: number; maxMs: number } | null>(null);
  useEffect(() => {
    const times: number[] = [];
    let raf = 0;
    let lastShown = 0;
    const tick = (t: number) => {
      times.push(t);
      while (times.length && times[0]! < t - WINDOW_MS) times.shift();
      if (t - lastShown > 250 && times.length > 1) {
        lastShown = t;
        let maxMs = 0;
        for (let i = 1; i < times.length; i++) maxMs = Math.max(maxMs, times[i]! - times[i - 1]!);
        setStats({ fps: ((times.length - 1) / (times.at(-1)! - times[0]!)) * 1000, maxMs });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="fps-meter" data-testid="fps-meter" aria-live="off">
      <b>{stats ? fmt(stats.fps, 0) : '–'}</b> Bilder/s · längstes Bild <b>{stats ? fmt(stats.maxMs, 0) : '–'}</b> ms
    </div>
  );
}
