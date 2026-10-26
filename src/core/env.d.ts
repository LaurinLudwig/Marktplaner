/**
 * Ausdrücklich erlaubte, plattformneutrale Laufzeitfunktionen für src/core/ (gibt es im Browser,
 * in Node und in Web-Workern). Die Typprüfung von src/core/ läuft OHNE DOM-Bibliothek
 * (`tsc -p src/core`, Teil von `npm run typecheck`); alles, was hier nicht steht, ist ein Fehler.
 */
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare const crypto: {
  subtle: { digest(algorithm: 'SHA-256', data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer> };
};
declare function structuredClone<T>(value: T): T;
