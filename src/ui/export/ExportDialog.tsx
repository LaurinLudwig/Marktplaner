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
import { SCALE_LIMITS } from '../../core/model/schema';
import { PAPER_FORMATS, type FestplatzPage, type PaperFormat } from '../../core/model/types';
import { pagePaper } from '../../core/paper';
import { addProfile, deleteProfile, loadExportSettings, resetProfile, selectProfile, setExportDpi, updateProfile, useExportSettings } from '../../state/exportSettings';
import { fixSheetScale, setSheet } from '../../state/paper';
import { useStore } from '../../state/store';
import { openPdf } from '../canvas/background/renderer';
import { estimateExportBytes, sizeText } from '../../app/pdfEstimate';
import { NumberField } from '../panels/NumberField';
import { TextField } from '../panels/TextField';

/**
 * Export-Dialog (M8-09, spec.md §9): Profil (mit „Profile verwalten …“), Umfang, Anhang, Raster-Auflösung, Blatt je
 * Page und Vorschau. Die Vorschau ist das echte PDF der gewählten Page (Rasterbilder mit 72 dpi), mit pdf.js gezeichnet.
 * Änderungen am Blatt gelten für die Page (Undo-Schritt); Profile gelten für diesen Rechner (kein Undo).
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
    const current = scope.pageIds ?? project.pages.map((p) => p.id);
    const next = on ? project.pages.map((p) => p.id).filter((x) => x === id || current.includes(x)) : current.filter((x) => x !== id);
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
                Gesamtplan (alle Festplätze in Tab-Reihenfolge)
              </label>
              <label className="check">
                <input type="radio" name="ex-scope" checked={!all} onChange={() => setExportScope({ pageIds: [previewPageId ?? project.pages[0]!.id] })} />
                Auswahl
              </label>
              <div className="export-pages" role="list">
                {project.pages.map((p) => (
                  <PageRow
                    key={p.id}
                    page={p}
                    checked={all || scope.pageIds!.includes(p.id)}
                    disabled={all}
                    previewed={p.id === previewPageId}
                    onToggle={(on) => togglePage(p.id, on)}
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

/** Zeile je Page: Häkchen, Name (Klick = Vorschau) und Blatt (Format, Ausrichtung, Maßstab). */
function PageRow({ page, checked, disabled, previewed, onToggle }: { page: FestplatzPage; checked: boolean; disabled: boolean; previewed: boolean; onToggle: (on: boolean) => void }) {
  const project = useStore((s) => s.project);
  const s = page.sheet;
  const fit = s.scale === null;
  const frame = pagePaper(page, project).frame;
  return (
    <div className={`export-page${previewed ? ' previewed' : ''}`} role="listitem" data-testid="export-page">
      <input type="checkbox" aria-label={`${page.name} exportieren`} checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      <button type="button" className="export-page-name" aria-pressed={previewed} onClick={() => setPreviewPage(page.id)} title="Vorschau zeigen">
        {page.name}
      </button>
      <select aria-label={`Format ${page.name}`} value={s.format} onChange={(e) => setSheet(page.id, { format: e.target.value as PaperFormat })}>
        {PAPER_FORMATS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select aria-label={`Ausrichtung ${page.name}`} value={s.orientation} onChange={(e) => setSheet(page.id, { orientation: e.target.value as 'portrait' | 'landscape' })}>
        <option value="landscape">quer</option>
        <option value="portrait">hoch</option>
      </select>
      <label className="check" title="An Seite anpassen">
        <input type="checkbox" aria-label={`${page.name}: an Seite anpassen`} checked={fit} onChange={(e) => (e.target.checked ? setSheet(page.id, { scale: null }) : fixSheetScale(page.id))} />
        anpassen
      </label>
      <NumberField
        id={`ex-scale-${page.id}`}
        label="1:"
        value={fit ? null : s.scale}
        placeholder={fit ? fmt(frame.scale, 0) : undefined}
        min={SCALE_LIMITS.min}
        max={SCALE_LIMITS.max}
        step={50}
        digits={0}
        onCommit={(n) => setSheet(page.id, { scale: n })}
      />
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

/** Echte PDF-Vorschau der gewählten Page, 300 ms nach der letzten Änderung (Page, Profil oder Projekt). */
function Preview({ pageId, profile }: { pageId: string | null; profile: ExportProfile }) {
  const project = useStore((s) => s.project);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Anfrage = aktueller Stand; das Ergebnis gehört zu genau einer Anfrage (sonst „wird erzeugt …“)
  const request = useMemo(() => ({ pageId, profile, project }), [pageId, profile, project]);
  const [result, setResult] = useState<{ for: unknown; error: string | null } | null>(null);
  useEffect(() => {
    const id = request.pageId;
    if (!id) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const bytes = await previewPdf(id);
        if (!alive || !bytes) return;
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
        if (alive) setResult({ for: request, error: null });
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
  const page = project.pages.find((p) => p.id === pageId);
  return (
    <div className="export-preview" aria-label="Vorschau" data-testid="export-preview" data-state={busy ? 'busy' : error ? 'error' : 'ok'}>
      <div className="export-preview-head">Vorschau: {page?.name}</div>
      <div className="export-preview-box">
        <canvas ref={canvasRef} />
        {busy && <span className="hint export-preview-busy">Vorschau wird erzeugt …</span>}
        {error && <span className="warn-chip outside">{error}</span>}
      </div>
    </div>
  );
}
