import { defineConfig } from '@playwright/test';
import base, { PERF_TESTS } from './playwright.config';

/**
 * Lasttests (Bildrate mit 500 Ständen, M3-23): nur `*perf.spec.ts`, seriell mit einem Worker, damit
 * keine parallel laufenden Browser die Messung verfälschen. Aufruf: `npm run test:perf`.
 *
 * Immer ein eigener Dev-Server (QA-M5-04): Läuft auf Port 1420 schon einer (andere Tests, `npm run dev`),
 * bricht der Lauf sofort mit „Port belegt“ ab, statt ihn mitzubenutzen und mitten im Lauf die Verbindung
 * zu verlieren. Ein fremder Server bedeutet meist auch parallel laufende Tests, die die Bildrate verfälschen.
 */
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: PERF_TESTS,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  webServer: base.webServer && !Array.isArray(base.webServer) ? { ...base.webServer, reuseExistingServer: false } : base.webServer,
});
