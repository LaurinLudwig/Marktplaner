import { useState } from 'react';
import { notify } from '../../../app/notify';
import { fmt, fmtInput, parseNum } from '../../../core/format';
import { pickObject } from '../../../core/hit';
import type { Background, FestplatzPage, Id, Vec } from '../../../core/model/types';
import { activeAreas } from '../../../core/pageAreas';
import { findSnap, pointSnapSource, type SnapResult } from '../../../core/snap';
import { applyTransform, memberPages, ownerOf, pageExtent, pagePivot, transformPageContent, type PageTransform } from '../../../core/verbund';
import { ALIGN_DEVIATION_HINT, translation, twoPointTransform, verbundOfRef, type TwoPointResult } from '../../../core/verbundView';
import { useStore } from '../../../state/store';
import { movePageContent } from '../../../state/verbund';
import { SnapMarker } from './SnapMarker';
import { SNAP_PX, type ToolContext, type ToolHandlers, type ToolPointer } from './types';

/** Ab dieser Bewegung (px) ist ein Ziehen kein Klick mehr (wie die Griffe, spec.md „Allgemein“). */
const DRAG_PX = 3;

type TwoPoint = { pts: Vec[]; result: TwoPointResult | null };
type Drag = { memberId: Id; start: Vec; startScreen: Vec; moved: boolean; t: PageTransform };

/** Vorschau eines bewegten Platzes: Rechtecke für die Vorschau im Store, der Hintergrund für die Zeichenfläche. */
function previewOf(overviewId: Id, member: FestplatzPage, t: PageTransform): Background | null {
  const moved = transformPageContent(member, t, { round: false });
  const rects = Object.fromEntries([...moved.areas, ...moved.stands, ...moved.infra].map((o) => [o.id, { cx: o.cx, cy: o.cy, w: o.w, d: o.d, rot: o.rot }]));
  useStore.getState().setPreview({ pageId: overviewId, rects });
  return moved.background;
}

/**
 * Werkzeug „Ausrichten“ (A, nur in der Gesamtansicht eines Verbunds, #15 Teil b, spec.md §12): Platz wählen (Klick auf
 * eines seiner Objekte oder Auswahl im Werkzeug-Panel), dann ziehen – die ganze Page samt Hintergrund folgt (Vorschau
 * im Store, `transformPageContent` beim Loslassen); Drehung als Zahl um die Mitte des Platzes; 2-Punkt-Ausrichtung
 * (Vorlage: Kalibrieren): Punkt auf diesem Plan → passender Punkt auf dem Referenzplan, zweimal; Maßstab bleibt 1.
 * Jede Ausrichtung ist ein Undo-Schritt (`movePageContent`); Esc bricht ab.
 */
export function useAlignTool(ctx: ToolContext, active: boolean): ToolHandlers & { backgrounds: Record<Id, Background | null> | null } {
  const verbund = useStore((s) => verbundOfRef(s.project, ctx.page.id));
  const pages = useStore((s) => s.project.pages);
  const members = verbund ? memberPages({ pages }, verbund) : [];
  const [memberId, setMemberId] = useState<Id | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [bgPreview, setBgPreview] = useState<{ id: Id; bg: Background | null } | null>(null);
  const [two, setTwo] = useState<TwoPoint | null>(null);
  const [hover, setHover] = useState<SnapResult | null>(null);
  const [rotText, setRotText] = useState('');

  // Werkzeug- oder Seitenwechsel bricht ab (Zurücksetzen beim Rendern)
  const key = active ? ctx.page.id : '';
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setDrag(null);
    setTwo(null);
    setBgPreview(null);
    setHover(null);
  }
  const member = members.find((p) => p.id === memberId) ?? null;
  const others = members.filter((p) => p.id !== memberId);

  const clearPreview = () => {
    if (useStore.getState().preview?.pageId === ctx.page.id) useStore.getState().setPreview(null);
    setBgPreview(null);
  };
  const showPreview = (m: FestplatzPage, t: PageTransform) => setBgPreview({ id: m.id, bg: previewOf(ctx.page.id, m, t) });

  /** Platz unter dem Punkt: Besitzer des obersten Objekts (auch auf gesperrten Ebenen, solange sichtbar). */
  const memberAt = (w: Vec): Id | null => {
    const visibleOnly = Object.fromEntries(Object.entries(ctx.page.layers).map(([k, l]) => [k, { visible: l.visible, locked: false }])) as FestplatzPage['layers'];
    const tol = 5 / ctx.view.scale;
    const hit = pickObject({ ...ctx.page, layers: visibleOnly }, w, 0, { geometry: ctx.geometryOf, tol: { line: tol, point: Math.max(ctx.markerSize / 2, tol) } });
    return hit ? ownerOf({ pages }, hit.id) : null;
  };

  /** Fang der 2-Punkt-Ausrichtung: Grundflächen-Ecken und Standmitten dieses Platzes bzw. der anderen (Referenz). */
  const snapOf = (w: Vec, own: boolean, off: boolean): SnapResult | null => {
    if (off || !member) return null;
    const L = ctx.page.layers;
    const list = own ? [member] : others;
    const source = pointSnapSource(L.areas.visible ? list.flatMap((p) => activeAreas(p)) : [], L.stands.visible ? list.flatMap((p) => p.stands) : []);
    return findSnap(w, [source], SNAP_PX / ctx.view.scale);
  };
  /** Nächster Punkt der 2-Punkt-Ausrichtung: gerade Anzahl = Punkt auf diesem Plan, ungerade = auf dem Referenzplan. */
  const nextOwn = (two?.pts.length ?? 0) % 2 === 0;

  /** 2-Punkt-Ausrichtung und Drehfeld: Drehung und Verschiebung ungerundet (nur Gleitkomma-Reste entfallen). */
  const apply = (t: PageTransform, what: string) => {
    if (!member) return;
    clearPreview();
    if (movePageContent(member.id, t, { precise: true })) notify(`${member.name} ${what}. Rückgängig mit Strg/Cmd+Z.`, 'success');
  };

  const rotate = () => {
    const v = parseNum(rotText);
    if (!member || !Number.isFinite(v) || !v) return;
    apply({ dx: 0, dy: 0, rot: v, pivot: pagePivot(member) }, `um ${fmt(v, 3)}° gedreht`);
    setRotText('');
  };

  const cancelTwo = () => {
    setTwo(null);
    clearPreview();
  };

  const handlers: ToolHandlers = {
    onPointerDown(p: ToolPointer) {
      if (!active || !verbund) return false;
      if (two) {
        if (two.result || !member) return true;
        const point = snapOf(p.world, nextOwn, p.modKey)?.point ?? p.world;
        const pts = [...two.pts, point];
        if (pts.length < 4) {
          setTwo({ pts, result: null });
          return true;
        }
        const result = twoPointTransform(pts[0]!, pts[2]!, pts[1]!, pts[3]!);
        if (!result) {
          notify('Ausrichten: Die beiden Punkte eines Plans dürfen nicht zusammenfallen. Bitte neu beginnen.', 'error');
          setTwo({ pts: [], result: null });
          return true;
        }
        setTwo({ pts, result });
        showPreview(member, result.t);
        return true;
      }
      const hit = memberAt(p.world);
      const id = hit ?? memberId;
      if (hit && hit !== memberId) setMemberId(hit);
      if (!id) return true;
      setDrag({ memberId: id, start: p.world, startScreen: p.screen, moved: false, t: translation(0, 0) });
      return true;
    },
    onPointerMove(p) {
      if (!active) return;
      if (two && !two.result) setHover(snapOf(p.world, nextOwn, p.modKey));
      if (!drag) return;
      const moved = drag.moved || Math.hypot(p.screen.x - drag.startScreen.x, p.screen.y - drag.startScreen.y) > DRAG_PX;
      if (!moved) return;
      const t = translation(p.world.x - drag.start.x, p.world.y - drag.start.y);
      setDrag({ ...drag, moved, t });
      const m = members.find((x) => x.id === drag.memberId);
      if (m) showPreview(m, t);
    },
    onPointerUp() {
      if (!drag) return;
      const d = drag;
      setDrag(null);
      if (!d.moved) return;
      clearPreview();
      if (movePageContent(d.memberId, d.t)) notify(`${members.find((x) => x.id === d.memberId)?.name ?? 'Platz'} verschoben. Rückgängig mit Strg/Cmd+Z.`, 'success');
    },
    onKeyDown(e) {
      if (!active || e.key !== 'Escape') return false;
      if (drag) {
        setDrag(null);
        clearPreview();
        return true;
      }
      if (two) {
        cancelTwo();
        return true;
      }
      return false;
    },
    overlay: null,
    panel: null,
  };
  if (!active || !verbund) return { ...handlers, backgrounds: null };

  // ---------- Overlay: Umriss des gewählten Platzes, Punkte der 2-Punkt-Ausrichtung ----------
  const t = drag?.moved && drag.memberId === memberId ? drag.t : two?.result?.t;
  const ext = member ? pageExtent(member, 0) : null;
  const outline = ext
    ? [
        { x: ext.minX, y: ext.minY },
        { x: ext.maxX, y: ext.minY },
        { x: ext.maxX, y: ext.maxY },
        { x: ext.minX, y: ext.maxY },
      ].map((q) => ctx.toScreen(t ? applyTransform(t, q) : q))
    : null;
  const pts = two?.pts ?? [];
  const sc = pts.map(ctx.toScreen);
  handlers.overlay = (
    <g className="align-overlay" data-testid="align-overlay">
      {outline && <polygon className="align-outline" points={outline.map((q) => `${q.x},${q.y}`).join(' ')} />}
      {[0, 2].map((i) =>
        sc[i] && sc[i + 1] ? <line key={`l${i}`} className="align-pair" x1={sc[i]!.x} y1={sc[i]!.y} x2={sc[i + 1]!.x} y2={sc[i + 1]!.y} /> : null,
      )}
      {sc.map((q, i) => (
        <g key={i}>
          <circle className={i % 2 ? 'align-ref' : 'align-own'} cx={q.x} cy={q.y} r={5} />
          <text className="align-label" x={q.x + 8} y={q.y - 8}>
            {i % 2 ? `B${(i + 1) / 2}` : `A${i / 2 + 1}`}
          </text>
        </g>
      ))}
      <SnapMarker snap={hover} toScreen={ctx.toScreen} />
    </g>
  );

  // ---------- Panel ----------
  const pick = (
    <select
      aria-label="Platz"
      data-testid="align-member"
      value={memberId ?? ''}
      onChange={(e) => {
        setMemberId(e.target.value || null);
        cancelTwo();
      }}
    >
      <option value="">Platz wählen …</option>
      {members.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
  const steps = member
    ? [`Punkt A1 auf „${member.name}“ anklicken`, 'passenden Punkt B1 auf dem Referenzplan anklicken', `Punkt A2 auf „${member.name}“ anklicken`, 'passenden Punkt B2 auf dem Referenzplan anklicken']
    : [];
  if (two && member) {
    const r = two.result;
    handlers.panel = (
      <div className="tool-panel align-panel" aria-label="2-Punkt-Ausrichtung" data-testid="align-panel">
        <strong>2 Punkte</strong>
        {r ? (
          <>
            <span className="tool-panel-note" data-testid="align-result">
              Drehung {fmt(r.rot, 3)}° · Verschiebung {fmt(r.t.dx)} / {fmt(r.t.dy)} m
              {r.deviation > ALIGN_DEVIATION_HINT && (
                <>
                  {' '}
                  · <span className="align-deviation" data-testid="align-deviation">Abstände {fmt(r.from)} m / {fmt(r.to)} m: Abweichung {fmt(r.deviation)} m (Maßstab bleibt 1)</span>
                </>
              )}
            </span>
            <button
              type="button"
              className="btn primary"
              data-testid="align-apply"
              onClick={() => {
                apply(r.t, 'ausgerichtet');
                setTwo(null);
              }}
            >
              Anwenden
            </button>
          </>
        ) : (
          <span className="tool-panel-note">{steps[two.pts.length]} · Cmd/Strg = ohne Fang · Esc = abbrechen</span>
        )}
        <button type="button" className="btn" onClick={cancelTwo}>
          Abbrechen
        </button>
      </div>
    );
  } else {
    handlers.panel = (
      <form
        className="tool-panel align-panel"
        aria-label="Ausrichten"
        data-testid="align-panel"
        onSubmit={(e) => {
          e.preventDefault();
          rotate();
        }}
      >
        {pick}
        {member ? (
          <>
            <label htmlFor="align-rot">Drehen um</label>
            <span className="inp">
              <input id="align-rot" data-testid="align-rot" className="num" value={rotText} inputMode="decimal" autoComplete="off" placeholder={fmtInput(0, 1)} onChange={(e) => setRotText(e.target.value)} />
              <span className="unit">°</span>
            </span>
            <button type="submit" className="btn" disabled={!parseNum(rotText)}>
              Drehen
            </button>
            <button type="button" className="btn" data-testid="align-two-point" disabled={!others.length} onClick={() => setTwo({ pts: [], result: null })}>
              2 Punkte …
            </button>
            <span className="tool-panel-note">Ziehen verschiebt „{member.name}“ samt Hintergrund · Drehung im Uhrzeigersinn um die Mitte des Platzes</span>
          </>
        ) : (
          <span className="tool-panel-note">Klick auf ein Objekt wählt seinen Platz, dann ziehen</span>
        )}
      </form>
    );
  }
  return { ...handlers, backgrounds: bgPreview ? { [bgPreview.id]: bgPreview.bg } : null };
}
