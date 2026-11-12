import { create } from 'zustand';
import { exportFileName, rasterQuality, type AppendixPart, type ExportDpi, type ExportProfile } from '../core/exportProfiles';
import { userMessage } from '../core/errors';
import type { Id, Project } from '../core/model/types';
import { exportFrame } from '../core/paper';
import type { PreparedBackground } from '../core/pdf/writePdf';
import { platform } from '../platform';
import { currentProfile, useExportSettings } from '../state/exportSettings';
import { useStore } from '../state/store';
import { pageView, viewBackgrounds } from '../core/verbundView';
import { entryPages, selectedEntries, type ExportEntry } from '../core/pdf/exportDoc';
import { showError } from './dialogs';
import { notify } from './notify';
import { backgroundKey, bitmapCanvas, engineJpegQuality, prepareBackground, rasterBudgets } from './pdfBackground';
import type { ExportJob, ExportMessage } from './pdfExport.worker';

/**
 * PDF-Export (M8-09, spec.md §9): Dialog-Zustand, Export im Web Worker mit Fortschritt und Abbrechen, Vorschau und
 * Speichern über `platform.saveFile` (Desktop: Dateidialog, Browser: Download).
 *
 * Der Export arbeitet auf dem Stand des Projekts beim Start (Immer-Objekte sind unveränderlich); weiterarbeiten
 * ist erlaubt.
 */

export interface ExportScope {
  /** Seiten: Page-IDs und Gesamtansichten `verbund:<id>` (#15 Teil c); null = Gesamtplan (alle in Tab-Reihenfolge). */
  pageIds: Id[] | null;
  appendix: Record<AppendixPart, boolean>;
}

interface ExportUi {
  open: boolean;
  scope: ExportScope;
  /** Seite der Vorschau (Page oder `verbund:<id>`). */
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
  // Vorschau der aktiven Seite, auch der Gesamtansicht eines Verbunds (#15 Teil c); sonst der erste Festplatz
  const active = s.ui.activePage !== 'start' && pageView(s.project, s.ui.activePage) ? s.ui.activePage : null;
  useExportUi.setState({ open: true, previewPageId: active ?? s.project.pages[0]!.id });
}

export const closeExportDialog = () => useExportUi.setState({ open: false });
export const setExportScope = (patch: Partial<ExportScope>) => useExportUi.setState((s) => ({ scope: { ...s.scope, ...patch } }));
export const setPreviewPage = (id: Id) => useExportUi.setState({ previewPageId: id });

/** Seiten des Exports in Tab-Reihenfolge: Pages und Gesamtansichten von Verbünden (#15 Teil c). */
export function scopePages(project: Project, scope: ExportScope): ExportEntry[] {
  return selectedEntries(project, scope.pageIds);
}

// ---------- Worker ----------

let nextId = 1;

function newWorker(): Worker {
  return new Worker(new URL('./pdfExport.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * SVG-Hintergründe auf dem Hauptthread rastern (der Worker kann SVG nicht dekodieren), je Seite und Besitzer-Page
 * (`backgroundKey`): Die Gesamtansicht eines Verbunds hat ein anderes Blatt als die Einzelansicht (#15 Teil c).
 */
async function prepareSvg(project: Project, profile: ExportProfile, entries: readonly ExportEntry[], dpi: ExportDpi | number, assets: Record<string, Uint8Array>): Promise<Record<string, PreparedBackground | null>> {
  const out: Record<string, PreparedBackground | null> = {};
  if (!profile.layers.background) return out;
  const jpegQuality = await engineJpegQuality(rasterQuality(dpi).jpeg);
  for (const entry of entries) {
    const bgs = viewBackgrounds(project, entry.page);
    if (!bgs.some((b) => b.background.kind === 'svg')) continue;
    const frame = exportFrame(entry.page, project, profile);
    const budgets = rasterBudgets(
      bgs.map((b) => b.background),
      frame,
      dpi,
    );
    for (const [i, { pageId, background: bg }] of bgs.entries()) {
      if (bg.kind !== 'svg') continue;
      out[backgroundKey(entry.ref, pageId)] = await prepareBackground(
        bg,
        assets[bg.assetId],
        frame,
        dpi,
        async (bytes, mime, format, q) => {
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return bitmapCanvas(img, format, q);
          } finally {
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }
        },
        jpegQuality,
        budgets[i],
      );
    }
  }
  return out;
}

/** Hintergründe der Seiten (je Mitglied in der Gesamtansicht). */
const entryBackgrounds = (project: Project, entries: readonly ExportEntry[]) => entries.flatMap((e) => viewBackgrounds(project, e.page));

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
      const entries = scopePages(project, scope);
      const pageIds = entries.map((e) => e.ref);
      const all = useStore.getState().assets;
      const assets: Record<string, Uint8Array> = {};
      if (profile.layers.background)
        for (const { background: bg } of entryBackgrounds(project, entries)) if (bg.kind !== 'svg' && all[bg.assetId]) assets[bg.assetId] = all[bg.assetId]!;
      const prepared = await prepareSvg(project, profile, entries, dpi, all);
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

/** Fehlende Hintergrunddateien: Export ohne sie, mit Hinweis (§9); je Festplatz einmal, auch über Gesamtansichten. */
function missingBackgrounds(project: Project, entries: readonly ExportEntry[]): string[] {
  const assets = useStore.getState().assets;
  return entryPages(project, entries)
    .filter((p) => p.background && !assets[p.background.assetId])
    .map((p) => p.name);
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
  const missing = profile.layers.background ? missingBackgrounds(project, pages) : [];
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
 * Vorschau: das echte PDF der Seite (Page oder Gesamtansicht; Rasterbilder mit 72 dpi, ohne Anhang). Eine laufende
 * Vorschau wird abgebrochen. null = abgebrochen oder fehlgeschlagen (Meldung im Dialog). `onProgress` wie beim
 * Export (Anteil 0–1, Arbeitsschritt), für die Ladeanzeige im Dialog (#33).
 */
export async function previewPdf(pageId: Id, onProgress?: (share: number, label: string) => void): Promise<Uint8Array | null> {
  preview?.cancel();
  const { project } = useStore.getState();
  const r = run({ project, profile: currentProfile(), scope: { pageIds: [pageId], appendix: { stands: false, free: false, infra: false } }, dpi: 72, onProgress });
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
