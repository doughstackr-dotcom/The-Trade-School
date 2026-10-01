import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');

const entries = [
  '_headers',
  'assets',
  'css',
  'icons',
  'index.html',
  'js',
  'manifest.webmanifest',
  'og-image.png',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of entries) {
  await cp(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
}

console.log(`Cloudflare Pages assets written to ${path.relative(ROOT, OUT)}/`);
