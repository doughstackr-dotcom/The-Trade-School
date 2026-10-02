import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { premiumModules } from './premium-modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const PRIVATE_SOURCE = process.env.TTS_PREMIUM_SOURCE || 'edge';
const PRIVATE_MODE = PRIVATE_SOURCE === 'storage' || PRIVATE_SOURCE === 'edge';
const SECURITY_CUTOVER = process.env.TTS_SECURITY_CUTOVER == null ? true : process.env.TTS_SECURITY_CUTOVER === '1';
const BUILD_ID = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || (PRIVATE_MODE ? `${PRIVATE_SOURCE}-${Date.now()}` : null);

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

if (PRIVATE_MODE) {
  const configPath = path.join(OUT, 'js', 'config.js');
  const config = await readFile(configPath, 'utf8');
  await writeFile(configPath, config.replace(
    /export const PREMIUM_SOURCE = ['"]site['"];/,
    `export const PREMIUM_SOURCE = ${JSON.stringify(PRIVATE_SOURCE)};`,
  ));

  const paid = new Set((await premiumModules()).map((mod) => mod.publicPath));
  for (const rel of paid) {
    await rm(path.join(OUT, rel), { force: true });
  }

  const swPath = path.join(OUT, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  await writeFile(swPath, sw
    .replace(/const BUILD = ['"]dev['"];/, `const BUILD = ${JSON.stringify(BUILD_ID)};`)
    .replace(/const NEVER_CACHE_PATHS = \[\];/, `const NEVER_CACHE_PATHS = ${JSON.stringify([...paid].sort())};`)
    .replace(/const SECURITY_CUTOVER = false;/, `const SECURITY_CUTOVER = ${SECURITY_CUTOVER ? 'true' : 'false'};`));
}

console.log(`Cloudflare Pages assets written to ${path.relative(ROOT, OUT)}/`);
