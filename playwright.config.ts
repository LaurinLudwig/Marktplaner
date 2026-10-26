import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests gegen das Frontend im Browser-Modus (Vite-Dev-Server, ohne Tauri).
 * Chromium entspricht WebView2 (Windows), WebKit entspricht WKWebView (macOS).
 * Lasttests (`*perf.spec.ts`) laufen nicht hier, sondern seriell über `npm run test:perf`
 * (playwright.perf.config.ts): Parallel laufende Browser verfälschen die Bildrate (QA-M3-L1).
 */
export const PERF_TESTS = '**/*perf.spec.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: PERF_TESTS,
  outputDir: 'test-results',
  fullyParallel: true,
  // QA-M8-02: lokal höchstens 4 Browser gleichzeitig (WebKit davon höchstens 2, siehe Projekt). Mehr Last lässt
  // WebKit beim Ziehen Bilder auslassen; die Gesten-Tests (Fang, Vorschau) werden dann unzuverlässig. CI: Standard.
  workers: process.env.CI ? undefined : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // QA-M8-02: Mehr als zwei parallele WebKit-Instanzen mit großen Rasterbildern (M8) erschöpfen auf einem Mac den
    // Speicher, der Dev-Server bricht ab. WebKit ist für die Mac-App maßgeblich und muss lokal zuverlässig laufen.
    { name: 'webkit', workers: 2, use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
