// Erzeugt die Testdateien unter tests/fixtures/ (Raster mit bekannten Maßen).
// Aufruf: node scripts/make-fixtures.mjs   (braucht die Playwright-Browser für PNG/JPEG)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

// ---------- SVG: 1000 × 800 Einheiten, Linie alle 100 Einheiten (= 10 m bei 0,1 m je Einheit) ----------
function rasterSvg({ withSize }) {
  const lines = [];
  for (let x = 0; x <= 1000; x += 100) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="800" stroke="${x % 500 ? '#9aa' : '#245'}" stroke-width="${x % 500 ? 1 : 2}"/>`);
  for (let y = 0; y <= 800; y += 100) lines.push(`<line x1="0" y1="${y}" x2="1000" y2="${y}" stroke="${y % 500 ? '#9aa' : '#245'}" stroke-width="${y % 500 ? 1 : 2}"/>`);
  const labels = [];
  for (let x = 0; x < 1000; x += 100) labels.push(`<text x="${x + 4}" y="14" font-size="12" fill="#245">${x / 10} m</text>`);
  const cross = (x, y, c) => `<path d="M${x - 12} ${y}H${x + 12}M${x} ${y - 12}V${y + 12}" stroke="${c}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${c}" stroke-width="2"/>`;
  const size = withSize ? ' width="1000" height="800"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 1000 800">
  <rect width="1000" height="800" fill="#ffffff"/>
  ${lines.join('\n  ')}
  ${labels.join('\n  ')}
  ${cross(100, 100, '#d22')}
  ${cross(600, 100, '#d22')}
  ${cross(100, 700, '#22d')}
  <text x="500" y="420" font-size="28" text-anchor="middle" fill="#245">Testraster 10 m · 1000 × 800</text>
</svg>
`;
}
writeFileSync(join(out, 'raster-10m.svg'), rasterSvg({ withSize: true }));
writeFileSync(join(out, 'raster-10m-viewbox.svg'), rasterSvg({ withSize: false }));

// ---------- PNG/JPEG: dasselbe Raster, exakt 1000 × 800 Pixel ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0">${rasterSvg({ withSize: true })}</body></html>`);
const svgEl = page.locator('svg');
await svgEl.screenshot({ path: join(out, 'raster-10m.png'), type: 'png' });
await svgEl.screenshot({ path: join(out, 'raster-10m.jpg'), type: 'jpeg', quality: 90 });
await browser.close();

// ---------- PDF ----------
const MM = 72 / 25.4; // PDF-Punkte je Millimeter

async function gridPage(doc, font, { width, height, cellMm, label }) {
  const p = doc.addPage([width, height]);
  const cell = cellMm * MM;
  const margin = 20 * MM;
  // pdf-lib zählt y von unten; das Raster beginnt oben links am Rand (20 mm)
  const cols = Math.floor((width - 2 * margin) / cell);
  const rows = Math.floor((height - 2 * margin) / cell);
  const top = height - margin;
  for (let i = 0; i <= cols; i++) {
    const x = margin + i * cell;
    p.drawLine({ start: { x, y: top }, end: { x, y: top - rows * cell }, thickness: i % 5 ? 0.4 : 1, color: rgb(0.2, 0.3, 0.4) });
  }
  for (let j = 0; j <= rows; j++) {
    const y = top - j * cell;
    p.drawLine({ start: { x: margin, y }, end: { x: margin + cols * cell, y }, thickness: j % 5 ? 0.4 : 1, color: rgb(0.2, 0.3, 0.4) });
  }
  p.drawText(label, { x: margin, y: margin / 2, size: 12, font, color: rgb(0.1, 0.2, 0.3) });
  return p;
}

// 1:1000, A4 quer: ein Kästchen = 10 mm Papier = 10 m in der Natur
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  await gridPage(doc, font, { width: 842, height: 595, cellMm: 10, label: 'Testplan 1:1000 – ein Kästchen = 10 mm = 10 m' });
  writeFileSync(join(out, 'plan-1zu1000.pdf'), await doc.save());
}

// Zwei Seiten: Deckblatt (A4 hoch) und Plan 1:500 (A3 quer, ein Kästchen = 20 mm = 10 m)
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cover = doc.addPage([595, 842]);
  cover.drawText('Seite 1 – Deckblatt (kein Plan)', { x: 60, y: 760, size: 22, font });
  await gridPage(doc, font, { width: 1191, height: 842, cellMm: 20, label: 'Seite 2 – Testplan 1:500 – ein Kästchen = 20 mm = 10 m' });
  writeFileSync(join(out, 'plan-2seiten.pdf'), await doc.save());
}

console.log('Testdateien erzeugt in', out);
