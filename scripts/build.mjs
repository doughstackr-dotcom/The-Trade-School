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
// Paid content (PREMIUM_SOURCE=storage, docs/ACCOUNTS.md §10). With the env var
// PREMIUM_SOURCE=storage (or --premium-source=storage) the paid lesson / game modules — every
// registry entry with a beginner / advanced / both tier that is not in FREE_IDS, plus helper
// files under js/lessons/ or js/games/ that only they import — are left out of dist/ and
// written to dist-premium/<folder>/<lessons|games>/<name>.<hash>.js instead, for
// scripts/publish-premium.mjs to upload to the private `premium` Storage bucket:
//   - <folder> is the bucket policy's first path segment: 'advanced' for Advanced entries,
//     'beginner' for Beginner and both-tier ones (requiredPlan() in js/core/access.js), and
//     for a helper the lowest folder of the paid modules that import it;
//   - their imports of public modules become root-relative hashed paths
//     ('/js/core/ui.<hash>.js'), which js/core/premium-loader.js makes absolute against the page
//     origin (a module imported from a blob: URL cannot resolve relative specifiers), and their
//     imports of other paid files become 'premium:<object path>' markers the loader follows;
//   - the registry's `path` of each paid entry becomes 'premium:<object path>', which the
//     router hands to the loader, and js/config.js is built with PREMIUM_SOURCE = 'storage';
//   - dist-premium/premium-manifest.json lists every object path with its source file.
// Public code may not import a paid module (the build fails and names the chain); shared
// modules that paid code imports stay in dist/. Names depend only on the source and the mode,
// so two builds of one commit (say Vercel's and the publishing CI job's) are identical. The
// default build (PREMIUM_SOURCE unset or 'site') ships everything publicly, as before.
//
//   node scripts/build.mjs                                 (npm run build)
//   PREMIUM_SOURCE=storage node scripts/build.mjs          (or --premium-source=storage)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PREMIUM_MANIFEST = 'premium-manifest.json';

/** Copied as-is (not hashed): stable URLs other sites / crawlers link to. */
const STATIC_FILES = ['og-image.png', 'robots.txt', 'sitemap.xml', 'favicon.ico', 'js/vendor/supabase.LICENSE'];
const STATIC_DIRS = ['assets'];
/** Never shipped: developer-only pages (their routes are also gated to localhost in source). */
const DEV_ONLY = new Set(['js/pages/dev-chart.js', 'js/lessons/_kit-demo.js']);
/** Already minified third-party code: copied byte for byte (still hashed), not scanned. */
const VERBATIM = new Set(['js/vendor/supabase.js']);
const REGISTRY = 'js/registry.js';
const CONFIG = 'js/config.js';
const CONFIG_SOURCE_RE = /export const PREMIUM_SOURCE = 'site';/;
const CONTENT_DIRS = ['js/lessons/', 'js/games/'];

const HASH_LEN = 10;
// './x.js' / '../dir/x.js' as a complete string literal (', " or a backtick without ${}).
const SPEC_RE = /(["'`])(\.{1,2}\/[A-Za-z0-9_@./-]+\.js)\1/g;
// A root-relative module path as a complete string literal: what paid modules import.
export const ABS_SPEC_RE = /(["'`])(\/js\/[A-Za-z0-9_@./-]+\.js)\1/g;
// 'premium:<object path>' as a complete string literal (registry paths, paid → paid imports).
export const PREMIUM_SPEC_RE = /(["'`])premium:([A-Za-z0-9_@./-]+\.js)\1/g;

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

/**
 * The bucket folder a registry entry is published under, or null when it stays public:
 * dev entries, FREE_IDS and entries without a paid tier. Mirrors requiredPlan() in
 * js/core/access.js and the `premium` bucket read policy (beginner/… for Beginner and
 * Advanced members, advanced/… for Advanced only).
 */
export function premiumFolder(entry, freeIds = []) {
  if (!entry || entry.dev || !entry.path) return null;
  if (entry.type !== 'lesson' && entry.type !== 'game') return null;
  if (freeIds.includes(entry.id)) return null;
  if (entry.tier === 'advanced') return 'advanced';
  if (entry.tier === 'beginner' || entry.tier === 'both') return 'beginner';
  return null;
}

/**
 * Splits the module graph into public and paid files.
 *   files: every JS file ('js/…'); deps: Map file → Set of files it references;
 *   entries: registry lessons + games ({ id, type, tier, path: './lessons/x.js', dev? }).
 * Returns { premium: Map file → folder, problems: string[] }. A paid entry that public code
 * reaches (other than through the registry's path strings) is a problem: it would have to
 * ship publicly for that code to work.
 */
export function planPremium({ files, deps, entries, freeIds = [], registry = REGISTRY }) {
  const isContent = (f) => CONTENT_DIRS.some((d) => f.startsWith(d));
  const entryFile = (e) => path.posix.normalize(path.posix.join(path.posix.dirname(registry), e.path));
  const fileSet = new Set(files);
  const entryFiles = new Set();
  const paid = new Map();
  for (const e of entries) {
    if (!e?.path) continue;
    const f = entryFile(e);
    entryFiles.add(f);
    const folder = premiumFolder(e, freeIds);
    if (folder && fileSet.has(f)) paid.set(f, folder === 'beginner' || paid.get(f) === 'beginner' ? 'beginner' : 'advanced');
  }

  // Everything public code can reach, not following the registry's paths into paid entries.
  // Roots: every file outside js/lessons/ and js/games/, plus the free entries there.
  const parent = new Map();
  const stack = files.filter((f) => !paid.has(f) && (!isContent(f) || entryFiles.has(f)));
  for (const f of stack) parent.set(f, null);
  while (stack.length) {
    const f = stack.pop();
    for (const d of deps.get(f) || []) {
      if ((f === registry && paid.has(d)) || parent.has(d) || !fileSet.has(d)) continue;
      parent.set(d, f);
      stack.push(d);
    }
  }
  const problems = [];
  for (const f of paid.keys()) {
    if (!parent.has(f)) continue;
    const chain = [f];
    for (let p = parent.get(f); p; p = parent.get(p)) chain.unshift(p);
    problems.push(`paid module ${f} is imported by public code: ${chain.join(' → ')}`);
  }

  // Helpers only paid modules reach; folder = the lowest folder among their paid importers.
  const premium = new Map([...paid].filter(([f]) => !parent.has(f)));
  const helpers = new Set();
  const todo = [...premium.keys()];
  while (todo.length) {
    const f = todo.pop();
    for (const d of deps.get(f) || []) {
      if (parent.has(d) || premium.has(d) || helpers.has(d) || !fileSet.has(d)) continue;
      helpers.add(d);
      todo.push(d);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const h of helpers) {
      let folder = premium.get(h) || null;
      for (const [f, fd] of premium) {
        if (f === h || !deps.get(f)?.has(h)) continue;
        if (fd === 'beginner') folder = 'beginner';
        else if (!folder) folder = 'advanced';
      }
      if (folder && folder !== premium.get(h)) {
        premium.set(h, folder);
        changed = true;
      }
    }
  }
  return { premium: new Map([...premium].sort(([a], [b]) => a.localeCompare(b))), problems };
}

/** Bucket object path: 'beginner/lessons/x.<hash>.js' for js/lessons/x.<hash>.js in 'beginner'. */
export function objectPath(folder, hashedRel) {
  return `${folder}/${hashedRel.replace(/^js\//, '')}`;
}

/** The PREMIUM_SOURCE a build targets: --premium-source=… over $PREMIUM_SOURCE; default 'site'. */
export function premiumSource(argv = [], env = {}) {
  const arg = argv.find((a) => a.startsWith('--premium-source='));
  const v = String(arg ? arg.split('=')[1] : env.PREMIUM_SOURCE || 'site').trim().toLowerCase();
  if (v !== 'site' && v !== 'storage') throw new Error(`PREMIUM_SOURCE must be 'site' or 'storage', got '${v}'`);
  return v;
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`;
    if (ent.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function walkAbs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const f = path.join(dir, ent.name);
    return ent.isDirectory() ? walkAbs(f) : [f];
  });
}

function hashedName(rel, hash) {
  const ext = path.posix.extname(rel);
  return `${rel.slice(0, -ext.length)}.${hash}${ext}`;
}

/**
 * Builds the site. { source: 'site' | 'storage', outDir, premiumDir, quiet } — the directories
 * default to dist/ and dist-premium/ (tests build into temp directories). Resolves to
 * { hashed: Map, premium: Map file → object path }.
 */
export async function build({ source = 'site', outDir = path.join(ROOT, 'dist'), premiumDir = path.join(ROOT, 'dist-premium'), quiet = false } = {}) {
  const t0 = Date.now();
  const storage = source === 'storage';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(premiumDir, { recursive: true, force: true });

  const jsFiles = walk('js').filter((f) => f.endsWith('.js') && !DEV_ONLY.has(f));
  const cssFiles = walk('css').filter((f) => f.endsWith('.css'));

  // 1) minify
  const content = new Map(); // rel → minified source (original specifiers)
  for (const rel of jsFiles) {
    let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (VERBATIM.has(rel)) {
      content.set(rel, src);
      continue;
    }
    if (rel === CONFIG && storage) {
      if (!CONFIG_SOURCE_RE.test(src)) throw new Error(`${CONFIG}: expected "export const PREMIUM_SOURCE = 'site';" to switch to 'storage'`);
      src = src.replace(CONFIG_SOURCE_RE, "export const PREMIUM_SOURCE = 'storage';");
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

  // 2b) paid modules (storage builds only)
  let premiumFolders = new Map();
  if (storage) {
    const reg = await import(pathToFileURL(path.join(ROOT, REGISTRY)).href);
    const cfg = await import(pathToFileURL(path.join(ROOT, CONFIG)).href);
    const plan = planPremium({ files: jsFiles, deps, entries: [...reg.LESSONS, ...reg.GAMES], freeIds: cfg.FREE_IDS });
    if (plan.problems.length) {
      throw new Error(`Paid modules must not be imported by public code (move what it shares into a public module, e.g. js/games/banks/):\n  ${plan.problems.join('\n  ')}`);
    }
    premiumFolders = plan.premium;
    for (const rel of premiumFolders.keys()) {
      const stray = [...content.get(rel).matchAll(ABS_SPEC_RE), ...content.get(rel).matchAll(PREMIUM_SPEC_RE)];
      if (stray.length) throw new Error(`${rel}: string literal ${stray[0][0]} would be mistaken for a rewritten import`);
    }
  }

  // 3) hashes: own content + everything reachable (cycle-safe). A storage build salts every
  //    hash, so its names never collide with a site build's (their outputs differ).
  const own = new Map([...content].map(([rel, code]) => [rel, sha(storage ? `premium-source:storage\n${code}` : code)]));
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
  const objects = new Map([...premiumFolders].map(([rel, folder]) => [rel, objectPath(folder, hashed.get(rel))]));

  // 4) write JS / CSS with rewritten specifiers
  const writeTo = (dir, rel, data) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  const write = (rel, data) => writeTo(outDir, rel, data);
  for (const [rel, code] of content) {
    let out = code;
    const paid = objects.has(rel);
    if (rel.endsWith('.js') && !VERBATIM.has(rel)) {
      out = code.replace(SPEC_RE, (all, q, spec) => {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
        if (!hashed.has(target)) return all; // dev-only module: left dangling, never routed
        if (objects.has(target)) {
          if (!paid && rel !== REGISTRY) throw new Error(`${rel} references paid module ${target}`);
          return `${q}premium:${objects.get(target)}${q}`;
        }
        if (paid) return `${q}/${hashed.get(target)}${q}`;
        return `${q}${spec.slice(0, spec.lastIndexOf('/') + 1)}${path.posix.basename(hashed.get(target))}${q}`;
      });
    }
    if (paid) writeTo(premiumDir, objects.get(rel), out);
    else write(hashed.get(rel), out);
  }

  // 5) index.html
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")\/((?:js|css)\/[^"]+)"/g, (all, pre, rel) => {
    if (!hashed.has(rel) || objects.has(rel)) throw new Error(`index.html references /${rel}, which is not in the build`);
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

  // 7) manifests + a sanity pass: no un-hashed module reference may survive, and no paid
  //    module may reach dist/
  const publicHashed = [...hashed].filter(([rel]) => !objects.has(rel)).sort(([a], [b]) => a.localeCompare(b));
  write('asset-manifest.json', `${JSON.stringify(Object.fromEntries(publicHashed), null, 2)}\n`);
  const shipped = new Set(publicHashed.map(([, out]) => out));
  for (const [rel, out] of publicHashed) {
    if (!out.endsWith('.js') || VERBATIM.has(rel)) continue;
    const code = fs.readFileSync(path.join(outDir, out), 'utf8');
    for (const m of code.matchAll(SPEC_RE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(out), m[2]));
      if (!shipped.has(target) && !DEV_ONLY.has(target)) throw new Error(`${out}: dangling reference "${m[2]}"`);
    }
  }
  if (storage) {
    const objectSet = new Set(objects.values());
    for (const [rel, obj] of objects) {
      if (fs.existsSync(path.join(outDir, hashed.get(rel)))) throw new Error(`paid module ${rel} was written to dist/`);
      const code = fs.readFileSync(path.join(premiumDir, obj), 'utf8');
      const rest = code.match(SPEC_RE);
      if (rest) throw new Error(`${obj}: relative reference ${rest[0]} (cannot load from a blob: URL)`);
      for (const m of code.matchAll(ABS_SPEC_RE)) if (!shipped.has(m[2].slice(1))) throw new Error(`${obj}: dangling reference "${m[2]}"`);
      for (const m of code.matchAll(PREMIUM_SPEC_RE)) if (!objectSet.has(m[2])) throw new Error(`${obj}: dangling reference "premium:${m[2]}"`);
    }
    const manifest = {
      bucket: 'premium',
      objects: Object.fromEntries([...objects].map(([rel, obj]) => [obj, rel]).sort(([a], [b]) => a.localeCompare(b))),
    };
    writeTo(premiumDir, PREMIUM_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (!quiet) {
    let bytes = 0;
    for (const f of walkAbs(outDir)) bytes += fs.statSync(f).size;
    const extra = storage ? `; ${objects.size} paid modules → ${path.relative(ROOT, premiumDir) || premiumDir}/ (PREMIUM_SOURCE=storage)` : '';
    console.log(`Built ${path.relative(ROOT, outDir) || outDir}/: ${publicHashed.length} hashed JS/CSS files, ${(bytes / 1024).toFixed(0)} KB total, in ${Date.now() - t0} ms${extra}.`);
  }
  return { hashed, premium: objects };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => build({ source: premiumSource(process.argv.slice(2), process.env) }))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
