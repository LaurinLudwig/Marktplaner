import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Tauri erwartet einen festen Port und darf Rust-Fehler nicht verdecken.
export default defineConfig({
  plugins: [react()],
  // Version für den Vermerk in Exporten (src/core/appInfo.ts, #5)
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022', sourcemap: true },
  // Lasttests (*.perf.test.ts) laufen getrennt und seriell: npm run test:perf (vitest.perf.config.ts)
  test: { include: ['src/**/*.test.ts'], exclude: [...configDefaults.exclude, 'src/**/*.perf.test.ts'], environment: 'node' },
});
