import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, openApp } from './helpers';
import { expectCriterion, importBigPlan, measureOnce, RUNS, setScale, summarize, type Kind, type Run } from './perf-helpers';

/**
 * M12 Lasttest (spec.md NFA, Q-04, #9): wie M4-21 (500 Stände, rund 500 Freiflächen, Plan 8000 × 6000 px), die Stände
 * aber in Formen: je ein Drittel Rechteck, Kreis/Oval (64 Ecken) und zusammengesetzte Formvorlage (Füllung + äußere
 * Kontur). Median aus 5 Messläufen mindestens 50 Bilder/s, kein Bild über 100 ms.
 */

/**
 * 10 Grundflächen 200 × 5 m (Abstand 6,6 m), je 50 Stände 3 × 3 m bündig an der Vorderseite mit 1 m Lücke. Jeder
 * zehnte Stand ist um 1,5 m verschoben (Überlappung), jeder siebte ragt nach vorn heraus (außerhalb).
 */
async function seed(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Lasttest', (p: any) => {
      p.shapeTemplates.push({ id: 'k', name: 'Karussell', w: 3, d: 3, parts: [{ kind: 'ellipse', x: 0, y: 0, w: 1, h: 0.75 }, { kind: 'rect', x: 0.3, y: 0.6, w: 0.4, h: 0.4 }] });
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
            suppressDuplicateWarning: false,
            suppressInfraWarning: false,
            shape: n % 3 === 1 ? 'ellipse' : 'rect',
            shapeTemplateId: n % 3 === 2 ? 'k' : null,
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
  await expect(page.locator('.stand-group')).toHaveCount(167);
  expect(await page.locator('.free-space').count()).toBeGreaterThan(400);
}

test.describe('M12: Bildrate mit Geschäftsformen', () => {
  test('500 Stände in Formen, Freiflächen, Plan 8000 × 6000 px: Median ≥ 50 Bilder/s, kein Bild über 100 ms', async ({ page }, info) => {
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
        // Stand s413 (Reihe 9, Formvorlage) greifen und nach oben über die Reihen ziehen; Esc bricht ab
        const t = await page.evaluate(() => {
          const s = (window as any).__marktplanerStore.getState();
          const st = s.project.pages[0].stands.find((x: any) => x.id === 's413');
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
    const drag = await series('drag', 5.5);

    const result = { browser: info.project.name, zoom, pan, drag };
    mkdirSync('test-artifacts/logs', { recursive: true });
    writeFileSync(`test-artifacts/logs/m12-perf-${info.project.name}.json`, JSON.stringify(result, null, 2));
    const brief = (m: { fps: number; maxFrameMs: number; runs: Run[] }) => `${m.fps.toFixed(1)} (Läufe ${m.runs.map((r) => r.fps.toFixed(1)).join('/')}; längstes ${Math.round(m.maxFrameMs)} ms)`;
    console.warn(`Lasttest M12 ${info.project.name}: Zoomen ${brief(zoom)} · Verschieben ${brief(pan)} · Ziehen ${brief(drag)}`);
    expectCriterion('Zoomen', zoom);
    expectCriterion('Verschieben', pan);
    expectCriterion('Ziehen über Grundflächen', drag);
  });
});
