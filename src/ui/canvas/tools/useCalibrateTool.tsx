import { useEffect, useRef, useState } from 'react';
import { notify } from '../../../app/notify';
import { confirmScale } from '../../../app/dialogs';
import { calibrate, CalibrationError, scaleWarnings, worldToBg } from '../../../core/background';
import { fmt, fmtInput, parseNum } from '../../../core/format';
import { constrainAngle, measure } from '../../../core/measure';
import type { Vec } from '../../../core/model/types';
import { updateBackground } from '../../../state/pageSettings';
import { useStore } from '../../../state/store';
import { MeasureLine } from './useMeasureTool';
import type { ToolContext, ToolHandlers, ToolPointer } from './types';

type Phase = { step: 'p1' } | { step: 'p2'; p1: Vec; p2: Vec } | { step: 'confirm'; p1: Vec; p2: Vec };

const GRAB_PX = 9;

/**
 * Kalibrieren (K): zwei Punkte auf dem Plan klicken, realen Abstand eingeben.
 * Bis zur Bestätigung lassen sich beide Punkte noch verschieben. Nur der Hintergrund wird
 * skaliert (core/background.ts › calibrate); gezeichnete Objekte bleiben unverändert.
 * Danach wird der Hintergrund gesperrt und das Auswahlwerkzeug aktiviert.
 */
export function useCalibrateTool(ctx: ToolContext, active: boolean): ToolHandlers {
  const [phase, setPhase] = useState<Phase>({ step: 'p1' });
  const [dragging, setDragging] = useState<'p1' | 'p2' | null>(null);
  const [meters, setMeters] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Werkzeug- oder Seitenwechsel bricht die Kalibrierung ab (Zurücksetzen beim Rendern)
  const key = active ? ctx.page.id : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setPhase({ step: 'p1' });
    setError(null);
  }
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase.step === 'confirm') inputRef.current?.focus();
  }, [phase.step]);

  const bg = ctx.page.background;

  const near = (screen: Vec, world: Vec) => {
    const s = ctx.toScreen(world);
    return Math.hypot(s.x - screen.x, s.y - screen.y) <= GRAB_PX;
  };

  const apply = async () => {
    if (phase.step !== 'confirm' || !bg) return;
    const value = parseNum(meters);
    try {
      const transform = calibrate(bg.transform, phase.p1, phase.p2, value);
      // Unplausibler Maßstab oder starke Änderung: erst nachfragen (QA-M2-07)
      const previous = bg.calibration || bg.paperScale ? bg.transform : null;
      if (!(await confirmScale(scaleWarnings(bg.kind, bg.pxSize, transform, previous)))) return;
      updateBackground(ctx.page.id, 'Hintergrund kalibrieren', {
        transform,
        calibration: { p1: worldToBg(bg.transform, phase.p1), p2: worldToBg(bg.transform, phase.p2), meters: value },
        paperScale: undefined,
        locked: true,
      });
      const px = measure(worldToBg(bg.transform, phase.p1), worldToBg(bg.transform, phase.p2)).distance;
      const unit = bg.kind === 'pdf' ? 'pt' : 'px';
      notify(`Kalibriert: ${fmt(value)} m ≙ ${fmt(px, 1)} ${unit}. Hintergrund gesperrt.`, 'success', 6000);
      useStore.getState().setUi({ tool: 'select' });
    } catch (e) {
      setError(e instanceof CalibrationError ? e.message : 'Bitte einen gültigen Abstand in Metern eingeben.');
    }
  };

  const cancel = () => {
    setPhase({ step: 'p1' });
    setError(null);
  };

  const point2 = (p: ToolPointer, p1: Vec) => (p.shiftKey ? constrainAngle(p1, p.world) : p.world);

  const handlers: ToolHandlers = {
    onPointerDown(p) {
      if (!active || !bg) return false;
      if (phase.step === 'p1') {
        setPhase({ step: 'p2', p1: p.world, p2: p.world });
        return true;
      }
      if (phase.step === 'p2') {
        const p2 = point2(p, phase.p1);
        setPhase({ step: 'confirm', p1: phase.p1, p2 });
        setMeters(fmtInput(measure(phase.p1, p2).distance, 2));
        setError(null);
        return true;
      }
      // confirm: Punkte greifen und verschieben
      if (near(p.screen, phase.p2)) setDragging('p2');
      else if (near(p.screen, phase.p1)) setDragging('p1');
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      if (phase.step === 'p2') setPhase({ ...phase, p2: point2(p, phase.p1) });
      else if (phase.step === 'confirm' && dragging) {
        setPhase(dragging === 'p1' ? { ...phase, p1: p.world } : { ...phase, p2: point2(p, phase.p1) });
      }
    },
    onPointerUp() {
      setDragging(null);
    },
    onKeyDown(e) {
      if (!active || e.key !== 'Escape' || phase.step === 'p1') return false;
      cancel();
      return true;
    },
    overlay: null,
    panel: null,
  };

  if (!active) return handlers;

  if (phase.step !== 'p1') {
    handlers.overlay = (
      <g className="calibrate-overlay">
        <MeasureLine className="calibrate" a={ctx.toScreen(phase.p1)} b={ctx.toScreen(phase.p2)} result={measure(phase.p1, phase.p2)} />
        {phase.step === 'confirm' &&
          [phase.p1, phase.p2].map((w, i) => {
            const s = ctx.toScreen(w);
            return <circle key={i} className="calibrate-handle" cx={s.x} cy={s.y} r={6} />;
          })}
      </g>
    );
  }

  if (!bg) {
    handlers.panel = <div className="tool-hint">Kalibrieren: Zuerst einen Hintergrund importieren.</div>;
  } else if (phase.step === 'p1') {
    handlers.panel = <div className="tool-hint">Kalibrieren: ersten Punkt mit bekanntem Abstand auf dem Plan anklicken</div>;
  } else if (phase.step === 'p2') {
    handlers.panel = <div className="tool-hint">Kalibrieren: zweiten Punkt anklicken · Shift = 45°-Schritte · Esc = abbrechen</div>;
  } else {
    handlers.panel = (
      <form
        className="tool-panel"
        aria-label="Kalibrierung"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <label htmlFor="calibrate-meters">Realer Abstand</label>
        <span className="inp">
          <input
            id="calibrate-meters"
            ref={inputRef}
            className={`num${error ? ' bad' : ''}`}
            value={meters}
            inputMode="decimal"
            autoComplete="off"
            onChange={(e) => {
              setMeters(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
          />
          <span className="unit">m</span>
        </span>
        <button type="submit" className="btn primary">
          Anwenden
        </button>
        <button type="button" className="btn" onClick={cancel}>
          Abbrechen
        </button>
        <span className="tool-panel-note">{error ?? 'Punkte lassen sich noch verschieben.'}</span>
      </form>
    );
  }
  return handlers;
}
