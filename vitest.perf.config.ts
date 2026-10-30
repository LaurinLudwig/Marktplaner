import { defineConfig } from 'vitest/config';

/**
 * Lasttests der reinen Logik (`src/**\/*.perf.test.ts`): nacheinander in einem Worker, damit keine parallel laufenden
 * Tests die Messung verfälschen. Aufruf: `npm run test:perf` (danach die Playwright-Lasttests).
 */
export default defineConfig({
  test: { include: ['src/**/*.perf.test.ts'], environment: 'node', fileParallelism: false },
});
