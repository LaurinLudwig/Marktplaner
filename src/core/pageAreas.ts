/**
 * Festplatz ohne Grundflächen (#17, spec.md §2): Schalter „Grundflächen verwenden“ je Page (`useAreas`, Standard an).
 * Ist er aus, bleiben vorhandene Grundflächen gespeichert, sind aber ausgeblendet und wirken nicht: keine Warnung
 * „außerhalb“, keine Freiflächen, kein Fang an der Vorderseite, nicht auswählbar, nicht in Legende und PDF.
 * Alle Berechnungen holen die Grundflächen einer Page deshalb über diese Funktionen.
 */
import type { Area, FestplatzPage } from './model/types';

/** Gemeinsame leere Liste: gleiche Identität, damit Zwischenspeicher (Freiflächen, Beschriftung) treffen. */
export const NO_AREAS: readonly Area[] = Object.freeze([]);

/** Page mit Grundflächen; `useAreas` fehlt nur bei Teilobjekten aus Tests und gilt dann als an. */
export type AreasOf = Pick<FestplatzPage, 'areas'> & { useAreas?: boolean };

/** Verwendet die Page Grundflächen? */
export const usesAreas = (page: AreasOf) => page.useAreas !== false;

/** Grundflächen, die auf der Page wirken: ohne „Grundflächen verwenden“ keine (die gespeicherten bleiben unberührt). */
export const activeAreas = (page: AreasOf): readonly Area[] => (usesAreas(page) ? page.areas : NO_AREAS);

/**
 * Bezug der Warnung „außerhalb“ (`isOutside`, `cachedPageWarnings`): die Grundflächen der Page oder `null` für eine
 * Page ohne Grundflächen, auf der kein Stand außerhalb ist.
 */
export const outsideRef = (page: AreasOf): readonly Area[] | null => (usesAreas(page) ? page.areas : null);

/** Grundflächen, an deren Vorderseite ein Stand einrastet (§3): nur wirkende auf sichtbarer Ebene. */
export const frontSnapAreas = (page: AreasOf & Pick<FestplatzPage, 'layers'>): readonly Area[] => (page.layers.areas.visible ? activeAreas(page) : NO_AREAS);
