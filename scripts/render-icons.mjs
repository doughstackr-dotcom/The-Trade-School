#!/usr/bin/env node
// Renders the app icons in icons/ from one SVG design: the brand mark (a hollow bear candle and
// a gold bull candle, as in js/main.js brandMark()) on the dark navy ground of the token palette.
//
//   node scripts/render-icons.mjs
//
// Writes icons/icon.svg (any size, rounded tile), icon-192.png, icon-512.png, maskable-512.png
// (full-bleed, mark inside the 80% safe zone), apple-touch-icon-180.png (full-bleed; iOS rounds
// the corners) and favicon-32.png (bigger mark, no grid). PNGs are Chromium screenshots of the
// SVG, so Playwright must be installed (locally or globally). Only needed when the design changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');

// Dark palette (css/tokens.css).
const NAVY = '#0B1220';      // --bg
const NAVY_2 = '#111A2B';    // --surface
const GRID = '#1B2640';      // --grid
const SLATE = '#7F8DA5';     // --text-3 (the hollow bear candle, as in the header mark)
const GOLD = '#F2B53A';      // --accent

/**
 * The brand mark in its own 28-unit space (see brandMark() in js/main.js), scaled and centred
 * on a 512 tile. Mark bounds: x 5.5–22.5, y 2.5–24 (centre 14, 13.25).
 */
function mark(scale, { stroke = 1.75 } = {}) {
  const tx = 256 - 14 * scale;
  const ty = 256 - 13.25 * scale;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale})" fill="none" stroke-linecap="round" stroke-width="${stroke}">
    <path d="M9 4v5M9 21v3" stroke="${SLATE}"/>
    <rect x="5.5" y="9" width="7" height="12" rx="1.6" stroke="${SLATE}"/>
    <path d="M19 2.5v4.5M19 19v5" stroke="${GOLD}"/>
    <rect x="15.5" y="7" width="7" height="12" rx="1.6" fill="${GOLD}" stroke="${GOLD}"/>
  </g>`;
}

function grid() {
  const ys = [128, 256, 384];
  return `<g stroke="${GRID}" stroke-width="4">${ys.map((y) => `<path d="M0 ${y}H512"/>`).join('')}</g>`;
}

/** kind: 'any' (rounded tile), 'full' (square, full bleed), 'favicon' (rounded, big mark, no grid) */
function iconSVG(kind) {
  const rx = kind === 'full' ? 0 : kind === 'favicon' ? 96 : 112;
  const scale = kind === 'favicon' ? 17 : kind === 'full' ? 12.5 : 14;
  const stroke = kind === 'favicon' ? 2.1 : 1.75;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NAVY_2}"/>
      <stop offset="1" stop-color="${NAVY}"/>
    </linearGradient>
    <clipPath id="c"><rect width="512" height="512" rx="${rx}"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="512" height="512" fill="url(#g)"/>
    ${kind === 'favicon' ? '' : grid()}
  </g>
  ${mark(scale, { stroke })}
</svg>
`;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ['playwright'];
  try {
    tries.push(path.join(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'playwright'));
  } catch {
    /* npm not available */
  }
  tries.push('/opt/node22/lib/node_modules/playwright');
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      /* try next */
    }
  }
  throw new Error('Playwright not found.');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const svgs = { any: iconSVG('any'), full: iconSVG('full'), favicon: iconSVG('favicon') };
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svgs.any);

  const renders = [
    { file: 'icon-192.png', svg: svgs.any, size: 192 },
    { file: 'icon-512.png', svg: svgs.any, size: 512 },
    { file: 'maskable-512.png', svg: svgs.full, size: 512 },
    { file: 'apple-touch-icon-180.png', svg: svgs.full, size: 180 },
    { file: 'favicon-32.png', svg: svgs.favicon, size: 32 },
  ];

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const r of renders) {
      const page = await browser.newPage({ viewport: { width: r.size, height: r.size }, deviceScaleFactor: 1 });
      const inline = r.svg.replace('width="512" height="512"', `width="${r.size}" height="${r.size}"`);
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${inline}</body></html>`);
      await page.screenshot({ path: path.join(OUT, r.file), omitBackground: true, clip: { x: 0, y: 0, width: r.size, height: r.size } });
      await page.close();
      console.log(`icons/${r.file}`);
    }
  } finally {
    await browser.close();
  }
  console.log('icons/icon.svg');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
