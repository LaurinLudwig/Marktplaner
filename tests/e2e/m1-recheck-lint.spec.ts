import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * QA-M1-05 (Nachprüfung): Der Linter erzwingt „src/core/ ohne React/DOM/Tauri“.
 * Läuft ohne Browser: kopiert `.oxlintrc.json` in ein Temp-Verzeichnis, legt Probedateien an
 * und prüft die Meldungen von oxlint. Das echte `src/` wird nicht angefasst.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OXLINT = join(ROOT, 'node_modules/.bin/oxlint');

function lintProbe(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'schelme-lint-'));
  try {
    copyFileSync(join(ROOT, '.oxlintrc.json'), join(dir, '.oxlintrc.json'));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    const r = spawnSync(OXLINT, ['-c', '.oxlintrc.json', '--deny-warnings', '-f', 'unix', 'src'], { cwd: dir, encoding: 'utf8' });
    return `${r.stdout}${r.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('M1 Nachprüfung: Reinheit von src/core/ (QA-M1-05)', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Browserunabhängig; läuft nur einmal');
  });

  test('Verbotene Importe und DOM-Globals in src/core/ sind Lint-Fehler, in src/ui/ nicht', () => {
    const out = lintProbe({
      'src/core/model/probe.ts': [
        "import { useState } from 'react';",
        "import { invoke } from '@tauri-apps/api/core';",
        "import { create } from 'zustand';",
        "import { useStore } from '../../state/store';",
        "import { platform } from '../../platform';",
        "import { ok } from '../format';",
        'export const a = [useState, invoke, create, useStore, platform, ok];',
        'export const b = window.innerWidth + document.title.length;',
        "export const c = localStorage.getItem('x');",
        '',
      ].join('\n'),
      'src/ui/allowed.ts': "import { useState } from 'react';\nexport const z = [useState, window];\n",
    });
    expect(out).toContain("src/core/model/probe.ts:1:1: 'react' import is restricted");
    expect(out).toContain("'@tauri-apps/api/core' import is restricted");
    expect(out).toContain("'zustand' import is restricted");
    expect(out).toContain("'../../state/store' import is restricted");
    expect(out).toContain("'../../platform' import is restricted");
    expect(out).not.toContain("'../format'");
    expect(out).toMatch(/probe\.ts:8:\d+: Unexpected use of 'window'/);
    expect(out).toMatch(/probe\.ts:8:\d+: Unexpected use of 'document'/);
    expect(out).toMatch(/probe\.ts:9:\d+: Unexpected use of 'localStorage'/);
    expect(out).not.toContain('src/ui/allowed.ts');
  });

  test('QA-M1-10: Weitere DOM-Zugriffe in src/core/ werden ebenfalls gemeldet', () => {
    const lines = [
      'export const a = globalThis.document;',
      'export const b = new DOMParser();',
      'export const c = new Image();',
      'export const d = self.location;',
      "export const e = fetch('x');",
      'export function f(el: HTMLDivElement): void { el.focus(); }',
    ];
    const out = lintProbe({ 'src/core/probe.ts': `${lines.join('\n')}\n` });
    for (let i = 1; i <= lines.length; i++) expect(out, `Zeile ${i}: ${lines[i - 1]}`).toMatch(new RegExp(`probe\\.ts:${i}:`));
  });
});
