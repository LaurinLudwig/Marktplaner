import { useEffect, useMemo, useRef, useState } from 'react';
import { closeExportDialog, previewPdf, scopePages, setExportScope, setPreviewPage, startExport, useExportUi } from '../../app/pdfExport';
import { ask } from '../../app/dialogs';
import { userMessage } from '../../core/errors';
import {
  APPENDIX_LABEL,
  APPENDIX_PARTS,
  EXPORT_DPI,
  exportFileName,
  PROFILE_LAYER_LABEL,
  PROFILE_LAYERS,
  STAND_FIELD_LABEL,
  STAND_FIELDS,
  WARNING_MODE_LABEL,
  type ExportDpi,
  type ExportProfile,
  type WarningMode,
} from '../../core/exportProfiles';
import { fmt } from '../../core/format';
import { SCALE_LIMITS, TARGET_WIDTH_LIMITS } from '../../core/model/schema';
import { exportFrame } from '../../core/paper';
import { exportEntries, type ExportEntry } from '../../core/pdf/exportDoc';
import { exceedsPdfLimit, isFreeFormat, paperSizeText, PDF_MAX_MM, sheetLabel } from '../../core/sheet';
import { addProfile, deleteProfile, loadExportSettings, resetProfile, selectProfile, setExportDpi, updateProfile, useExportSettings } from '../../state/exportSettings';
import { fixSheetScale, setSheet } from '../../state/paper';
import { useStore } from '../../state/store';
import { openPdf } from '../canvas/background/renderer';
import { estimateExportBytes, sizeText } from '../../app/pdfEstimate';
import { lastDuration, rememberDuration, remainingSeconds } from '../../app/previewEta';
import { NumberField } from '../panels/NumberField';
import { SheetFormatSelect } from '../panels/PaperPanels';
import { TextField } from '../panels/TextField';

/**
 * Export-Dialog (M8-09, spec.md §9): Profil (mit „Profile verwalten …“), Umfang, Anhang, Raster-Auflösung, Blatt je
 * Page und Vorschau. Die Vorschau ist das echte PDF der gewählten Page (Rasterbilder mit 72 dpi), mit pdf.js gezeichnet.
 * Änderungen am Blatt gelten für die Page (Undo-Schritt); Profile gelten für diesen Rechner (kein Undo).
 * Gesamtansichten von Verbünden („Unterstadt (gesamt)“, #15 Teil c) sind eigene Seiten mit dem Blatt des Verbunds.
 */
export function ExportDialog() {
  const open = useExportUi((s) => s.open);
  useEffect(() => {
    if (open) void loadExportSettings();
  }, [open]);
  if (!open) return null;
  return <ExportDialogBody />;
}

function ExportDialogBody() {
  const project = useStore((s) => s.project);
  const scope = useExportUi((s) => s.scope);
  const previewPageId = useExportUi((s) => s.previewPageId);
  const { profiles, profileId, dpi, error } = useExportSettings();
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]!;
  const [managing, setManaging] = useState(false);
  const [today] = useState(() => new Date());
  const exportRef = useRef<HTMLButtonElement>(null);
  const pages = scopePages(project, scope);
  const entries = useMemo(() => exportEntries(project), [project]);
  const hasOverviews = entries.some((e) => e.verbund);
  const all = scope.pageIds === null;

  useEffect(() => {
    exportRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeExportDialog();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const togglePage = (id: string, on: boolean) => {
    const refs = entries.map((e) => e.ref);
    const current = scope.pageIds ?? refs;
    const next = on ? refs.filter((x) => x === id || current.includes(x)) : current.filter((x) => x !== id);
    setExportScope({ pageIds: next });
  };
  const assets = useStore((s) => s.assets);
  const estimate = useMemo(
    () => estimateExportBytes(project, profile, scope.pageIds, scope.appendix, dpi, assets),
    [project, profile, scope.pageIds, scope.appendix, dpi, assets],
  );
  const fileName = exportFileName(project.name, profile.name, today, pages.length === 1 ? pages[0]!.name : undefined);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeExportDialog()}>
      <div className="dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="ex-title">
        <h2 id="ex-title">Als PDF exportieren</h2>
        <div className="export-body">
          <div className="export-form form">
            {error && <p className="warn-chip outside">{error}</p>}
            <div className="field">
              <label htmlFor="ex-profile">Profil</label>
              <div className="export-row">
                <select id="ex-profile" value={profile.id} onChange={(e) => selectProfile(e.target.value)}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" aria-expanded={managing} onClick={() => setManaging((m) => !m)}>
                  Profile verwalten …
                </button>
              </div>
              <p className="hint" data-testid="profile-summary">
                {profileSummary(profile)}
              </p>
            </div>
            {managing && <ProfileEditor profile={profile} />}

            <fieldset className="export-group">
              <legend>Umfang</legend>
              <label className="check">
                <input type="radio" name="ex-scope" checked={all} onChange={() => setExportScope({ pageIds: null })} />
                {hasOverviews ? 'Gesamtplan (alle Festplätze und Gesamtansichten in Tab-Reihenfolge)' : 'Gesamtplan (alle Festplätze in Tab-Reihenfolge)'}
              </label>
              <label className="check">
                <input type="radio" name="ex-scope" checked={!all} onChange={() => setExportScope({ pageIds: [previewPageId ?? project.pages[0]!.id] })} />
                Auswahl
              </label>
              <div className="export-pages" role="list">
                {entries.map((e) => (
                  <PageRow
                    key={e.ref}
                    entry={e}
                    checked={all || scope.pageIds!.includes(e.ref)}
                    disabled={all}
                    previewed={e.ref === previewPageId}
                    profile={profile}
                    onToggle={(on) => togglePage(e.ref, on)}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="export-group">
              <legend>Anhang</legend>
              {APPENDIX_PARTS.map((a) => (
                <label key={a} className="check">
                  <input type="checkbox" checked={profile.appendix[a] && scope.appendix[a]} disabled={!profile.appendix[a]} onChange={(e) => setExportScope({ appendix: { ...scope.appendix, [a]: e.target.checked } })} />
                  {APPENDIX_LABEL[a]}
                  {!profile.appendix[a] && <span className="hint"> · nicht im Profil</span>}
                </label>
              ))}
            </fieldset>

            <div className="field">
              <label htmlFor="ex-dpi">Auflösung der Rasterhintergründe</label>
              <select id="ex-dpi" value={String(dpi)} onChange={(e) => setExportDpi((e.target.value === 'original' || e.target.value === 'email' ? e.target.value : Number(e.target.value)) as ExportDpi)}>
                {EXPORT_DPI.map((d) => (
                  <option key={d} value={String(d)}>
                    {d === 'original' ? 'Original (nicht verkleinern)' : d === 'email' ? 'E-Mail (100 dpi, stark komprimiert)' : `${d} dpi${d === 200 ? ' (Standard)' : ''}`}
                  </option>
                ))}
              </select>
              <p className="hint">PDF-Hintergründe bleiben Vektor. Bilder werden auf den Ausschnitt des Blatts beschnitten und nur verkleinert.</p>
            </div>
          </div>
          <Preview pageId={previewPageId} profile={profile} />
        </div>
        <p className="hint export-file" data-testid="export-file-name">
          Datei: {fileName} ·{' '}
          <span data-testid="export-size-estimate" data-bytes={Math.round(estimate)}>
            geschätzt {sizeText(estimate)}
          </span>{' '}
          · Maßstab gilt bei Druck in Originalgröße (im Druckdialog nicht „an Seite anpassen“).
        </p>
        <div className="buttons">
          <button type="button" className="btn" onClick={closeExportDialog}>
            Abbrechen
          </button>
          <button ref={exportRef} type="button" className="btn primary" disabled={!pages.length} onClick={() => void startExport()}>
            Exportieren
          </button>
        </div>
      </div>
    </div>
  );
}

function profileSummary(p: ExportProfile): string {
  const hidden = STAND_FIELDS.filter((f) => !p.fields.includes(f)).map((f) => STAND_FIELD_LABEL[f]);
  const layersOff = PROFILE_LAYERS.filter((l) => !p.layers[l]).map((l) => PROFILE_LAYER_LABEL[l]);
  return [
    hidden.length ? `ohne ${hidden.join(', ')}` : 'alle Felder',
    layersOff.length ? `Ebenen aus: ${layersOff.join(', ')}` : 'alle Ebenen',
    `Warnungen: ${WARNING_MODE_LABEL[p.warnings]}`,
  ].join(' · ');
}

/**
 * Zeile je Seite (Page oder Gesamtansicht eines Verbunds, #15 Teil c): Häkchen, Name (Klick = Vorschau) und Blatt
 * (Format, Ausrichtung, Maßstab bzw. Zielbreite), darunter das Papiermaß in mm (#13) und gegebenenfalls die Warnung für
 * Seiten über 5 080 mm. Die Gesamtansicht zeigt und ändert das Blatt des Verbunds.
 */
function PageRow({ entry, checked, disabled, previewed, profile, onToggle }: { entry: ExportEntry; checked: boolean; disabled: boolean; previewed: boolean; profile: ExportProfile; onToggle: (on: boolean) => void }) {
  const project = useStore((s) => s.project);
  const { page, name } = entry;
  const s = page.sheet;
  const auto = s.scale === null;
  const free = isFreeFormat(s.format);
  // Maß und Maßstab wie im PDF: Die Legende folgt den Ebenen des Profils (beim Plan ändert das das Papiermaß)
  const frame = exportFrame(page, project, profile);
  return (
    <div className={`export-page${previewed ? ' previewed' : ''}${entry.verbund ? ' overview' : ''}`} role="listitem" data-testid="export-page" data-ref={entry.ref}>
      <input type="checkbox" aria-label={`${name} exportieren`} checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      <button type="button" className="export-page-name" aria-pressed={previewed} onClick={() => setPreviewPage(entry.ref)} title="Vorschau zeigen">
        {name}
      </button>
      <SheetFormatSelect page={page} ariaLabel={`Format ${name}`} />
      {free ? (
        <NumberField
          id={`ex-width-${page.id}`}
          label="Zielbreite"
          unit="mm"
          value={s.targetWidth}
          min={TARGET_WIDTH_LIMITS.min}
          max={TARGET_WIDTH_LIMITS.max}
          step={10}
          digits={0}
          disabled={!auto}
          onCommit={(n) => setSheet(page.id, { targetWidth: n })}
        />
      ) : (
        <select aria-label={`Ausrichtung ${name}`} value={s.orientation} onChange={(e) => setSheet(page.id, { orientation: e.target.value as 'portrait' | 'landscape' })}>
          <option value="landscape">quer</option>
          <option value="portrait">hoch</option>
        </select>
      )}
      <label className="check" title={free ? 'Maßstab über Zielbreite' : 'An Seite anpassen'}>
        <input
          type="checkbox"
          aria-label={free ? `${name}: Maßstab über Zielbreite` : `${name}: an Seite anpassen`}
          checked={auto}
          onChange={(e) => (e.target.checked ? setSheet(page.id, { scale: null }) : fixSheetScale(page.id))}
        />
        {free ? 'über Zielbreite' : 'anpassen'}
      </label>
      <NumberField
        id={`ex-scale-${page.id}`}
        label="1:"
        value={auto ? null : s.scale}
        placeholder={auto ? fmt(frame.scale, 0) : undefined}
        min={SCALE_LIMITS.min}
        max={SCALE_LIMITS.max}
        step={50}
        digits={0}
        onCommit={(n) => setSheet(page.id, { scale: n })}
      />
      <span className="hint export-page-size" data-testid="export-page-size">
        {paperSizeText(frame.paper)}
      </span>
      {exceedsPdfLimit(frame.paper) && (
        <span className="warn-chip export-page-warn" data-testid="export-page-too-large">
          Länger als {fmt(PDF_MAX_MM, 0)} mm: PDF-Programme schneiden ab
        </span>
      )}
    </div>
  );
}

/** Profil bearbeiten: Name, Ebenen, Warnungen, Felder, Anhang. Änderungen gelten sofort (für diesen Rechner). */
function ProfileEditor({ profile: p }: { profile: ExportProfile }) {
  const setLayer = (l: (typeof PROFILE_LAYERS)[number], on: boolean) => updateProfile(p.id, { layers: { ...p.layers, [l]: on } });
  const setField = (f: (typeof STAND_FIELDS)[number], on: boolean) => updateProfile(p.id, { fields: STAND_FIELDS.filter((x) => (x === f ? on : p.fields.includes(x))) });
  const onDelete = async () => {
    const r = await ask({
      title: 'Profil löschen',
      message: `Das Profil „${p.name}“ wird auf diesem Rechner gelöscht.`,
      buttons: [
        { id: 'cancel', label: 'Abbrechen' },
        { id: 'ok', label: 'Löschen', variant: 'danger' },
      ],
      cancelId: 'cancel',
    });
    if (r === 'ok') deleteProfile(p.id);
  };
  return (
    <div className="profile-editor" data-testid="profile-editor">
      <TextField id="ex-profile-name" label="Profilname" value={p.name} onCommit={(t) => updateProfile(p.id, { name: t })} />
      <div className="profile-cols">
        <fieldset className="export-group">
          <legend>Ebenen</legend>
          {PROFILE_LAYERS.map((l) => (
            <label key={l} className="check">
              <input type="checkbox" checked={p.layers[l]} onChange={(e) => setLayer(l, e.target.checked)} />
              {PROFILE_LAYER_LABEL[l]}
            </label>
          ))}
        </fieldset>
        <fieldset className="export-group">
          <legend>Felder (Beschriftung und Anhang)</legend>
          {STAND_FIELDS.map((f) => (
            <label key={f} className="check">
              <input type="checkbox" checked={p.fields.includes(f)} onChange={(e) => setField(f, e.target.checked)} />
              {STAND_FIELD_LABEL[f]}
            </label>
          ))}
        </fieldset>
        <fieldset className="export-group">
          <legend>Warnungen</legend>
          {(['none', 'safety', 'all'] as WarningMode[]).map((w) => (
            <label key={w} className="check">
              <input type="radio" name="ex-warn" checked={p.warnings === w} onChange={() => updateProfile(p.id, { warnings: w })} />
              {WARNING_MODE_LABEL[w]}
              {w === 'safety' && <span className="hint"> · Freihaltefläche, Durchfahrt zu eng</span>}
            </label>
          ))}
          <legend className="sub">Anhang</legend>
          {APPENDIX_PARTS.map((a) => (
            <label key={a} className="check">
              <input type="checkbox" checked={p.appendix[a]} onChange={(e) => updateProfile(p.id, { appendix: { ...p.appendix, [a]: e.target.checked } })} />
              {APPENDIX_LABEL[a]}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="export-row">
        <button type="button" className="btn" onClick={() => addProfile()}>
          Als neues Profil kopieren
        </button>
        {p.builtin ? (
          <button type="button" className="btn" onClick={() => resetProfile(p.id)}>
            Zurücksetzen
          </button>
        ) : (
          <button type="button" className="btn danger" onClick={() => void onDelete()}>
            Profil löschen
          </button>
        )}
      </div>
      <p className="hint">Profile gelten für diesen Rechner, nicht für das Projekt. Nicht angehakte Felder kommen im PDF überhaupt nicht vor.</p>
    </div>
  );
}

/**
 * Echte PDF-Vorschau der gewählten Page, 300 ms nach der letzten Änderung (Page, Profil oder Projekt). Solange sie
 * lädt, ist die alte Vorschau abgeblendet; darüber Arbeitsschritt, Fortschritt und geschätzte Restzeit (#33).
 */
function Preview({ pageId, profile }: { pageId: string | null; profile: ExportProfile }) {
  const project = useStore((s) => s.project);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Anfrage = aktueller Stand; das Ergebnis gehört zu genau einer Anfrage (sonst „wird erzeugt …“)
  const request = useMemo(() => ({ pageId, profile, project }), [pageId, profile, project]);
  const [result, setResult] = useState<{ for: unknown; error: string | null } | null>(null);
  const [progress, setProgress] = useState<{ for: unknown; share: number; label: string; start: number } | null>(null);
  useEffect(() => {
    const id = request.pageId;
    if (!id) return;
    let alive = true;
    const t = setTimeout(async () => {
      const start = performance.now();
      const report = (share: number, label: string) => alive && setProgress({ for: request, share, label, start });
      report(0, 'Vorbereiten …');
      try {
        const bytes = await previewPdf(id, report);
        if (!alive || !bytes) return;
        report(1, 'Vorschau wird gezeichnet …');
        const doc = await openPdf(bytes);
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!alive || !canvas) return;
        const vp1 = page.getViewport({ scale: 1 });
        const box = canvas.parentElement!.getBoundingClientRect();
        const scale = Math.min((box.width - 4) / vp1.width, (box.height - 4) / vp1.height);
        const ratio = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: scale * ratio });
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        canvas.style.width = `${Math.round(vp.width / ratio)}px`;
        canvas.style.height = `${Math.round(vp.height / ratio)}px`;
        await page.render({ canvas, viewport: vp }).promise;
        if (alive) {
          rememberDuration(id, performance.now() - start);
          setResult({ for: request, error: null });
        }
        void doc.cleanup();
      } catch (e) {
        if (alive) setResult({ for: request, error: userMessage(e, 'Die Vorschau konnte nicht erzeugt werden.') });
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [request]);
  const busy = result?.for !== request;
  const error = !busy ? result?.error : null;
  // Restzeit sekündlich nachführen, solange die Vorschau lädt
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(i);
  }, [busy]);
  const step = progress?.for === request ? progress : null;
  const eta = step && pageId ? remainingSeconds(Math.max(0, now - step.start), step.share, lastDuration(pageId)) : null;
  // Page oder Gesamtansicht eines Verbunds (#15 Teil c)
  const entry = useMemo(() => exportEntries(project).find((e) => e.ref === pageId), [project, pageId]);
  const page = entry?.page;
  // Maß und Maßstab der Seite im PDF (Ebenen des Profils, wie die Vorschau selbst)
  const frame = page && exportFrame(page, project, profile);
  return (
    <div className="export-preview" aria-label="Vorschau" data-testid="export-preview" data-state={busy ? 'busy' : error ? 'error' : 'ok'}>
      <div className="export-preview-head">
        Vorschau: {entry?.name}
        {page && frame && (
          <span className="hint" data-testid="export-preview-size">
            {' '}
            · {sheetLabel(page.sheet, frame)}
          </span>
        )}
      </div>
      <div className={`export-preview-box${busy ? ' busy' : ''}`}>
        <canvas ref={canvasRef} />
        {busy && (
          <div className="export-preview-busy" data-testid="export-preview-progress">
            <div className="export-preview-title">
              <span className="spinner" aria-hidden="true" />
              <span role="status">Vorschau wird erzeugt …</span>
            </div>
            <span className="export-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((step?.share ?? 0) * 100)}%` }} />
            </span>
            <div className="export-preview-step">
              <span>{step?.label ?? 'Vorbereiten …'}</span>
              {eta !== null && (
                <span className="num" data-testid="export-preview-eta">
                  noch etwa {eta} s
                </span>
              )}
            </div>
          </div>
        )}
        {error && <span className="warn-chip outside">{error}</span>}
      </div>
    </div>
  );
}
