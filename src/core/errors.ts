/**
 * Fehler mit einer Meldung, die bereits auf Deutsch für den Nutzer formuliert ist.
 * Alle anderen Fehler (Bibliotheken, Browser, Dateisystem) werden nie direkt angezeigt, sondern
 * durch eine feste deutsche Meldung ersetzt (QA-M2-02).
 */
export class UserError extends Error {
  override name = 'UserError';
}

export function userMessage(e: unknown, fallback: string): string {
  return e instanceof UserError ? e.message : fallback;
}
