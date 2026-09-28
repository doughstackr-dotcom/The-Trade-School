#!/usr/bin/env node
// Production build → dist/ (what Vercel serves; see vercel.json and README "Deploy").
//
// The site stays a set of native ES modules — nothing is bundled, so lazy route imports keep
// loading one small file each — but every JS and CSS file is minified (esbuild) and gets a
// content hash in its name (js/core/router.3f2a9c1b7e.js) so it can be cached forever
// (`immutable`). Every reference is rewritten to the hashed name:
//   - static `import … from './x.js'` / `export … from`, dynamic import('./x.js'),
//   - any other string literal that names a module relative to its file — the registry's
//     `path: './lessons/fibonacci.js'` (the router builds lesson / game URLs from these at
//     runtime), the router's page table, `new URL('../vendor/supabase.js', import.meta.url)`,
//   - the <link> / <script> tags of index.html.
// dist/asset-manifest.json lists every original → hashed path.
//
// A file's hash covers its own minified content plus that of every file it references,
// directly or not (import cycles included), so a change anywhere yields new names for every
// file that can reach it and a stale cached copy is never mixed with new code.
//
// Dev-only modules (the /dev-chart page and the lesson-kit demo) are left out, and
// globalThis.__TTS_DIST__ is defined as true so the router refuses dev routes on any host.
//
//   node scripts/build.mjs            (npm run build)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Copied as-is (not hashed): stable URLs other sites / crawlers link to. */
const STATIC_FILES = ['og-image.png', 'robots.txt', 'sitemap.xml', 'favicon.ico', 'js/vendor/supabase.LICENSE'];
const STATIC_DIRS = ['assets'];
/** Never shipped: developer-only pages (their routes are also gated to localhost in source). */
const DEV_ONLY = new Set(['js/pages/dev-chart.js', 'js/lessons/_kit-demo.js']);
/** Already minified third-party code: copied byte for byte (still hashed), not scanned. */
const VERBATIM = new Set(['js/vendor/supabase.js']);

const HASH_LEN = 10;
// './x.js' / '../dir/x.js' as a complete string literal (', " or a backtick without ${}).
const SPEC_RE = /(["'`])(\.{1,2}\/[A-Za-z0-9_@./-]+\.js)\1/g;

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`;
    if (ent.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function hashedName(rel, hash) {
  const ext = path.posix.extname(rel);
  return `${rel.slice(0, -ext.length)}.${hash}${ext}`;
}

async function main() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });

  const jsFiles = walk('js').filter((f) => f.endsWith('.js') && !DEV_ONLY.has(f));
  const cssFiles = walk('css').filter((f) => f.endsWith('.css'));

  // 1) minify
  const content = new Map(); // rel → minified source (original specifiers)
  for (const rel of jsFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (VERBATIM.has(rel)) {
      content.set(rel, src);
      continue;
    }
    const { code } = await transform(src, {
      loader: 'js',
      minify: true,
      legalComments: 'inline',
      define: { 'globalThis.__TTS_DIST__': 'true' },
      sourcefile: rel,
    });
    content.set(rel, code);
  }
  for (const rel of cssFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const { code } = await transform(src, { loader: 'css', minify: true, sourcefile: rel });
    content.set(rel, code);
  }

  // 2) module references (edges) per JS file
  const deps = new Map();
  const problems = [];
  for (const rel of jsFiles) {
    const set = new Set();
    if (!VERBATIM.has(rel)) {
      for (const m of content.get(rel).matchAll(SPEC_RE)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]));
        if (content.has(target)) set.add(target);
        else if (!DEV_ONLY.has(target)) problems.push(`${rel}: "${m[2]}" → ${target} does not exist`);
      }
    }
    deps.set(rel, set);
  }
  if (problems.length) throw new Error(`Unresolved module references:\n  ${problems.join('\n  ')}`);

  // 3) hashes: own content + everything reachable (cycle-safe)
  const own = new Map([...content].map(([rel, code]) => [rel, sha(code)]));
  const hashed = new Map(); // rel → hashed rel
  for (const rel of content.keys()) {
    const seen = new Set();
    const stack = [rel];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const d of deps.get(f) || []) stack.push(d);
    }
    const closure = [...seen].sort().map((f) => `${f}:${own.get(f)}`).join('\n');
    hashed.set(rel, hashedName(rel, sha(closure).slice(0, HASH_LEN)));
  }

  // 4) write JS / CSS with rewritten specifiers
  const write = (rel, data) => {
    const file = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  for (const [rel, code] of content) {
    let out = code;
    if (rel.endsWith('.js') && !VERBATIM.has(rel)) {
      out = code.replace(SPEC_RE, (all, q, spec) => {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
        if (!hashed.has(target)) return all; // dev-only module: left dangling, never routed
        return `${q}${spec.slice(0, spec.lastIndexOf('/') + 1)}${path.posix.basename(hashed.get(target))}${q}`;
      });
    }
    write(hashed.get(rel), out);
  }

  // 5) index.html
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")\/((?:js|css)\/[^"]+)"/g, (all, pre, rel) => {
    if (!hashed.has(rel)) throw new Error(`index.html references /${rel}, which is not in the build`);
    return `${pre}/${hashed.get(rel)}"`;
  });
  const leftovers = [...html.matchAll(/<script\b(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/g)];
  if (leftovers.length) throw new Error(`index.html has inline scripts (CSP would block them): ${leftovers.map((m) => m[0]).join(', ')}`);
  write('index.html', html);

  // 6) static files
  for (const rel of STATIC_FILES) {
    if (fs.existsSync(path.join(ROOT, rel))) write(rel, fs.readFileSync(path.join(ROOT, rel)));
  }
  for (const dir of STATIC_DIRS) {
    for (const rel of walk(dir)) write(rel, fs.readFileSync(path.join(ROOT, rel)));
  }

  // 7) manifest + a sanity pass: no un-hashed module reference may survive
  const manifest = Object.fromEntries([...hashed].sort(([a], [b]) => a.localeCompare(b)));
  write('asset-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const shipped = new Set(hashed.values());
  for (const [rel, out] of hashed) {
    if (!out.endsWith('.js') || VERBATIM.has(rel)) continue;
    const code = fs.readFileSync(path.join(DIST, out), 'utf8');
    for (const m of code.matchAll(SPEC_RE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(out), m[2]));
      if (!shipped.has(target) && !DEV_ONLY.has(target)) throw new Error(`${out}: dangling reference "${m[2]}"`);
    }
  }

  let bytes = 0;
  for (const rel of walk('dist').map((f) => f.slice('dist/'.length))) bytes += fs.statSync(path.join(DIST, rel)).size;
  console.log(`Built dist/: ${hashed.size} hashed JS/CSS files, ${(bytes / 1024).toFixed(0)} KB total, in ${Date.now() - t0} ms.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
