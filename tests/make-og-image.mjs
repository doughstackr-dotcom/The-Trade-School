// Dev helper: renders tests/og-card.html to og-image.png (1200x630) with Playwright.
// Usage: node tests/make-og-image.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const card = `<!doctype html><meta charset="utf-8"><style>
  * { margin:0; box-sizing:border-box }
  body { width:1200px; height:630px; background:#0B1220; color:#E9EEF7;
         font-family:'Segoe UI',system-ui,sans-serif; display:flex; align-items:center;
         justify-content:center; gap:72px; overflow:hidden }
  .candles { display:flex; align-items:flex-end; gap:18px; height:340px }
  .c { position:relative; width:34px }
  .c .wick { position:absolute; left:50%; transform:translateX(-50%); width:3px; border-radius:2px }
  .c .body { position:relative; border-radius:5px }
  .up .wick, .up .body { background:#3DBB77 }
  .down .wick, .down .body { background:#E5484D }
  h1 { font-size:88px; font-weight:800; letter-spacing:-2px; line-height:1.02 }
  .accent { color:#5B8CFF }
  p { margin-top:22px; font-size:30px; color:#A5B1C6; font-weight:400 }
</style>
<div class="candles">
  <div class="c up"><div class="wick" style="top:0;height:60px"></div><div class="body" style="top:60px;height:150px"></div></div>
  <div class="c down"><div class="wick" style="top:20px;height:40px"></div><div class="body" style="top:60px;height:110px"></div></div>
  <div class="c up"><div class="wick" style="top:0;height:90px"></div><div class="body" style="top:90px;height:170px"></div></div>
  <div class="c up"><div class="wick" style="top:0;height:50px"></div><div class="body" style="top:50px;height:210px"></div></div>
  <div class="c down"><div class="wick" style="top:30px;height:60px"></div><div class="body" style="top:90px;height:120px"></div></div>
</div>
<div><h1>The <span class="accent">Trade</span><br>School</h1>
<p>Learn trading fundamentals by playing.</p></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(card);
await page.screenshot({ path: path.join(ROOT, 'og-image.png') });
await browser.close();
console.log('wrote og-image.png');
