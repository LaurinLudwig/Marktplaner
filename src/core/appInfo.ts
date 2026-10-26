/**
 * Programm, Version und Urheber für den Vermerk in Exporten (#5, spec.md §9) und die PDF-Metadaten. Die Version kommt
 * aus package.json (Vite `define`); außerhalb von Vite (z. B. Playwright lädt Module direkt) gilt ein Platzhalter.
 */
export const APP_NAME = 'Marktplaner';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const APP_AUTHOR = 'Laurin Ludwig';
export const APP_URL = 'https://github.com/LaurinLudwig';

/** „Marktplaner, Version 0.1.0, Laurin Ludwig, https://github.com/LaurinLudwig“ */
export const exportNote = (): string => `${APP_NAME}, Version ${APP_VERSION}, ${APP_AUTHOR}, ${APP_URL}`;
