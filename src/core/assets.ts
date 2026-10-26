import type { Assets } from './fileFormat';
import type { BackgroundKind, Project } from './model/types';

/** IDs aller Dateien, die das Projekt tatsächlich verwendet. */
export function referencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const p of project.pages) if (p.background) ids.add(p.background.assetId);
  return ids;
}

/** Nur die verwendeten Dateien; ersetzte oder gelöschte Hintergründe landen nicht in der Projektdatei. */
export function referencedAssets(project: Project, assets: Assets): Assets {
  const ids = referencedAssetIds(project);
  return Object.fromEntries(Object.entries(assets).filter(([id]) => ids.has(id)));
}

export interface FileTypeInfo {
  kind: BackgroundKind;
  ext: 'pdf' | 'svg' | 'png' | 'jpg';
  mime: string;
}

/** Dateityp anhand der ersten Bytes, ersatzweise der Endung. null = nicht unterstützt. */
export function detectFileType(bytes: Uint8Array, fileName: string): FileTypeInfo | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { kind: 'pdf', ext: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { kind: 'image', ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  const head = new TextDecoder().decode(b.subarray(0, 2048)).toLowerCase();
  if (head.includes('<svg') || fileName.toLowerCase().endsWith('.svg')) return { kind: 'svg', ext: 'svg', mime: 'image/svg+xml' };
  return null;
}

export const mimeForAsset = (assetId: string): string =>
  assetId.endsWith('.pdf') ? 'application/pdf' : assetId.endsWith('.svg') ? 'image/svg+xml' : assetId.endsWith('.png') ? 'image/png' : 'image/jpeg';

/** Inhalts-Hash als Hex (SHA-256, gekürzt). Gleiche Dateien bekommen dieselbe ID und werden nur einmal gespeichert. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest).subarray(0, 12), (x) => x.toString(16).padStart(2, '0')).join('');
}
