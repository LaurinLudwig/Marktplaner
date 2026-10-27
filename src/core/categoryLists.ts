import { newId } from './id';
import type { Category, Id } from './model/types';

/**
 * Kategorielisten (#1): fertige Zusammenstellungen von Kategorien, aus denen ein neues Projekt startet oder die in den
 * Projekteinstellungen geladen werden. Flache Listen; „Süßwaren – Waffeln“ ist nur ein Name, keine Unterkategorie.
 */
export interface CategoryListEntry {
  name: string;
  color: string;
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

/** Kategorien einer Liste mit neuen IDs (neues Projekt). */
export const categoriesFromList = (list: CategoryList): Category[] => list.entries.map((e) => ({ id: newId(), name: e.name, color: e.color }));

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
 *   und übernehmen die Farbe der Liste; alle anderen entfallen.
 */
export function applyCategoryList(current: readonly Category[], list: CategoryList, mode: ApplyMode): ApplyResult {
  const byName = new Map(current.map((c) => [key(c.name), c]));
  if (mode === 'merge') {
    const added: Category[] = [];
    for (const e of list.entries) {
      if (byName.has(key(e.name))) continue;
      const c = { id: newId(), name: e.name, color: e.color };
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
    categories.push({ id: old?.id ?? newId(), name: e.name, color: e.color });
  }
  return { categories, removed: current.filter((c) => !kept.has(c.id)).map((c) => c.id) };
}
