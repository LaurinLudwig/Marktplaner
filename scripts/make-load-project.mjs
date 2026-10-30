// Erzeugt tests/fixtures/last-500-staende.schelme: Testprojekt mit 500 Ständen auf 4 Festplätzen
// (je 6 Grundflächen à 170 m, teils gedreht),
// um die Bildrate in der Desktop-App von Hand zu prüfen (M3-23, Q-04). Deterministisch, ohne Zufall.
// Aufruf: node scripts/make-load-project.mjs   (braucht keine Browser)
// Aufbau wie src/core/model (createProject/createPage/createStand); der Unit-Test
// src/core/fixtures.test.ts lädt die Datei mit dem echten Ladecode und prüft, dass nichts verworfen wird.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'last-500-staende.schelme');

const r2 = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;

// Süßwaren mit Mindestabstand (#3): Die Abstandsprüfung läuft im Lasttest mit (viele Paare in Reichweite)
const CATEGORIES = [
  { id: 'cat-imbiss', name: 'Imbiss', color: '#f0a35e', minDistance: null },
  { id: 'cat-getraenke', name: 'Getränke', color: '#4fc3f7', minDistance: null },
  { id: 'cat-suess', name: 'Süßwaren', color: '#f06292', minDistance: 30 },
  { id: 'cat-handwerk', name: 'Kunsthandwerk', color: '#9ccc65', minDistance: null },
  { id: 'cat-fahrgeschaeft', name: 'Fahrgeschäft', color: '#7986cb', minDistance: null },
];
const WARE = ['Bratwurst', 'Crêpes', 'Bier', 'Wein', 'Gebrannte Mandeln', 'Lebkuchen', 'Keramik', 'Holzspielzeug', 'Kinderkarussell', 'Schmuck'];
const NAMES = ['Wenz', 'Kaya', 'Müller', 'Schäfer', 'Becker', 'Hofmann', 'Wagner', 'Schmitt', 'Krämer', 'Weber', 'Fischer', 'Lang'];
const SIZES = [
  [3, 3],
  [4, 3],
  [3, 3],
  [5, 3],
  [6, 3],
  [4, 3],
  [8, 4],
  [10, 5],
];
const CONNECTIONS = [null, '230V', 'CEE16', 'CEE32'];

const layers = () => Object.fromEntries(['background', 'areas', 'free', 'stands', 'infra', 'labels', 'sheet'].map((id) => [id, { visible: true, locked: false }]));

function page(id, name, prefix) {
  return {
    id,
    name,
    prefix,
    numberingMode: 'frontLtr',
    powerLimitKw: null,
    blockOverLimit: false,
    northAngle: 0,
    grid: { size: 1, visible: true },
    layers: layers(),
    background: null,
    areas: [],
    stands: [],
    infra: [],
    sheet: { format: 'A3', orientation: 'landscape', scale: null, cx: 0, cy: 0 },
    titleBlock: { visible: true, corner: 'br', dx: 10, dy: 10 },
    titleBlockText: '',
    legend: { visible: true, corner: 'bl', dx: 10, dy: 10 },
    scaleBar: { visible: true, corner: 'tl', dx: 10, dy: 10 },
    northArrow: { visible: true, corner: 'tr', dx: 10, dy: 10 },
    hiddenFree: [],
    view: null,
  };
}

/**
 * Reihen von Grundflächen untereinander, ohne Überschneidung; Stände bündig an der Vorderseite,
 * Lücke 0,5 m (an jeder dritten Stelle 4 m, damit ab M4 Freiflächen entstehen).
 * `rows` = [Länge, Tiefe, Drehung, Anzahl Stände].
 */
function fillPage(pg, rows, counter) {
  let bottom = 0;
  rows.forEach(([len, depth, rot, count], ri) => {
    // halbe senkrechte Ausdehnung der gedrehten Fläche
    const half = (len / 2) * Math.abs(Math.sin(rad(rot))) + (depth / 2) * Math.abs(Math.cos(rad(rot)));
    const area = { id: `${pg.id}-a${ri + 1}`, name: `${pg.name} Reihe ${ri + 1}`, cx: 0, cy: r2(bottom + half), w: len, d: depth, rot };
    bottom += 2 * half + 12;
    pg.areas.push(area);
    let s = 0.5;
    for (let i = 0; i < count; i++) {
      const n = counter.n++;
      const [w, d] = SIZES[n % SIZES.length];
      // lokal: x entlang der Vorderseite (−len/2 … len/2), y = Vorderseite (+depth/2) minus halbe Standtiefe
      const lx = -len / 2 + s + w / 2;
      const ly = depth / 2 - d / 2;
      const c = Math.cos(rad(rot));
      const sn = Math.sin(rad(rot));
      pg.stands.push({
        id: `${pg.id}-s${i + 1}-r${ri + 1}`,
        nr: `${pg.prefix}${pg.stands.length + 1}`,
        nrLocked: false,
        name: `${WARE[n % WARE.length]} ${NAMES[n % NAMES.length]}`,
        owner: `${NAMES[(n * 7) % NAMES.length]} GmbH`,
        ware: WARE[n % WARE.length],
        powerKw: [0, 3, 6, 11, 16][n % 5],
        connection: CONNECTIONS[n % CONNECTIONS.length],
        note: '',
        categoryId: n % 7 === 6 ? null : CATEGORIES[n % CATEGORIES.length].id,
        color: n % 23 === 0 ? '#ffffff' : null,
        suppressOutsideWarning: false,
        suppressOverlapWarning: false,
        suppressDuplicateWarning: false,
        suppressInfraWarning: false,
        suppressDistanceWarning: false,
        shape: 'rect',
        shapeTemplateId: null,
        cx: r2(area.cx + lx * c - ly * sn),
        cy: r2(area.cy + lx * sn + ly * c),
        w,
        d,
        rot,
      });
      s += w + (i % 3 === 2 ? 4 : 0.5);
      if (s > len) throw new Error(`${area.name}: ${count} Stände passen nicht auf ${len} m`);
    }
  });
}

const counter = { n: 0 };
const rowsOf = (rot, counts) => counts.map((n, i) => [170, i % 2 ? 8 : 6, rot, n]);
const pages = [
  [page('obermarkt', 'Obermarkt', 'A-'), rowsOf(0, [21, 21, 21, 21, 21, 21])],
  [page('untermarkt', 'Untermarkt', 'B-'), rowsOf(15, [21, 21, 21, 21, 21, 21])],
  [page('ziegelturm', 'Am Ziegelturm', 'C-'), rowsOf(340, [21, 21, 21, 21, 21, 21])],
  [page('schifftor', 'Schifftor', 'D-'), rowsOf(0, [21, 21, 20, 20, 20, 20])],
];
for (const [pg, rows] of pages) fillPage(pg, rows, counter);

const project = {
  id: 'lasttest-500',
  name: 'Lasttest 500 Stände',
  settings: {
    minFreeWidth: 0.5,
    labelFontSize: 0.6,
    labelTemplate: '{nr}\n{name}\n{breite}×{tiefe} m',
    numbering: { scope: 'perPage', start: 1, digits: 1 },
    warnOutside: true,
    warnOverlap: true,
    warnDuplicateNr: true,
    warnInfra: true,
    warnPassageWidth: true,
    minPassageWidth: 3.5,
    warnDistance: true,
    snap: { front: true, grid: false, neighbors: true },
    snapGap: 0.3,
    defaultStandColor: '#a7adb3',
  },
  pages: pages.map(([pg]) => pg),
  categories: CATEGORIES,
  // wie DEFAULT_INFRA_TYPES in src/core/model/defaults.ts (die Datei soll beim Laden unverändert bleiben)
  infraTypes: [
    { id: 'barrierMobile', builtin: true, label: 'Mobile Sperre', geometry: 'line', color: '#e0a526', icon: 'fence', defaultW: 3.5, defaultD: 0.3, occupiesArea: false, keepClear: true },
    { id: 'barrierFixed', builtin: true, label: 'Feste Sperre', geometry: 'line', color: '#c0392b', icon: 'block', defaultW: 4, defaultD: 0.8, occupiesArea: false, keepClear: true },
    { id: 'medical', builtin: true, label: 'Sanitätsdienst', geometry: 'rect', color: '#e74c3c', icon: 'medical_services', defaultW: 6, defaultD: 3, occupiesArea: true, keepClear: true },
    { id: 'ambulance', builtin: true, label: 'RTW-Platz', geometry: 'rect', color: '#d35454', icon: 'ambulance', defaultW: 8, defaultD: 3.5, occupiesArea: true, keepClear: true },
    { id: 'toilet', builtin: true, label: 'Toilette', geometry: 'rect', color: '#3a86c8', icon: 'wc', defaultW: 6, defaultD: 2.5, occupiesArea: true, keepClear: true },
    { id: 'waste', builtin: true, label: 'Müllcontainer', geometry: 'rect', color: '#6d7a80', icon: 'delete', defaultW: 1.5, defaultD: 1.2, occupiesArea: true, keepClear: true },
    { id: 'narrowPassage', builtin: true, label: 'Enge Durchfahrt', geometry: 'line', color: '#9b59b6', icon: 'arrow_range', defaultW: 3.5, defaultD: 0, occupiesArea: true, keepClear: true },
    { id: 'marker', builtin: true, label: 'Marker', geometry: 'point', color: '#16a085', icon: 'location_on', defaultW: 0, defaultD: 0, occupiesArea: false, keepClear: false },
  ],
  shapeTemplates: [],
  titleBlock: { dateText: '', version: '' },
  unplaced: [],
};

const total = project.pages.reduce((n, p) => n + p.stands.length, 0);
if (total !== 500) throw new Error(`Erwartet 500 Stände, erzeugt ${total}`);

const file = { format: 'schelmeplaner', schemaVersion: 9, project };
writeFileSync(out, zipSync({ 'project.json': [strToU8(JSON.stringify(file, null, 2)), { level: 6 }] }, { mtime: new Date('2026-01-01T00:00:00Z') }));
console.warn(`${out}: ${total} Stände auf ${project.pages.length} Festplätzen`);
