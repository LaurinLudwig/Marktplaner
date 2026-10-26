import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, openApp } from './helpers';
import { expectCriterion, importBigPlan, measureOnce, RUNS, setScale, summarize, type Kind, type Run } from './perf-helpers';

/**
 * M4-21 Lasttest = Abnahmekriterium (spec.md NFA, präzisiert 2026-10-11, QA-M4-03):
 * 500 Stände, viele Freiflächen und ein Hintergrundplan 8000 × 6000 px. Median aus 5 Messläufen
 * mindestens 50 Bilder/s beim Zoomen, Verschieben der Ansicht und Ziehen eines Stands (quer über
 * mehrere Grundflächen, mit Freiflächen, Warnungen und allen Fang-Optionen), in Chromium und WebKit;
 * kein einzelnes Bild über 100 ms.
 */

/**
 * 10 Grundflächen 200 × 5 m (Abstand 6,6 m), je 50 Stände 3 × 3 m bündig an der Vorderseite mit 1 m
 * Lücke: rund 500 Freiflächen. Jeder zehnte Stand ist um 1,5 m verschoben (Überlappung), jeder
 * siebte ragt nach vorn heraus (außerhalb).
 */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Lasttest', (p: any) => {
      const pg = p.pages[0];
      let n = 1;
      for (let row = 0; row < 10; row++) {
        const y = row * 6.6 - 30;
        pg.areas.push({ id: `a${row}`, name: `Reihe ${row + 1}`, cx: 0, cy: y, w: 200, d: 5, rot: 0 });
        for (let i = 0; i < 50; i++) {
          const shift = i % 10 === 9 ? -1.5 : 0;
          pg.stands.push({
            id: `s${n}`,
            nr: String(n),
            nrLocked: false,
            name: `Geschäft Nummer ${n}`,
            owner: 'Muster',
            ware: 'Ware',
            powerKw: 3,
            connection: 'CEE16',
            note: '',
            categoryId: null,
            color: i % 3 === 0 ? '#e57373' : null,
            suppressOutsideWarning: false,
            suppressOverlapWarning: false,
            cx: -98 + i * 4 + shift,
            cy: y + 1 + (i % 7 === 3 ? 1 : 0),
            w: 3,
            d: 3,
            rot: 0,
          });
          n++;
        }
      }
      p.settings.snap = { front: true, grid: true, neighbors: true };
    });
    const { w, h } = s.ui.viewport;
    s.setView(s.project.pages[0].id, { scale: 5.5, tx: w / 2, ty: h / 2 });
  });
  await expect(page.locator('.stand-label')).toHaveCount(500);
  expect(await page.locator('.free-space').count()).toBeGreaterThan(400);
  expect(await page.locator('.stand[data-warning="overlap"]').count()).toBeGreaterThan(0);
  expect(await page.locator('.stand[data-warning="outside"]').count()).toBeGreaterThan(0);
}

test.describe('M4-21: Abnahmekriterium Bildrate', () => {
  test('500 Stände, Freiflächen, Plan 8000 × 6000 px: Median ≥ 50 Bilder/s, kein Bild über 100 ms', async ({ page }, info) => {
    test.setTimeout(300_000);
    await openApp(page);
    await importBigPlan(page);
    await seed(page);
    const box = await canvasBox(page);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const series = async (kind: Kind, scale: number) => {
      const runs: Run[] = [];
      for (let k = 0; k < RUNS; k++) {
        await setScale(page, scale);
        if (kind !== 'drag') {
          runs.push(await measureOnce(page, kind, center));
          continue;
        }
        // Stand s412 (Reihe 9) greifen und nach oben über die Reihen ziehen; Esc bricht ab
        const t = await page.evaluate(() => {
          const s = (window as any).__marktplanerStore.getState();
          const st = s.project.pages[0].stands.find((x: any) => x.id === 's412');
          const v = s.views[s.project.pages[0].id];
          return { x: v.tx + st.cx * v.scale, y: v.ty + st.cy * v.scale };
        });
        const grab = { x: box.x + t.x, y: box.y + t.y };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x + 5, grab.y - 5, { steps: 3 });
        runs.push(await measureOnce(page, 'drag', grab));
        expect(await page.evaluate(() => !!(window as any).__marktplanerStore.getState().preview)).toBe(true);
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      return summarize(runs);
    };

    const zoom = await series('zoom', 5.5);
    const pan = await series('pan', 5.5);
    // Lesegröße: Freiflächen-Beschriftung (ab 6 px) und heller Rand (ab 12 px) sichtbar
    await setScale(page, 20);
    await expect(page.locator('.layer-labels.halo')).toHaveCount(1);
    expect(await page.locator('.free-label').count()).toBeGreaterThan(20);
    const panReadable = await series('pan', 20);
    const drag = await series('drag', 5.5);

    const result = { browser: info.project.name, zoom, pan, panReadable, drag };
    mkdirSync('test-artifacts/logs', { recursive: true });
    writeFileSync(`test-artifacts/logs/m4-perf-${info.project.name}.json`, JSON.stringify(result, null, 2));
    const brief = (m: { fps: number; maxFrameMs: number; runs: Run[] }) => `${m.fps.toFixed(1)} (Läufe ${m.runs.map((r) => r.fps.toFixed(1)).join('/')}; längstes ${Math.round(m.maxFrameMs)} ms)`;
    console.warn(`Lasttest M4 ${info.project.name}: Zoomen ${brief(zoom)} · Verschieben ${brief(pan)} · Lesegröße ${brief(panReadable)} · Ziehen ${brief(drag)}`);
    expectCriterion('Zoomen', zoom);
    expectCriterion('Verschieben', pan);
    expectCriterion('Verschieben in Lesegröße', panReadable);
    expectCriterion('Ziehen über Grundflächen', drag);
  });
});
