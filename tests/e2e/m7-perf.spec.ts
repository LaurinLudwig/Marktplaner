import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, openApp } from './helpers';
import { expectCriterion, importBigPlan, measureOnce, RUNS, setScale, summarize, type Kind, type Run } from './perf-helpers';

/**
 * M7-13 Lasttest (spec.md NFA, Q-04): wie M4-21 (500 Stände, rund 500 Freiflächen, Plan 8000 × 6000 px), dazu
 * 100 Infrastruktur-Objekte aller Geometrien (belegende Toilettenwagen in den Grundflächen, Durchfahrten,
 * Sperren, RTW-Plätze mit Warnung „Infrastruktur“, Marker) sowie Blatt, Schriftfeld und Legende.
 * Median aus 5 Messläufen mindestens 50 Bilder/s, kein Bild über 100 ms.
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
            suppressDuplicateWarning: false,
            suppressInfraWarning: false,
            cx: -98 + i * 4 + shift,
            cy: y + 1 + (i % 7 === 3 ? 1 : 0),
            w: 3,
            d: 3,
            rot: 0,
          });
          n++;
        }
      }
      // 100 Infrastruktur-Objekte: je Reihe 3 Toilettenwagen in der Grundfläche (belegen), 2 Durchfahrten zwischen
      // den Reihen, 2 Sperren, 1 RTW-Platz über einem Stand (Warnung), 2 Marker
      const I = { note: '', powerKw: 0, connection: null, suppressWidthWarning: false };
      for (let row = 0; row < 10; row++) {
        const y = row * 6.6 - 30;
        for (let k = 0; k < 3; k++) pg.infra.push({ ...I, id: `w${row}-${k}`, typeId: 'toilet', label: 'WC', cx: -60 + k * 60 + 0.5, cy: y + 1, w: 2, d: 2.5, rot: 0 });
        for (let k = 0; k < 2; k++) pg.infra.push({ ...I, id: `p${row}-${k}`, typeId: 'narrowPassage', label: '', cx: -40 + k * 80, cy: y + 4.4, w: 3.2, d: 0, rot: 90 });
        for (let k = 0; k < 2; k++) pg.infra.push({ ...I, id: `b${row}-${k}`, typeId: k ? 'barrierFixed' : 'barrierMobile', label: '', cx: 105, cy: y + k * 2, w: 3.5, d: k ? 0.8 : 0.3, rot: 90 });
        pg.infra.push({ ...I, id: `r${row}`, typeId: 'ambulance', label: 'RTW', cx: -20 + row * 4, cy: y + 1, w: 8, d: 3.5, rot: 0 });
        for (let k = 0; k < 2; k++) pg.infra.push({ ...I, id: `m${row}-${k}`, typeId: 'marker', label: `Treffpunkt ${row}${k}`, cx: -110 + k * 220, cy: y, w: 0, d: 0, rot: 0 });
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
  await expect(page.locator('.world .infra')).toHaveCount(100);
  await expect(page.locator('.infra.warn-narrow')).toHaveCount(20);
  await expect(page.getByTestId('legend')).toBeVisible();
}

test.describe('M7-13: Bildrate mit Infrastruktur', () => {
  test('500 Stände, 100 Infrastruktur-Objekte, Freiflächen, Plan 8000 × 6000 px: Median ≥ 50 Bilder/s, kein Bild über 100 ms', async ({ page }, info) => {
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
    writeFileSync(`test-artifacts/logs/m7-perf-${info.project.name}.json`, JSON.stringify(result, null, 2));
    const brief = (m: { fps: number; maxFrameMs: number; runs: Run[] }) => `${m.fps.toFixed(1)} (Läufe ${m.runs.map((r) => r.fps.toFixed(1)).join('/')}; längstes ${Math.round(m.maxFrameMs)} ms)`;
    console.warn(`Lasttest M7 ${info.project.name}: Zoomen ${brief(zoom)} · Verschieben ${brief(pan)} · Lesegröße ${brief(panReadable)} · Ziehen ${brief(drag)}`);
    expectCriterion('Zoomen', zoom);
    expectCriterion('Verschieben', pan);
    expectCriterion('Verschieben in Lesegröße', panReadable);
    expectCriterion('Ziehen über Grundflächen', drag);
  });
});
