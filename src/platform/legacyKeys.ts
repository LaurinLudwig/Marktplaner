/**
 * Schlüssel im localStorage tragen den App-Namen als Präfix. Seit der Umbenennung in Marktplaner (#10) heißt er
 * `marktplaner.`; Werte unter dem alten Präfix `schelmeplaner.` werden einmalig übernommen, wenn es den neuen
 * Schlüssel noch nicht gibt. Die alten Einträge bleiben stehen.
 *
 * Läuft beim Laden dieses Moduls, also vor allen Modulen, die beim Start Einstellungen lesen (sie importieren
 * `APP_KEY_PREFIX` von hier). In der Desktop-App liegt der alte localStorage nach dem Datenumzug (Rust,
 * `legacy_data.rs`) bereits im neuen Webview-Ordner.
 */
export const APP_KEY_PREFIX = 'marktplaner.';
const LEGACY_PREFIX = 'schelmeplaner.';

export function adoptLegacyKeys(storage: Storage): number {
  let adopted = 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(LEGACY_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    const target = APP_KEY_PREFIX + k.slice(LEGACY_PREFIX.length);
    const value = storage.getItem(k);
    if (value === null || storage.getItem(target) !== null) continue;
    storage.setItem(target, value);
    adopted++;
  }
  return adopted;
}

try {
  if (typeof localStorage !== 'undefined') adoptLegacyKeys(localStorage);
} catch {
  /* localStorage gesperrt (z. B. privater Modus): dann gibt es nichts zu übernehmen */
}
