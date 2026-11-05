import { beforeEach, describe, expect, it } from 'vitest';
import { createPage, createProject } from '../core/model/defaults';
import type { Project, Stand } from '../core/model/types';
import { createStand } from '../core/objects';
import { setAllNrLocked } from '../state/numbering';
import { START_PAGE, useStore } from '../state/store';
import { useToasts } from './notify';
import { nrLockCount, setAllNrLocks } from './nrLock';

/** #14: „Alle Fixierungen lösen“ / „Alle Nummern fixieren“ (spec.md §5): Store, Undo und Hinweis mit Rückgängig. */

const stand = (id: string, nr: string, nrLocked: boolean): Stand => ({ ...createStand({ cx: 0, cy: 0, w: 2, d: 2, rot: 0 }), id, nr, nrLocked });

function load(scope: 'perPage' | 'global') {
  const p: Project = createProject('T');
  const a = { ...createPage('A'), id: 'A', stands: [stand('a1', '1', true), stand('a2', '2', false), stand('a3', '', true), stand('a4', '', false)] };
  const b = { ...createPage('B'), id: 'B', numberingMode: 'manual' as const, stands: [stand('b1', '7', true), stand('b2', '8', false)] };
  p.pages = [a, b];
  p.settings.numbering.scope = scope;
  useStore.getState().loadBundle({ project: p, assets: {} }, { path: null, name: null });
  useToasts.setState({ toasts: [] });
}

const s = () => useStore.getState();
/** Stand-ID → [Nummer, fixiert] über alle Pages. */
const snapshot = () => Object.fromEntries(s().project.pages.flatMap((p) => p.stands.map((x) => [x.id, [x.nr, x.nrLocked]])));
const locked = () => s().project.pages.flatMap((p) => p.stands.filter((x) => x.nrLocked).map((x) => x.id));
const toasts = () => useToasts.getState().toasts;

beforeEach(() => load('perPage'));

describe('#14 setAllNrLocked (Store)', () => {
  it('pro Festplatz: löst nur die Fixierungen der Page, ein Undo-Schritt, Nummern bleiben', () => {
    const before = snapshot();
    expect(setAllNrLocked('A', false)).toBe(2);
    expect(locked()).toEqual(['b1']);
    expect(s().history.past.length).toBe(1);
    expect(s().history.past.at(-1)!.label).toBe('Alle Fixierungen lösen');
    const nrs = (x: Record<string, unknown[]>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v[0]]));
    expect(nrs(snapshot())).toEqual(nrs(before));
    s().undo();
    expect(snapshot()).toEqual(before);
  });

  it('gilt auch auf einer Page im Modus „manuell“', () => {
    expect(setAllNrLocked('B', true)).toBe(1);
    expect(locked()).toEqual(['a1', 'a3', 'b1', 'b2']);
    expect(s().history.past.at(-1)!.label).toBe('Alle Nummern fixieren');
  });

  it('global: alle Pages; fixieren lässt Stände ohne Nummer aus', () => {
    load('global');
    expect(setAllNrLocked('A', true)).toBe(2);
    expect(locked()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    expect(setAllNrLocked('A', false)).toBe(5);
    expect(locked()).toEqual([]);
    expect(s().history.past.length).toBe(2);
  });

  it('ohne Page (Start-Page): alle Pages auch bei „pro Festplatz“', () => {
    expect(setAllNrLocked(null, false)).toBe(3);
    expect(locked()).toEqual([]);
  });

  it('nichts zu tun: kein Undo-Schritt', () => {
    setAllNrLocked(null, false);
    const n = s().history.past.length;
    expect(setAllNrLocked(null, false)).toBe(0);
    expect(s().history.past.length).toBe(n);
  });
});

describe('#14 setAllNrLocks (Befehl mit Hinweis)', () => {
  it('Ziel richtet sich nach der aktiven Page; auf der Start-Page alle Pages', () => {
    s().setUi({ activePage: 'A' });
    expect(nrLockCount(false)).toBe(2);
    s().setUi({ activePage: START_PAGE });
    expect(nrLockCount(false)).toBe(3);
    expect(nrLockCount(true)).toBe(2);
  });

  it('Hinweis „n Fixierungen gelöst“; „Rückgängig“ nimmt genau diesen Schritt zurück', () => {
    s().setUi({ activePage: START_PAGE });
    const before = snapshot();
    setAllNrLocks(false);
    expect(toasts().map((t) => t.text)).toEqual(['3 Fixierungen gelöst']);
    const action = toasts()[0]!.action!;
    expect(action.label).toBe('Rückgängig');
    action.run();
    expect(snapshot()).toEqual(before);
    expect(s().history.past.length).toBe(0);
  });

  it('Einzahl und „Nummern fixiert“', () => {
    s().setUi({ activePage: 'B' });
    setAllNrLocks(true);
    setAllNrLocks(false);
    expect(toasts().map((t) => t.text)).toEqual(['1 Nummer fixiert', '2 Fixierungen gelöst']);
    s().undo();
    s().undo();
    setAllNrLocks(false);
    expect(toasts().at(-1)!.text).toBe('1 Fixierung gelöst');
  });

  it('„Rückgängig“ nach einer weiteren Änderung nimmt nichts zurück, sondern sagt es', () => {
    s().setUi({ activePage: 'A' });
    setAllNrLocks(false);
    const action = toasts()[0]!.action!;
    setAllNrLocks(true);
    const after = snapshot();
    action.run();
    expect(snapshot()).toEqual(after);
    expect(toasts().at(-1)!.text).toMatch(/^Rückgängig hier nicht mehr möglich/);
  });

  it('nichts zu tun: Hinweis ohne Rückgängig und ohne Undo-Schritt', () => {
    s().setUi({ activePage: START_PAGE });
    setAllNrLocks(false);
    useToasts.setState({ toasts: [] });
    setAllNrLocks(false);
    expect(toasts().map((t) => [t.text, !!t.action])).toEqual([['Es gibt keine fixierten Nummern.', false]]);
    expect(s().history.past.length).toBe(1);
  });
});
