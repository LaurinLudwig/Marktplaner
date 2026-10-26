import { newId } from '../id';
import type { FestplatzPage } from './types';

/** „Festplatz n“ mit der kleinsten Zahl n ≥ Anzahl+1, die noch nicht vergeben ist. */
export function nextPageName(pages: readonly FestplatzPage[]): string {
  const names = new Set(pages.map((p) => p.name));
  let n = pages.length + 1;
  while (names.has(`Festplatz ${n}`)) n++;
  return `Festplatz ${n}`;
}

/** „Name (Kopie)“, bei Bedarf „Name (Kopie 2)“ usw. */
export function copyName(name: string, pages: readonly FestplatzPage[]): string {
  const names = new Set(pages.map((p) => p.name));
  const base = name.replace(/ \(Kopie(?: \d+)?\)$/, '');
  let candidate = `${base} (Kopie)`;
  for (let i = 2; names.has(candidate); i++) candidate = `${base} (Kopie ${i})`;
  return candidate;
}

/** Tiefe Kopie einer Page mit neuen IDs für die Page und alle Objekte darauf. */
/** Ersetzt die Objekt-IDs in einem Freiflächen-Schlüssel (spec.md §4); Achsenenden bleiben. */
export function remapFreeKey(key: string, ids: ReadonlyMap<string, string>): string {
  const [base = '', part] = key.split('#');
  const mapped = base
    .split('|')
    .map((x) => ids.get(x) ?? x)
    .join('|');
  return part !== undefined ? `${mapped}#${part}` : mapped;
}

export function clonePage(page: FestplatzPage, name: string): FestplatzPage {
  const copy = structuredClone(page);
  copy.id = newId();
  copy.name = name;
  const ids = new Map<string, string>();
  for (const list of [copy.areas, copy.stands, copy.infra])
    for (const o of list) {
      const id = newId();
      ids.set(o.id, id);
      o.id = id;
    }
  // Ausgeblendete Freiflächen (#8) behalten: Schlüssel `areaId|links|rechts[#k]` auf die neuen IDs umschreiben
  copy.hiddenFree = copy.hiddenFree.map((h) => ({ ...h, key: remapFreeKey(h.key, ids) }));
  return copy;
}
