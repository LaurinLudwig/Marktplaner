import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, openApp } from './helpers';
import { expectCriterion, measureOnce, RUNS, setScale, summarize, type Kind, type Run } from './perf-helpers';

/**
 * M3-23 Lasttest (Regression, ohne Hintergrundplan): 500 Stände mit Beschriftung auf einer Page.
 * Gewertet wie das Abnahmekriterium (spec.md NFA, perf-helpers.ts): Median aus 5 Läufen mindestens
 * 50 Bilder/s beim Zoomen, Verschieben der Ansicht und Ziehen eines Stands; kein Bild über 100 ms.
 */

/** 10 Grundflächen mit je 50 Ständen (3 × 3 m, Name und Nummer), zusammen 200 × 66 m. */
async function seed500(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__marktplanerStore.getState();
    s.change('Lasttest', (p: any) => {
      const pg = p.pages[0];
      let n = 1;
      for (let row = 0; row < 10; row++) {
        const y = row * 6.6 - 30;
        pg.areas.push({ id: `a${row}`, name: `Reihe ${row + 1}`, cx: 0, cy: y, w: 200, d: 3.5, rot: 0 });
        for (let i = 0; i < 50; i++) {
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
            cx: -98 + i * 4,
            cy: y,
            w: 3,
            d: 3,
            rot: (i * 7) % 360,
          });
          n++;
        }
      }
    });
    const { w, h } = s.ui.viewport;
    // 5,5 px/m: alle Stände im Bild, Beschriftung (0,6 m ≈ 3,3 px) ist sichtbar
    s.setView(p0(s), { scale: 5.5, tx: w / 2, ty: h / 2 });
    function p0(st: any) {
      return st.project.pages[0].id;
    }
  });
  await expect(page.locator('.stand-label')).toHaveCount(500);
  await expect(page.locator('.layer-labels.tiny')).toHaveCount(0);
}

test.describe('M3-23: Lasttest 500 Stände', () => {
  test('Zoomen, Verschieben der Ansicht und Ziehen eines Stands mit mindestens 50 Bildern/s', async ({ page }, info) => {
    test.setTimeout(240_000);
    await openApp(page);
    await seed500(page);
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
        // Stand s225 (Reihe 5, Mitte) mit der echten Maus greifen, dann pro Frame bewegen; Esc bricht ab
        const target = await page.evaluate(() => {
          const s = (window as any).__marktplanerStore.getState();
          const st = s.project.pages[0].stands.find((x: any) => x.id === 's225');
          const v = s.views[s.project.pages[0].id];
          return { x: v.tx + st.cx * v.scale, y: v.ty + st.cy * v.scale };
        });
        const grab = { x: box.x + target.x, y: box.y + target.y };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x + 5, grab.y + 5, { steps: 3 });
        runs.push(await measureOnce(page, 'drag', grab, 'diagonal'));
        expect(await page.evaluate(() => !!(window as any).__marktplanerStore.getState().preview)).toBe(true);
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      return summarize(runs);
    };
    const zoom = await series('zoom', 5.5);
    const pan = await series('pan', 5.5);
    // Lesegröße (Schrift ≥ 12 px, mit hellem Rand um die Beschriftung): ein Ausschnitt mit ca. 130 Ständen
    await setScale(page, 20);
    await expect(page.locator('.layer-labels.halo')).toHaveCount(1);
    const panReadable = await series('pan', 20);
    const drag = await series('drag', 5.5);
    // Ein abschließendes Ziehen mit Loslassen ist genau ein Undo-Schritt
    const past0 = await page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length);
    const t = await page.evaluate(() => {
      const s = (window as any).__marktplanerStore.getState();
      const st = s.project.pages[0].stands.find((x: any) => x.id === 's225');
      const v = s.views[s.project.pages[0].id];
      return { x: v.tx + st.cx * v.scale, y: v.ty + st.cy * v.scale };
    });
    await page.mouse.move(box.x + t.x, box.y + t.y);
    await page.mouse.down();
    await page.mouse.move(box.x + t.x + 40, box.y + t.y + 40, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).__marktplanerStore.getState().history.past.length)).toBe(past0 + 1);

    const result = { browser: info.project.name, zoom, pan, panReadable, drag };
    mkdirSync('test-artifacts/logs', { recursive: true });
    writeFileSync(`test-artifacts/logs/m3-perf-${info.project.name}.json`, JSON.stringify(result, null, 2));
    console.warn(`Lasttest M3 ${info.project.name}: Zoomen ${zoom.fps.toFixed(1)} · Verschieben ${pan.fps.toFixed(1)} · Lesegröße ${panReadable.fps.toFixed(1)} · Ziehen ${drag.fps.toFixed(1)} · längstes Bild ${Math.round(Math.max(zoom.maxFrameMs, pan.maxFrameMs, panReadable.maxFrameMs, drag.maxFrameMs))} ms`);
    expectCriterion('Zoomen', zoom);
    expectCriterion('Verschieben', pan);
    expectCriterion('Verschieben in Lesegröße', panReadable);
    expectCriterion('Ziehen', drag);
  });
});
