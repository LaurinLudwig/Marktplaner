import { normAngle, rectCorners, roundRect } from '../../core/geometry/rect';
import { openProjectSettings } from '../../app/startPageNav';
import { CONNECTION_LABEL } from '../../core/label';
import { PASSAGE_TYPE_ID, typeMap } from '../../core/infra';
import { STAND_SHAPES, type Area, type Connection, type EdgeIndex, type FestplatzPage, type Id, type InfraObject, type ShapePart, type Stand, type StandShape } from '../../core/model/types';
import { cachedDuplicates } from '../../core/numbering';
import { SHAPE_LABEL } from '../../core/shape';
import { feesOf, fmtEuro, hasPricing, sumFees, type Fee } from '../../core/fee';
import { fmt, fmtInput } from '../../core/format';
import { usesAreas } from '../../core/pageAreas';
import { cachedInfraWarnings, cachedWarningData, fmtGap } from '../../core/warnings';
import { memberPages, ownerOf, pageEnv } from '../../core/verbund';
import { verbundOfRef } from '../../core/verbundView';
import { Icon } from '../icons/Icon';
import { tip } from '../shortcuts/tip';
import { setNrLocked } from '../../state/numbering';
import { dissolveStandOnPage, mergeStandsOnPage, setFrontOverride, setStandParts, setStandShape } from '../../state/shapes';
import { autoFrontMeters, hasOwnForm, occupancyStands, occupiesParts, pageStands } from '../../core/footprint';
import { standPartsInMeters } from '../../core/compound';
import { newPart } from '../startpage/ShapeTemplates';
import { reassignObjects, setAreaFront, setInfraType, setLabelOffset, setRectField, setWarningIgnored, updateArea, updateInfra, updateStands, type WarningKind } from '../../state/objects';
import { useStore } from '../../state/store';
import { ColorField } from './ColorField';
import { NumberField } from './NumberField';
import { common, dimSpec, selectionTitle, type SelectionInfo } from './selection';
import { TextField } from './TextField';

/**
 * Eigenschaften der Auswahl in der Seitenleiste. Bei Mehrfachauswahl erscheinen die gemeinsamen
 * Felder; unterschiedliche Werte bleiben leer, eine Eingabe gilt für alle ausgewählten Objekte.
 */
export function ObjectPanel({ sel }: { sel: SelectionInfo }) {
  const { page, objects } = sel;
  const stands = objects.filter((o) => o.kind === 'stand').map((o) => o.obj as Stand);
  const areas = objects.filter((o) => o.kind === 'area').map((o) => o.obj as Area);
  const infra = objects.filter((o) => o.kind === 'infra').map((o) => o.obj as InfraObject);
  const single = objects.length === 1;
  const infraTypes = useStore((s) => s.project.infraTypes);
  const onlyInfra = infra.length === objects.length;
  const kinds = [areas.length, stands.length, infra.length].filter(Boolean).length;
  return (
    <section className="panel" aria-label="Eigenschaften">
      <div className="panel-head">
        <span>{selectionTitle(objects, typeMap(infraTypes))}</span>
        {!single && <span className="panel-badge">{objects.length} ausgewählt</span>}
      </div>
      <div className="panel-body form">
        <OwnerField pageId={page.id} ids={objects.map((o) => o.obj.id)} />
        {areas.length === 1 && single && <AreaFields pageId={page.id} area={areas[0]!} />}
        {stands.length > 0 && kinds === 1 && <StandWarnings page={page} stands={stands} />}
        {stands.length > 0 && kinds === 1 && <StandFields pageId={page.id} stands={stands} />}
        {stands.length > 1 && kinds === 1 && (
          <button
            type="button"
            className="btn"
            data-testid="merge-stands"
            onClick={() => mergeStandsOnPage(page.id, stands.map((x) => x.id))}
            {...tip({ label: 'Zu einem Stand zusammenfassen', desc: 'Ein Stand mit eigener Form; Nummer, Name und Strom kommen vom größten Stand', ariaLabel: false })}
          >
            Zu einem Stand zusammenfassen
          </button>
        )}
        {onlyInfra && <InfraWarnings page={page} objects={infra} />}
        {onlyInfra && <InfraFields pageId={page.id} objects={infra} />}
        <GeometryFields pageId={page.id} sel={sel} />
        {single && areas.length === 1 && <FrontPicker pageId={page.id} area={areas[0]!} />}
        {kinds > 1 && <p className="hint">Attribute erscheinen, wenn nur Objekte einer Art ausgewählt sind.</p>}
      </div>
    </section>
  );
}

/** Wert der Auswahl „Festplatz“, wenn die Objekte verschiedenen Plätzen gehören. */
const MIXED_OWNER = '__mixed__';

/**
 * Feld „Festplatz“ (#15, nur in der Gesamtansicht eines Verbunds): zeigt, welchem Platz die Auswahl gehört, und hängt
 * sie um (Objekte wechseln in die Liste des anderen Platzes; ein Undo-Schritt, auch bei Mehrfachauswahl). Verschieben
 * ändert die Zuordnung nie; nur dieses Feld.
 */
function OwnerField({ pageId, ids }: { pageId: string; ids: Id[] }) {
  const verbund = useStore((s) => verbundOfRef(s.project, pageId));
  const pages = useStore((s) => s.project.pages);
  if (!verbund) return null;
  const members = memberPages({ pages }, verbund);
  const owner = common(ids.map((id) => ownerOf({ pages }, id)));
  // Nur Grundflächen ausgewählt: Plätze ohne Grundflächen (#17) sind kein Ziel (bei gemischter Auswahl Hinweis beim Umhängen)
  const areaIds = new Set(members.flatMap((p) => p.areas.map((a) => a.id)));
  const onlyAreas = ids.every((id) => areaIds.has(id));
  return (
    <div className="field">
      <label htmlFor="obj-owner">Festplatz</label>
      <select
        id="obj-owner"
        data-testid="obj-owner"
        value={owner ?? MIXED_OWNER}
        onChange={(e) => {
          if (e.target.value !== MIXED_OWNER) reassignObjects(ids, e.target.value);
        }}
      >
        {!owner && <option value={MIXED_OWNER}>verschiedene</option>}
        {members.map((p) => {
          const blocked = onlyAreas && p.useAreas === false && p.id !== owner;
          return (
            <option key={p.id} value={p.id} disabled={blocked}>
              {blocked ? `${p.name} (verwendet keine Grundflächen)` : p.name}
            </option>
          );
        })}
      </select>
      <p className="hint">Gehört diesem Platz und zählt nur dort (Statistik, Strom, Standgeld, Nummerierung). Verschieben ändert die Zuordnung nicht.</p>
    </div>
  );
}

function GeometryFields({ pageId, sel }: { pageId: string; sel: SelectionInfo }) {
  const ids = sel.objects.map((o) => o.obj.id);
  const rects = sel.objects.map((o) => roundRect(o.obj));
  const infraTypes = useStore((s) => s.project.infraTypes);
  const dims = dimSpec(sel.objects, (id) => infraTypes.find((t) => t.id === id)?.geometry);
  if (!dims.w && !dims.d && !dims.rot) return null;
  return (
    <div className="fields-3">
      {dims.w && <NumberField id="sb-w" label={dims.w.label} unit="m" value={common(rects.map((r) => r.w))} min={dims.w.min} max={dims.w.max} step={0.1} onCommit={(v) => setRectField(pageId, ids, 'w', v)} />}
      {dims.d && <NumberField id="sb-d" label={dims.d.label} unit="m" value={common(rects.map((r) => r.d))} min={dims.d.min} max={dims.d.max} step={0.1} onCommit={(v) => setRectField(pageId, ids, 'd', v)} />}
      {dims.rot && <NumberField id="sb-rot" label="Drehung" unit="°" value={common(rects.map((r) => r.rot))} min={-360} max={360} step={1} digits={1} onCommit={(v) => setRectField(pageId, ids, 'rot', v)} />}
    </div>
  );
}

function AreaFields({ pageId, area }: { pageId: string; area: Area }) {
  return <TextField id="area-name" label="Bezeichnung" value={area.name} placeholder="z. B. Obermarkt Nord" onCommit={(name) => updateArea(pageId, area.id, { name: name.trim() }, 'Grundfläche umbenennen')} />;
}

/** Richtung (auf dem Bildschirm), in die die Außenseite einer Kante zeigt. */
const DIRS = ['oben', 'rechts', 'unten', 'links'] as const;
const EDGE_NORMAL_ANGLE: Record<EdgeIndex, number> = { 0: 0, 1: 90, 2: 180, 3: 270 };
const edgeDirection = (area: Area, edge: EdgeIndex) => DIRS[Math.round(normAngle(EDGE_NORMAL_ANGLE[edge] + area.rot) / 90) % 4]!;

/** Kantenwähler: Mini-Abbild der Grundfläche, jede Kante anklickbar; die Vorderseite ist markiert. */
function FrontPicker({ pageId, area }: { pageId: string; area: Area }) {
  const W = 112;
  const H = 72;
  const pad = 10;
  const c = rectCorners({ ...area, cx: 0, cy: 0 });
  const span = Math.max(...c.map((p) => Math.abs(p.x))) * 2 || 1;
  const spanY = Math.max(...c.map((p) => Math.abs(p.y))) * 2 || 1;
  const k = Math.min((W - 2 * pad) / span, (H - 2 * pad) / spanY);
  const pts = c.map((p) => ({ x: W / 2 + p.x * k, y: H / 2 + p.y * k }));
  const edges = [0, 1, 2, 3] as const;
  return (
    <div className="field">
      <label>Vorderseite</label>
      <div className="front-pick">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          <polygon className="fp-body" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
          {edges.map((e) => {
            const a = pts[e]!;
            const b = pts[(e + 1) % 4]!;
            return (
              <g key={e}>
                <line className={`fp-edge${e === 2 ? ' on' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <line className="fp-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} onClick={() => setAreaFront(pageId, area.id, e)} />
              </g>
            );
          })}
        </svg>
        <div className="seg" role="group" aria-label="Vorderseite wählen">
          {edges.map((e) => (
            <button key={e} type="button" aria-pressed={e === 2} onClick={() => setAreaFront(pageId, area.id, e)}>
              {edgeDirection(area, e)}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">Oder eine Kante der ausgewählten Fläche anklicken. Die Fläche bleibt, wo sie ist.</p>
    </div>
  );
}

/** Name eines Stands in Meldungen: „Nr. 12 · Name“, ohne beides „ohne Namen“. */
const standName = (s: Stand) => [s.nr && `Nr. ${s.nr}`, s.name].filter(Boolean).join(' · ') || 'Stand ohne Namen';

const SUPPRESS: Record<WarningKind, 'suppressOutsideWarning' | 'suppressOverlapWarning' | 'suppressDuplicateWarning' | 'suppressInfraWarning' | 'suppressDistanceWarning'> = {
  outside: 'suppressOutsideWarning',
  overlap: 'suppressOverlapWarning',
  duplicate: 'suppressDuplicateWarning',
  infra: 'suppressInfraWarning',
  distance: 'suppressDistanceWarning',
};

/**
 * Warnungen der ausgewählten Stände (M4-09, M4-10, M5-10) mit den Häkchen „ignorieren“. Erscheint nur, wenn
 * ein Stand eine Warnung hat oder eine ignoriert. Die Häkchen gelten je Art und nur für den eigenen Stand.
 */
function StandWarnings({ page, stands }: { page: FestplatzPage; stands: Stand[] }) {
  const settings = useStore((s) => s.project.settings);
  const pages = useStore((s) => s.project.pages);
  const shapeTemplates = useStore((s) => s.project.shapeTemplates);
  // Stände, wie sie belegen (#16)
  const calc = pageStands(page, shapeTemplates);
  const infraTypes = useStore((s) => s.project.infraTypes);
  const groups = useStore((s) => s.project.groups);
  const categories = useStore((s) => s.project.categories);
  // Nachbarn aus dem Verbund (#15) zählen für Überlappung und Abstand (nicht Infrastruktur), „außerhalb“ über den Verbund
  const env = pageEnv({ pages, groups, categories }, page);
  const wd = cachedWarningData(calc, page.infra, env, { infraTypes, categories, shapeTemplates, settings });
  const w = wd.page;
  const iw = wd.infra;
  const dups = cachedDuplicates(pages, settings.numbering.scope);
  const dw = wd.distance;
  const byId = new Map([...page.stands, ...env.neighbours.stands].map((s) => [s.id, s]));
  /** Platzname eines Nachbarn („ (Seestraße)“), bei eigenen Objekten leer. */
  const ownerSuffix = (id: Id) => {
    const owner = ownerOf({ pages }, id);
    return owner && owner !== page.id ? ` (${pages.find((p) => p.id === owner)?.name ?? ''})` : '';
  };
  const outside = stands.filter((s) => w.byStand.get(s.id)?.outside);
  const overlap = stands.filter((s) => w.byStand.get(s.id)?.overlaps.length);
  const duplicate = stands.filter((s) => dups.has(s.id));
  const inInfra = stands.filter((s) => iw.byStand.has(s.id));
  const tooClose = stands.filter((s) => dw.has(s.id));
  /** „Schokofrüchte Meier, 23,40 m“ je zu nahem Stand (#3). */
  const closeText = (s: Stand) =>
    dw
      .get(s.id)!
      .map((c) => `${byId.get(c.id)?.name.trim() || 'Stand ohne Namen'}${ownerSuffix(c.id)}, ${fmtGap(c.dist)}`)
      .join('; ');
  const ids = stands.map((s) => s.id);
  /** „RTW-Platz „Nord““ für die Objekte, in die der Stand eindringt. */
  const infraText = (s: Stand) =>
    iw.byStand
      .get(s.id)!
      .map((id) => {
        const o = page.infra.find((x) => x.id === id);
        const t = o && infraTypes.find((x) => x.id === o.typeId);
        return t ? (o.label ? `${t.label} „${o.label}“` : t.label) : 'Infrastruktur';
      })
      .join(', ');
  const rows: { kind: WarningKind; label: string; hit: Stand[]; ignored: boolean; enabled: boolean }[] = [
    { kind: 'infra', label: 'Infrastruktur ignorieren', hit: inInfra, ignored: stands.every((s) => s.suppressInfraWarning), enabled: settings.warnInfra },
    { kind: 'overlap', label: 'Überlappung ignorieren', hit: overlap, ignored: stands.every((s) => s.suppressOverlapWarning), enabled: settings.warnOverlap },
    { kind: 'outside', label: '„außerhalb“ ignorieren', hit: outside, ignored: stands.every((s) => s.suppressOutsideWarning), enabled: settings.warnOutside },
    { kind: 'duplicate', label: 'doppelte Nummer ignorieren', hit: duplicate, ignored: stands.every((s) => s.suppressDuplicateWarning), enabled: settings.warnDuplicateNr },
    { kind: 'distance', label: 'Abstand ignorieren', hit: tooClose, ignored: stands.every((s) => s.suppressDistanceWarning), enabled: settings.warnDistance },
  ];
  // Ohne Grundflächen (#17) gibt es kein „außerhalb“; das Häkchen am Stand bleibt gespeichert, erscheint aber nicht
  const visible = rows.filter((r) => (r.kind !== 'outside' || usesAreas(page)) && (r.hit.length || stands.some((s) => s[SUPPRESS[r.kind]])));
  /** „Stand X (Festplatz 2)“ für die anderen Stände mit derselben Nummer. */
  const dupText = (s: Stand) =>
    dups
      .get(s.id)!
      .map((r) => {
        const pg = pages.find((p) => p.id === r.pageId);
        const other = pg?.stands.find((x) => x.id === r.standId);
        const name = other ? other.name.trim() || 'Stand ohne Namen' : 'Stand';
        return pg && pg.id !== page.id ? `${name} (${pg.name})` : name;
      })
      .join(', ');
  if (!visible.length) return null;
  const single = stands.length === 1;
  return (
    <div className="field" data-testid="stand-warnings">
      <label>Warnungen</label>
      {visible.map((r) => (
        <div key={r.kind} className="form">
          {r.hit.length > 0 && (
            <div className={`warn-chip ${r.kind}`} data-testid={`warn-chip-${r.kind}`}>
              {r.kind === 'infra'
                ? single
                  ? `Steht in: ${infraText(stands[0]!)}`
                  : `${r.hit.length} in Freihalteflächen`
                : r.kind === 'overlap'
                ? single
                  ? `Überlappt mit ${w.byStand.get(stands[0]!.id)!.overlaps.map((id) => (byId.get(id) ? standName(byId.get(id)!) : 'Stand') + ownerSuffix(id)).join(', ')}`
                  : `${r.hit.length} überlappen`
                : r.kind === 'duplicate'
                  ? single
                    ? `Nummer ${stands[0]!.nr.trim()} auch bei: ${dupText(stands[0]!)}`
                    : `${r.hit.length} mit doppelter Nummer`
                  : r.kind === 'distance'
                    ? single
                      ? `Zu nah an gleicher Kategorie: ${closeText(stands[0]!)}`
                      : `${r.hit.length} zu nah an gleicher Kategorie`
                  : single
                    ? 'Außerhalb jeder Grundfläche'
                    : `${r.hit.length} außerhalb`}
              {!r.enabled && ' (projektweit ausgeschaltet)'}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={r.ignored} onChange={(e) => setWarningIgnored(page.id, ids, r.kind, e.target.checked)} />
            {r.label}
          </label>
        </div>
      ))}
    </div>
  );
}

/**
 * Platznummer mit Schloss (M5-05): Eine fixierte Nummer überspringt die Automatik. Bei Mehrfachauswahl
 * nur das Schloss (gilt für alle); die Nummer selbst wird einzeln vergeben.
 */
function NrField({ pageId, stands }: { pageId: string; stands: Stand[] }) {
  const single = stands.length === 1;
  const locked = stands.every((s) => s.nrLocked);
  const mixed = !locked && stands.some((s) => s.nrLocked);
  const ids = stands.map((s) => s.id);
  const lockLabel = locked ? 'Fixierung lösen' : 'Nummer fixieren';
  return (
    <div className="nr-row">
      {single ? (
        <TextField id="st-nr" className="grow" label="Platznummer" value={stands[0]!.nr} onCommit={(nr) => updateStands(pageId, ids, { nr: nr.trim() }, 'Platznummer ändern')} />
      ) : (
        <div className="field grow">
          <label>Platznummer</label>
          <span className="hint">{mixed ? 'teilweise fixiert' : locked ? 'alle fixiert' : 'einzeln vergeben'}</span>
        </div>
      )}
      <button
        type="button"
        className={`icon-btn nr-lock${mixed ? ' mixed' : ''}`}
        aria-pressed={locked}
        data-testid="nr-lock"
        onClick={() => setNrLocked(pageId, ids, !locked)}
        {...tip({ label: lockLabel, desc: 'Fixierte Nummern überspringt „Neu nummerieren“', side: 'top' })}
      >
        <Icon name={locked ? 'lock' : 'unlock'} size={16} />
      </button>
    </div>
  );
}

const CONNECTIONS: (Connection | null)[] = [null, '230V', 'CEE16', 'CEE32'];
const MIXED = '__mixed';

function StandFields({ pageId, stands }: { pageId: string; stands: Stand[] }) {
  const categories = useStore((s) => s.project.categories);
  const shapeTemplates = useStore((s) => s.project.shapeTemplates);
  // Stände, wie sie belegen (#16): Vorlagen mit „belegt wie gezeichnet“ eingesetzt
  const calc = occupancyStands(stands, shapeTemplates) as Stand[];
  const occupying = calc.every((s) => occupiesParts(s));
  const ids = stands.map((s) => s.id);
  const single = stands.length === 1;
  const text = (key: 'name' | 'owner' | 'ware' | 'note') => common(stands.map((s) => s[key]));
  const set = (patch: Partial<Stand>, label: string) => updateStands(pageId, ids, patch, label);
  const cat = common(stands.map((s) => s.categoryId ?? ''));
  const conn = common(stands.map((s) => s.connection ?? ''));
  const color = common(stands.map((s) => s.color));
  const mixedColor = !single && color === null && stands.some((s) => s.color !== null);
  return (
    <>
      <NrField pageId={pageId} stands={stands} />
      <TextField id="st-name" label="Geschäftsname" value={text('name')} onCommit={(name) => set({ name }, 'Geschäftsname ändern')} />
      <TextField id="st-owner" label="Eigentümer" value={text('owner')} onCommit={(owner) => set({ owner }, 'Eigentümer ändern')} />
      <TextField id="st-ware" label="Typ/Ware" value={text('ware')} onCommit={(ware) => set({ ware }, 'Ware ändern')} />
      <div className="fields-2">
        <NumberField id="st-power" label="Strom" unit="kW" value={common(stands.map((s) => s.powerKw))} min={0} max={10000} step={0.5} onCommit={(powerKw) => set({ powerKw }, 'Strom ändern')} />
        <div className="field">
          <label htmlFor="st-conn">Anschlussart</label>
          <select id="st-conn" value={conn ?? MIXED} onChange={(e) => set({ connection: (e.target.value || null) as Connection | null }, 'Anschlussart ändern')}>
            {conn === null && <option value={MIXED} disabled hidden />}
            {CONNECTIONS.map((c) => (
              <option key={c ?? ''} value={c ?? ''}>
                {c ? CONNECTION_LABEL[c] : 'keine Angabe'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ShapeField pageId={pageId} stands={stands} />
      {single && hasOwnForm(stands[0]!) && <StandPartsFields pageId={pageId} stand={stands[0]!} />}
      {occupying && <FrontField pageId={pageId} stands={calc} />}
      <div className="field">
        <label htmlFor="st-cat">Kategorie</label>
        <select id="st-cat" value={cat ?? MIXED} onChange={(e) => set({ categoryId: e.target.value || null }, 'Kategorie zuordnen')}>
          {cat === null && <option value={MIXED} disabled hidden />}
          <option value="">keine Kategorie</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!categories.length && (
          <p className="hint">
            Kategorien legst du in den{' '}
            <button type="button" className="link-btn" onClick={() => openProjectSettings()}>
              Projekteinstellungen
            </button>{' '}
            an.
          </p>
        )}
      </div>
      <FeeInfo stands={calc} />
      {stands.some((s) => s.labelOffset) && (
        <button
          type="button"
          className="btn"
          onClick={() => setLabelOffset(pageId, ids, null)}
          {...tip({ label: 'Beschriftung zurücksetzen', desc: 'Die von Hand verschobene Beschriftung wieder automatisch platzieren', ariaLabel: false })}
        >
          Beschriftung zurücksetzen
        </button>
      )}
      <ColorField
        id="st-color"
        label={mixedColor ? 'Eigene Farbe (unterschiedlich)' : 'Eigene Farbe'}
        value={color}
        onCommit={(c) => set({ color: c }, 'Farbe ändern')}
        onReset={() => set({ color: null }, 'Eigene Farbe entfernen')}
        resetLabel="Eigene Farbe entfernen (Farbe der Kategorie verwenden)"
        canReset={stands.some((s) => s.color !== null)}
      />
      <TextField id="st-note" label="Notiz" value={text('note')} multiline onCommit={(note) => set({ note }, 'Notiz ändern')} />
    </>
  );
}

/** Wie sich das Standgeld eines Stands ergibt: „4,3 m × 25 €“ bzw. „Pauschale der Kategorie“. */
function feeBasis(f: Fee): string {
  if (f.source === 'flat') return 'Pauschale der Kategorie';
  return `${fmtInput(f.meters)} m × ${fmtEuro(f.rate)}${f.source === 'perMeter' ? ' (Sonderpreis der Kategorie)' : ''}`;
}

/**
 * Standgeld (#5, nur Anzeige): netto und brutto, bei mehreren Ständen die Summe. Nur, wenn im Projekt ein Preis
 * festgelegt ist; die Preise stehen in den Projekteinstellungen.
 */
function FeeInfo({ stands }: { stands: Stand[] }) {
  const pricing = useStore((s) => s.project.settings.pricing);
  const categories = useStore((s) => s.project.categories);
  if (!hasPricing(pricing, categories)) return null;
  const fees = feesOf(stands, categories, pricing);
  const sum = sumFees(fees);
  const single = stands.length === 1 ? fees[0] : undefined;
  return (
    <div className="field fee-info" data-testid="fee-info">
      <span className="field-label">{stands.length === 1 ? 'Standgeld' : `Standgeld (${stands.length} Stände)`}</span>
      {sum.count ? (
        <>
          <span>
            <b>{fmtEuro(sum.net)}</b> netto · {fmtEuro(sum.gross)} brutto
          </span>
          {single && <span className="hint">{feeBasis(single)}</span>}
          {stands.length > 1 && sum.count < stands.length && <span className="hint">{stands.length - sum.count} ohne Preis</span>}
        </>
      ) : (
        <span className="hint">
          Kein Preis festgelegt (
          <button type="button" className="link-btn" onClick={() => openProjectSettings()}>
            Projekteinstellungen
          </button>
          )
        </span>
      )}
    </div>
  );
}

/** Wert im Feld „Form“: Grundform, `tpl:<ID>` (Vorlage) oder `own` (eigene Form, #16). */
const OWN = 'own';
const shapeValue = (s: Stand) => (s.parts?.length ? OWN : s.shapeTemplateId ? `tpl:${s.shapeTemplateId}` : s.shape);

/**
 * Form der Stände (M12, spec.md §3 „Form“): Rechteck, Kreis/Oval, eigene Form (#16) oder eine Formvorlage. Eine eigene
 * Form und eine Vorlage mit „belegt wie gezeichnet“ belegen mit ihren Teilen, sonst wird mit dem Rechteck B × T
 * gerechnet. Eine Vorlage übernimmt ihr Vorschlagsmaß.
 */
function ShapeField({ pageId, stands }: { pageId: string; stands: Stand[] }) {
  const templates = useStore((s) => s.project.shapeTemplates);
  const value = common(stands.map(shapeValue));
  const ids = stands.map((s) => s.id);
  const sorted = templates.toSorted((a, b) => a.name.localeCompare(b.name, 'de'));
  const onChange = (v: string) =>
    setStandShape(pageId, ids, v === OWN ? { own: true } : v.startsWith('tpl:') ? { templateId: v.slice(4) } : { shape: v as Stand['shape'] });
  const tpl = value?.startsWith('tpl:') ? templates.find((t) => t.id === value.slice(4)) : undefined;
  const occupies = value === OWN || !!tpl?.occupies;
  return (
    <div className="field">
      <label htmlFor="st-shape">Form</label>
      <select id="st-shape" value={value ?? MIXED} onChange={(e) => onChange(e.target.value)}>
        {value === null && <option value={MIXED} disabled hidden />}
        {STAND_SHAPES.map((k) => (
          <option key={k} value={k}>
            {SHAPE_LABEL[k]}
          </option>
        ))}
        <option value={OWN}>Eigene Form</option>
        {sorted.length > 0 && (
          <optgroup label="Formvorlagen">
            {sorted.map((t) => (
              <option key={t.id} value={`tpl:${t.id}`}>
                {t.name} ({fmt(t.w)} × {fmt(t.d)} m)
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {value !== 'rect' && value !== null && (
        <p className="hint" data-testid="shape-hint">
          {occupies
            ? 'Belegt wie gezeichnet: Freiflächen, Warnungen, Treffer, Fang und Frontmeter rechnen mit den Teilen.'
            : 'Belegung, Warnungen und Fang rechnen mit dem Rechteck B × T.'}
        </p>
      )}
      {!templates.length && value !== OWN && (
        <p className="hint">
          Formvorlagen legst du in den{' '}
          <button type="button" className="link-btn" onClick={() => openProjectSettings()}>
            Projekteinstellungen
          </button>{' '}
          an.
        </p>
      )}
    </div>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Teile der eigenen Form eines Stands (#16): Art, X/Y (linke obere Ecke ab der linken oberen Ecke von B × T, vor der
 * Drehung), Breite, Tiefe und Drehung je Teil. Jede Eingabe ist ein Undo-Schritt; B × T passt sich an, die übrigen
 * Teile bleiben auf dem Plan an ihrem Platz. Dazu „Teil hinzufügen“ und „Form auflösen“.
 */
function StandPartsFields({ pageId, stand }: { pageId: string; stand: Stand }) {
  const parts = standPartsInMeters(stand);
  const set = (i: number, patch: Partial<ShapePart>) => setStandParts(pageId, stand.id, parts.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <div className="field stand-parts" data-testid="stand-parts">
      <label>Teile der Form</label>
      {parts.map((p, i) => (
        <div key={i} className="stand-part-row" data-testid="stand-part">
          <div className="stand-part-head">
            <select aria-label={`Art von Teil ${i + 1}`} value={p.kind} onChange={(e) => set(i, { kind: e.target.value as StandShape })}>
              {STAND_SHAPES.map((k) => (
                <option key={k} value={k}>
                  {SHAPE_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="hint grow">Teil {i + 1}</span>
            <button
              type="button"
              className="icon-btn"
              disabled={parts.length === 1}
              onClick={() => setStandParts(pageId, stand.id, parts.filter((_, k) => k !== i), 'Teil entfernen')}
              {...tip({ label: `Teil ${i + 1} entfernen`, side: 'top' })}
            >
              <Icon name="delete" size={16} />
            </button>
          </div>
          <div className="fields-3">
            <NumberField id={`sp-x-${i}`} label={`X von Teil ${i + 1}`} unit="m" value={round2(p.x)} min={-1000} max={1000} step={0.5} onCommit={(x) => set(i, { x })} />
            <NumberField id={`sp-y-${i}`} label={`Y von Teil ${i + 1}`} unit="m" value={round2(p.y)} min={-1000} max={1000} step={0.5} onCommit={(y) => set(i, { y })} />
            <NumberField id={`sp-rot-${i}`} label={`Drehung von Teil ${i + 1}`} unit="°" value={round1(p.rot)} min={-360} max={360} step={1} digits={1} onCommit={(rot) => set(i, { rot })} />
          </div>
          <div className="fields-2">
            <NumberField id={`sp-w-${i}`} label={`Breite von Teil ${i + 1}`} unit="m" value={round2(p.w)} min={0.1} max={100} step={0.5} onCommit={(w) => set(i, { w })} />
            <NumberField id={`sp-h-${i}`} label={`Tiefe von Teil ${i + 1}`} unit="m" value={round2(p.h)} min={0.1} max={100} step={0.5} onCommit={(h) => set(i, { h })} />
          </div>
        </div>
      ))}
      <div className="stand-part-actions">
        <button type="button" className="btn" data-testid="stand-part-add" onClick={() => setStandParts(pageId, stand.id, [...parts, newPart(parts)], 'Teil hinzufügen')}>
          Teil hinzufügen
        </button>
        <button
          type="button"
          className="btn"
          data-testid="dissolve-stand"
          disabled={parts.length < 2}
          onClick={() => dissolveStandOnPage(pageId, stand.id)}
          {...tip({ label: 'Form auflösen', desc: 'Jeder Teil wird ein eigener Stand; der größte behält die Daten', ariaLabel: false })}
        >
          Form auflösen
        </button>
      </div>
      <p className="hint">
        X/Y: linke obere Ecke des Teils ab der linken oberen Ecke von B × T (vor der Drehung), die Vorderseite liegt unten. Auf der Zeichenfläche:
        Teil anklicken, dann ziehen oder an seinen Griffen ändern.
      </p>
    </div>
  );
}

/**
 * Frontmeter fürs Standgeld (#16), nur bei Belegung wie gezeichnet: leer = automatisch die belegte Länge an der
 * Vorderseite (als Platzhalter angezeigt), sonst der eingegebene Wert.
 */
function FrontField({ pageId, stands }: { pageId: string; stands: Stand[] }) {
  const ids = stands.map((s) => s.id);
  const override = common(stands.map((s) => s.frontOverride));
  const auto = common(stands.map((s) => autoFrontMeters(s)));
  return (
    <NumberField
      id="st-front"
      label="Frontmeter"
      unit="m"
      value={override}
      min={0}
      max={1000}
      step={0.5}
      placeholder={auto !== null ? `automatisch ${fmtInput(auto)}` : 'automatisch'}
      onCommit={(v) => setFrontOverride(pageId, ids, v)}
      onClear={() => setFrontOverride(pageId, ids, null)}
    />
  );
}

/**
 * Attribute der ausgewählten Infrastruktur-Objekte (M7, spec.md §11): Typ (nur innerhalb derselben Geometrie),
 * Bezeichnung (beim Marker der Text), Strom und Anschlussart (nur Rechteck-Typen), Notiz.
 */
function InfraFields({ pageId, objects }: { pageId: string; objects: InfraObject[] }) {
  const types = useStore((s) => s.project.infraTypes);
  const ids = objects.map((o) => o.id);
  const geos = new Set(objects.map((o) => types.find((t) => t.id === o.typeId)?.geometry));
  const geometry = geos.size === 1 ? [...geos][0] : undefined;
  const typeId = common(objects.map((o) => o.typeId));
  const conn = common(objects.map((o) => o.connection ?? ''));
  const set = (patch: Parameters<typeof updateInfra>[2], label: string) => updateInfra(pageId, ids, patch, label);
  const marker = geometry === 'point';
  return (
    <>
      {geometry && (
        <div className="field">
          <label htmlFor="in-type">Typ</label>
          <select id="in-type" value={typeId ?? MIXED} onChange={(e) => setInfraType(pageId, ids, e.target.value)}>
            {typeId === null && <option value={MIXED} disabled hidden />}
            {types
              .filter((t) => t.geometry === geometry)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
          </select>
        </div>
      )}
      <TextField
        id="in-label"
        label={marker ? 'Text' : 'Bezeichnung'}
        value={common(objects.map((o) => o.label))}
        placeholder={marker ? 'z. B. Treffpunkt' : 'z. B. Nord'}
        onCommit={(label) => set({ label: label.trim() }, marker ? 'Text ändern' : 'Bezeichnung ändern')}
      />
      {geometry === 'rect' && (
        <div className="fields-2">
          <NumberField id="in-power" label="Strom" unit="kW" value={common(objects.map((o) => o.powerKw))} min={0} max={10000} step={0.5} onCommit={(powerKw) => set({ powerKw }, 'Strom ändern')} />
          <div className="field">
            <label htmlFor="in-conn">Anschlussart</label>
            <select id="in-conn" value={conn ?? MIXED} onChange={(e) => set({ connection: (e.target.value || null) as Connection | null }, 'Anschlussart ändern')}>
              {conn === null && <option value={MIXED} disabled hidden />}
              {CONNECTIONS.map((c) => (
                <option key={c ?? ''} value={c ?? ''}>
                  {c ? CONNECTION_LABEL[c] : 'keine Angabe'}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <TextField id="in-note" label="Notiz" value={common(objects.map((o) => o.note))} multiline onCommit={(note) => set({ note }, 'Notiz ändern')} />
    </>
  );
}

/** Warnung „Durchfahrt zu eng“ der ausgewählten Durchfahrten mit dem Häkchen „Breite ignorieren“ (M7). */
function InfraWarnings({ page, objects }: { page: FestplatzPage; objects: InfraObject[] }) {
  const settings = useStore((s) => s.project.settings);
  const infraTypes = useStore((s) => s.project.infraTypes);
  const passages = objects.filter((o) => o.typeId === PASSAGE_TYPE_ID);
  if (!passages.length || passages.length !== objects.length) return null;
  const iw = cachedInfraWarnings(page, infraTypes, settings.minPassageWidth);
  const narrow = passages.filter((o) => iw.narrow.has(o.id));
  const ignored = passages.every((o) => o.suppressWidthWarning);
  if (!narrow.length && !passages.some((o) => o.suppressWidthWarning)) return null;
  return (
    <div className="field" data-testid="infra-warnings">
      <label>Warnungen</label>
      {narrow.length > 0 && (
        <div className="warn-chip overlap" data-testid="warn-chip-narrow">
          {passages.length === 1 ? `Lichte Breite ${fmt(passages[0]!.w)} m, Mindestbreite ${fmt(settings.minPassageWidth)} m` : `${narrow.length} zu eng`}
          {!settings.warnPassageWidth && ' (projektweit ausgeschaltet)'}
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={ignored}
          onChange={(e) => updateInfra(page.id, passages.map((o) => o.id), { suppressWidthWarning: e.target.checked }, e.target.checked ? 'Warnung ignorieren' : 'Warnung wieder anzeigen')}
        />
        Breite ignorieren
      </label>
    </div>
  );
}
