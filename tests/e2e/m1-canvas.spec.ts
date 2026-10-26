import { expect, test } from '@playwright/test';
import { canvas, canvasBox, dispatchWheel, MOD, openApp, origin, pageTabs, scale, pointerOnCanvas } from './helpers';

/** M1-15, M1-16, M1-17, M1-24: Zoom, Pan, Werkzeuge, Trackpad. */

test.describe('M1 Zeichenfläche: Zoom und Pan', () => {
  test('M1-15: Strg/Cmd + / − zoomen, Strg/Cmd+0 passt an', async ({ page }) => {
    await openApp(page);
    expect(await scale(page)).toBe(10);
    await page.keyboard.press(`${MOD}+=`); // US-Layout: = statt +
    expect(await scale(page)).toBeCloseTo(12.5, 1);
    await page.keyboard.press(`${MOD}+Minus`);
    expect(await scale(page)).toBeCloseTo(10, 1);
    await page.keyboard.press(`${MOD}+Minus`);
    expect(await scale(page)).toBeCloseTo(8, 1);
    await page.keyboard.press(`${MOD}+0`);
    expect(await scale(page)).toBe(10);
  });

  test('M1-15: QWERTZ-Plus (key "+") und Ziffernblock zoomen', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${MOD}+NumpadAdd`);
    expect(await scale(page)).toBeCloseTo(12.5, 1);
    await page.keyboard.press(`${MOD}+NumpadSubtract`);
    expect(await scale(page)).toBeCloseTo(10, 1);
    await page.keyboard.press(`${MOD}+Shift+Equal`); // liefert key "+"
    expect(await scale(page)).toBeCloseTo(12.5, 1);
  });

  test('M1-15: Zoom-Buttons in der Statusleiste mit Tooltip', async ({ page }) => {
    await openApp(page);
    await page.locator('.statusbar').getByRole('button', { name: 'Vergrößern' }).click();
    expect(await scale(page)).toBeCloseTo(12.5, 1);
    await page.locator('.statusbar').getByRole('button', { name: 'Verkleinern' }).click();
    await page.locator('.statusbar').getByRole('button', { name: 'Verkleinern' }).click();
    expect(await scale(page)).toBeCloseTo(8, 1);
    await page.locator('.statusbar').getByRole('button', { name: 'An Fenster anpassen' }).click();
    expect(await scale(page)).toBe(10);
  });

  test('M1-15: Zoom ist nach unten und oben begrenzt (0,2 … 500 px/m)', async ({ page }) => {
    await openApp(page);
    for (let i = 0; i < 40; i++) await page.keyboard.press(`${MOD}+Minus`);
    expect(await scale(page)).toBeCloseTo(0.2, 2);
    for (let i = 0; i < 60; i++) await page.keyboard.press(`${MOD}+=`);
    expect(await scale(page)).toBe(500);
    // Raster-Pfade bleiben endlich (kein NaN/Infinity)
    const d = (await page.locator('svg.canvas path.grid-major').getAttribute('d')) ?? '';
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  test('M1-15: Mausrad zoomt um den Mauszeiger (Chromium, echtes Rad-Ereignis)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright-WebKit liefert synthetische Raddaten, die wie Trackpad aussehen (siehe QA-M1-02)');
    await openApp(page);
    const box = await canvasBox(page);
    const at = { x: box.x + 200, y: box.y + 150 };
    const o0 = await origin(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => scale(page)).toBeGreaterThan(10);
    const k = (await scale(page)) / 10;
    // Punkt unter dem Mauszeiger bleibt stehen: Ursprung wandert entsprechend
    const o1 = await origin(page);
    const local = { x: at.x - box.x, y: at.y - box.y };
    expect(o1.x).toBeCloseTo(local.x - (local.x - o0.x) * k, -1);
    expect(o1.y).toBeCloseTo(local.y - (local.y - o0.y) * k, -1);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => scale(page)).toBeLessThan(10.5);
  });

  test('M1-15: Mausrad (zeilenweise Deltas, Windows/Firefox-Stil) zoomt', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    await dispatchWheel(page, { x: box.x + 300, y: box.y + 300 }, { deltaY: -3, deltaMode: 1 });
    expect(await scale(page)).toBeGreaterThan(10);
  });

  test('M1-24: Mausrad mit wheelDeltaY = 120er-Vielfaches zoomt, verschiebt nicht', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    const o0 = await origin(page);
    await dispatchWheel(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { deltaY: -100, wheelDeltaY: 120 });
    expect(await scale(page)).toBeGreaterThan(10);
    const o1 = await origin(page);
    expect(Math.abs(o1.x - o0.x)).toBeLessThan(1);
  });

  test('M1-24: Pinch (Rad mit Strg) zoomt', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    await dispatchWheel(page, { x: box.x + 300, y: box.y + 300 }, { deltaY: -5, ctrlKey: true, wheelDeltaY: 15 });
    expect(await scale(page)).toBeCloseTo(10 * Math.exp(0.05), 1);
    await dispatchWheel(page, { x: box.x + 300, y: box.y + 300 }, { deltaY: 10, ctrlKey: true, wheelDeltaY: -30 });
    expect(await scale(page)).toBeLessThan(10);
  });

  test('M1-24: Zwei-Finger-Wischen (pixelgenaue Deltas) verschiebt, zoomt nicht', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    const o0 = await origin(page);
    await dispatchWheel(page, { x: box.x + 300, y: box.y + 300 }, { deltaX: 12, deltaY: 30, wheelDeltaY: -90 });
    expect(await scale(page)).toBe(10);
    const o1 = await origin(page);
    expect(o1.x - o0.x).toBeCloseTo(-12, 0);
    expect(o1.y - o0.y).toBeCloseTo(-30, 0);
  });

  test('M1-24: Safari-Pinch-Gesten (gesturechange) zoomen', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'GestureEvent gibt es nur in WebKit');
    await openApp(page);
    const box = await canvasBox(page);
    await page.evaluate(
      ({ x, y }) => {
        const el = document.querySelector('svg.canvas')!;
        const fire = (type: string, s: number) => {
          const e = new Event(type, { bubbles: true, cancelable: true });
          Object.assign(e, { scale: s, clientX: x, clientY: y });
          el.dispatchEvent(e);
        };
        fire('gesturestart', 1);
        fire('gesturechange', 1.5);
        fire('gesturechange', 2);
        fire('gestureend', 2);
      },
      { x: box.x + 300, y: box.y + 300 },
    );
    expect(await scale(page)).toBeCloseTo(20, 0);
  });

  test('M1-16: Leertaste + Ziehen verschiebt die Ansicht (temporäre Hand), danach wieder Auswahl', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    const o0 = await origin(page);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.keyboard.down('Space');
    await expect(page.locator('main.stage')).toHaveClass(/panning/);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const o1 = await origin(page);
    expect(o1.x - o0.x).toBeCloseTo(100, 0);
    expect(o1.y - o0.y).toBeCloseTo(50, 0);
    await expect(page.locator('main.stage')).not.toHaveClass(/panning/);
    await expect(page.getByRole('button', { name: 'Auswahl' })).toHaveAttribute('aria-pressed', 'true');
    // Mit Auswahl-Werkzeug verschiebt Ziehen ohne Leertaste die Ansicht nicht
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 500, { steps: 5 });
    await page.mouse.up();
    expect(await origin(page)).toEqual(o1);
  });

  test('M1-16: Leertaste aktiviert keine fokussierten Buttons', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Hand' }).focus();
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect(page.getByRole('button', { name: 'Auswahl' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('M1-16/M1-17: Hand-Werkzeug (H) verschiebt beim Ziehen; V wechselt zurück', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: 'Hand' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Auswahl' })).toHaveAttribute('aria-pressed', 'false');
    const box = await canvasBox(page);
    const o0 = await origin(page);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 280, { steps: 5 });
    await page.mouse.up();
    const o1 = await origin(page);
    expect(o1.x - o0.x).toBeCloseTo(-50, 0);
    expect(o1.y - o0.y).toBeCloseTo(-20, 0);
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: 'Auswahl' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('M1-16: Mittlere Maustaste verschiebt immer', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    // E-39: erst drücken, wenn die Zeichenfläche den Zeiger bekommt; Ergebnis abwarten statt sofort lesen
    await pointerOnCanvas(page, box.x + 300, box.y + 300);
    const o0 = await origin(page);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + 330, box.y + 300, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(async () => (await origin(page)).x - o0.x).toBeCloseTo(30, 0);
  });

  test('M1-17: Zoom-Werkzeug (Z): Klick vergrößert ×2, Alt+Klick verkleinert', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('z');
    await expect(page.getByRole('button', { name: 'Zoom', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const box = await canvasBox(page);
    await canvas(page).click({ position: { x: 200, y: 200 } });
    expect(await scale(page)).toBe(20);
    await canvas(page).click({ position: { x: 200, y: 200 }, modifiers: ['Alt'] });
    expect(await scale(page)).toBe(10);
    expect(box.width).toBeGreaterThan(0);
  });

  test('M1-17: Werkzeug-Buttons per Klick aktivieren; Werkzeug-Shortcuts in Textfeldern wirkungslos', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Hand' }).click();
    await expect(page.getByRole('button', { name: 'Hand' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zoom', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Im Umbenennen-Feld darf „v“ nicht das Werkzeug wechseln
    await pageTabs(page).nth(1).dblclick();
    await page.getByRole('textbox', { name: 'Name des Festplatzes' }).fill('');
    await page.keyboard.type('vhz');
    await expect(page.getByRole('textbox', { name: 'Name des Festplatzes' })).toHaveValue('vhz');
    await expect(page.getByRole('button', { name: 'Zoom', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
  });

  test('Ansicht ist pro Page eigenständig und wird beim Wechsel beibehalten', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${MOD}+=`);
    await page.keyboard.press(`${MOD}+=`);
    const s1 = await scale(page);
    await page.locator('.tab-add').click();
    expect(await scale(page)).toBe(10);
    await pageTabs(page).nth(1).click();
    expect(await scale(page)).toBeCloseTo(s1, 1);
  });

  test('Statusleiste zeigt Koordinaten in Metern unter dem Mauszeiger', async ({ page }) => {
    await openApp(page);
    const box = await canvasBox(page);
    const o = await origin(page);
    // 50 px rechts, 20 px unter dem Ursprung bei 10 px/m → x 5, y 2
    await page.mouse.move(box.x + o.x + 50, box.y + o.y + 20);
    await expect(page.locator('.statusbar span').first()).toContainText('x 5 y 2 m');
  });
});
