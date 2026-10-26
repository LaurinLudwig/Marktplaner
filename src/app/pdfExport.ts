import { create } from 'zustand';
import { exportFileName, rasterQuality, type AppendixPart, type ExportDpi, type ExportProfile } from '../core/exportProfiles';
import { userMessage } from '../core/errors';
import type { Id, Project } from '../core/model/types';
import { pagePaper } from '../core/paper';
import type { PreparedBackground } from '../core/pdf/writePdf';
import { platform } from '../platform';
import { currentProfile, useExportSettings } from '../state/exportSettings';
import { useStore } from '../state/store';
import { showError } from './dialogs';
import { notify } from './notify';
import { bitmapCanvas, engineJpegQuality, prepareBackground } from './pdfBackground';
import type { ExportJob, ExportMessage } from './pdfExport.worker';

/**
 * PDF-Export (M8-09, spec.md §9): Dialog-Zustand, Export im Web Worker mit Fortschritt und Abbrechen, Vorschau und
 * Speichern über `platform.saveFile` (Desktop: Dateidialog, Browser: Download).
 *
 * Der Export arbeitet auf dem Stand des Projekts beim Start (Immer-Objekte sind unveränderlich); weiterarbeiten
 * ist erlaubt.
 */

export interface ExportScope {
  /** null = Gesamtplan. */
  pageIds: Id[] | null;
  appendix: Record<AppendixPart, boolean>;
}

interface ExportUi {
  open: boolean;
  scope: ExportScope;
  /** Page der Vorschau. */
  previewPageId: Id | null;
  /** Laufender Export (nicht modal, unten in der Statuszeile). */
  job: { share: number; label: string } | null;
}

export const useExportUi = create<ExportUi>()(() => ({
  open: false,
  scope: { pageIds: null, appendix: { stands: true, free: true, infra: true } },
  previewPageId: null,
  job: null,
}));

export function openExportDialog() {
  const s = useStore.getState();
  if (!s.project.pages.length) {
    notify('Es gibt noch keinen Festplatz zum Exportieren.');
    return;
  }
  const active = s.project.pages.find((p) => p.id === s.ui.activePage);
  useExportUi.setState({ open: true, previewPageId: active?.id ?? s.project.pages[0]!.id });
}

export const closeExportDialog = () => useExportUi.setState({ open: false });
export const setExportScope = (patch: Partial<ExportScope>) => useExportUi.setState((s) => ({ scope: { ...s.scope, ...patch } }));
export const setPreviewPage = (id: Id) => useExportUi.setState({ previewPageId: id });

/** Pages des Exports in Tab-Reihenfolge. */
export function scopePages(project: Project, scope: ExportScope) {
  return scope.pageIds ? project.pages.filter((p) => scope.pageIds!.includes(p.id)) : project.pages;
}

// ---------- Worker ----------

let nextId = 1;

function newWorker(): Worker {
  return new Worker(new URL('./pdfExport.worker.ts', import.meta.url), { type: 'module' });
}

/** SVG-Hintergründe auf dem Hauptthread rastern (der Worker kann SVG nicht dekodieren). */
async function prepareSvg(project: Project, profile: ExportProfile, pageIds: Id[], dpi: ExportDpi | number, assets: Record<string, Uint8Array>): Promise<Record<Id, PreparedBackground | null>> {
  const out: Record<Id, PreparedBackground | null> = {};
  if (!profile.layers.background) return out;
  const jpegQuality = await engineJpegQuality(rasterQuality(dpi).jpeg);
  for (const page of project.pages) {
    const bg = page.background;
    if (!pageIds.includes(page.id) || bg?.kind !== 'svg') continue;
    const frame = pagePaper(page, project).frame;
    out[page.id] = await prepareBackground(bg, assets[bg.assetId], frame, dpi, async (bytes, mime, format, q) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return bitmapCanvas(img, format, q);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    }, jpegQuality);
  }
  return out;
}

interface RunOptions {
  project: Project;
  profile: ExportProfile;
  scope: ExportScope;
  dpi: ExportDpi | number;
  onProgress?: (share: number, label: string) => void;
}

/** Startet einen Worker; `cancel` beendet ihn sofort. */
function run(opts: RunOptions): { done: Promise<Uint8Array>; cancel: () => void } {
  const worker = newWorker();
  const id = nextId++;
  let cancelled = false;
  let rejectFn: (e: unknown) => void = () => {};
  const done = new Promise<Uint8Array>((resolve, reject) => {
    rejectFn = reject;
    worker.addEventListener('message', (e: MessageEvent<ExportMessage>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') opts.onProgress?.(m.share, m.label);
      else if (m.type === 'done') resolve(m.bytes);
      else reject(new Error(m.message));
    });
    worker.addEventListener('error', (e) => reject(new Error(e.message || 'Der Export ist abgestürzt.')));
  }).finally(() => worker.terminate());
  void (async () => {
    try {
      const { project, profile, scope, dpi } = opts;
      const pageIds = scopePages(project, scope).map((p) => p.id);
      const all = useStore.getState().assets;
      const assets: Record<string, Uint8Array> = {};
      if (profile.layers.background)
        for (const p of project.pages) if (pageIds.includes(p.id) && p.background && p.background.kind !== 'svg' && all[p.background.assetId]) assets[p.background.assetId] = all[p.background.assetId]!;
      const prepared = await prepareSvg(project, profile, pageIds, dpi, all);
      if (cancelled) return;
      const job: ExportJob = { id, project, profile, req: { pageIds, appendix: scope.appendix }, assets, prepared, dpi };
      // Worker-Nachricht (kein Fenster, kein targetOrigin)
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage(job);
    } catch (e) {
      rejectFn(e);
    }
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      worker.terminate();
      rejectFn(new ExportAborted());
    },
  };
}

class ExportAborted extends Error {
  override name = 'ExportAborted';
}

let running: { cancel: () => void } | null = null;

/** Fehlende Hintergrunddateien: Export ohne sie, mit Hinweis (§9). */
function missingBackgrounds(project: Project, pageIds: Id[]): string[] {
  const assets = useStore.getState().assets;
  return project.pages.filter((p) => pageIds.includes(p.id) && p.background && !assets[p.background.assetId]).map((p) => p.name);
}

/** Export starten: Dialog schließt, Fortschritt in der Statuszeile, danach Dateidialog bzw. Download. */
export async function startExport() {
  if (running) return;
  const { project } = useStore.getState();
  const profile = currentProfile();
  const { scope } = useExportUi.getState();
  const { dpi } = useExportSettings.getState();
  const pages = scopePages(project, scope);
  if (!pages.length) {
    notify('Keine Page ausgewählt.');
    return;
  }
  closeExportDialog();
  const missing = profile.layers.background ? missingBackgrounds(project, pages.map((p) => p.id)) : [];
  if (missing.length) notify(`Hintergrund fehlt in der Projektdatei, exportiert wird ohne: ${missing.join(', ')}`, 'error', 8000);
  useExportUi.setState({ job: { share: 0, label: 'Vorbereiten …' } });
  const r = run({ project, profile, scope, dpi, onProgress: (share, label) => useExportUi.setState({ job: { share, label } }) });
  running = r;
  try {
    const bytes = await r.done;
    useExportUi.setState({ job: null });
    const name = exportFileName(project.name, profile.name, new Date(), pages.length === 1 ? pages[0]!.name : undefined);
    const saved = await platform.saveFile(bytes, name, { name: 'PDF', extensions: ['pdf'] }, 'application/pdf', useStore.getState().filePath);
    if (saved) notify(`PDF gespeichert: ${saved.name}`, 'success');
  } catch (e) {
    useExportUi.setState({ job: null });
    if (e instanceof ExportAborted) notify('PDF-Export abgebrochen.');
    else await showError('PDF-Export fehlgeschlagen', userMessage(e, 'Das PDF konnte nicht erzeugt werden.'));
  } finally {
    running = null;
  }
}

export function cancelExport() {
  running?.cancel();
}

// ---------- Vorschau ----------

let preview: { cancel: () => void } | null = null;

/**
 * Vorschau: das echte PDF der Page (Rasterbilder mit 72 dpi, ohne Anhang). Eine laufende Vorschau wird abgebrochen.
 * null = abgebrochen oder fehlgeschlagen (Meldung im Dialog).
 */
export async function previewPdf(pageId: Id): Promise<Uint8Array | null> {
  preview?.cancel();
  const { project } = useStore.getState();
  const r = run({ project, profile: currentProfile(), scope: { pageIds: [pageId], appendix: { stands: false, free: false, infra: false } }, dpi: 72 });
  preview = r;
  try {
    return await r.done;
  } catch (e) {
    if (e instanceof ExportAborted) return null;
    throw e;
  } finally {
    if (preview === r) preview = null;
  }
}

export const cancelPreview = () => preview?.cancel();
