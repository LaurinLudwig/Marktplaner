import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { mmToPt } from '../../src/core/pdf/writePdf';
import { collectErrors, MOD, openApp } from './helpers';

/**
 * M8: PDF-Export (spec.md §9), Maßstabsbalken und Nordpfeil (§8), Formatversion 5 (§10). Die heruntergeladenen PDFs
 * werden mit pdf.js ausgelesen.
 */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const activePg = (page: Page) => store(page, 's.project.pages.find((p) => p.id === s.ui.activePage)') as Promise<any>;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function openFixture(page: Page, file = 'tests/fixtures/format-v4-m7.schelme') {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+o`);
  await (await chooser).setFiles(file);
  await expect.poll(() => store(page, 's.project.pages.length')).toBe(4);
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Als PDF exportieren' });

async function openExport(page: Page) {
  await page.keyboard.press(`${MOD}+p`);
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
}

async function exportAndRead(page: Page) {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await dialog(page).getByRole('button', { name: 'Exportieren' }).click();
  const d = await download;
  const bytes = new Uint8Array(readFileSync((await d.path())!));
  return { name: d.suggestedFilename(), pdf: await readPdf(bytes) };
}

test.describe('M8: PDF-Export', () => {
  test('Cmd/Strg+P: Dialog mit echter Vorschau; Gesamtplan „Intern“ mit Anhang, Seiten exakt in mm', async ({ page }) => {
    const errors = collectErrors(page);
    await openFixture(page);
    await openExport(page);
    await expect(page.getByTestId('export-page')).toHaveCount(4);
    await expect(page.getByTestId('export-file-name')).toContainText(`Lasttest 500 Stände – Intern – ${today()}.pdf`);
    const { name, pdf } = await exportAndRead(page);
    expect(name.normalize('NFC')).toBe(`Lasttest 500 Stände – Intern – ${today()}.pdf`);
    // Obermarkt A1 quer, Untermarkt A2 hoch, die anderen A3 quer; danach Anhang A4 quer
    expect(pdf.pages[0]!.w).toBeCloseTo(mmToPt(841), 1);
    expect(pdf.pages[0]!.h).toBeCloseTo(mmToPt(594), 1);
    expect(pdf.pages[1]!.w).toBeCloseTo(mmToPt(420), 1);
    expect(pdf.pages[1]!.h).toBeCloseTo(mmToPt(594), 1);
    expect(pdf.pages[4]!.w).toBeCloseTo(mmToPt(297), 1);
    expect(pdf.outline).toEqual(['Obermarkt', 'Untermarkt', 'Am Ziegelturm', 'Schifftor', 'Standliste', 'Freiflächenliste', 'Infrastrukturliste']);
    const all = pdf.pages.map((p) => p.text).join('\n');
    expect(all).toContain('Süßwaren Größe');
    expect(all).toContain('Jürgen Müller');
    expect(pdf.pages[0]!.text).toContain('Maßstab 1:500 bei Druck in Originalgröße (A1 quer)');
    expect(pdf.info.Title).toBe('Lasttest 500 Stände – Intern');
    // Fortschritt verschwindet, Erfolgsmeldung
    await expect(page.getByTestId('export-progress')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('„Sanität/Ordnungsamt“: kein Eigentümer im PDF; Dateiname ohne Schrägstrich', async ({ page }) => {
    await openFixture(page);
    await openExport(page);
    await dialog(page).getByLabel('Profil', { exact: true }).selectOption({ label: 'Sanität/Ordnungsamt' });
    await expect(page.getByTestId('profile-summary')).toContainText('ohne Eigentümer, Strom, Anschlussart, Notiz');
    const { name, pdf } = await exportAndRead(page);
    expect(name.normalize('NFC')).toBe(`Lasttest 500 Stände – Sanität-Ordnungsamt – ${today()}.pdf`);
    const all = pdf.pages.map((p) => p.text).join('\n');
    expect(all).not.toContain('Jürgen Müller');
    expect(all).not.toContain('Eigentümer');
    expect(all).toContain('Süßwaren Größe');
    expect(pdf.outline).toEqual(['Obermarkt', 'Untermarkt', 'Am Ziegelturm', 'Schifftor', 'Standliste', 'Infrastrukturliste']);
  });

  test('Profile verwalten: Kopie ohne Name, bleibt nach Neuladen; Auswahl einer Page mit Festplatz im Dateinamen', async ({ page }) => {
    await openFixture(page);
    await openExport(page);
    await dialog(page).getByRole('button', { name: 'Profile verwalten …' }).click();
    const editor = page.getByTestId('profile-editor');
    await editor.getByRole('button', { name: 'Als neues Profil kopieren' }).click();
    await expect(dialog(page).getByLabel('Profil', { exact: true }).locator('option:checked')).toHaveText('Intern (Kopie)');
    await editor.getByLabel('Profilname').fill('Ohne Namen');
    await editor.getByLabel('Profilname').press('Enter');
    await editor.getByRole('checkbox', { name: 'Name', exact: true }).uncheck();
    // Auswahl: nur Obermarkt
    await dialog(page).getByRole('radio', { name: 'Auswahl' }).check();
    await expect(page.getByTestId('export-file-name')).toContainText(`Lasttest 500 Stände – Obermarkt – Ohne Namen – ${today()}.pdf`);
    const { pdf } = await exportAndRead(page);
    expect(pdf.outline[0]).toBe('Obermarkt');
    expect(pdf.outline).not.toContain('Untermarkt');
    expect(pdf.pages.map((p) => p.text).join('\n')).not.toContain('Süßwaren Größe');
    // Profile gelten pro Rechner: nach Neuladen noch da und ausgewählt
    await page.reload();
    await openFixture(page);
    await page.keyboard.press(`${MOD}+p`);
    await expect(dialog(page).getByLabel('Profil', { exact: true }).locator('option:checked')).toHaveText('Ohne Namen');
    // Mitgelieferte lassen sich nicht löschen, nur zurücksetzen
    await dialog(page).getByLabel('Profil', { exact: true }).selectOption({ label: 'Intern' });
    await dialog(page).getByRole('button', { name: 'Profile verwalten …' }).click();
    await expect(page.getByTestId('profile-editor').getByRole('button', { name: 'Profil löschen' })).toHaveCount(0);
    await expect(page.getByTestId('profile-editor').getByRole('button', { name: 'Zurücksetzen' })).toBeVisible();
  });

  test('Blatt im Dialog ändern gilt für die Page und ist ein Undo-Schritt', async ({ page }) => {
    await openFixture(page);
    await openExport(page);
    await dialog(page).getByLabel('Format Schifftor').selectOption('A2');
    expect((await store(page, 's.project.pages[3].sheet')) as any).toMatchObject({ format: 'A2' });
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    expect((await store(page, 's.project.pages[3].sheet')) as any).toMatchObject({ format: 'A3' });
  });

  test('Fortschritt, Abbrechen; die Oberfläche bleibt währenddessen bedienbar', async ({ page }) => {
    await openFixture(page);
    await importBigJpeg(page);
    await openExport(page);
    await dialog(page).getByLabel('Auflösung der Rasterhintergründe').selectOption('original');
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await dialog(page).getByRole('button', { name: 'Exportieren' }).click();
    const progress = page.getByTestId('export-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('PDF:');
    // Während des Exports: Page wechseln und Undo-fähige Änderung gehen
    await page.keyboard.press('Alt+2');
    await expect.poll(() => store(page, 's.project.pages.findIndex((p) => p.id === s.ui.activePage)')).toBe(1);
    await progress.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(progress).toHaveCount(0);
    await expect(page.getByText('PDF-Export abgebrochen.')).toBeVisible();
    await page.waitForTimeout(500);
    expect(downloaded).toBe(false);
  });
});

/** Großer JPEG-Hintergrund (8000 × 6000 px) auf dem Obermarkt, über das Blatt gelegt. */
async function importBigJpeg(page: Page) {
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 8000;
    c.height = 6000;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f4f1ea';
    x.fillRect(0, 0, 8000, 6000);
    x.strokeStyle = '#345';
    x.lineWidth = 3;
    for (let i = 0; i < 8000; i += 41) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(8000 - i, 6000);
      x.stroke();
    }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]!;
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(`${MOD}+Shift+P`);
  await (await chooser).setFiles({ name: 'grossplan.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await expect.poll(() => store(page, 's.project.pages[0].background?.kind'), { timeout: 30_000 }).toBe('image');
}


test.describe('M8: Maßstabsbalken und Nordpfeil', () => {
  test('sichtbar auf dem Blatt, ziehen rastet an der Blattecke, Entf blendet aus, Bereich „Blatt“ blendet ein', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => {
        p.pages[0].areas.push({ id: 'G', name: '', cx: 0, cy: 0, w: 100, d: 60, rot: 0 });
      });
    });
    await page.keyboard.press(`${MOD}+0`);
    await page.keyboard.press(`${MOD}+-`);
    await expect(page.getByTestId('scale-bar')).toBeVisible();
    await expect(page.getByTestId('north-arrow')).toBeVisible();
    await expect(page.getByTestId('scale-bar')).toContainText('1:');
    // Maßstabsbalken in die Nähe der Ecke oben rechts ziehen: rastet dort ein (Anker „oben rechts“)
    const bar = (await page.getByTestId('scale-bar').boundingBox())!;
    const frame = (await page.getByTestId('sheet-frame').boundingBox())!;
    // Nur ein ausgewähltes Papier-Element wird gezogen (§8): erst klicken
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width - bar.width / 2 - 2, frame.y + bar.height / 2 + 30, { steps: 12 });
    await page.mouse.up();
    let a = (await activePg(page)).scaleBar;
    expect(a.corner).toBe('tr');
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'paper', element: 'scaleBar' });
    await expect(page.getByRole('region', { name: 'Maßstabsbalken' })).toBeVisible();
    await page.keyboard.press('Delete');
    a = (await activePg(page)).scaleBar;
    expect(a.visible).toBe(false);
    await expect(page.getByTestId('scale-bar')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Maßstabsbalken' }).check();
    await expect(page.getByTestId('scale-bar')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Nordpfeil' }).uncheck();
    await expect(page.getByTestId('north-arrow')).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.getByTestId('north-arrow')).toBeVisible();
  });
});

test.describe('M8-Nacharbeit: Papier-Elemente stören nicht, Cmd/Strg+0 zeigt das ganze Blatt', () => {
  test('Ziehen auf einem nicht ausgewählten Papier-Element zieht ein Auswahlrechteck auf; Klick wählt es aus', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, rot: 0 };
      s.change('Testdaten', (p: any) => {
        p.pages[0].areas.push({ id: 'G', name: '', cx: 0, cy: 0, w: 100, d: 60, rot: 0 });
        p.pages[0].stands.push({ ...base, id: 's1', cx: -40, cy: -20, w: 4, d: 4 });
      });
    });
    await page.keyboard.press(`${MOD}+0`);
    // Rechteck beginnt auf dem Maßstabsbalken (oben links) und umschließt den Stand
    const bar = (await page.getByTestId('scale-bar').boundingBox())!;
    const s1 = (await page.locator('.stand[data-id="s1"]').boundingBox())!;
    await page.mouse.move(bar.x + 5, bar.y + 5);
    await page.mouse.down();
    await page.mouse.move(s1.x + s1.width + 10, s1.y + s1.height + 10, { steps: 10 });
    await page.mouse.up();
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'objects', ids: ['s1'] });
    expect((await activePg(page)).scaleBar).toMatchObject({ corner: 'tl', dx: 10, dy: 10 });
    // Klick ohne Ziehen wählt den Maßstabsbalken aus
    await page.mouse.click(bar.x + 5, bar.y + 5);
    expect(await store(page, 's.ui.selection')).toEqual({ kind: 'paper', element: 'scaleBar' });
  });

  test('Cmd/Strg+0: ganzes Blatt mit Marke und Papier-Elementen im Fenster', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      s.change('Testdaten', (p: any) => void p.pages[0].areas.push({ id: 'G', name: '', cx: 0, cy: 0, w: 30, d: 10, rot: 0 }));
    });
    await page.keyboard.press(`${MOD}+0`);
    const stage = (await page.locator('svg.canvas').boundingBox())!;
    for (const id of ['sheet-frame', 'sheet-label', 'title-block', 'legend', 'scale-bar', 'north-arrow']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x, id).toBeGreaterThanOrEqual(stage.x - 1);
      expect(b.y, id).toBeGreaterThanOrEqual(stage.y - 1);
      expect(b.x + b.width, id).toBeLessThanOrEqual(stage.x + stage.width + 1);
      expect(b.y + b.height, id).toBeLessThanOrEqual(stage.y + stage.height + 1);
    }
  });
});

test.describe('M8: Dateiformat Version 5', () => {
  test('echte Datei Version 4 öffnen: Anker ergänzt; Speichern schreibt Version 5 ohne exportProfiles', async ({ page }) => {
    await openFixture(page);
    const p = (await store(page, 's.project')) as any;
    expect(p.pages[0].scaleBar).toEqual({ visible: true, corner: 'tl', dx: 10, dy: 10 });
    expect(p.pages[0].northArrow).toEqual({ visible: true, corner: 'tr', dx: 10, dy: 10 });
    expect(await store(page, 's.history.past.length')).toBe(0);
    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const path = await (await download).path();
    const { unzipSync, strFromU8 } = await import('fflate');
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(path)))['project.json']!));
    expect(json.schemaVersion).toBe(9); // seit #3 Version 9, angepasst vom Entwickler (vorher 8)
    expect(json.project).not.toHaveProperty('exportProfiles');
    expect(json.project.pages[2].scaleBar).toEqual({ visible: true, corner: 'tl', dx: 10, dy: 10 });
  });
});
