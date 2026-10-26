import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeProjectFile } from './fileFormat';
import { CURRENT_SCHEMA_VERSION } from './model/migrations';

/**
 * tests/fixtures/last-500-staende.schelme (erzeugt mit scripts/make-load-project.mjs) muss sich mit
 * dem echten Ladecode öffnen lassen, ohne dass Objekte verworfen oder Felder ersetzt werden.
 */
describe('Testprojekt 500 Stände', () => {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'last-500-staende.schelme')));

  it('lädt vollständig: 500 Stände auf 4 Festplätzen, alle Felder unverändert', () => {
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!)).project;
    const { project } = decodeProjectFile(bytes);
    expect(project.pages).toHaveLength(4);
    expect(project.pages.reduce((n, p) => n + p.stands.length, 0)).toBe(500);
    expect(project.categories).toEqual(raw.categories);
    project.pages.forEach((p, i) => {
      expect(p.areas).toEqual(raw.pages[i].areas);
      expect(p.stands).toEqual(raw.pages[i].stands);
    });
  });

  it('hat die aktuelle Formatversion und passt vollständig zum Modell (Laden ergänzt und verwirft nichts)', () => {
    const file = JSON.parse(strFromU8(unzipSync(bytes)['project.json']!));
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const { project } = decodeProjectFile(bytes);
    expect(JSON.parse(JSON.stringify(project))).toEqual(file.project);
  });
});
