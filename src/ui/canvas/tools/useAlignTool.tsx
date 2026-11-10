import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { notify } from '../../../app/notify';
import type { Preview } from '../../../core/derive';
import { fmt, fmtInput, parseNum } from '../../../core/format';
import { rotate } from '../../../core/geometry/vec';
import { pickObject } from '../../../core/hit';
import type { Background, FestplatzPage, Id, Vec } from '../../../core/model/types';
import { activeAreas } from '../../../core/pageAreas';
import { findSnap, pointSnapSource, type SnapResult } from '../../../core/snap';
import { applyTransform, inverseTransform, ownerOf, pageExtent, pagePivot, worldMembers, worldPage, type PageTransform } from '../../../core/verbund';
import {
  ALIGN_OUTLIER_MIN_PAIRS,
  alignPreview,
  fitRigid,
  NO_SESSION,
  sessionMove,
  sessionOpen,
  sessionRotate,
  sessionTransform,
  verbundOfRef,
  type AlignSession,
  type PointPair,
} from '../../../core/verbundView';
import { tip } from '../../shortcuts/tip';
import { useStore } from '../../../state/store';
import { movePageContent } from '../../../state/verbund';
import { SnapMarker } from './SnapMarker';
import { SNAP_PX, type ToolContext, type ToolHandlers, type ToolPointer } from './types';

/** Ab dieser Bewegung (px) ist ein Ziehen kein Klick mehr (wie die Griffe, spec.md „Allgemein“). */
const DRAG_PX = 3;
/** Abstand des Drehgriffs vom oberen Rand der Platz-Hülle (px) und Fangradius des Griffs (px). */
const HANDLE_PX = 28;
const HANDLE_HIT_PX = 9;
/** Deckkraft des gewählten Hintergrunds beim Ausrichten (Anzeige, nicht gespeichert). */
const OPACITY_DEFAULT = 0.5;
const OPACITY_MIN = 0.1;

type Mode = 'manual' | 'points';
type Session = AlignSession;
type Gesture =
  | { kind: 'move'; start: Vec; startScreen: Vec; moved: boolean; base: Session | null }
  | { kind: 'rotate'; from: Vec; center: Vec; base: Session | null };
/** Punktpaare; `pendingA` = gesetzter A-Punkt ohne B (in den gespeicherten Koordinaten des Platzes). */
type Points = { pairs: PointPair[]; pendingA: Vec | null };

const NO_POINTS: Points = { pairs: [], pendingA: null };
const ZERO = NO_SESSION;
const isOpen = sessionOpen;

/** Wird von der Zeichenfläche gelesen: Vorschau-Hintergrund und Deckkraft des gewählten Platzes. */
export interface AlignView {
  /** Bewegter Hintergrund je Platz (Vorschau), sonst null. */
  backgrounds: Record<Id, Background | null> | null;
  /** Gewählter Platz: sein Hintergrund liegt oben und mit dieser Deckkraft (0,1 … 1). */
  dim: { pageId: Id; opacity: number } | null;
}

/**
 * Werkzeug „Ausrichten“ (A, nur in der Gesamtansicht eines Verbunds; #15 Teil b, #26; spec.md §12). Platz wählen
 * (Klick auf eines seiner Objekte oder Auswahl im Panel); sein Hintergrund liegt halbtransparent oben (Regler
 * „Deckkraft“). Zwei Modi:
 * - **Manuell** (Sitzung): Ziehen verschiebt, der Drehgriff bzw. das Gradfeld dreht um die Mitte des Platzes – alles
 *   nur Vorschau; „Fertig“ übernimmt Verschiebung und Drehung als einen Undo-Schritt, „Abbrechen“/Esc verwirft.
 * - **Punkte**: beliebig viele Paare A_i (gewählter Plan) → B_i (Referenz); ab 2 Paaren Vorschau mit der
 *   bestpassenden starren Bewegung (`fitRigid`), „Anwenden“ = ein Undo-Schritt.
 * Die Vorschau ist eine Transformation je Platz (`alignPreview`: Vorschau-Lage des Platzes, #27); übernommen wird sie
 * mit `movePageContent`, das nur die Lage im Verbund ändert (der Inhalt der Page bleibt).
 */
export function useAlignTool(ctx: ToolContext, active: boolean): ToolHandlers & AlignView {
  const verbund = useStore((s) => verbundOfRef(s.project, ctx.page.id));
  const pages = useStore((s) => s.project.pages);
  // Mitglieder im System des Verbunds (#27: mit ihrer Lage abgebildet); Ausrichten ändert nur die Lage (`movePageContent`)
  const members = verbund ? worldMembers({ pages }, verbund) : [];
  const [memberId, setMemberId] = useState<Id | null>(null);
  const [mode, setMode] = useState<Mode>('manual');
  const [session, setSession] = useState<Session | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [points, setPoints] = useState<Points>(NO_POINTS);
  const [hover, setHover] = useState<SnapResult | null>(null);
  const [overHandle, setOverHandle] = useState(false);
  const [opacity, setOpacity] = useState(OPACITY_DEFAULT);

  // Werkzeug- oder Seitenwechsel verwirft offene Änderungen (Zurücksetzen beim Rendern)
  const key = active ? ctx.page.id : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setGesture(null);
    setSession(null);
    setPoints(NO_POINTS);
    setHover(null);
    setOverHandle(false);
  }
  // Aus dem Store gelesen (unveränderlich für den React Compiler), nur solange der Platz Mitglied ist
  const stored = useStore((s) => (memberId && verbundOfRef(s.project, ctx.page.id)?.pageIds.includes(memberId) ? (s.project.pages.find((p) => p.id === memberId) ?? null) : null));
  // Im System des Verbunds (#27, zwischengespeichert): Mitte, Hülle, Fang und Punktpaare rechnen in der Welt
  const member = useMemo(() => (stored && verbund ? worldPage(verbund, stored) : null), [stored, verbund]);
  const others = members.filter((p) => p.id !== memberId);
  const pivot = member ? pagePivot(member) : null;
  const fit = useMemo(() => fitRigid(points.pairs), [points.pairs]);
  const open = mode === 'manual' ? isOpen(session) : points.pairs.length > 0 || points.pendingA !== null;

  // ---------- Vorschau: eine Transformation je Platz ----------
  const t = useMemo<PageTransform | null>(() => {
    if (mode === 'manual') return member ? sessionTransform(session, pagePivot(member)) : null;
    return fit?.t ?? null;
  }, [mode, session, fit, member]);
  // Vorschau über die Lage (#27): Vorschau-Lage = t ∘ Lage, daraus Weltkopien und Hintergrund
  const preview = useMemo(() => (active && verbund && stored && t ? alignPreview(verbund, stored, t) : null), [active, verbund, stored, t]);
  const mid = member?.id ?? null;
  const backgrounds = useMemo(() => (preview && mid ? { [mid]: preview.background } : null), [preview, mid]);
  const dim = useMemo(() => (mid ? { pageId: mid, opacity } : null), [mid, opacity]);
  const ownPreview = useRef<Preview | null>(null);
  useLayoutEffect(() => {
    const st = useStore.getState();
    if (preview) {
      const next: Preview = { pageId: ctx.page.id, rects: preview.rects, labelOffsets: preview.labelOffsets };
      ownPreview.current = next;
      st.setPreview(next);
    } else if (ownPreview.current) {
      if (st.preview === ownPreview.current) st.setPreview(null);
      ownPreview.current = null;
    }
  }, [preview, ctx.page.id]);
  useLayoutEffect(
    () => () => {
      if (ownPreview.current && useStore.getState().preview === ownPreview.current) useStore.getState().setPreview(null);
    },
    [],
  );

  /** Platz unter dem Punkt: Besitzer des obersten Objekts (auch auf gesperrten Ebenen, solange sichtbar). */
  const memberAt = (w: Vec): Id | null => {
    const visibleOnly = Object.fromEntries(Object.entries(ctx.page.layers).map(([k, l]) => [k, { visible: l.visible, locked: false }])) as FestplatzPage['layers'];
    const tol = 5 / ctx.view.scale;
    const hit = pickObject({ ...ctx.page, layers: visibleOnly }, w, 0, { geometry: ctx.geometryOf, tol: { line: tol, point: Math.max(ctx.markerSize / 2, tol) } });
    return hit ? ownerOf({ pages }, hit.id) : null;
  };

  /** Fang der Punktpaare: Grundflächen-Ecken und Standmitten des gewählten Platzes (wie angezeigt) bzw. der anderen. */
  const snapOf = (w: Vec, own: boolean, off: boolean): SnapResult | null => {
    if (off || !member) return null;
    const L = ctx.page.layers;
    const list = own ? [preview?.page ?? member] : others;
    const source = pointSnapSource(L.areas.visible ? list.flatMap((p) => activeAreas(p)) : [], L.stands.visible ? list.flatMap((p) => p.stands) : []);
    return findSnap(w, [source], SNAP_PX / ctx.view.scale);
  };
  const nextOwn = points.pendingA === null;
  const pointsReady = mode === 'points' && !!member && others.length > 0;

  /** Drehgriff (Bildschirm): über der Mitte des oberen Rands der Platz-Hülle, dreht mit. */
  const ext = member ? pageExtent(member, 0) : null;
  const handle = (() => {
    if (!active || mode !== 'manual' || !ext) return null;
    const top = { x: (ext.minX + ext.maxX) / 2, y: ext.minY };
    const base = ctx.toScreen(t ? applyTransform(t, top) : top);
    const dir = rotate({ x: 0, y: -1 }, session?.rot ?? 0);
    return { base, at: { x: base.x + dir.x * HANDLE_PX, y: base.y + dir.y * HANDLE_PX } };
  })();
  const onHandle = (s: Vec) => !!handle && Math.hypot(s.x - handle.at.x, s.y - handle.at.y) <= HANDLE_HIT_PX;

  /** Offene Änderungen verwerfen; true = es gab welche. */
  const discard = (): boolean => {
    const had = open || gesture !== null;
    setGesture(null);
    setSession(null);
    setPoints(NO_POINTS);
    setHover(null);
    return had;
  };
  const discardWithHint = () => {
    if (discard() && member) notify(`Ausrichten: Änderungen an „${member.name}“ verworfen.`, 'info');
  };

  /** Platzwechsel über die Auswahl: offene Änderungen werden mit Hinweis verworfen (spec.md §12). */
  const switchMember = (id: Id | null) => {
    if (id === memberId) return;
    discardWithHint();
    setMemberId(id);
  };
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    discardWithHint();
    setMode(m);
  };

  /** Übernehmen: ein Undo-Schritt, Drehung und Verschiebung ungerundet (nur Gleitkomma-Reste entfallen). */
  const commit = () => {
    if (!member || !t) return;
    const what = mode === 'points' ? 'ausgerichtet' : t.rot && (t.dx || t.dy) ? 'verschoben und gedreht' : t.rot ? 'gedreht' : 'verschoben';
    const m = member;
    const tr = t;
    discard();
    if (movePageContent(m.id, tr, { precise: true })) notify(`${m.name} ${what}. Rückgängig mit Strg/Cmd+Z.`, 'success');
  };

  const setSessionField = (patch: Partial<Session>) => setSession((s) => ({ ...(s ?? ZERO), ...patch }));

  const handlers: ToolHandlers = {
    onPointerDown(p: ToolPointer) {
      if (!active || !verbund) return false;
      if (pointsReady && member) {
        const point = snapOf(p.world, nextOwn, p.modKey)?.point ?? p.world;
        if (nextOwn) {
          // A liegt auf dem Plan, wie er gerade angezeigt wird (Vorschau): zurück in seine gespeicherten Koordinaten
          setPoints({ pairs: points.pairs, pendingA: t ? applyTransform(inverseTransform(t), point) : point });
        } else {
          setPoints({ pairs: [...points.pairs, { a: points.pendingA!, b: point }], pendingA: null });
        }
        setHover(null);
        return true;
      }
      if (mode === 'manual' && member && onHandle(p.screen)) {
        const center = t ? applyTransform(t, pivot!) : pivot!;
        setGesture({ kind: 'rotate', from: p.world, center, base: session });
        return true;
      }
      // Bei offenen Änderungen bleibt der Platz fest (Ziehen bewegt ihn von überall); sonst wählt ein Klick den Platz
      const hit = open ? null : memberAt(p.world);
      if (hit && hit !== memberId) setMemberId(hit);
      const id = hit ?? memberId;
      if (!id || mode !== 'manual') return true;
      setGesture({ kind: 'move', start: p.world, startScreen: p.screen, moved: false, base: session });
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      if (pointsReady) setHover(snapOf(p.world, nextOwn, p.modKey));
      if (!gesture) {
        const over = onHandle(p.screen);
        if (over !== overHandle) setOverHandle(over);
        return;
      }
      const base = gesture.base ?? ZERO;
      if (gesture.kind === 'rotate') {
        setSession(sessionRotate(base, gesture.center, gesture.from, p.world, p.shiftKey));
        return;
      }
      const moved = gesture.moved || Math.hypot(p.screen.x - gesture.startScreen.x, p.screen.y - gesture.startScreen.y) > DRAG_PX;
      if (!moved) return;
      if (!gesture.moved) setGesture({ ...gesture, moved });
      setSession(sessionMove(base, { x: p.world.x - gesture.start.x, y: p.world.y - gesture.start.y }));
    },
    onPointerUp() {
      if (gesture) setGesture(null);
    },
    onKeyDown(e) {
      if (!active) return false;
      if (e.key === 'Escape') {
        if (gesture) {
          setSession(gesture.base);
          setGesture(null);
          return true;
        }
        return discard();
      }
      if (e.key === 'Enter' && t && !gesture) {
        commit();
        return true;
      }
      return false;
    },
    overlay: null,
    panel: null,
  };
  if (!active || !verbund) return { ...handlers, backgrounds: null, dim: null };
  if (gesture?.kind === 'rotate' || (!gesture && overHandle)) handlers.cursor = 'cursor-rotate';
  else if (pointsReady) handlers.cursor = 'cursor-crosshair';

  // ---------- Overlay: Umriss, Drehgriff, Punktpaare ----------
  const outline = ext
    ? [
        { x: ext.minX, y: ext.minY },
        { x: ext.maxX, y: ext.minY },
        { x: ext.maxX, y: ext.maxY },
        { x: ext.minX, y: ext.maxY },
      ].map((q) => ctx.toScreen(t ? applyTransform(t, q) : q))
    : null;
  const shownA = (a: Vec) => ctx.toScreen(t ? applyTransform(t, a) : a);
  const marks = [...points.pairs.map((pr) => ({ a: pr.a, b: pr.b as Vec | null })), ...(points.pendingA ? [{ a: points.pendingA, b: null }] : [])];
  handlers.overlay = (
    <g className="align-overlay" data-testid="align-overlay">
      {outline && <polygon className="align-outline" points={outline.map((q) => `${q.x},${q.y}`).join(' ')} />}
      {handle && (
        <g className="align-rotate" data-testid="align-rotate-handle-group">
          <line className="align-rotate-stem" x1={handle.base.x} y1={handle.base.y} x2={handle.at.x} y2={handle.at.y} />
          <circle className="align-rotate-handle" data-testid="align-rotate-handle" cx={handle.at.x} cy={handle.at.y} r={6} />
        </g>
      )}
      {marks.map((m, i) => {
        const a = shownA(m.a);
        const b = m.b ? ctx.toScreen(m.b) : null;
        const bad = fit?.outlier?.index === i;
        return (
          <g key={i} className={`align-mark${bad ? ' outlier' : ''}`} data-testid="align-mark">
            {b && <line className="align-pair" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
            <circle className="align-own" cx={a.x} cy={a.y} r={5} />
            <text className="align-label" x={a.x + 8} y={a.y - 8}>
              A{i + 1}
            </text>
            {b && (
              <>
                <circle className="align-ref" cx={b.x} cy={b.y} r={5} />
                <text className="align-label" x={b.x + 8} y={b.y + 16}>
                  B{i + 1}
                </text>
              </>
            )}
          </g>
        );
      })}
      <SnapMarker snap={hover} toScreen={ctx.toScreen} />
    </g>
  );

  // ---------- Panel ----------
  const pick = (
    <select aria-label="Platz" data-testid="align-member" value={memberId ?? ''} onChange={(e) => switchMember(e.target.value || null)}>
      <option value="">Platz wählen …</option>
      {members.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
  const modes = (
    <div className="seg align-mode" role="group" aria-label="Modus">
      <button type="button" aria-pressed={mode === 'manual'} data-testid="align-mode-manual" onClick={() => switchMode('manual')} {...tip({ label: 'Manuell', desc: 'Ziehen verschiebt, der Griff über dem Platz dreht (Shift = 15°-Schritte); „Fertig“ übernimmt alles als einen Schritt.', ariaLabel: false })}>
        Manuell
      </button>
      <button
        type="button"
        aria-pressed={mode === 'points'}
        data-testid="align-mode-points"
        disabled={members.length < 2}
        onClick={() => switchMode('points')}
        {...tip({ label: 'Punkte', desc: 'Punktpaare setzen: A auf dem gewählten Plan, dann den passenden Punkt B auf dem Referenzplan. Fang an Ecken und Standmitten, Cmd/Strg = ohne Fang.', ariaLabel: false })}
      >
        Punkte
      </button>
    </div>
  );
  const opacityControl = member && (
    <label className="align-group align-opacity" {...tip({ label: 'Deckkraft', desc: `Hintergrund von „${member.name}“ beim Ausrichten (nur Anzeige)`, ariaLabel: false })}>
      Deckkraft
      <input
        type="range"
        data-testid="align-opacity"
        aria-label="Deckkraft"
        min={OPACITY_MIN * 100}
        max={100}
        step={5}
        value={Math.round(opacity * 100)}
        onChange={(e) => setOpacity(Math.min(1, Math.max(OPACITY_MIN, Number(e.target.value) / 100)))}
      />
      <span className="align-opacity-value">{Math.round(opacity * 100)} %</span>
    </label>
  );
  const cancel = (
    <button type="button" className="btn" data-testid="align-cancel" disabled={!open} onClick={() => discard()}>
      Abbrechen
    </button>
  );

  let body: ReactNode;
  let list: ReactNode = null;
  if (!member) {
    body = <span className="tool-panel-note">Klick auf ein Objekt wählt seinen Platz</span>;
  } else if (mode === 'manual') {
    const s = session ?? ZERO;
    body = (
      <>
        <span className="align-group">
          <LiveField id="align-dx" label="X" unit="m" digits={3} value={s.dx} onChange={(dx) => setSessionField({ dx })} />
          <LiveField id="align-dy" label="Y" unit="m" digits={3} value={s.dy} onChange={(dy) => setSessionField({ dy })} />
          <LiveField id="align-rot" label="Drehung" unit="°" digits={4} value={s.rot} onChange={(rot) => setSessionField({ rot })} tipDesc="im Uhrzeigersinn um die Mitte des Platzes" />
        </span>
        <span className="align-group">
          <button type="submit" className="btn primary" data-testid="align-done" disabled={!open}>
            Fertig
          </button>
          {cancel}
        </span>
      </>
    );
  } else {
    const n = points.pairs.length + 1;
    body = (
      <>
        <span className="tool-panel-note align-step" data-testid="align-step">
          {nextOwn ? `A${n} auf „${member.name}“` : `B${n} auf Referenzplan`}
        </span>
        <span className="align-group">
          <button type="submit" className="btn primary" data-testid="align-apply" disabled={!fit}>
            Anwenden
          </button>
          {cancel}
        </span>
      </>
    );
    if (points.pairs.length || points.pendingA) {
      list = (
        <div className="align-pairs" data-testid="align-pairs">
          <ol>
            {points.pairs.map((_, i) => (
              <li key={i} className={fit?.outlier?.index === i ? 'outlier' : undefined} data-testid="align-pair">
                <span className="align-pair-nr">{i + 1}</span>
                <span className="align-residual" data-testid="align-residual">
                  {fit ? `${fmt(fit.residuals[i]!, 3)} m` : '–'}
                </span>
                <button
                  type="button"
                  className="icon-x"
                  data-testid="align-pair-remove"
                  onClick={() => setPoints({ pairs: points.pairs.filter((__, j) => j !== i), pendingA: points.pendingA })}
                  {...tip({ label: `Paar ${i + 1} entfernen` })}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          {fit && (
            <span
              className="align-summary"
              data-testid="align-result"
              {...tip({ label: 'Restabweichung', desc: `Abstand zwischen bewegtem A und B je Paar; „Mittel“ = quadratisches Mittel. Auffällige Paare erkennt das Werkzeug ab ${ALIGN_OUTLIER_MIN_PAIRS} Paaren.`, ariaLabel: false })}
            >
              Drehung {fmt(fit.rot, 3)}° · Mittel {fmt(fit.rms, 3)} m · max {fmt(fit.max, 3)} m
            </span>
          )}
          {!fit && points.pairs.length >= 2 && <span className="align-deviation">Die A- bzw. B-Punkte fallen zusammen: keine Richtung.</span>}
          {fit?.outlier && (
            <span className="align-deviation" data-testid="align-outlier">
              Paar {fit.outlier.index + 1} weicht auffällig ab (ohne es: Mittel {fmt(fit.outlier.rmsWithout, 3)} m) – prüfen oder entfernen.
            </span>
          )}
          <button type="button" className="link-btn" data-testid="align-clear" onClick={() => setPoints(NO_POINTS)}>
            Alle Paare löschen
          </button>
        </div>
      );
    }
  }
  handlers.panel = (
    <form
      className="tool-panel align-panel"
      aria-label="Ausrichten"
      data-testid="align-panel"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <div className="align-row">
        {pick}
        {modes}
        {opacityControl}
        {body}
      </div>
      {list}
    </form>
  );
  return { ...handlers, backgrounds, dim };
}

/**
 * Zahlenfeld der manuellen Sitzung: zeigt den aktuellen Wert (auch während des Ziehens) und übernimmt jede gültige
 * Eingabe sofort in die Vorschau; Enter = „Fertig“ (Formular), Esc stellt den Wert vor dem Bearbeiten wieder her.
 */
function LiveField({ id, label, unit, digits, value, onChange, tipDesc }: { id: string; label: string; unit: string; digits: number; value: number; onChange: (v: number) => void; tipDesc?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [before, setBefore] = useState(value);
  const valid = text === null || text.trim() === '' || Number.isFinite(parseNum(text));
  return (
    <span className="align-field">
      <label htmlFor={id} {...(tipDesc ? tip({ label, desc: tipDesc, ariaLabel: false }) : {})}>
        {label}
      </label>
      <span className="inp">
        <input
          id={id}
          data-testid={id}
          className={`num${valid ? '' : ' bad'}`}
          value={text ?? fmtInput(value, digits)}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setBefore(value);
            setText(fmtInput(value, digits));
          }}
          onBlur={() => setText(null)}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            const n = v.trim() === '' ? 0 : parseNum(v);
            if (Number.isFinite(n)) onChange(n);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            onChange(before);
            setText(null);
            (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="unit">{unit}</span>
      </span>
    </span>
  );
}
