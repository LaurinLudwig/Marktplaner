/**
 * Symbole der Infrastruktur-Typen (M7, spec.md §11) für die Oberfläche. Pfaddaten: infraIconPaths.ts.
 */
import type { InfraIcon } from '../../core/infra';
import { iconPath } from './infraIconPaths';

export { iconPath, INFRA_ICON_PATH } from './infraIconPaths';

/** Deutsche Namen für die Symbol-Auswahl. */
export const INFRA_ICON_LABEL: Record<InfraIcon, string> = {
  fence: 'Zaun',
  block: 'Sperre',
  medical_services: 'Sanitätskoffer',
  ambulance: 'Rettungswagen',
  wc: 'WC',
  delete: 'Mülleimer',
  arrow_range: 'Breite',
  location_on: 'Ort',
  local_hospital: 'Kreuz',
  health_and_safety: 'Schutz',
  emergency: 'Notfall',
  fire_truck: 'Feuerwehr',
  local_fire_department: 'Feuer',
  warning: 'Achtung',
  traffic: 'Ampel',
  road: 'Straße',
  gate: 'Tor',
  door_sliding: 'Eingang',
  signpost: 'Wegweiser',
  stadium: 'Bühne',
  mic: 'Mikrofon',
  theater_comedy: 'Theater',
  celebration: 'Fest',
  storefront: 'Stand',
  info: 'Info',
  campaign: 'Durchsage',
  family_restroom: 'Familie',
  chair: 'Sitzplatz',
  water_drop: 'Wasser',
  bolt: 'Strom',
  electrical_services: 'Stromanschluss',
  recycling: 'Recycling',
  flag: 'Fahne',
};

/** Symbol eines Infrastruktur-Typs für Knöpfe und Listen (Farbe über `currentColor` oder `color`). */
export function InfraIconView({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 -960 960 960" fill={color ?? 'currentColor'} aria-hidden="true">
      <path d={iconPath(name)} />
    </svg>
  );
}
