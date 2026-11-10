import { produce } from 'immer';
import { showError } from '../app/dialogs';
import { notify } from '../app/notify';
import { fmt } from '../core/format';
import { MIN_FREE_WIDTH } from '../core/freeSpace';
import { applyCategoryList, type ApplyMode, type CategoryList } from '../core/categoryLists';
import { checkPowerChange } from '../core/power';
import { normAngle, roundRect, setFront } from '../core/geometry/rect';
import { rotate } from '../core/geometry/vec';
import { allSelectable } from '../core/hit';
import { newId } from '../core/id';
import { clampToLimits, createInfra, fitRect, INFRA_LIMITS } from '../core/infra';
import { clampMinPassage, clampPrice, clampSnapGap, VAT_LIMITS } from '../core/model/schema';
import type { Area, Category, EdgeIndex, FestplatzPage, Id, InfraObject, PricingSettings, Project, Rect, Stand, Vec } from '../core/model/types';
import { cloneObjects, createArea, createStand, findObjects, LIMITS, MIN_DRAW_SIZE, PALETTE, STAND_DEFAULT, type Clipboard, type ObjectKind } from '../core/objects';
import { groupCenter, moveRects, type RectMap } from '../core/transform';
import { stretchStand } from '../core/compound';
import type { Bounds } from '../core/viewport';
import { isIdentity, placeObject, relativePlacement } from '../core/placement';
import { groupOf, placementOf } from '../core/verbund';
import { assignObjects, copyFallback, fallbackPage, ownerPages, pageView, verbundOfRef, viewToOwner, viewToView } from '../core/verbundView';
import { START_PAGE, useStore } from './store';

/**
 * Befehle für Grundflächen, Geschäfte, Infrastruktur (M7) und Kategorien (M3). Jede Änderung ist genau ein Undo-Schritt;
 * Werte werden beim Übernehmen gerundet (`roundRect`: 0,01 m bzw. 0,1°).
 *
 * `pageId` darf die Gesamtansicht eines Verbunds sein (`verbund:<id>`, #15): Dann wirkt eine Änderung auf die Objekte
 * mit diesen IDs in den Listen ihrer Besitzer-Pages (`ownerPages`), auch über mehrere Pages – weiterhin ein
 * Undo-Schritt. Neue Objekte bekommen ihre Page über `assignObjects` (Grundfläche, sonst „Neue Objekte auf: …“).
 *
 * Koordinaten (#27): Rechtecke, Drehungen und Versätze, die die Befehle bekommen, liegen im System der Ansicht `pageId`
 * – in der Gesamtansicht also im System des Verbunds (Welt). Gespeichert wird je Objekt im System seiner
 * Besitzer-Page (`viewToOwner`: Umkehrung ihrer Lage); erst danach wird gerundet (0,01 m bzw. 0,1° in den Koordinaten
 * der Page). In einer Einzelansicht ist die Abbildung die Identität.
 */

const st = () => useStore.getState();

/** Aktive Festplatz-Page oder Gesamtansicht eines Verbunds (core/verbundView.ts `pageView`); null auf der Start-Page. */
export function activePage(): FestplatzPage | null {
  const s = st();
  if (s.ui.activePage === START_PAGE) return null;
  return pageView(s.project, s.ui.activePage);
}

export function selectedIds(): Id[] {
  const sel = st().ui.selection;
  return sel?.kind === 'objects' ? sel.ids : [];
}

export function select(ids: Id[]) {
  st().setUi({ selection: ids.length ? { kind: 'objects', ids } : null });
}

const pageOf = (p: Project, pageId: Id | null) => (pageId ? p.pages.find((x) => x.id === pageId) : undefined);

/** Pages, in deren Listen Änderungen an `pageId` landen: die Page selbst bzw. alle Mitglieder des Verbunds (#15). */
const pagesOf = (p: Project, pageId: Id) => ownerPages(p, pageId);

/** Objekte mit diesen IDs in den Listen der Pages (in der Gesamtansicht in allen Mitgliedern, #15); `page` = Besitzer. */
function eachObject(pages: readonly FestplatzPage[], ids: readonly Id[], fn: (o: Area | Stand | InfraObject, kind: ObjectKind, page: FestplatzPage) => void) {
  const set = new Set(ids);
  for (const page of pages) {
    for (const a of page.areas) if (set.has(a.id)) fn(a, 'area', page);
    for (const s of page.stands) if (set.has(s.id)) fn(s, 'stand', page);
    for (const o of page.infra) if (set.has(o.id)) fn(o, 'infra', page);
  }
}

/**
 * Rechteck aus dem System der Ansicht `pageId` in das der Besitzer-Page `ownerId` (#27; in der Einzelansicht
 * unverändert). Liest die Lagen aus dem gespeicherten Projekt, nicht aus dem Entwurf.
 */
function toOwner<T extends Rect>(pageId: Id, ownerId: Id | null | undefined, r: T): T {
  if (!ownerId) return r;
  const p = viewToOwner(st().project, pageId, ownerId);
  return isIdentity(p) ? r : placeObject(p, r);
}

/**
 * Page eines neuen Objekts: die Page selbst; in der Gesamtansicht eines Verbunds (#15) der Platz, auf dessen Grundfläche
 * es steht, sonst die Auswahl „Neue Objekte auf: …“ (`newObjectsPage`). null = kein Platz (Verbund ohne Mitglieder bzw.
 * Grundfläche ohne Platz mit Grundflächen).
 */
function targetPage(pageId: Id, obj: Area | Stand | InfraObject, kind: ObjectKind): Id | null {
  const project = st().project;
  const verbund = verbundOfRef(project, pageId);
  if (!verbund) return pageId;
  const lists = { areas: kind === 'area' ? [obj] : [], stands: kind === 'stand' ? [obj as Stand] : [], infra: kind === 'infra' ? [obj] : [] };
  return assignObjects(project, verbund, lists, () => newObjectsPage(verbund.id)).get(obj.id) ?? null;
}

/** „Neue Objekte auf: …“ (#15): gewählter Platz des Verbunds, sonst sein erstes Mitglied; null ohne Mitglieder. */
export function newObjectsPage(verbundId: Id): Id | null {
  const s = st();
  const verbund = s.project.groups.find((g) => g.id === verbundId);
  return verbund ? fallbackPage(s.project, verbund, s.ui.newObjectsOn[verbundId]) : null;
}

/** „Neue Objekte auf: …“ setzen (Ansichtseinstellung der Sitzung: kein Undo-Schritt, nicht in der Projektdatei). */
export function setNewObjectsPage(verbundId: Id, pageId: Id) {
  st().setUi({ newObjectsOn: { ...st().ui.newObjectsOn, [verbundId]: pageId } });
}

/** Geometrie des Typs eines Infrastruktur-Objekts (unbekannter Typ: Rechteck). */
const geometryOf = (p: Pick<Project, 'infraTypes'>, o: InfraObject) => p.infraTypes.find((t) => t.id === o.typeId)?.geometry ?? 'rect';

/** Rechteck übernehmen; Infrastruktur nach den Regeln ihrer Geometrie (Punkte ohne Maße und Drehung). */
const assignObj = (p: Pick<Project, 'infraTypes'>, o: Area | Stand | InfraObject, kind: ObjectKind, r: Rect) =>
  assignRect(o, kind === 'infra' ? fitRect(geometryOf(p, o as InfraObject), r) : r);

const assignRect = (o: Rect, r: Rect) => {
  const n = roundRect(r);
  o.cx = n.cx;
  o.cy = n.cy;
  o.w = n.w;
  o.d = n.d;
  o.rot = n.rot;
};

/**
 * Änderung mit Prüfung des Stromlimits (M5-09, spec.md §6): Erhöht sie die Summe einer Page, die
 * Überschreitungen blockiert, über deren Limit, wird sie nicht übernommen (Meldung, Rückgabe false).
 * Ohne Blockieren erscheint beim ersten Überschreiten ein Hinweis.
 */
export function changeWithPowerCheck(label: string, recipe: (p: Project) => void): boolean {
  const before = st().project;
  const checks = checkPowerChange(before.pages, produce(before, recipe).pages);
  const blocked = checks.find((c) => c.blocked);
  if (blocked) {
    void showError(
      'Stromlimit überschritten',
      `${blocked.pageName} hätte ${fmt(blocked.after)} kW bei einem Limit von ${fmt(blocked.limitKw)} kW. Die Änderung wurde nicht übernommen. Das Blockieren lässt sich im Bereich „Strom“ der Seitenleiste ausschalten.`,
    );
    return false;
  }
  st().change(label, recipe);
  for (const c of checks) if (c.crossed) notify(`Stromlimit überschritten: ${c.pageName} hat ${fmt(c.after)} von ${fmt(c.limitKw)} kW.`, 'error', 6000);
  return true;
}

const clamp = (v: number, kind: ObjectKind) => Math.min(LIMITS[kind].max, Math.max(LIMITS[kind].min, v));

// ---------- Anlegen ----------

/**
 * Zuletzt angelegtes Standmaß; neue Stände per Klick bekommen es (anfangs 3 × 3 m). Nur plausible
 * Maße (beide mindestens 0,5 m) werden übernommen (QA-M3-L2).
 */
let lastStandSize = { ...STAND_DEFAULT };
export const standDefaultSize = () => lastStandSize;

export function addArea(pageId: Id, rect: Rect): Id {
  const area = createArea(roundRect({ ...rect, w: clamp(rect.w, 'area'), d: clamp(rect.d, 'area') }));
  const target = targetPage(pageId, area, 'area');
  // Zugeordnet im System der Ansicht, gespeichert in dem der Page (#27)
  const local = roundRect(toOwner(pageId, target, area));
  st().change('Grundfläche anlegen', (p) => void pageOf(p, target)?.areas.push(local));
  select([area.id]);
  return area.id;
}

export function addStand(pageId: Id, rect: Rect): Id {
  const stand = createStand(roundRect({ ...rect, w: clamp(rect.w, 'stand'), d: clamp(rect.d, 'stand') }));
  if (stand.w >= MIN_DRAW_SIZE && stand.d >= MIN_DRAW_SIZE) lastStandSize = { w: stand.w, d: stand.d };
  const target = targetPage(pageId, stand, 'stand');
  const local = roundRect(toOwner(pageId, target, stand));
  st().change('Geschäft anlegen', (p) => void pageOf(p, target)?.stands.push(local));
  select([stand.id]);
  return stand.id;
}

/** Infrastruktur-Objekt anlegen (Undo-Schritt, danach ausgewählt). Strom hat ein neues Objekt nicht. */
export function addInfra(pageId: Id, typeId: Id, rect: Rect): Id | null {
  const type = st().project.infraTypes.find((t) => t.id === typeId);
  if (!type) return null;
  const obj = createInfra(type, rect);
  const target = targetPage(pageId, obj, 'infra');
  const local = { ...obj, ...fitRect(type.geometry, toOwner(pageId, target, obj)) };
  st().change(`${type.label} anlegen`, (p) => void pageOf(p, target)?.infra.push(local));
  select([obj.id]);
  return obj.id;
}

/** Attribute von Infrastruktur-Objekten ändern; false, wenn das Stromlimit die Änderung blockiert. */
export function updateInfra(pageId: Id, ids: Id[], patch: Partial<Pick<InfraObject, 'label' | 'note' | 'powerKw' | 'connection' | 'suppressWidthWarning'>>, label: string): boolean {
  return changeWithPowerCheck(label, (p) => {
    eachObject(pagesOf(p, pageId), ids, (o, kind) => {
      if (kind !== 'infra') return;
      const obj = o as InfraObject;
      const rect = geometryOf(p, obj) === 'rect';
      // Strom und Anschluss gibt es nur bei Rechteck-Typen
      Object.assign(obj, rect ? patch : { ...patch, powerKw: obj.powerKw, connection: obj.connection });
    });
  });
}

/** Typ wechseln, nur innerhalb derselben Geometrie (Maße bleiben). */
export function setInfraType(pageId: Id, ids: Id[], typeId: Id) {
  const type = st().project.infraTypes.find((t) => t.id === typeId);
  if (!type) return;
  st().change('Typ ändern', (p) => {
    for (const page of pagesOf(p, pageId)) for (const o of page.infra) if (ids.includes(o.id) && geometryOf(p, o) === type.geometry) o.typeId = typeId;
  });
}

// ---------- Geometrie ----------

/** Übernimmt die Rechtecke einer Geste (Ziehen, Drehen, Größe ändern; im System der Ansicht) als einen Undo-Schritt. */
export function commitRects(pageId: Id, rects: RectMap, label: string) {
  st().change(label, (p) => {
    eachObject(pagesOf(p, pageId), Object.keys(rects), (o, kind, page) => assignObj(p, o, kind, toOwner(pageId, page.id, rects[o.id]!)));
  });
}

/**
 * Breite, Tiefe oder Drehung für alle angegebenen Objekte setzen (Drehung um den eigenen Mittelpunkt). Die Drehung gilt
 * im System der Ansicht (#27: in der Gesamtansicht die Drehung in der Welt; gespeichert wird sie abzüglich der Drehung
 * der Lage des Besitzers).
 */
export function setRectField(pageId: Id, ids: Id[], field: 'w' | 'd' | 'rot', value: number) {
  const label = field === 'rot' ? 'Drehen' : field === 'w' ? 'Breite ändern' : 'Tiefe ändern';
  const project = st().project;
  st().change(label, (p) => {
    eachObject(pagesOf(p, pageId), ids, (o, kind, page) => {
      const v =
        field === 'rot'
          ? normAngle(value + viewToOwner(project, pageId, page.id).rot)
          : kind === 'infra'
            ? clampToLimits(value, INFRA_LIMITS[geometryOf(p, o as InfraObject)][field])
            : clamp(value, kind);
      // Eigene Form mit gedrehten Teilen (#16): Teile strecken, dann das Hüllrechteck neu einpassen
      const fit = kind === 'stand' && field !== 'rot' ? stretchStand(o as Stand, field === 'w' ? v : o.w, field === 'd' ? v : o.d) : null;
      if (fit) {
        assignRect(o, fit.rect);
        (o as Stand).parts = fit.parts;
        return;
      }
      assignObj(p, o, kind, { ...o, [field]: v });
    });
  });
}

/** Verschiebt die Objekte so, dass die Mitte ihres Hüllrechtecks bei x bzw. y liegt. */
export function moveGroupTo(pageId: Id, ids: Id[], target: { x?: number; y?: number }) {
  const page = pageView(st().project, pageId);
  if (!page) return;
  const objs = findObjects(page, ids).map((o) => o.obj);
  const c = groupCenter(objs);
  if (!c) return;
  moveBy(pageId, ids, (target.x ?? c.x) - c.x, (target.y ?? c.y) - c.y, 'Verschieben');
}

export function moveBy(pageId: Id, ids: Id[], dx: number, dy: number, label: string, merge?: { mergeKey: string; mergeIntoPrevious: boolean }) {
  const page = pageView(st().project, pageId);
  if (!page) return;
  const rects: RectMap = Object.fromEntries(findObjects(page, ids).map((o) => [o.obj.id, o.obj]));
  const moved = moveRects(rects, { x: dx, y: dy });
  st().change(
    label,
    (p) => {
      eachObject(pagesOf(p, pageId), ids, (o, kind, owner) => assignObj(p, o, kind, toOwner(pageId, owner.id, moved[o.id]!)));
    },
    merge ?? {},
  );
}

/**
 * Pfeiltasten: jeder Druck ist ein eigener Undo-Schritt; die Wiederholungen einer gedrückt gehaltenen
 * Taste (`repeat`) verschmelzen mit dem ersten Druck zu einem Schritt (QA-M3-05).
 */
export function nudge(dx: number, dy: number, repeat = false) {
  const page = activePage();
  const ids = selectedIds();
  if (!page || !ids.length) return;
  moveBy(page.id, ids, dx, dy, 'Verschieben', { mergeKey: `nudge:${page.id}:${dx},${dy}:${ids.join(',')}`, mergeIntoPrevious: repeat });
}

/** Kante `edge` der Grundfläche wird Vorderseite; die Fläche bleibt an derselben Stelle. */
export function setAreaFront(pageId: Id, id: Id, edge: EdgeIndex) {
  if (edge === 2) return;
  st().change('Vorderseite festlegen', (p) => {
    const a = pagesOf(p, pageId).flatMap((pg) => pg.areas).find((x) => x.id === id);
    if (a) assignRect(a, setFront(a, edge));
  });
}

// ---------- Attribute ----------

/**
 * Attribute der Stände ändern; false, wenn das Stromlimit die Änderung blockiert. Ein Beschriftungsversatz
 * (`labelOffset`) gilt im System der Ansicht und wird je Besitzer zurückgedreht (#27).
 */
export function updateStands(pageId: Id, ids: Id[], patch: Partial<Omit<Stand, 'id' | keyof Rect>>, label: string): boolean {
  const project = st().project;
  const offset = patch.labelOffset;
  return changeWithPowerCheck(label, (p) => {
    eachObject(pagesOf(p, pageId), ids, (o, kind, page) => {
      if (kind !== 'stand') return;
      const rot = offset ? viewToOwner(project, pageId, page.id).rot : 0;
      Object.assign(o, offset && rot ? { ...patch, labelOffset: roundVec(rotate(offset, rot)) } : patch);
    });
  });
}

const roundVec = (v: Vec): Vec => ({ x: Math.round(v.x * 100) / 100 || 0, y: Math.round(v.y * 100) / 100 || 0 });

export function updateArea(pageId: Id, id: Id, patch: Partial<Pick<Area, 'name'>>, label: string) {
  st().change(label, (p) => {
    const a = pagesOf(p, pageId).flatMap((pg) => pg.areas).find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  });
}

// ---------- Löschen, Kopieren, Einfügen ----------

export function deleteObjects(pageId: Id, ids: Id[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  const n = ids.length;
  st().change(n === 1 ? 'Objekt löschen' : `${n} Objekte löschen`, (p) => {
    // In der Gesamtansicht (#15) aus den Listen aller Besitzer-Pages; unberührte Listen bleiben dieselben
    for (const page of pagesOf(p, pageId)) {
      if (page.areas.some((a) => set.has(a.id))) page.areas = page.areas.filter((a) => !set.has(a.id));
      if (page.stands.some((s) => set.has(s.id))) page.stands = page.stands.filter((s) => !set.has(s.id));
      if (page.infra.some((o) => set.has(o.id))) page.infra = page.infra.filter((o) => !set.has(o.id));
    }
  });
  select([]);
}

/**
 * Umhängen (#15, Feld „Festplatz“ der Seitenleiste in der Gesamtansicht): Die Objekte wechseln in die Listen der Page
 * `targetId` (Besitz = Liste, kein eigenes Feld), ein Undo-Schritt, auch für eine Mehrfachauswahl über mehrere Pages.
 * Lage und Attribute bleiben; eine Grundfläche nimmt ihre ausgeblendeten Freiflächen mit. Grundflächen kommen nicht auf
 * eine Page ohne Grundflächen (#17); dann erscheint ein Hinweis. Liefert die Zahl der umgehängten Objekte.
 *
 * Koordinaten (#27): Jede Page hat ihr eigenes System; die Objekte werden von ihrer Page über das System des Verbunds
 * in das der Ziel-Page umgerechnet (lokal B = Lage B⁻¹ · Lage A · lokal A), sodass sie in der Gesamtansicht an
 * derselben Stelle bleiben. Gespeichert ungerundet bis auf Gleitkomma-Reste (10⁻⁸): Eine Rundung auf 0,01 m im System
 * der Ziel-Page verschöbe sie sonst gegen ihre Nachbarn. Ausblendungen beziehen sich auf die Achse der Grundfläche und
 * bleiben gültig.
 */
export function reassignObjects(ids: readonly Id[], targetId: Id): number {
  const set = new Set(ids);
  const project = st().project;
  const target = project.pages.find((p) => p.id === targetId);
  if (!target) return 0;
  const moving = (o: { id: Id }, page: FestplatzPage) => set.has(o.id) && page.id !== targetId;
  const count = project.pages.reduce(
    (n, pg) => n + (target.useAreas !== false ? pg.areas.filter((a) => moving(a, pg)).length : 0) + pg.stands.filter((s) => moving(s, pg)).length + pg.infra.filter((o) => moving(o, pg)).length,
    0,
  );
  // Grundflächen bleiben auf ihrem Platz, wenn das Ziel keine verwendet (#17): Hinweis statt still nichts zu tun
  const skipped = target.useAreas === false ? project.pages.reduce((n, pg) => n + pg.areas.filter((a) => moving(a, pg)).length, 0) : 0;
  if (skipped)
    notify(
      `„${target.name}“ verwendet keine Grundflächen: ${skipped === 1 ? 'Die Grundfläche bleibt' : `${skipped} Grundflächen bleiben`} auf ${skipped === 1 ? 'ihrem' : 'ihren'} Platz.`,
      'error',
      6000,
    );
  if (!count) return 0;
  const group = groupOf(project, targetId);
  /** Abbildung aus dem System der Page `fromId` in das der Ziel-Page (Identität ohne gemeinsamen Verbund). */
  const moveFrom = (fromId: Id) => (group && group.pageIds.includes(fromId) ? relativePlacement(placementOf(group, targetId), placementOf(group, fromId)) : null);
  const ok = changeWithPowerCheck(count === 1 ? 'Festplatz ändern' : `${count} Objekte umhängen`, (p) => {
    const to = p.pages.find((x) => x.id === targetId)!;
    for (const pg of p.pages) {
      if (pg.id === targetId) continue;
      const rel = moveFrom(pg.id);
      const conv = <T extends Rect>(o: T): T => (rel && !isIdentity(rel) ? placeObject(rel, o, { round: true }) : o);
      const areas = to.useAreas !== false ? pg.areas.filter((a) => set.has(a.id)).map(conv) : [];
      const stands = pg.stands.filter((s) => set.has(s.id)).map(conv);
      const infra = pg.infra.filter((o) => set.has(o.id)).map(conv);
      if (areas.length) {
        const gone = new Set(areas.map((a) => a.id));
        pg.areas = pg.areas.filter((a) => !gone.has(a.id));
        to.areas.push(...areas);
        // Ausgeblendete Freiflächen gehören zur Grundfläche (Schlüssel „areaId|…“) und wandern mit
        const isOwn = (h: { key: string }) => gone.has(h.key.slice(0, h.key.indexOf('|')));
        const hidden = pg.hiddenFree.filter(isOwn);
        if (hidden.length) {
          pg.hiddenFree = pg.hiddenFree.filter((h) => !isOwn(h));
          to.hiddenFree.push(...hidden);
        }
      }
      if (stands.length) {
        pg.stands = pg.stands.filter((s) => !set.has(s.id));
        to.stands.push(...stands);
      }
      if (infra.length) {
        pg.infra = pg.infra.filter((o) => !set.has(o.id));
        to.infra.push(...infra);
      }
    }
  });
  return ok ? count : 0;
}

export function deleteSelection() {
  const page = activePage();
  if (page) deleteObjects(page.id, selectedIds());
}

let clipboard: Clipboard | null = null;
/** Wie oft der aktuelle Inhalt der Zwischenablage je Page schon eingefügt wurde. */
let pasteCounts: Record<Id, number> = {};

export const hasClipboard = () => !!clipboard;

function copyInternal(): boolean {
  const page = activePage();
  const ids = new Set(selectedIds());
  if (!page || !ids.size) return false;
  clipboard = {
    areas: structuredClone(page.areas.filter((a) => ids.has(a.id))),
    stands: structuredClone(page.stands.filter((s) => ids.has(s.id))),
    infra: structuredClone(page.infra.filter((o) => ids.has(o.id))),
    sourcePageId: page.id,
  };
  pasteCounts = {};
  return true;
}

export function copySelection() {
  copyInternal();
}

export function cutSelection() {
  if (copyInternal()) deleteSelection();
}

interface ObjectLists {
  areas: Area[];
  stands: Stand[];
  infra: InfraObject[];
}

/**
 * Objekte einfügen (Einfügen, Duplizieren, Alt+Ziehen; im System der Ansicht), ein Undo-Schritt. In der Gesamtansicht
 * eines Verbunds (#15) bekommt jedes Objekt seine Page über `assignObjects`; `from` (Kopie → Original) macht bei Kopien
 * den Platz des Originals zum Ersatz-Platz, sonst gilt „Neue Objekte auf: …“. Gespeichert im System der Page (#27).
 */
function insertObjects(pageId: Id, objs: ObjectLists, label: string, from: Readonly<Record<Id, Id>> = {}) {
  const project = st().project;
  const verbund = verbundOfRef(project, pageId);
  const owner = verbund ? assignObjects(project, verbund, objs, copyFallback(project, from, newObjectsPage(verbund.id))) : null;
  const pageFor = (id: Id) => (owner ? (owner.get(id) ?? null) : pageId);
  const inserted: Id[] = [];
  const ok = changeWithPowerCheck(label, (p) => {
    inserted.length = 0;
    const put = <T extends Rect & { id: Id }>(o: T, list: (pg: FestplatzPage) => T[] | null, fit: (local: T) => T) => {
      const pg = pageOf(p, pageFor(o.id));
      const target = pg ? list(pg) : null;
      if (!pg || !target) return;
      target.push(fit(toOwner(pageId, pg.id, o)));
      inserted.push(o.id);
    };
    // Auf einer Page ohne Grundflächen (#17) werden mitkopierte Grundflächen nicht eingefügt
    for (const a of objs.areas) put(a, (pg) => (pg.useAreas ? pg.areas : null), roundRect);
    for (const s of objs.stands) put(s, (pg) => pg.stands, roundRect);
    // Objekte unbekannter Typen (z. B. aus einem anderen Projektstand) nicht einfügen
    for (const o of objs.infra) if (p.infraTypes.some((t) => t.id === o.typeId)) put(o, (pg) => pg.infra, (l) => ({ ...l, ...fitRect(geometryOf(p, l), l) }));
  });
  if (ok) select([...inserted]);
}

/**
 * Einfügen: auf derselben Page 1 m nach rechts unten versetzt, jedes weitere Einfügen 1 m weiter; auf
 * einer anderen Page an derselben Position (weitere Male ebenfalls je 1 m weiter). Liegt die Position
 * außerhalb des sichtbaren Bereichs `view`, mittig darin. Innerhalb eines Verbunds (Gesamtansicht und Mitglieder, #27)
 * heißt „dieselbe Position“ dieselbe Stelle in der Gesamtansicht (`viewToView`).
 */
export function paste(view: Bounds | null) {
  const page = activePage();
  if (!page || !clipboard) return;
  const rel = viewToView(st().project, clipboard.sourcePageId, page.id);
  const conv = <T extends Rect>(list: T[]): T[] => (isIdentity(rel) ? list : list.map((o) => placeObject(rel, o)));
  const src = { areas: conv(clipboard.areas), stands: conv(clipboard.stands), infra: conv(clipboard.infra) };
  const all = [...src.areas, ...src.stands, ...src.infra];
  const c = groupCenter(all);
  if (!c) return;
  const n = pasteCounts[page.id] ?? 0;
  pasteCounts[page.id] = n + 1;
  const samePage = clipboard.sourcePageId === page.id;
  let off = n + (samePage ? 1 : 0);
  let dx = off;
  let dy = off;
  if (view && (c.x < view.minX || c.x > view.maxX || c.y < view.minY || c.y > view.maxY)) {
    off = n;
    dx = (view.minX + view.maxX) / 2 - c.x + off;
    dy = (view.minY + view.maxY) / 2 - c.y + off;
  }
  insertObjects(page.id, cloneObjects(src.areas, src.stands, dx, dy, src.infra), 'Einfügen');
}

/** Kopien der Objekte für Alt+Ziehen (an derselben Stelle, leere Platznummer); `from` = Kopie → Original. */
export function cloneForDrag(page: FestplatzPage, ids: readonly Id[]): ObjectLists & { from: Record<Id, Id> } {
  const set = new Set(ids);
  const areas = page.areas.filter((a) => set.has(a.id));
  const stands = page.stands.filter((s) => set.has(s.id));
  const infra = page.infra.filter((o) => set.has(o.id));
  const copies = cloneObjects(areas, stands, 0, 0, infra);
  const from: Record<Id, Id> = {};
  copies.areas.forEach((c, i) => (from[c.id] = areas[i]!.id));
  copies.stands.forEach((c, i) => (from[c.id] = stands[i]!.id));
  copies.infra.forEach((c, i) => (from[c.id] = infra[i]!.id));
  return { ...copies, from };
}

/** Alt+Ziehen: Kopien an ihrer neuen Lage einfügen, ein Undo-Schritt; danach sind die Kopien ausgewählt (M4-12). */
export function commitDuplicateDrag(pageId: Id, copies: ObjectLists, from: Readonly<Record<Id, Id>> = {}) {
  insertObjects(pageId, copies, 'Duplizieren', from);
}

/** Duplizieren: Kopie um 1 m nach rechts unten versetzt, danach ausgewählt. */
export function duplicateSelection() {
  const page = activePage();
  const ids = selectedIds();
  if (!page || !ids.length) return;
  const { from, ...copies } = cloneForDrag(page, ids);
  const shifted = <T extends Rect>(o: T): T => ({ ...o, cx: o.cx + 1, cy: o.cy + 1 });
  insertObjects(page.id, { areas: copies.areas.map(shifted), stands: copies.stands.map(shifted), infra: copies.infra.map(shifted) }, 'Duplizieren', from);
}

export function selectAll() {
  const page = activePage();
  if (page) select(allSelectable(page));
}

// ---------- Kategorien (projektweit) ----------

export function addCategory(): Id {
  const cats = st().project.categories;
  const names = new Set(cats.map((c) => c.name));
  let i = cats.length + 1;
  while (names.has(`Kategorie ${i}`)) i++;
  const used = new Set(cats.map((c) => c.color));
  const cat: Category = { id: newId(), name: `Kategorie ${i}`, color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[cats.length % PALETTE.length]!, minDistance: null, price: null };
  st().change('Kategorie anlegen', (p) => void p.categories.push(cat));
  return cat.id;
}

export function updateCategory(id: Id, patch: Partial<Omit<Category, 'id'>>) {
  const label =
    patch.price !== undefined ? 'Sonderpreis ändern' : patch.minDistance !== undefined ? 'Mindestabstand ändern' : patch.color !== undefined ? 'Kategorie umfärben' : 'Kategorie umbenennen';
  st().change(label, (p) => {
    const c = p.categories.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  });
}

/** Verschiebt die Kategorie an Position `to` (Reihenfolge in Statistik, Legende und Auswahllisten). */
export function moveCategory(id: Id, to: number) {
  st().change('Kategorien umsortieren', (p) => {
    const from = p.categories.findIndex((c) => c.id === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(p.categories.length - 1, to));
    if (target === from) return;
    const [cat] = p.categories.splice(from, 1);
    p.categories.splice(target, 0, cat!);
  });
}

/**
 * Beschriftung von Hand verschieben (#9): Mitte relativ zur Standmitte in Metern (auf 0,01 m gerundet); null = wieder
 * automatisch platzieren. Ein Undo-Schritt.
 */
export function setLabelOffset(pageId: Id, ids: Id[], offset: Vec | null) {
  const v = offset && { x: Math.round(offset.x * 100) / 100, y: Math.round(offset.y * 100) / 100 };
  updateStands(pageId, ids, { labelOffset: v }, v ? 'Beschriftung verschieben' : 'Beschriftung zurücksetzen');
}

/** Anzahl der Stände (alle Pages) mit dieser Kategorie. */
export function categoryUsage(project: Project, id: Id): number {
  return project.pages.reduce((n, pg) => n + pg.stands.filter((s) => s.categoryId === id).length, 0);
}

/** Löscht die Kategorie; ihre Stände verlieren sie (ein Undo-Schritt). */
export function deleteCategory(id: Id) {
  st().change('Kategorie löschen', (p) => {
    p.categories = p.categories.filter((c) => c.id !== id);
    for (const pg of p.pages) for (const s of pg.stands) if (s.categoryId === id) s.categoryId = null;
  });
}

/** Kategorieliste laden (#1): ergänzen oder ersetzen, ein Undo-Schritt. Stände entfallener Kategorien verlieren sie. */
export function loadCategoryList(list: CategoryList, mode: ApplyMode) {
  const { categories, removed } = applyCategoryList(st().project.categories, list, mode);
  const gone = new Set(removed);
  st().change(mode === 'merge' ? 'Kategorien ergänzen' : 'Kategorien ersetzen', (p) => {
    p.categories = categories;
    for (const pg of p.pages) for (const s of pg.stands) if (s.categoryId && gone.has(s.categoryId)) s.categoryId = null;
  });
}

// ---------- Beschriftung (projektweit) ----------

export function setLabelTemplate(template: string) {
  st().change('Beschriftungsvorlage ändern', (p) => void (p.settings.labelTemplate = template));
}

export function setLabelFontSize(size: number) {
  if (!(size > 0)) return;
  st().change('Schriftgröße ändern', (p) => void (p.settings.labelFontSize = Math.round(size * 100) / 100));
}

// ---------- Freiflächen und Warnungen (projektweit, M4) ----------

export function setMinFreeWidth(width: number) {
  if (!(width > 0)) return;
  const v = Math.min(MIN_FREE_WIDTH.max, Math.max(MIN_FREE_WIDTH.min, Math.round(width * 100) / 100));
  st().change('Mindestbreite ändern', (p) => void (p.settings.minFreeWidth = v));
}

// ---------- Fang-Abstand und Standardfarbe (projektweit, M10) ----------

/** Abstand beim Fang an Nachbarständen (#2), 0–10 m, auf cm gerundet. */
export function setSnapGap(gap: number) {
  if (!Number.isFinite(gap)) return;
  const v = clampSnapGap(Math.round(gap * 100) / 100);
  st().change('Fang-Abstand ändern', (p) => void (p.settings.snapGap = v));
}

/** Farbe der Stände ohne eigene Farbe und ohne Kategorie (#3). */
export function setDefaultStandColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  st().change('Standardfarbe ändern', (p) => void (p.settings.defaultStandColor = color.toLowerCase()));
}

/** Standgeld (#5): Preis je Frontmeter (null = keiner), Rundung, MwSt-Satz; ein Undo-Schritt. */
export function setPricing(patch: Partial<PricingSettings>) {
  const label = patch.perMeter !== undefined ? 'Preis je Frontmeter ändern' : patch.vatRate !== undefined ? 'MwSt-Satz ändern' : 'Rundung der Frontmeter ändern';
  const pricing = { ...st().project.settings.pricing, ...patch };
  const next: PricingSettings = { perMeter: clampPrice(pricing.perMeter), roundUpMeters: pricing.roundUpMeters, vatRate: Math.round(Math.min(VAT_LIMITS.max, Math.max(VAT_LIMITS.min, pricing.vatRate)) * 100) / 100 };
  st().change(label, (p) => void (p.settings.pricing = next));
}

export type WarningKind = 'outside' | 'overlap' | 'duplicate' | 'infra' | 'distance';

const WARNING: Record<
  WarningKind,
  {
    name: string;
    setting: 'warnOutside' | 'warnOverlap' | 'warnDuplicateNr' | 'warnInfra' | 'warnDistance';
    suppress: 'suppressOutsideWarning' | 'suppressOverlapWarning' | 'suppressDuplicateWarning' | 'suppressInfraWarning' | 'suppressDistanceWarning';
  }
> = {
  outside: { name: 'Warnung „außerhalb“', setting: 'warnOutside', suppress: 'suppressOutsideWarning' },
  overlap: { name: 'Warnung „Überlappung“', setting: 'warnOverlap', suppress: 'suppressOverlapWarning' },
  duplicate: { name: 'Warnung „doppelte Nummer“', setting: 'warnDuplicateNr', suppress: 'suppressDuplicateWarning' },
  infra: { name: 'Warnung „Infrastruktur“', setting: 'warnInfra', suppress: 'suppressInfraWarning' },
  distance: { name: 'Warnung „Abstand“', setting: 'warnDistance', suppress: 'suppressDistanceWarning' },
};

/** Warnung „Durchfahrt zu eng“ projektweit ein- oder ausschalten (Undo-Schritt, M7). */
export function setPassageWarningEnabled(on: boolean) {
  st().change(`Warnung „Durchfahrt zu eng“ ${on ? 'einschalten' : 'ausschalten'}`, (p) => void (p.settings.warnPassageWidth = on));
}

/** Mindestbreite der engen Durchfahrt (projektweit, 0,5–50 m, M7). */
export function setMinPassageWidth(width: number) {
  if (!(width > 0)) return;
  const v = Math.round(clampMinPassage(width) * 100) / 100;
  st().change('Mindestbreite der Durchfahrt ändern', (p) => void (p.settings.minPassageWidth = v));
}

/** Warnungen einer Art projektweit ein- oder ausschalten (Undo-Schritt). */
export function setWarningsEnabled(kind: WarningKind, on: boolean) {
  st().change(`${WARNING[kind].name} ${on ? 'einschalten' : 'ausschalten'}`, (p) => {
    p.settings[WARNING[kind].setting] = on;
  });
}

/** Warnung einer Art für die angegebenen Stände ignorieren bzw. wieder anzeigen (Undo-Schritt). */
export function setWarningIgnored(pageId: Id, ids: Id[], kind: WarningKind, ignored: boolean) {
  updateStands(pageId, ids, { [WARNING[kind].suppress]: ignored }, ignored ? 'Warnung ignorieren' : 'Warnung wieder anzeigen');
}
