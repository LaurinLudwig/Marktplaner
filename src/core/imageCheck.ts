/**
 * Strukturprüfung von PNG und JPEG vor der Übernahme (QA-M2-02): Abgeschnittene Dateien werden
 * abgewiesen, statt still als Teilbild importiert zu werden (WebKit) oder mit englischer
 * Browsermeldung zu scheitern (Chromium).
 */
import { UserError } from './errors';

const TRUNCATED = 'Die Bilddatei ist beschädigt oder unvollständig (z. B. abgebrochener Download).';

const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;

/** PNG: Signatur, IHDR am Anfang, alle Chunks vollständig, mindestens ein IDAT, IEND erreicht. */
export function checkPng(b: Uint8Array): void {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) throw new UserError('Die Datei ist kein gültiges PNG-Bild.');
  let i = 8;
  let first = true;
  let idat = false;
  while (i + 8 <= b.length) {
    const len = u32(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) throw new UserError(TRUNCATED);
    if (first && type !== 'IHDR') throw new UserError('Die Datei ist kein gültiges PNG-Bild.');
    first = false;
    if (type === 'IDAT') idat = true;
    if (type === 'IEND') {
      if (!idat) throw new UserError(TRUNCATED);
      return;
    }
    i = end;
  }
  throw new UserError(TRUNCATED);
}

/** JPEG: SOI, gültige Segmente bis zum Bildbeginn (SOS) und ein Endmarker (EOI) danach. */
export function checkJpeg(b: Uint8Array): void {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new UserError('Die Datei ist kein gültiges JPEG-Bild.');
  let i = 2;
  let sos = -1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new UserError(TRUNCATED);
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // Füllbyte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new UserError(TRUNCATED);
    if (marker === 0xda) {
      sos = i + 2 + len;
      break;
    }
    i += 2 + len;
  }
  if (sos < 0) throw new UserError(TRUNCATED);
  for (let j = b.length - 2; j >= sos; j--) if (b[j] === 0xff && b[j + 1] === 0xd9) return;
  throw new UserError(TRUNCATED);
}
