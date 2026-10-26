import { expect, type Page } from '@playwright/test';

/** Hilfsfunktionen für die M1-E2E-Tests (QA). */

export const MOD = 'ControlOrMeta';

/** Sammelt Seitenfehler und Konsolenfehler. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('header.tabbar')).toBeVisible();
}

export const tabbar = (page: Page) => page.locator('header.tabbar');
export const pageTabs = (page: Page) => page.locator('header.tabbar [role="tab"]');
export const canvas = (page: Page) => page.locator('svg.canvas');

/** Namen aller Tabs in Reihenfolge (inkl. Start-Page). */
export async function tabNames(page: Page): Promise<string[]> {
  return pageTabs(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
}

export async function activeTabName(page: Page): Promise<string> {
  return page.locator('header.tabbar [role="tab"][aria-selected="true"]').getAttribute('aria-label').then((s) => s ?? '');
}

const parseDe = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/** Maßstab aus der Statusleiste: Pixel pro Meter. */
export async function scale(page: Page): Promise<number> {
  const text = await page.locator('.statusbar span').nth(1).innerText();
  const m = /=\s*([\d.,]+)\s*px/.exec(text);
  if (!m) throw new Error(`Maßstab nicht lesbar: ${text}`);
  return parseDe(m[1]!);
}

/** Bildschirmposition des Weltursprungs (Kreuz auf der Zeichenfläche), relativ zur Zeichenfläche. */
export async function origin(page: Page): Promise<{ x: number; y: number }> {
  const d = (await page.locator('svg.canvas path.origin').getAttribute('d')) ?? '';
  const m = /M(-?[\d.]+) (-?[\d.]+)H/.exec(d);
  if (!m) throw new Error(`Ursprung nicht lesbar: ${d}`);
  return { x: Number(m[1]) + 8, y: Number(m[2]) };
}

export async function canvasBox(page: Page) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('Zeichenfläche nicht sichtbar');
  return box;
}

/** Wartet auf den globalen Tooltip und liefert dessen Text. */
export async function hoverTooltip(page: Page, target: ReturnType<Page['locator']>): Promise<string> {
  await page.mouse.move(5, 790);
  await target.hover({ force: true });
  const tip = page.locator('.tooltip[role="tooltip"]');
  await expect(tip).toBeVisible({ timeout: 2000 });
  return tip.innerText();
}

/** Synthetisches Rad-Ereignis mit vorgegebenen Eigenschaften (Maus vs. Trackpad). */
export async function dispatchWheel(
  page: Page,
  at: { x: number; y: number },
  init: { deltaX?: number; deltaY: number; deltaMode?: number; ctrlKey?: boolean; wheelDeltaY?: number },
) {
  await page.evaluate(
    ({ pos, w }) => {
      const el = document.querySelector('svg.canvas')!;
      const e = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: pos.x,
        clientY: pos.y,
        deltaX: w.deltaX ?? 0,
        deltaY: w.deltaY,
        deltaMode: w.deltaMode ?? 0,
        ctrlKey: w.ctrlKey ?? false,
      });
      if (w.wheelDeltaY !== undefined) Object.defineProperty(e, 'wheelDeltaY', { value: w.wheelDeltaY });
      el.dispatchEvent(e);
    },
    { pos: at, w: init },
  );
}

/**
 * Ablageort für Screenshots, die bei jedem Testlauf neu entstehen (QA-M1-12). Der Ordner steht in
 * .gitignore; versionierte Belege der QA-Berichte liegen unter qa/screenshots/.
 */
export const artifact = (name: string) => `test-artifacts/screenshots/${name}`;

/**
 * M6-07: Projektweite Einstellungen (Beschriftung, Mindestbreite, Warnungsschalter, Kategorien, Nummernkreis) stehen
 * seit M6 in den Projekteinstellungen der Start-Page statt in der Seitenleiste.
 */
export async function openSettings(page: Page) {
  await tabbar(page).getByRole('tab', { name: 'Start-Page' }).click();
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
}

/** Zurück auf die Festplatz-Page Nummer `n` (1 = erster Festplatz). */
export async function backToPage(page: Page, n = 1) {
  await pageTabs(page).nth(n).click();
}

/**
 * Bewegt die Maus an (x, y) und wartet, bis die Zeichenfläche den Zeiger tatsächlich bekommt (die Statusleiste
 * zeigt Koordinaten; sie kommen nur über pointermove auf der Zeichenfläche). Erst dann ist sicher, dass ein
 * folgender Tastendruck dort landet und nicht z. B. am <html>-Element, solange die Seite noch nicht so weit ist
 * (E-39: WebKit unter Last).
 */
export async function pointerOnCanvas(page: Page, x: number, y: number) {
  const coords = page.locator('.statusbar span').first();
  await expect(async () => {
    await page.mouse.move(x - 1, y);
    await page.mouse.move(x, y);
    await expect(coords).not.toContainText('–', { timeout: 200 });
  }).toPass({ timeout: 10_000 });
}
