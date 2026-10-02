import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { premiumModules } from './premium-modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const PRIVATE_SOURCE = process.env.TTS_PREMIUM_SOURCE || 'edge';
const PRIVATE_MODE = PRIVATE_SOURCE === 'storage' || PRIVATE_SOURCE === 'edge';
const SECURITY_CUTOVER = process.env.TTS_SECURITY_CUTOVER == null ? true : process.env.TTS_SECURITY_CUTOVER === '1';
const BUILD_ID = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || (PRIVATE_MODE ? `${PRIVATE_SOURCE}-${Date.now()}` : null);
const ASSET_VERSION = encodeURIComponent(BUILD_ID || 'dev');

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

await stampReleaseAssets();

console.log(`Cloudflare Pages assets written to ${path.relative(ROOT, OUT)}/`);

async function stampReleaseAssets() {
  const indexPath = path.join(OUT, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, html
    .replace(/(<html\b[^>]*)(>)/, `$1 data-release="${ASSET_VERSION}"$2`)
    .replace(/(<link rel="stylesheet" href="css\/[^"]+\.css)(")/g, `$1?v=${ASSET_VERSION}$2`)
    .replace(/(<script type="module" src="js\/boot\.js)(")/, `$1?v=${ASSET_VERSION}$2`));

  for (const file of await walk(path.join(OUT, 'js'))) {
    if (!file.endsWith('.js')) continue;
    const code = await readFile(file, 'utf8');
    const next = versionRelativeImports(code);
    if (next !== code) await writeFile(file, next);
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function versionRelativeImports(code) {
  const version = `?v=${ASSET_VERSION}`;
  const addVersion = (spec) => (
    /^\.{1,2}\//.test(spec) && /\.m?js$/.test(spec) && !/[?#]/.test(spec)
      ? `${spec}${version}`
      : spec
  );
  return code
    .replace(/(\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_m, a, spec, b) => `${a}${addVersion(spec)}${b}`)
    .replace(/(\bimport\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_m, a, spec, b) => `${a}${addVersion(spec)}${b}`)
    .replace(/(\bimport\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, (_m, a, spec, b) => `${a}${addVersion(spec)}${b}`);
}
