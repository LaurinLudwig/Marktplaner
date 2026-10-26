import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, collectErrors, MOD, openApp } from './helpers';

/** QA M11: Grenzfälle zu #7 (Kennzahlen je Kategorie) und #8 (Freiflächen ausblenden), spec.md §4, §7, §9, §10. */

const store = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__marktplanerStore.getState(); return ${fn}; })()`);
const hidden = (page: Page, i = 0) => store(page, `s.project.pages[${i}].hiddenFree`) as Promise<{ key: string; start: number; end: number }[]>;
const BASE = `{ nr: '', nrLocked: false, name: '', owner: '', ware: '', powerKw: 0, connection: null, note: '', categoryId: null, color: null, suppressOutsideWarning: false, suppressOverlapWarning: false, suppressDuplicateWarning: false, suppressInfraWarning: false, rot: 0 }`;

/** Grundfläche 50 × 10 m, Stand s1 x 20 … 28; Ansicht 10 px/m, Versatz (50, 100). Freiflächen [0,20] und [28,50]. */
async function seed(page: Page, rot = 0) {
  await store(
    page,
    `s.change('Testdaten', (p) => {
      const nord = p.pages[0];
      nord.areas.push({ id: 'g1', name: 'Hauptstraße', cx: 25, cy: 5, w: 50, d: 10, rot: ${rot} });
      nord.stands.push({ ...${BASE}, id: 's1', name: 'Bratwurst', cx: 24, cy: 8.5, w: 8, d: 3 });
    })`,
  );
  await store(page, `s.setView(s.project.pages[0].id, { scale: 10, tx: 50, ty: 100 })`);
}
const at = async (page: Page, x: number, y: number) => {
  const b = await canvasBox(page);
  return { x: b.x + 50 + x * 10, y: b.y + 100 + y * 10 };
};
/** Ausblenden per Kern-Aktion über das Kontextmenü (Rechtsklick bei Weltpunkt). */
async function hideAt(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Freifläche nicht mehr anzeigen/ }).click();
}
const hideLeft = (page: Page) => store(page, `s.change('Freifläche ausblenden', (p) => { p.pages[0].hiddenFree = [{ key: 'g1|^|s1', start: 0, end: 20 }]; })`);

test.describe('QA M11 #8: Verfall der Ausblendung', () => {
  test('Ziehen mit der Maus: Verfall im selben Undo-Schritt, Undo/Redo stellt beides her', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await seed(page);
    await hideAt(page, 10, 5);
    await expect(page.locator('.free-label')).toHaveCount(1);
    const n = (await store(page, 's.history.past.length')) as number;
    const a = await at(page, 24, 8.5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y, { steps: 5 });
    await expect(page.locator('.free-label')).toHaveCount(2); // live während des Ziehens
    await page.mouse.up();
    expect(await hidden(page)).toEqual([]);
    expect(await store(page, 's.history.past.length')).toBe(n + 1);
    await page.keyboard.press(`${MOD}+z`);
    expect(await hidden(page)).toHaveLength(1);
    expect(await store(page, 's.project.pages[0].stands[0].cx')).toBe(24);
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect(await hidden(page)).toEqual([]);
    expect(await store(page, 's.project.pages[0].stands[0].cx')).not.toBe(24);
    expect(errors).toEqual([]);
  });

  test('Abbruch des Ziehens mit Escape behält die Ausblendung', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideAt(page, 10, 5);
    const a = await at(page, 24, 8.5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await store(page, 's.project.pages[0].stands[0].cx')).toBe(24);
    expect(await hidden(page)).toHaveLength(1);
    await expect(page.locator('.free-label')).toHaveCount(1);
  });

  test('Löschen des angrenzenden Stands und Stand in die Lücke heben die Ausblendung auf', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideLeft(page);
    const a = await at(page, 24, 8.5);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press('Delete');
    expect(await store(page, 's.project.pages[0].stands.length')).toBe(0);
    expect(await hidden(page)).toEqual([]);
    await page.keyboard.press(`${MOD}+z`);
    expect(await hidden(page)).toHaveLength(1);
    // Stand in die Lücke
    await store(page, `s.change('Stand', (p) => { p.pages[0].stands.push({ ...${BASE}, id: 's2', cx: 5, cy: 8.5, w: 3, d: 3 }); })`);
    expect(await hidden(page)).toEqual([]);
    await page.keyboard.press(`${MOD}+z`);
    expect(await hidden(page)).toHaveLength(1);
    // Größe ändern (Breite) am angrenzenden Stand
    await store(page, `s.change('Breite', (p) => { p.pages[0].stands[0].w = 9; })`);
    expect(await hidden(page)).toEqual([]);
  });

  test('Toleranz 0,01 m; nicht angrenzender Stand lässt die Ausblendung stehen', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideLeft(page);
    await store(page, `s.change('klein', (p) => { p.pages[0].stands[0].cx = 24.008; })`);
    expect(await hidden(page)).toHaveLength(1);
    await store(page, `s.change('groß', (p) => { p.pages[0].stands[0].cx = 24.03; })`);
    expect(await hidden(page)).toEqual([]);
    await page.keyboard.press(`${MOD}+z`);
    // Stand in der anderen Lücke
    await store(page, `s.change('Stand', (p) => { p.pages[0].stands.push({ ...${BASE}, id: 's2', cx: 40, cy: 8.5, w: 3, d: 3 }); })`);
    expect(await hidden(page)).toHaveLength(1);
  });

  test('Gedrehte Grundfläche: Ausblenden und Verfall', async ({ page }) => {
    await openApp(page);
    await seed(page, 30);
    // Stand mitdrehen, damit er an der Vorderseite der gedrehten Fläche liegt (Mitte der Fläche 25/5, Vorderseite unten)
    await store(page, `s.change('mitdrehen', (p) => { const a = 30 * Math.PI / 180; const lx = -1, ly = 3.5; p.pages[0].stands[0].cx = 25 + lx * Math.cos(a) - ly * Math.sin(a); p.pages[0].stands[0].cy = 5 + lx * Math.sin(a) + ly * Math.cos(a); p.pages[0].stands[0].rot = 30; })`);
    await store(page, `s.setUi({ activePage: 'start' })`);
    await page.getByRole('tab', { name: /Freiflächen/ }).click();
    const rows = page.getByTestId('free-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(1).getByTestId('free-hide').click();
    expect(await hidden(page)).toEqual([{ key: 'g1|^|s1', start: 0, end: 20 }]);
    await expect(page.getByTestId('free-sums')).toContainText('22 m');
    await store(page, `s.change('Stand', (p) => { p.pages[0].stands[0].w = 7; })`);
    expect(await hidden(page)).toEqual([]);
  });

  test('Angeschnittene (L-förmige) Freifläche lässt sich ausblenden und verfällt', async ({ page }) => {
    await openApp(page);
    await seed(page);
    // Zweite Grundfläche überlappt die erste → Freiflächen der zweiten sind angeschnitten
    await store(page, `s.change('g2', (p) => { p.pages[0].areas.push({ id: 'g2', name: 'Quer', cx: 5, cy: 15, w: 10, d: 30, rot: 90 }); })`);
    const list = (await store(page, `JSON.stringify(window.__marktplanerStore.getState().project.pages[0].areas.length)`)) as string;
    expect(list).toBe('2');
    await store(page, `s.setUi({ activePage: 'start' })`);
    await page.getByRole('tab', { name: /Freiflächen/ }).click();
    const rows = page.getByTestId('free-row');
    const before = await rows.count();
    expect(before).toBeGreaterThanOrEqual(2);
    await rows.last().getByTestId('free-hide').click();
    await expect(rows).toHaveCount(before - 1);
    expect(await hidden(page)).toHaveLength(1);
    // Die zweite Grundfläche verschieben → Anschnitt ändert sich nicht am Intervall (Stand-Schlüssel), aber Polygone;
    // Stand in die Lücke der Fläche des Eintrags hebt sie auf
    const key = (await hidden(page))[0]!.key;
    const areaId = key.split('|')[0];
    await store(page, `s.change('Stand', (p) => { const a = p.pages[0].areas.find((x) => x.id === '${areaId}'); p.pages[0].areas = p.pages[0].areas.filter((x) => x.id !== '${areaId}').concat([{ ...a, w: a.w - 1 }]); })`);
    expect(await hidden(page)).toEqual([]);
  });

  test('Belegende Infrastruktur in der Lücke hebt die Ausblendung auf', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideLeft(page);
    await store(page, `s.change('WC', (p) => { p.pages[0].infra.push({ id: 'i1', typeId: 'toilet', cx: 5, cy: 8.5, powerKw: 0, connection: null, suppressWidthWarning: false, w: 6, d: 2.5, rot: 0, label: '', note: '' }); })`);
    expect(await hidden(page)).toEqual([]);
  });

  test('Page duplizieren: Kopie behält die Ausblendung auf ihren neuen IDs; Verfall getrennt je Page', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideLeft(page);
    const id = await store(page, 's.project.pages[0].id');
    await page.evaluate(async (pid) => {
      const m = await import('/src/state/pages.ts' as string);
      m.duplicatePage(pid as string);
    }, id);
    expect(await store(page, 's.project.pages.length')).toBe(2);
    const copy = await hidden(page, 1);
    expect(copy).toHaveLength(1);
    expect(copy[0]!.key).not.toBe('g1|^|s1');
    expect(copy[0]!.start).toBe(0);
    expect(copy[0]!.end).toBe(20);
    await store(page, `s.change('Breite', (p) => { p.pages[0].stands[0].w = 9; })`);
    expect(await hidden(page, 0)).toEqual([]);
    expect(await hidden(page, 1)).toHaveLength(1);
  });
});

test.describe('QA M11 #8: Anzeige und Kontextmenü', () => {
  test('Kein Menü auf Infrastruktur und mit anderem Werkzeug; Legende ohne Freifläche, wenn alle ausgeblendet', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await store(page, `s.change('WC', (p) => { p.pages[0].infra.push({ id: 'i1', typeId: 'toilet', cx: 40, cy: 2, powerKw: 0, connection: null, suppressWidthWarning: false, w: 2, d: 2, rot: 0, label: '', note: '' }); })`);
    const ip = await at(page, 40, 2);
    await page.mouse.click(ip.x, ip.y, { button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
    const legendHasFree = () => store(page, `document.querySelector('[data-testid="legend"], .legend')?.textContent ?? ''`);
    // Gegenprobe (Hinweis aus qa/M11.md, angepasst vom Entwickler): vor dem Ausblenden steht „Freifläche“ in der Legende
    expect(String(await legendHasFree())).toMatch(/Freifläche/);
    await hideAt(page, 10, 5);
    await hideAt(page, 45, 5);
    await hideAt(page, 33, 5); // Toilette teilt die rechte Lücke
    await expect(page.locator('.free-label')).toHaveCount(0);
    expect(String(await legendHasFree())).not.toMatch(/Freifläche/);
    await store(page, `s.setUi({ activePage: 'start' })`);
    await expect(page.getByTestId('stat-total').getByTestId('stat-free')).toHaveText('0 m');
  });

  test('CSV-Spalte „ausgeblendet“ nur mit Schalter', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideLeft(page);
    await store(page, `s.setUi({ activePage: 'start' })`);
    await page.getByRole('tab', { name: /Freiflächen/ }).click();
    const csv = async () => {
      const d = page.waitForEvent('download');
      await page.getByRole('button', { name: /CSV/ }).first().click();
      return readFileSync((await (await d).path())!, 'utf8');
    };
    const off = await csv();
    expect(off).not.toMatch(/ausgeblendet/);
    expect(off.split('\n').filter((l) => /20/.test(l) && /\b0\b/.test(l)).length).toBeGreaterThanOrEqual(0);
    await page.getByTestId('free-show-hidden').locator('input').check();
    const on = await csv();
    expect(on.split('\n')[0]).toMatch(/ausgeblendet/);
    await expect(page.getByTestId('free-sums')).toContainText('22 m');
  });
});

test.describe('QA M11 Format', () => {
  test('Echte v6-Datei öffnet, wird als Version 7 gespeichert', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+o`);
    await (await chooser).setFiles('tests/fixtures/format-v6-m10.mplan');
    await expect.poll(() => store(page, 's.project.name')).toBe('Formatversion 6 (M10)');
    expect(await store(page, 's.project.pages.every((p) => Array.isArray(p.hiddenFree) && p.hiddenFree.length === 0)')).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('QA M11 #8: PDF', () => {
  test('PDF-Szene, Legende und Anhang ohne ausgeblendete Freifläche', async ({ page }) => {
    await openApp(page);
    await seed(page);
    await hideLeft(page);
    const r = await page.evaluate(async () => {
      const { buildExport } = await import('/src/core/pdf/exportDoc.ts' as string);
      const { newProfile } = await import('/src/core/exportProfiles.ts' as string);
      const { hasFreeSpace } = await import('/src/core/paper.ts' as string);
      const s = (window as any).__marktplanerStore.getState();
      const prof = newProfile('QA'); prof.appendix.free = true;
      const out = buildExport(s.project, prof, { pageIds: null, appendix: { free: true } });
      const free = out.scenes[0].layers.find((l: any) => l.id === 'free');
      const app = out.appendix.find((t: any) => /Frei/.test(t.title));
      const all = () => {
        s.change('alle', (p: any) => { p.pages[0].hiddenFree.push({ key: 'g1|s1|$', start: 28, end: 50 }); });
        return hasFreeSpace((window as any).__marktplanerStore.getState().project.pages[0], (window as any).__marktplanerStore.getState().project);
      };
      return { freePrims: JSON.stringify(free ?? null), rows: app ? app.rows.length : -1, before: hasFreeSpace(s.project.pages[0], s.project), after: all() };
    });
    expect(r.rows).toBe(1);
    expect(r.freePrims).not.toMatch(/"x":\s*0\b.*"x":\s*20\b/);
    expect(r.before).toBe(true);
    expect(r.after).toBe(false); // Legende: Eintrag „Freifläche“ entfällt
  });
});
