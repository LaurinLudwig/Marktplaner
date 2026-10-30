import { UserError } from './errors';
import { newId } from './id';
import { clampMinDistance } from './model/schema';
import type { Category, Id } from './model/types';

/**
 * Kategorielisten (#1, #2): fertige Zusammenstellungen von Kategorien, aus denen ein neues Projekt startet oder die in
 * den Projekteinstellungen geladen werden. Flache Listen; „Süßwaren – Waffeln“ ist nur ein Name, keine Unterkategorie.
 * Mitgelieferte Listen stehen hier, eigene liegen pro Rechner (state/categoryLists.ts) und lassen sich als Datei
 * weitergeben.
 */
export interface CategoryListEntry {
  name: string;
  color: string;
  /** Mindestabstand zur gleichen Kategorie in Metern (#3); fehlt oder null = keine Prüfung. */
  minDistance?: number | null;
}

export interface CategoryList {
  id: string;
  name: string;
  builtin: boolean;
  entries: CategoryListEntry[];
}

/** Auswahl „leer“ beim neuen Projekt: keine Kategorien. */
export const EMPTY_LIST_ID = 'leer';
export const DEFAULT_LIST_ID = 'jahrmarkt-klein';

/**
 * Farben nach Gruppen (Fahrgeschäfte blau, Spiel violett, Süßwaren rosa/rot, Imbiss orange, Ausschank gelb, Waren
 * grün). Hell genug für schwarze Beschriftung und im Graustufendruck über die Helligkeit unterscheidbar.
 */
export const BUILTIN_CATEGORY_LISTS: readonly CategoryList[] = [
  {
    id: DEFAULT_LIST_ID,
    name: 'Jahrmarkt klein',
    builtin: true,
    entries: [
      { name: 'Kinderfahrgeschäft', color: '#81d4fa' },
      { name: 'Großfahrgeschäft', color: '#5c8fd6' },
      { name: 'Laufgeschäft', color: '#9fa8da' },
      { name: 'Spielgeschäft/Verlosung', color: '#ba68c8' },
      { name: 'Süßwaren', color: '#f06292' },
      { name: 'Imbiss', color: '#f0a35e' },
      { name: 'Ausschank', color: '#f2d15c' },
      { name: 'Festzelt', color: '#c49a6c' },
      { name: 'Krammarkt/Waren', color: '#9ccc65' },
      { name: 'Kunsthandwerk', color: '#4db6ac' },
      { name: 'Verein/Info', color: '#b0bec5' },
    ],
  },
  {
    id: 'jahrmarkt-gross',
    name: 'Jahrmarkt groß',
    builtin: true,
    entries: [
      { name: 'Fahrgeschäft – Kinder', color: '#b3e5fc' },
      { name: 'Fahrgeschäft – Rundfahrgeschäft', color: '#4fc3f7' },
      { name: 'Fahrgeschäft – Hochfahrgeschäft', color: '#5c8fd6' },
      { name: 'Fahrgeschäft – Achterbahn', color: '#3d6bb3' },
      { name: 'Fahrgeschäft – Riesenrad', color: '#7986cb' },
      { name: 'Fahrgeschäft – Autoscooter', color: '#4dd0e1' },
      { name: 'Fahrgeschäft – Laufgeschäft', color: '#9fa8da' },
      { name: 'Spielgeschäft – Schießwagen', color: '#ce93d8' },
      { name: 'Spielgeschäft – Verlosung', color: '#ba68c8' },
      { name: 'Spielgeschäft – Wurf- und Geschicklichkeit', color: '#9c64b5' },
      { name: 'Süßwaren – Mandeln', color: '#f48fb1' },
      { name: 'Süßwaren – Waffeln', color: '#f06292' },
      { name: 'Süßwaren – Schokofrüchte', color: '#c2185b' },
      { name: 'Süßwaren – Crêpes', color: '#f8bbd0' },
      { name: 'Süßwaren – Zuckerwatte und Popcorn', color: '#ec7aa8' },
      { name: 'Süßwaren – Lebkuchen', color: '#d4728a' },
      { name: 'Imbiss – Bratwurst', color: '#f0a35e' },
      { name: 'Imbiss – Fisch', color: '#ffcc80' },
      { name: 'Imbiss – Pommes', color: '#ffb74d' },
      { name: 'Imbiss – Grill und Steak', color: '#e57c3a' },
      { name: 'Imbiss – Langos und Backwaren', color: '#e8a87c' },
      { name: 'Ausschank – Bier', color: '#f2d15c' },
      { name: 'Ausschank – Wein', color: '#c9a227' },
      { name: 'Ausschank – Cocktails', color: '#fff176' },
      { name: 'Ausschank – Kaffee und Alkoholfreies', color: '#d7c49e' },
      { name: 'Festzelt', color: '#c49a6c' },
      { name: 'Krammarkt – Waren', color: '#9ccc65' },
      { name: 'Krammarkt – Textil', color: '#c5e1a5' },
      { name: 'Kunsthandwerk', color: '#4db6ac' },
      { name: 'Verein/Info', color: '#b0bec5' },
    ],
  },
];

export const builtinList = (id: string) => BUILTIN_CATEGORY_LISTS.find((l) => l.id === id) ?? null;

/** Vergleichsschlüssel für Namen: Groß-/Kleinschreibung und Leerraum an den Rändern zählen nicht. */
const key = (name: string) => name.trim().toLocaleLowerCase('de-DE');

const categoryOf = (e: CategoryListEntry, id: Id = newId()): Category => ({ id, name: e.name, color: e.color, minDistance: e.minDistance ?? null });

/** Kategorien einer Liste mit neuen IDs (neues Projekt). */
export const categoriesFromList = (list: CategoryList): Category[] => list.entries.map((e) => categoryOf(e));

export type ApplyMode = 'merge' | 'replace';

export interface ApplyResult {
  categories: Category[];
  /** IDs bisheriger Kategorien, die beim Ersetzen entfallen; ihre Stände verlieren die Kategorie. */
  removed: Id[];
}

/**
 * Liste auf die Kategorien eines Projekts anwenden.
 * - `merge`: nur Namen ergänzen, die es noch nicht gibt; Bestehendes bleibt unverändert.
 * - `replace`: danach gilt genau die Liste. Gleichnamige Kategorien behalten ihre ID (Stände behalten die Kategorie)
 *   und übernehmen Farbe und Mindestabstand der Liste; alle anderen entfallen.
 */
export function applyCategoryList(current: readonly Category[], list: CategoryList, mode: ApplyMode): ApplyResult {
  const byName = new Map(current.map((c) => [key(c.name), c]));
  if (mode === 'merge') {
    const added: Category[] = [];
    for (const e of list.entries) {
      if (byName.has(key(e.name))) continue;
      const c = categoryOf(e);
      byName.set(key(e.name), c);
      added.push(c);
    }
    return { categories: [...current, ...added], removed: [] };
  }
  const kept = new Set<Id>();
  const seen = new Set<string>();
  const categories: Category[] = [];
  for (const e of list.entries) {
    if (seen.has(key(e.name))) continue; // doppelter Name in der Liste
    seen.add(key(e.name));
    const old = byName.get(key(e.name));
    if (old) kept.add(old.id);
    categories.push(categoryOf(e, old?.id));
  }
  return { categories, removed: current.filter((c) => !kept.has(c.id)).map((c) => c.id) };
}

// ---------- Eigene Listen (#2) ----------

/** Liste aus den Kategorien eines Projekts. */
export const listFromCategories = (name: string, categories: readonly Category[]): CategoryList => ({
  id: newId(),
  name,
  builtin: false,
  entries: categories.map((c) => ({ name: c.name, color: c.color, minDistance: c.minDistance })),
});

/** Name, den es unter `existing` noch nicht gibt: „Markt“, „Markt (2)“, … */
export function uniqueListName(name: string, existing: readonly CategoryList[]): string {
  const taken = new Set(existing.map((l) => key(l.name)));
  const base = name.trim() || 'Eigene Liste';
  if (!taken.has(key(base))) return base;
  let i = 2;
  while (taken.has(key(`${base} (${i})`))) i++;
  return `${base} (${i})`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Einträge prüfen: ungültige fallen weg, doppelte Namen zählen einmal. */
function normalizeEntries(raw: unknown): CategoryListEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CategoryListEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.name !== 'string' || !e.name.trim() || !isColor(e.color)) continue;
    if (seen.has(key(e.name))) continue;
    seen.add(key(e.name));
    out.push({ name: e.name.trim(), color: e.color.toLowerCase(), minDistance: clampMinDistance(e.minDistance) });
  }
  return out;
}

function normalizeOwnList(raw: unknown): CategoryList | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (builtinList(raw.id)) return null;
  const entries = normalizeEntries(raw.entries);
  return entries.length ? { id: raw.id, name: raw.name.trim(), builtin: false, entries } : null;
}

/** Gespeicherte eigene Listen dieses Rechners lesen; Beschädigtes fällt mit Hinweis weg. */
export function loadOwnLists(raw: unknown): { lists: CategoryList[]; error?: string } {
  if (raw === undefined || raw === null) return { lists: [] };
  if (!Array.isArray(raw)) return { lists: [], error: 'Die gespeicherten Kategorielisten sind beschädigt und wurden verworfen.' };
  const seen = new Set<string>();
  const lists = raw.map(normalizeOwnList).filter((l): l is CategoryList => !!l && !seen.has(l.id) && !!seen.add(l.id));
  return lists.length < raw.length ? { lists, error: 'Einige gespeicherte Kategorielisten waren beschädigt und wurden verworfen.' } : { lists };
}

/** Dateiformat zum Weitergeben einer Liste (JSON). */
export const CATEGORY_LIST_FORMAT = 'marktplaner-kategorien';
export const CATEGORY_LIST_VERSION = 1;
export const CATEGORY_LIST_EXTENSION = 'json';

export function encodeCategoryListFile(list: CategoryList): string {
  const categories = list.entries.map((e) => ({ name: e.name, color: e.color, minDistance: e.minDistance ?? null }));
  const file = { format: CATEGORY_LIST_FORMAT, version: CATEGORY_LIST_VERSION, name: list.name, categories };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Datei lesen; ungültige Dateien und solche aus einer neueren App-Version werden mit deutscher Meldung abgewiesen. */
export function parseCategoryListFile(text: string): CategoryList {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new UserError('Die Datei ist keine Kategorieliste des Marktplaners (kein gültiges JSON).');
  }
  if (!isObj(raw) || raw.format !== CATEGORY_LIST_FORMAT) throw new UserError('Die Datei ist keine Kategorieliste des Marktplaners.');
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new UserError('Die Kategorieliste hat keine gültige Formatversion.');
  if (version > CATEGORY_LIST_VERSION) {
    throw new UserError(`Die Kategorieliste wurde mit einer neueren Version des Marktplaners erstellt (Format ${version}). Bitte die App aktualisieren.`);
  }
  const entries = normalizeEntries(raw.categories);
  if (!entries.length) throw new UserError('Die Kategorieliste enthält keine gültige Kategorie.');
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Importierte Liste';
  return { id: newId(), name, builtin: false, entries };
}

/** Vorschlag für den Dateinamen beim Export. */
export const categoryListFileName = (list: CategoryList) =>
  `Kategorien ${list.name.replace(/[\\/:*?"<>|]+/g, '-').replace(/[^\P{Cc}]+/gu, '').trim() || 'Liste'}.${CATEGORY_LIST_EXTENSION}`;
