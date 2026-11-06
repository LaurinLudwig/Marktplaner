import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../core/model/defaults';
import type { FestplatzPage } from '../core/model/types';
import { createStand } from '../core/objects';
import { setDirectionPoint, setNumberingDirection, setNumberingMode, toolFitsMode } from './numbering';
import { useStore } from './store';

/** #12: Nummerierung in weiteren Richtungen – Einstellungen der Page im Store (Undo-Schritte, Vorgaben, Rundung). */

const pg = (): FestplatzPage => useStore.getState().project.pages[0]!;
const past = () => useStore.getState().history.past.length;

beforeEach(() => {
  const project = createProject('T');
  // zwei Stände 2 × 2 m: Hülle x −1 … 21, y −1 … 11 → Vorgabe waagrecht bei y = 5
  project.pages[0]!.stands.push(createStand({ cx: 0, cy: 0, w: 2, d: 2, rot: 0 }), createStand({ cx: 20, cy: 10, w: 2, d: 2, rot: 0 }));
  useStore.getState().loadBundle({ project, assets: {} }, { path: null, name: null });
});

describe('#12 Nummerierungsmodus und eigene Richtung im Store', () => {
  it('erstes Umschalten auf „eigene Richtung“ belegt A und B vor (ein Undo-Schritt); später bleibt die Richtung erhalten', () => {
    setNumberingMode(pg().id, 'direction');
    expect(pg()).toMatchObject({ numberingMode: 'direction', direction: { from: { x: -1, y: 5 }, to: { x: 21, y: 5 } } });
    expect(past()).toBe(1);
    setNumberingDirection(pg().id, { from: { x: 3, y: 3 }, to: { x: 3, y: -7 } });
    setNumberingMode(pg().id, 'topToBottom');
    setNumberingMode(pg().id, 'direction');
    expect(pg().direction).toEqual({ from: { x: 3, y: 3 }, to: { x: 3, y: -7 } });
    // Undo nimmt Moduswechsel und Vorbelegung zusammen zurück
    const s = useStore.getState();
    for (let i = 0; i < 4; i++) s.undo();
    expect(pg().numberingMode).toBe('frontLtr');
    expect(pg().direction).toBeUndefined();
  });

  it('erstes Umschalten auf „gegen den Uhrzeigersinn“ belegt den Mittelpunkt vor wie „Uhrzeigersinn“', () => {
    setNumberingMode(pg().id, 'counterClockwise');
    expect(pg()).toMatchObject({ numberingMode: 'counterClockwise', clockwise: { center: { x: 10, y: 5 }, startAngle: 0 } });
  });

  it('Richtung setzen: beide Punkte auf 0,01 m gerundet in einem Undo-Schritt', () => {
    setNumberingDirection(pg().id, { from: { x: 1.234, y: -0.006 }, to: { x: 9.996, y: 4.444 } });
    expect(pg().direction).toEqual({ from: { x: 1.23, y: -0.01 }, to: { x: 10, y: 4.44 } });
    expect(useStore.getState().history.past.at(-1)?.label).toBe('Richtung setzen');
    useStore.getState().undo();
    expect(pg().direction).toBeUndefined();
  });

  it('Felder A/B ändern nur die eine Koordinate; ohne gesetzte Richtung gilt die Vorgabe als Ausgang', () => {
    setDirectionPoint(pg().id, 'to', { y: 8.126 });
    expect(pg().direction).toEqual({ from: { x: -1, y: 5 }, to: { x: 21, y: 8.13 } });
    setDirectionPoint(pg().id, 'from', { x: 2 });
    expect(pg().direction).toEqual({ from: { x: 2, y: 5 }, to: { x: 21, y: 8.13 } });
    expect(past()).toBe(2);
  });

  it('Ziehen von A: viele Zwischenschritte in einer Transaktion ergeben einen Undo-Schritt; Abbrechen stellt alles wieder her', () => {
    setNumberingDirection(pg().id, { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    const s = useStore.getState();
    const before = past();
    s.beginTransaction('Richtung verschieben');
    for (let i = 1; i <= 5; i++) setDirectionPoint(pg().id, 'from', { x: i, y: i / 3 }, 'Richtung verschieben');
    useStore.getState().commitTransaction();
    expect(pg().direction).toEqual({ from: { x: 5, y: 1.67 }, to: { x: 10, y: 0 } });
    expect(past()).toBe(before + 1);
    useStore.getState().undo();
    expect(pg().direction).toEqual({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    useStore.getState().redo();
    expect(pg().direction!.from).toEqual({ x: 5, y: 1.67 });

    useStore.getState().beginTransaction('Richtung verschieben');
    setDirectionPoint(pg().id, 'to', { x: 30, y: 30 }, 'Richtung verschieben');
    useStore.getState().abortTransaction();
    expect(pg().direction).toEqual({ from: { x: 5, y: 1.67 }, to: { x: 10, y: 0 } });
    expect(past()).toBe(before + 1);
  });
});

describe('#12 Werkzeuge beim Wechsel des Nummerierungsmodus', () => {
  const tool = () => useStore.getState().ui.tool;

  it('„Richtung setzen“ endet, sobald die Page den Modus „eigene Richtung“ verlässt', () => {
    setNumberingMode(pg().id, 'direction');
    useStore.getState().setUi({ tool: 'numberDirection' });
    // erneut „eigene Richtung“ lässt das Werkzeug aktiv
    setNumberingMode(pg().id, 'direction');
    expect(tool()).toBe('numberDirection');
    setNumberingMode(pg().id, 'topToBottom');
    expect(tool()).toBe('select');
  });

  it('„Mittelpunkt setzen“ bleibt beim Wechsel des Drehsinns, endet beim Verlassen des Kreises; andere Werkzeuge bleiben', () => {
    setNumberingMode(pg().id, 'clockwise');
    useStore.getState().setUi({ tool: 'numberCenter' });
    setNumberingMode(pg().id, 'counterClockwise');
    expect(tool()).toBe('numberCenter');
    setNumberingMode(pg().id, 'manual');
    expect(tool()).toBe('select');
    useStore.getState().setUi({ tool: 'measure' });
    setNumberingMode(pg().id, 'direction');
    expect(tool()).toBe('measure');
  });

  it('toolFitsMode: welches Werkzeug zu welchem Modus passt (auch für die Prüfung der Zeichenfläche nach Undo)', () => {
    expect(toolFitsMode('numberDirection', 'direction')).toBe(true);
    for (const m of ['frontLtr', 'rightToLeft', 'topToBottom', 'bottomToTop', 'clockwise', 'counterClockwise', 'manual'] as const) expect(toolFitsMode('numberDirection', m)).toBe(false);
    expect([toolFitsMode('numberCenter', 'clockwise'), toolFitsMode('numberCenter', 'counterClockwise'), toolFitsMode('numberCenter', 'direction')]).toEqual([true, true, false]);
    expect(toolFitsMode('select', 'manual')).toBe(true);
  });
});
