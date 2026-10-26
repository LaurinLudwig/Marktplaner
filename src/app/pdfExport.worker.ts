/**
 * Web Worker des PDF-Exports (M8-09, spec.md §9): stellt den Inhalt zusammen (Schwärzung, Szenen, Anhang), bereitet
 * Rasterhintergründe vor und schreibt das PDF. Die Oberfläche bleibt währenddessen bedienbar; Abbrechen beendet
 * den Worker.
 */
import medium from '../assets/fonts/IBMPlexSans-Medium.woff?url';
import regular from '../assets/fonts/IBMPlexSans-Regular.woff?url';
import semibold from '../assets/fonts/IBMPlexSans-SemiBold.woff?url';
import { userMessage } from '../core/errors';
import { rasterQuality, type ExportDpi, type ExportProfile } from '../core/exportProfiles';
import type { Project } from '../core/model/types';
import { buildExport, type ExportRequest } from '../core/pdf/exportDoc';
import { writePdf, type PdfFonts, type PreparedBackground } from '../core/pdf/writePdf';
import { iconPath } from '../ui/icons/infraIconPaths';
import { engineJpegQuality, offscreenCanvasFor, prepareBackground } from './pdfBackground';

export interface ExportJob {
  id: number;
  project: Project;
  profile: ExportProfile;
  req: ExportRequest;
  /** Eingebettete Dateien der Hintergründe (nur die benötigten). */
  assets: Record<string, Uint8Array>;
  /** Auf dem Hauptthread vorbereitete Hintergründe (SVG), je Page-ID. */
  prepared: Record<string, PreparedBackground | null>;
  dpi: ExportDpi | number;
}

export type ExportMessage =
  | { type: 'progress'; id: number; share: number; label: string }
  | { type: 'done'; id: number; bytes: Uint8Array; pages: number }
  | { type: 'error'; id: number; message: string };

let fonts: Promise<PdfFonts> | null = null;
const load = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const loadFonts = () => (fonts ??= Promise.all([load(regular), load(medium), load(semibold)]).then(([r, m, s]) => ({ regular: r, medium: m, semibold: s })));

const post = (m: ExportMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.addEventListener('message', async (e: MessageEvent<ExportJob>) => {
  const job = e.data;
  try {
    const content = buildExport(job.project, job.profile, job.req);
    const jpegQuality = await engineJpegQuality(rasterQuality(job.dpi).jpeg);
    const withBg = content.scenes.filter((s) => s.background).length;
    let prepDone = 0;
    // Anteile: Hintergründe 40 %, Pages und Anhang 55 %, Speichern 5 %
    const pages = [];
    for (const scene of content.scenes) {
      const bg = scene.background;
      let background: PreparedBackground | null = null;
      if (bg) {
        post({ type: 'progress', id: job.id, share: (0.4 * prepDone) / Math.max(1, withBg), label: `Hintergrund ${scene.name}` });
        background =
          scene.pageId in job.prepared
            ? job.prepared[scene.pageId]!
            : bg.kind === 'svg'
              ? null
              : await prepareBackground(bg, job.assets[bg.assetId], scene.frame, job.dpi, offscreenCanvasFor, jpegQuality);
        prepDone++;
      }
      pages.push({ scene, background });
    }
    const n = content.scenes.length;
    const bytes = await writePdf({
      title: content.title,
      projectName: content.projectName,
      pages,
      appendix: content.appendix,
      fonts: await loadFonts(),
      iconPath,
      onProgress: (done, total) => {
        const label = done < n ? `Page ${done + 1} von ${n}` : done < total - 1 ? 'Anhang' : 'Speichern';
        post({ type: 'progress', id: job.id, share: 0.4 + (0.6 * done) / total, label });
      },
    });
    post({ type: 'done', id: job.id, bytes, pages: n }, [bytes.buffer]);
  } catch (err) {
    post({ type: 'error', id: job.id, message: userMessage(err, 'Das PDF konnte nicht erzeugt werden.') });
  }
});
