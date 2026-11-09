/**
 * Formatversionen von `project.json` (Feld `schemaVersion`).
 *
 * Regel (CONTRIBUTING.md): Jede Änderung am Dateiformat erhöht CURRENT_SCHEMA_VERSION und bringt eine
 * Migration „von n auf n+1“ mit Test mit (src/core/model/migrations.test.ts, Testdatei in
 * tests/fixtures/). Migrationen arbeiten auf den rohen JSON-Daten, verändern die Eingabe nicht und
 * ergänzen fehlende Felder mit Standardwerten. Danach prüft und vervollständigt `normalizeProject`
 * (schema.ts) das Ergebnis.
 *
 * Versionen:
 *   1  M1–M3: Projekt, Pages, Hintergrund, Grundflächen, Geschäfte, Kategorien.
 *   2  M4: Geschäft `suppressOverlapWarning`, Einstellung `warnOverlap` (Warnungen, Freiflächen).
 *   3  M5: Einstellungen `numbering.digits` und `warnDuplicateNr`, Geschäft `suppressDuplicateWarning`;
 *      `clockwise.startAngle` gilt relativ zur Nordrichtung der Page (vorher ohne Oberfläche, nie gesetzt).
 *   4  M7: Infrastruktur-Typen mit `id`, Geometrie, Standardmaß, `keepClear`; Infrastruktur-Objekt `typeId`,
 *      `label`, `note`, Strom, `suppressWidthWarning`; Geschäft `suppressInfraWarning`; Einstellungen `warnInfra`,
 *      `warnPassageWidth`, `minPassageWidth`; Page `sheet`, `titleBlock` (Anker, ersetzt `titleBlockPos`), `legend`,
 *      Ebene `sheet`.
 *   5  M8: Page `scaleBar` und `northArrow` (Anker der Papier-Elemente Maßstabsbalken und Nordpfeil); das nie
 *      genutzte Feld `exportProfiles` entfällt (Export-Profile gelten seit M8 pro Rechner).
 *   6  M10: Einstellungen `snapGap` (Abstand beim Fang an Nachbarständen, #2) und `defaultStandColor` (Farbe der
 *      Stände ohne Kategorie und eigene Farbe, #3).
 *   7  M11: Page `hiddenFree` (ausgeblendete Freiflächen mit Schlüssel und Achsenintervall, #8).
 *   8  M12: Geschäft `shape` und `shapeTemplateId`, Projekt `shapeTemplates` (Geschäftsformen, #9).
 *   9  Konkurrenzschutz (#3): Kategorie `minDistance`, Geschäft `suppressDistanceWarning`, Einstellung `warnDistance`.
 *  10  Standgeld (#5): Einstellung `pricing` (Preis je Frontmeter, Rundung, MwSt-Satz), Kategorie `price`.
 *  11  Beschriftung (#9): Geschäft `labelOffset` (von Hand verschobene Beschriftung).
 *  12  Ohne Grundflächen (#17): Page `useAreas` („Grundflächen verwenden“).
 *  13  Nummerierung (#12): Page `numberingMode` auch `rightToLeft`, `topToBottom`, `bottomToTop`, `direction`,
 *      `counterClockwise`; Page `direction` (Start- und Zielpunkt der eigenen Richtung).
 *  14  Freies Blatt (#13): Blatt `format` auch 'plan' und 'region', dazu `margin`, `targetWidth`, `region`.
 *  15  Zusammengesetzte Form (#16): Geschäft `parts` (eigene Form) und `frontOverride` (Frontmeter von Hand),
 *      Formvorlage `occupies` („belegt wie gezeichnet“), Teil einer Form `rot` (Drehung je Teil).
 *  16  Festplatz-Verbund (#15): Projekt `groups` (Verbünde mit Mitgliedern, Blatt, Papier-Elementen, Ebenen, Ansicht).
 *  17  Nachbarn im PDF (#15 Teil c): Ebene `neighbours` („Nachbarn“) je Page und je Verbund.
 */
import { UserError } from '../errors';

export const CURRENT_SCHEMA_VERSION = 17;

type Obj = Record<string, unknown>;
type Migration = (project: Obj) => Obj;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Wendet `fn` auf jedes Element an; alles andere als ein Array bleibt unverändert (die Prüfung macht schema.ts). */
/** DIN-Formate bis Formatversion 13 (#13). */
const DIN_FORMATS = ['A4', 'A3', 'A2', 'A1', 'A0'];
const mapList = (v: unknown, fn: (x: unknown) => unknown) => (Array.isArray(v) ? v.map(fn) : v);

/** MIGRATIONS[n] hebt ein Projekt von Version n auf n+1. */
export const MIGRATIONS: Record<number, Migration> = {
  /** 1 → 2 (M4): Überlappungswarnung pro Stand ignorierbar und projektweit abschaltbar. */
  1: (p) => ({
    ...p,
    settings: isObj(p.settings) ? { warnOverlap: true, ...p.settings } : p.settings,
    pages: mapList(p.pages, (pg) => (isObj(pg) ? { ...pg, stands: mapList(pg.stands, (s) => (isObj(s) ? { suppressOverlapWarning: false, ...s } : s)) } : pg)),
  }),
  /** 2 → 3 (M5): Stellenzahl der Nummern, Warnung „doppelte Nummer“ projektweit und pro Stand. */
  2: (p) => ({
    ...p,
    settings: isObj(p.settings)
      ? { warnDuplicateNr: true, ...p.settings, ...(isObj(p.settings.numbering) ? { numbering: { digits: 1, ...p.settings.numbering } } : {}) }
      : p.settings,
    pages: mapList(p.pages, (pg) => (isObj(pg) ? { ...pg, stands: mapList(pg.stands, (s) => (isObj(s) ? { suppressDuplicateWarning: false, ...s } : s)) } : pg)),
  }),
  /**
   * 3 → 4 (M7): Infrastruktur, Blatt, Schriftfeld, Legende.
   * Die gespeicherten Infrastruktur-Typen hatten bis M6 keine Oberfläche und entsprachen immer den Standards; sie
   * entfallen, `normalizeProject` setzt die neuen Standards. Objekte (bis M6 nie angelegt) werden umbenannt
   * (`type` → `typeId`, `text` → `label`). `titleBlockPos` (Meter, nie genutzt) entfällt; Blatt und Anker ergänzt
   * `normalizeProject` mit Standardwerten.
   */
  3: (p) => {
    const { infraTypes: _old, ...rest } = p;
    return {
      ...rest,
      settings: isObj(p.settings) ? { warnInfra: true, warnPassageWidth: true, minPassageWidth: 3.5, ...p.settings } : p.settings,
      pages: mapList(p.pages, (pg) => {
        if (!isObj(pg)) return pg;
        const { titleBlockPos: _pos, ...page } = pg;
        return {
          ...page,
          stands: mapList(pg.stands, (s) => (isObj(s) ? { suppressInfraWarning: false, ...s } : s)),
          infra: mapList(pg.infra, (o) => {
            if (!isObj(o)) return o;
            const { type, text, ...obj } = o;
            return { typeId: type, label: typeof text === 'string' ? text : '', ...obj };
          }),
        };
      }),
    };
  },
  /**
   * 4 → 5 (M8): Maßstabsbalken (oben links) und Nordpfeil (oben rechts) als Papier-Elemente, je 10 mm Abstand,
   * sichtbar. `exportProfiles` war in jeder Datei leer (keine Oberfläche bis M7) und entfällt.
   */
  4: (p) => {
    const { exportProfiles: _profiles, ...rest } = p;
    return {
      ...rest,
      pages: mapList(p.pages, (pg) =>
        isObj(pg)
          ? {
              scaleBar: { visible: true, corner: 'tl', dx: 10, dy: 10 },
              northArrow: { visible: true, corner: 'tr', dx: 10, dy: 10 },
              ...pg,
            }
          : pg,
      ),
    };
  },
  /**
   * 5 → 6 (M10): Alte Projekte rasten mit dem neuen Standardabstand 0,3 m ein (Entscheidung Laurin 2026-10-23) und
   * behalten das bisherige feste Grau als Standardfarbe.
   */
  5: (p) => ({
    ...p,
    settings: isObj(p.settings) ? { snapGap: 0.3, defaultStandColor: '#a7adb3', ...p.settings } : p.settings,
  }),
  /** 6 → 7 (M11): Noch keine Freifläche ausgeblendet. */
  6: (p) => ({
    ...p,
    pages: mapList(p.pages, (pg) => (isObj(pg) ? { hiddenFree: [], ...pg } : pg)),
  }),
  /** 7 → 8 (M12): Alle Stände sind Rechtecke, noch keine Formvorlagen. */
  7: (p) => ({
    shapeTemplates: [],
    ...p,
    pages: mapList(p.pages, (pg) =>
      isObj(pg) ? { ...pg, stands: mapList(pg.stands, (s) => (isObj(s) ? { shape: 'rect', shapeTemplateId: null, ...s } : s)) } : pg,
    ),
  }),
  /** 8 → 9 (#3): Noch keine Kategorie mit Mindestabstand; die Warnung ist eingeschaltet, greift aber erst mit einem Wert. */
  8: (p) => ({
    ...p,
    settings: isObj(p.settings) ? { warnDistance: true, ...p.settings } : p.settings,
    categories: mapList(p.categories, (c) => (isObj(c) ? { minDistance: null, ...c } : c)),
    pages: mapList(p.pages, (pg) =>
      isObj(pg) ? { ...pg, stands: mapList(pg.stands, (s) => (isObj(s) ? { suppressDistanceWarning: false, ...s } : s)) } : pg,
    ),
  }),
  /** 9 → 10 (#5): Noch kein Preis festgelegt; MwSt-Satz 19 %, Meter exakt. */
  9: (p) => ({
    ...p,
    settings: isObj(p.settings) ? { pricing: { perMeter: null, roundUpMeters: false, vatRate: 19 }, ...p.settings } : p.settings,
    categories: mapList(p.categories, (c) => (isObj(c) ? { price: null, ...c } : c)),
  }),
  /** 10 → 11 (#9): Noch keine Beschriftung von Hand verschoben. */
  10: (p) => ({
    ...p,
    pages: mapList(p.pages, (pg) => (isObj(pg) ? { ...pg, stands: mapList(pg.stands, (s) => (isObj(s) ? { labelOffset: null, ...s } : s)) } : pg)),
  }),
  /** 11 → 12 (#17): Alle bisherigen Pages verwenden Grundflächen, auch solche ohne eine einzige. */
  11: (p) => ({
    ...p,
    pages: mapList(p.pages, (pg) => (isObj(pg) ? { useAreas: true, ...pg } : pg)),
  }),
  /**
   * 12 → 13 (#12): Die bisherigen Modi `frontLtr`, `clockwise` und `manual` behalten ihre Bedeutung, `direction` ist
   * optional (ohne Angabe gilt beim Umschalten die Vorgabe). Es gibt nichts zu ergänzen; die Version steigt, damit
   * ältere Programmversionen die neuen Modi nicht stillschweigend als „links → rechts“ lesen.
   */
  12: (p) => ({ ...p }),
  /**
   * 13 → 14 (#13): Bestehende Blätter bleiben DIN. Neue Pages haben seit #13 das Format „Plan“; damit ein Blatt ohne
   * Format (Dateien vor M7) nicht zum Plan wird, gilt dort der bisherige Standard A3 quer, an Seite anpassen. Rand
   * automatisch, Zielbreite 841 mm, kein Ausschnitt.
   */
  13: (p) => ({
    ...p,
    pages: mapList(p.pages, (pg) => {
      if (!isObj(pg)) return pg;
      const sheet = isObj(pg.sheet) ? pg.sheet : {};
      // Ungültiges Format: wie vor #13 A3 (beim Laden würde es sonst zum neuen Standard „Plan“)
      const format = typeof sheet.format === 'string' && DIN_FORMATS.includes(sheet.format) ? sheet.format : 'A3';
      return { ...pg, sheet: { orientation: 'landscape', scale: null, cx: 0, cy: 0, margin: null, targetWidth: 841, region: null, ...sheet, format } };
    }),
  }),
  /**
   * 14 → 15 (#16): Kein Stand hat eine eigene Form oder Frontmeter von Hand, keine Vorlage belegt wie gezeichnet, kein
   * Teil ist gedreht. Damit rechnet alles wie bisher mit dem Rechteck B × T.
   */
  14: (p) => ({
    ...p,
    ...('shapeTemplates' in p
      ? { shapeTemplates: mapList(p.shapeTemplates, (t) => (isObj(t) ? { occupies: false, ...t, parts: mapList(t.parts, (q) => (isObj(q) ? { rot: 0, ...q } : q)) } : t)) }
      : {}),
    pages: mapList(p.pages, (pg) =>
      isObj(pg) ? { ...pg, stands: mapList(pg.stands, (s) => (isObj(s) ? { parts: null, frontOverride: null, ...s } : s)) } : pg,
    ),
  }),
  /** 15 → 16 (#15): Noch kein Festplatz-Verbund; jede Page steht für sich. */
  15: (p) => ({ groups: [], ...p }),
  /**
   * 16 → 17 (#15 Teil c): Ebene „Nachbarn“ je Page und Verbund, sichtbar und nicht gesperrt (Nachbarn waren bisher auf
   * den Ebenen „Geschäfte“ bzw. „Infrastruktur“ sichtbar; so bleibt die Darstellung gleich).
   */
  16: (p) => ({
    ...p,
    pages: mapList(p.pages, withNeighbourLayer),
    ...('groups' in p ? { groups: mapList(p.groups, withNeighbourLayer) } : {}),
  }),
};

/** Ebene `neighbours` ergänzen, eine vorhandene bleibt (16 → 17). */
function withNeighbourLayer(x: unknown): unknown {
  if (!isObj(x) || !isObj(x.layers)) return x;
  return { ...x, layers: { neighbours: { visible: true, locked: false }, ...x.layers } };
}

export function migrate(project: unknown, fromVersion: number): unknown {
  let p = project;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new UserError(`Die Datei hat Formatversion ${fromVersion}; diese Version kann Marktplaner nicht umwandeln.`);
    if (!isObj(p)) return p;
    p = step(p);
  }
  return p;
}
