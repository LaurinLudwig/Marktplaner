import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserError } from './errors';
import { checkJpeg, checkPng } from './imageCheck';

const fx = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', name)));

describe('Bildprüfung vor dem Import (QA-M2-02)', () => {
  it('vollständige Testbilder sind gültig', () => {
    expect(() => checkPng(fx('raster-10m.png'))).not.toThrow();
    expect(() => checkJpeg(fx('raster-10m.jpg'))).not.toThrow();
  });

  it('abgeschnittene Bilder werden mit deutscher Meldung abgewiesen', () => {
    const png = fx('raster-10m.png');
    const jpg = fx('raster-10m.jpg');
    for (const cut of [20, 3000, png.length - 1, png.length - 12]) {
      expect(() => checkPng(png.subarray(0, cut))).toThrow(UserError);
      expect(() => checkPng(png.subarray(0, cut))).toThrow(/unvollständig|kein gültiges/);
    }
    for (const cut of [10, 3000, jpg.length - 1]) expect(() => checkJpeg(jpg.subarray(0, cut))).toThrow(/unvollständig|kein gültiges/);
  });

  it('falsche Signaturen werden erkannt', () => {
    expect(() => checkPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow('kein gültiges PNG');
    expect(() => checkJpeg(new Uint8Array([0, 0, 0, 0]))).toThrow('kein gültiges JPEG');
  });

  it('Daten nach dem JPEG-Endmarker sind erlaubt (z. B. angehängte Vorschau)', () => {
    const jpg = fx('raster-10m.jpg');
    const extra = new Uint8Array(jpg.length + 5);
    extra.set(jpg);
    expect(() => checkJpeg(extra)).not.toThrow();
  });
});
