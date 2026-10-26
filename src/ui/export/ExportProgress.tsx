import { cancelExport, useExportUi } from '../../app/pdfExport';

/** Fortschritt eines laufenden PDF-Exports (M8-09): nicht modal, unten links; die Oberfläche bleibt bedienbar. */
export function ExportProgress() {
  const job = useExportUi((s) => s.job);
  if (!job) return null;
  const pct = Math.round(job.share * 100);
  return (
    <div className="export-progress" role="status" aria-live="polite" data-testid="export-progress">
      <span>PDF: {job.label}</span>
      <span className="export-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="num">{pct} %</span>
      <button type="button" className="btn" onClick={cancelExport}>
        Abbrechen
      </button>
    </div>
  );
}
