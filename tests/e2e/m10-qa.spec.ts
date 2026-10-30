import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPdf } from '../../src/core/pdf/pdf.testutil';
import { backToPage, canvasBox, collectErrors, MOD, openApp, openSettings, origin, scale } from './helpers';

/** QA M10: Randfälle zu Fang-Abstand (#2), Standardfarbe (#3), Formatversion 6, Vermerk (#5), Umbenennung (#10). */

type P = { x: number; y: number };
const store = (page: Page) => page.evaluate(() => (window as any).__marktplanerStore.getState().project);
const standById = (page: Page, id: string) =>
  page.evaluate((sid) => (window as any).__marktplanerStore.getState().project.pages[0].stands.find((s: any) => s.id === sid), id);

async function w2s(page: Page, p: P): Promise<P> {
  const box = await canvasBox(page);
  const o = await origin(page);
  const k = await scale(page);
  return { x: box.x + o.x + p.x * k, y: box.y + o.y + p.y * k };
}

async function drag(page: Page, a: P, b: P, hold: string[] = []) {
  const from = await w2s(page, a);
  const to = await w2s(page, b);
  await page.mouse.move(from.x, from.y);
  for (const k of hold) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const k of hold) await page.keyboard.up(k);
}

async function seed(page: Page, data: { stands?: object[]; areas?: object[]; gap?: number }) {
  await page.evaluate((o) => {
    const s = (window as any).__marktplanerStore.getState();
    const base = { nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, rot: 0 };
    s.change('Testdaten', (p: any) => {
      if (o.gap !== undefined) p.settings.snapGap = o.gap;
      for (const a of o.areas ?? []) p.pages[0].areas.push({ name: '', rot: 0, ...a });
      p.pages[0].stands.push(...(o.stands ?? []).map((st: any) => ({ ...base, ...st })));
    });
  }, data);
}

/** Position eines Punkts entlang der Richtung `rot` (Grad). */
const along = (s: { cx: number; cy: number }, rot: number) => s.cx * Math.cos((rot * Math.PI) / 180) + s.cy * Math.sin((rot * Math.PI) / 180);

test.describe('QA M10: Fang-Abstand', () => {
  test('gedrehter Nachbar (30°): Anliegen mit 0,3 m, Fluchten ohne Abstand', async ({ page }) => {
    await openApp(page);
    const r = 30;
    const at = (t: number, n = 0) => ({ cx: t * Math.cos((r * Math.PI) / 180) - n * Math.sin((r * Math.PI) / 180), cy: t * Math.sin((r * Math.PI) / 180) + n * Math.cos((r * Math.PI) / 180) });
    await seed(page, { stands: [{ id: 'a', ...at(0), w: 3, d: 3, rot: r }, { id: 'b', ...at(8), w: 3, d: 3, rot: r }] });
    // b greifen und bis 0,1 m neben die 0,3-m-Lage (Mitte 3,3) ziehen, quer 0,2 m versetzt
    const pt = (c: { cx: number; cy: number }) => ({ x: c.cx, y: c.cy });
    await drag(page, pt(at(8)), pt(at(3.4, 0.2)));
    const b = await standById(page, 'b');
    expect(along(b, r)).toBeCloseTo(3.3, 2); // Koordinaten auf 0,01 m gerundet
    expect(along(b, r + 90)).toBeCloseTo(0, 2);
  });

  test('Mehrfachauswahl: der gegriffene Stand hält den Abstand, die Gruppe bewegt sich parallel', async ({ page }) => {
    await openApp(page);
    await seed(page, { stands: [{ id: 'n', cx: 0, cy: 0, w: 3, d: 3 }, { id: 'a', cx: 10, cy: 0, w: 3, d: 3 }, { id: 'b', cx: 10, cy: 6, w: 3, d: 3 }] });
    await page.evaluate(() => (window as any).__marktplanerStore.getState().setUi({ selection: { kind: 'objects', ids: ['a', 'b'] } }));
    await drag(page, { x: 10, y: 0 }, { x: 3.4, y: 0.2 });
    const a = await standById(page, 'a');
    const b = await standById(page, 'b');
    expect(a.cx).toBeCloseTo(3.3, 4);
    expect(a.cy).toBeCloseTo(0, 4);
    expect(b.cx - a.cx).toBeCloseTo(0, 4);
    expect(b.cy - a.cy).toBeCloseTo(6, 4);
  });

  test('Vorderkante: entlang der Grundfläche hält der Stand 0,3 m zum Nachbarn, auf beiden Seiten', async ({ page }) => {
    await openApp(page);
    await seed(page, {
      areas: [{ id: 'g', cx: 10, cy: -5, w: 30, d: 10 }],
      stands: [{ id: 'n', cx: 10, cy: -1.5, w: 3, d: 3 }, { id: 'm', cx: 20, cy: -1.5, w: 3, d: 3 }],
    });
    // Vorderseite der Grundfläche liegt bei y = 0 (Kante +d/2); m von rechts an n heran
    await drag(page, { x: 20, y: -1.5 }, { x: 13.4, y: -1.5 });
    let m = await standById(page, 'm');
    expect(m.cy).toBeCloseTo(-1.5, 4);
    expect(m.cx).toBeCloseTo(13.3, 4);
    // und von links
    await drag(page, { x: 13.3, y: -1.5 }, { x: 6.6, y: -1.5 });
    m = await standById(page, 'm');
    expect(m.cx).toBeCloseTo(6.7, 4);
  });

  test('Abstand 0 ist bündig, Abstand 10 m bei Übersichtszoom', async ({ page }) => {
    await openApp(page);
    await seed(page, { gap: 0, stands: [{ id: 'n', cx: 0, cy: 0, w: 3, d: 3 }, { id: 'm', cx: 20, cy: 0, w: 3, d: 3 }] });
    await drag(page, { x: 20, y: 0 }, { x: 3.1, y: 0.2 });
    expect((await standById(page, 'm')).cx).toBeCloseTo(3, 4);
  });

  test('QA-M10-01: großer Abstand (2 m, 10 m) rastet beim Standardzoom ein', async ({ page }) => {
    // Erwartet laut spec.md §3 (0–10 m). Bis zur Behebung von QA-M10-01 als test.fail markiert (Markierung vom
    // Entwickler entfernt, wie im Bericht vorgesehen).
    await openApp(page);
    const k = await scale(page);
    test.info().annotations.push({ type: 'Maßstab', description: `${k} px/m` });
    for (const gap of [2, 10]) {
      await page.evaluate(() => (window as any).__marktplanerStore.getState().change('leeren', (p: any) => void (p.pages[0].stands = [])));
      await seed(page, { gap, stands: [{ id: 'n', cx: 0, cy: 0, w: 3, d: 3 }, { id: 'm', cx: 20, cy: 6, w: 3, d: 3 }] });
      const target = 3 + gap;
      await drag(page, { x: 20, y: 6 }, { x: target + 2 / k, y: 0.2 }); // 2 px neben der Ziel-Lage
      expect((await standById(page, 'm')).cx, `Abstand ${gap} m`).toBeCloseTo(target, 4);
    }
  });

  test('Eingabefeld nimmt 0 und 10 m an und weist Werte außerhalb ab', async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    const field = page.locator('#snap-gap');
    for (const [input, want] of [['10', 10], ['25', 10], ['0', 0], ['-3', 0], ['0,05', 0.05]] as const) {
      await field.fill(input);
      await field.press('Enter');
      expect((await store(page)).settings.snapGap, input).toBe(want);
    }
    await backToPage(page);
  });
});

test.describe('QA M10: Formatversion 6 und Standardfarbe', () => {
  test('echte v5-Datei: 0,3 m und Grau; Speichern schreibt Version 6 mit beiden Feldern', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles('tests/fixtures/format-v5-m8.schelme');
    await expect(page.locator('.file-state')).toContainText('format-v5-m8');
    const s = (await store(page)).settings;
    expect(s.snapGap).toBe(0.3);
    expect(s.defaultStandColor).toBe('#a7adb3');
    await openSettings(page);
    await expect(page.locator('#snap-gap')).toHaveValue('0,3');

    const download = page.waitForEvent('download');
    await page.keyboard.press(`${MOD}+s`);
    const d = await download;
    expect(d.suggestedFilename()).toBe('format-v5-m8.mplan');
    const { unzipSync, strFromU8 } = await import('fflate');
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync((await d.path())!)))['project.json']!));
    expect(json.schemaVersion).toBe(11); // seit #9 Version 11, angepasst vom Entwickler (vorher 10, 9, 8)
    expect(json.project.settings.snapGap).toBe(0.3);
    expect(json.project.settings.defaultStandColor).toBe('#a7adb3');
    expect(errors).toEqual([]);
  });

  test('Standardfarbe im PDF (Legende „Geschäft ohne Kategorie“) und Vermerk auf jeder Seite inkl. Anhang', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page, { stands: [{ id: 'plain', cx: 0, cy: 0, w: 3, d: 3, nr: '1', name: 'Ohne Kategorie' }] });
    await openSettings(page);
    await page.getByRole('group', { name: 'Standardfarbe (Geschäfte ohne Kategorie)' }).getByRole('button', { name: 'Farbe #4db6ac' }).click();
    await backToPage(page);

    await page.keyboard.press(`${MOD}+p`);
    const dialog = page.getByRole('dialog', { name: 'Als PDF exportieren' });
    await expect(dialog).toBeVisible();
    // Profil mit Anhang (Standardprofil „Intern“ hat Anhang)
    await expect(page.getByTestId('export-preview')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Exportieren' }).click();
    const bytes = new Uint8Array(readFileSync((await (await download).path())!));
    const pdf = await readPdf(bytes);
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const NOTE = `Marktplaner, Version ${version}, Laurin Ludwig, https://github.com/LaurinLudwig`;
    expect(pdf.pages.length).toBeGreaterThanOrEqual(2); // Plan + Anhang
    for (const p of pdf.pages) {
      expect(p.text).toContain(NOTE);
      // mittig, unten (PDF-Koordinaten: y von unten, 3 mm ≈ 8,5 pt)
      const it = p.items.find((i) => i.str.includes('Marktplaner, Version'))!;
      expect(it.y).toBeLessThan(15);
    }
    expect(pdf.pages.some((p) => p.text.includes('Geschäft ohne Kategorie'))).toBe(true);
    expect(pdf.info.Producer).toBe(`Marktplaner ${version}`);
    expect(String(pdf.info.Creator)).toContain(version);
    // #4db6ac = 0,302 0,714 0,675 als Füllfarbe im Inhaltsstrom
    expect(pdf.raw.map((r) => new TextDecoder('latin1').decode(r)).join('\n')).toMatch(/0\.30\d* 0\.71\d* 0\.67\d* rg/);
    expect(errors).toEqual([]);
  });
});
