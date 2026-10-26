import { contentHash, detectFileType } from '../core/assets';
import { initialTransform, transformForReplacement } from '../core/background';
import type { Background } from '../core/model/types';
import { screenToWorld } from '../core/viewport';
import { platform } from '../platform';
import { setBackground } from '../state/pageSettings';
import { START_PAGE, useStore } from '../state/store';
import { UserError, userMessage } from '../core/errors';
import { imageSize, openPdf, pageSize, pdfErrorMessage, renderPdfRegion } from '../ui/canvas/background/renderer';
import { confirm, showError } from './dialogs';
import { notify } from './notify';
import { pickPdfPage } from './pagePicker';
import { currentView } from './view';

export const BACKGROUND_EXTENSIONS = ['pdf', 'svg', 'png', 'jpg', 'jpeg'];
const WARN_BYTES = 50 * 1024 * 1024;
const MAX_BYTES = 300 * 1024 * 1024;

const IMPORT_FAILED = 'Die Datei konnte nicht als Plan gelesen werden.';
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

/** Löst Seite `page` (1-basiert) als eigenes PDF heraus; nur diese Seite wird eingebettet. */
async function extractPdfPage(bytes: Uint8Array, page: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (src.isEncrypted) throw new UserError('Das PDF ist verschlüsselt. Bitte eine Fassung ohne Kennwortschutz exportieren.');
    // Ohne Erstell-/Änderungsdatum, damit dieselbe Seite immer dieselben Bytes ergibt
    const out = await PDFDocument.create({ updateMetadata: false });
    const [copied] = await out.copyPages(src, [page - 1]);
    out.addPage(copied!);
    return await out.save();
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.warn('Seite nicht extrahierbar', e);
    throw new UserError('Die gewählte Seite kann nicht aus dem PDF herausgelöst werden.');
  }
}

interface Prepared {
  bytes: Uint8Array;
  /** Grundlage der Asset-ID: bei herausgelösten PDF-Seiten Originaldatei + Seite (QA-M2-04). */
  identity: { bytes: Uint8Array; suffix: string };
  kind: Background['kind'];
  ext: string;
  size: { w: number; h: number };
  pdfPage?: number;
  pdfPageCount?: number;
}

async function prepare(bytes: Uint8Array, fileName: string): Promise<Prepared | null> {
  const type = detectFileType(bytes, fileName);
  if (!type) throw new UserError('Dieses Dateiformat wird nicht unterstützt. Möglich sind PDF, SVG, PNG und JPEG.');
  if (type.kind !== 'pdf') return { bytes, identity: { bytes, suffix: '' }, kind: type.kind, ext: type.ext, size: await imageSize(bytes, type.mime) };

  const doc = await openPdf(bytes);
  try {
    const count = doc.numPages;
    let page = 1;
    if (count > 1) {
      const chosen = await pickPdfPage({
        fileName,
        pageCount: count,
        thumbnail: async (n) => {
          const p = await doc.getPage(n);
          const size = pageSize(p);
          const img = await renderPdfRegion(p, { minX: 0, minY: 0, maxX: size.w, maxY: size.h }, Math.min(200 / size.w, 200 / size.h));
          return img!.url;
        },
      });
      if (chosen === null) return null;
      page = chosen;
    }
    const size = pageSize(await doc.getPage(page).catch((e: unknown) => Promise.reject(pdfErrorMessage(e))));
    // Einseitige PDFs unverändert einbetten; bei mehrseitigen nur die gewählte Seite.
    const embedded = count > 1 ? await extractPdfPage(bytes, page) : bytes;
    return {
      bytes: embedded,
      identity: count > 1 ? { bytes, suffix: `-s${page}` } : { bytes, suffix: '' },
      kind: 'pdf',
      ext: 'pdf',
      size,
      pdfPage: page,
      pdfPageCount: count,
    };
  } finally {
    void doc.loadingTask.destroy();
  }
}

/**
 * Hintergrund für die aktive Festplatz-Page importieren oder ersetzen.
 * Ersetzen behält Position, Drehung, Breite in Metern, Deckkraft und Sperre; die gezeichneten
 * Objekte bleiben ohnehin unverändert (sie sind in Metern gespeichert).
 */
export async function importBackground(): Promise<void> {
  const s = useStore.getState();
  const pageId = s.ui.activePage;
  if (pageId === START_PAGE) return;

  let picked;
  try {
    picked = await platform.pickFile({ name: 'Plan (PDF, SVG, PNG, JPEG)', extensions: BACKGROUND_EXTENSIONS });
  } catch (e) {
    console.warn('Dateiauswahl fehlgeschlagen', e);
    await showError('Datei kann nicht geöffnet werden', userMessage(e, 'Die Datei konnte nicht gelesen werden.'));
    return;
  }
  if (!picked) return;
  if (picked.bytes.length > MAX_BYTES) {
    await showError('Datei zu groß', `${picked.name} ist ${mb(picked.bytes.length)} groß. Möglich sind höchstens ${mb(MAX_BYTES)}.`);
    return;
  }
  if (picked.bytes.length > WARN_BYTES) {
    const ok = await confirm(
      'Große Datei',
      `${picked.name} ist ${mb(picked.bytes.length)} groß und wird in die Projektdatei eingebettet. Die Projektdatei wird entsprechend größer, Speichern und Autosave dauern länger. Trotzdem importieren?`,
      'Importieren',
    );
    if (!ok) return;
  }

  const done = notify('Plan wird geladen …', 'busy');
  let prepared: Prepared | null;
  try {
    prepared = await prepare(picked.bytes, picked.name);
  } catch (e) {
    done();
    if (!(e instanceof UserError)) console.warn('Import fehlgeschlagen', e);
    await showError('Plan kann nicht importiert werden', userMessage(e, IMPORT_FAILED));
    return;
  }
  done();
  if (!prepared) return;

  // Gleiche Datei (bzw. gleiche Seite derselben PDF) ⇒ gleiche ID ⇒ nur einmal eingebettet
  const assetId = `${await contentHash(prepared.identity.bytes)}${prepared.identity.suffix}.${prepared.ext}`;
  useStore.getState().addAsset(assetId, prepared.bytes);

  const page = useStore.getState().project.pages.find((p) => p.id === pageId);
  if (!page) return;
  const old = page.background;
  const { w: vw, h: vh } = useStore.getState().ui.viewport;
  const view = currentView();
  let transform: Background['transform'];
  if (old) {
    transform = transformForReplacement(old.transform, old.pxSize, prepared.size);
  } else {
    // Mittig in die aktuelle Ansicht, etwa 80 % der sichtbaren Breite; danach kalibrieren
    const center = view ? screenToWorld(view, { x: vw / 2, y: vh / 2 }) : { x: 0, y: 0 };
    const worldWidth = view && vw > 0 ? (vw / view.scale) * 0.8 : 100;
    transform = initialTransform(prepared.size, center, worldWidth);
  }
  const background: Background = {
    assetId,
    kind: prepared.kind,
    fileName: picked.name,
    ...(prepared.pdfPage !== undefined ? { pdfPage: prepared.pdfPage, pdfPageCount: prepared.pdfPageCount! } : {}),
    pxSize: prepared.size,
    transform,
    opacity: old?.opacity ?? 1,
    locked: old?.locked ?? false,
  };
  setBackground(pageId, background, old ? 'Hintergrund ersetzen' : 'Hintergrund importieren');
  notify(old ? 'Hintergrund ersetzt. Bitte die Kalibrierung prüfen (K).' : 'Hintergrund importiert. Jetzt kalibrieren (K).', 'success', 6000);
}

/** Vorhandenen Plan einer Page entfernen (rückgängig machbar). */
export function removeBackground(pageId: string) {
  setBackground(pageId, null, 'Hintergrund entfernen');
}


