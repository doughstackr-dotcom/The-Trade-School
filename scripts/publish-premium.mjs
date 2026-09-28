#!/usr/bin/env node
// Uploads the paid lesson / game modules of a PREMIUM_SOURCE=storage build to the private
// `premium` Supabase Storage bucket (docs/ACCOUNTS.md §10), then removes objects that no
// build needs any more.
//
//   PREMIUM_SOURCE=storage npm run build          (writes dist/ and dist-premium/)
//   node scripts/publish-premium.mjs [--dry-run] [--build] [--keep-hours=48] [--if-configured]
//
//   --dry-run        print the plan (uploads, deletions) and change nothing
//   --build          run the storage build first (otherwise dist-premium/ must exist)
//   --keep-hours=N   an object no longer in the manifest is deleted only once it has not been
//                    uploaded for N hours (default 48), so a deployment that is still live, or
//                    an open tab of it, keeps working while the next one rolls out
//   --if-configured  exit 0 with a notice when the credentials are missing (CI without secrets)
//
// Environment: SUPABASE_URL (defaults to the project in js/config.js) and
// SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API keys; the secret / service_role
// key). The key is sent only to SUPABASE_URL and never printed. Talks to the Storage REST API
// with fetch; no dependencies.
//
// Every object in the manifest is upserted on each run (hashed names: identical content), which
// also marks it as still in use for --keep-hours. Only objects under beginner/ and advanced/
// are ever deleted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, PREMIUM_MANIFEST } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREMIUM_DIR = path.join(ROOT, 'dist-premium');
export const BUCKET = 'premium';
export const FOLDERS = ['beginner', 'advanced'];
const CONTENT_TYPE = 'text/javascript; charset=utf-8';

/**
 * What to do: { upload: [object], remove: [object], keep: [object] } — every manifest object is
 * uploaded; a remote object under beginner/ or advanced/ that is not in the manifest is removed
 * when last updated more than keepHours ago, else kept for now.
 *   objects: manifest object paths; remote: [{ name, updated_at? , created_at? }].
 */
export function planPublish({ objects, remote = [], now = Date.now(), keepHours = 48 }) {
  const wanted = new Set(objects);
  const remove = [];
  const keep = [];
  for (const o of remote) {
    if (wanted.has(o.name) || !FOLDERS.includes(o.name.split('/')[0])) continue;
    const t = Date.parse(o.updated_at || o.created_at || '');
    if (Number.isFinite(t) && now - t < keepHours * 3600e3) keep.push(o.name);
    else remove.push(o.name);
  }
  return { upload: [...wanted].sort(), remove: remove.sort(), keep: keep.sort() };
}

/** Minimal Storage REST client (service role). */
export function storageApi({ url, key, fetch: fetchFn = globalThis.fetch }) {
  const base = `${String(url).replace(/\/+$/, '')}/storage/v1`;
  const auth = { Authorization: `Bearer ${key}`, apikey: key };
  const encode = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function call(method, route, { body, headers = {} } = {}) {
    const res = await fetchFn(`${base}${route}`, { method, headers: { ...auth, ...headers }, body });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* no body */
      }
      throw new Error(`Storage ${method} ${route} → HTTP ${res.status} ${detail}`);
    }
    return res;
  }

  return {
    /** Every object under `prefix` (recursive): [{ name, updated_at, created_at }]. */
    async list(prefix = '') {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await call('POST', `/object/list/${BUCKET}`, {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        const items = await res.json();
        for (const it of items) {
          const name = prefix ? `${prefix}/${it.name}` : it.name;
          if (it.id == null) out.push(...await this.list(name)); // a "folder"
          else out.push({ name, updated_at: it.updated_at, created_at: it.created_at });
        }
        if (items.length < 1000) break;
      }
      return out;
    },
    async upload(objectPath, data) {
      await call('POST', `/object/${BUCKET}/${encode(objectPath)}`, {
        headers: { 'Content-Type': CONTENT_TYPE, 'x-upsert': 'true', 'Cache-Control': 'max-age=3600' },
        body: data,
      });
    },
    async remove(objectPaths) {
      for (let i = 0; i < objectPaths.length; i += 100) {
        await call('DELETE', `/object/${BUCKET}`, {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: objectPaths.slice(i, i + 100) }),
        });
      }
    },
  };
}

async function defaultUrl() {
  try {
    return (await import(pathToFileURL(path.join(ROOT, 'js', 'config.js')).href)).SUPABASE_URL || '';
  } catch {
    return '';
  }
}

/** Runs the publish; returns the plan. `log` receives every line printed. */
export async function publish({
  argv = [], env = {}, fetch: fetchFn = globalThis.fetch, premiumDir = PREMIUM_DIR, log = console.log, now = Date.now(),
} = {}) {
  const dryRun = argv.includes('--dry-run');
  const ifConfigured = argv.includes('--if-configured');
  const keepArg = argv.find((a) => a.startsWith('--keep-hours='));
  const keepHours = keepArg ? Number(keepArg.split('=')[1]) : 48;
  if (!Number.isFinite(keepHours) || keepHours < 0) throw new Error('--keep-hours must be a number ≥ 0');

  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const url = env.SUPABASE_URL || await defaultUrl();
  if ((!key || !url) && !dryRun) {
    const msg = 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: nothing published.';
    if (ifConfigured) {
      log(`${msg} (--if-configured: skipping)`);
      return null;
    }
    throw new Error(`${msg} Set them in the environment (never in the repo), or pass --dry-run.`);
  }
  if (url && !/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) throw new Error('SUPABASE_URL must be an https:// URL');

  if (argv.includes('--build')) await build({ source: 'storage', premiumDir, quiet: false });
  const manifestFile = path.join(premiumDir, PREMIUM_MANIFEST);
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`${path.relative(ROOT, manifestFile)} not found: run \`PREMIUM_SOURCE=storage npm run build\` first (or pass --build).`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const objects = Object.keys(manifest.objects || {});
  if (!objects.length) throw new Error('The premium manifest lists no objects.');
  for (const o of objects) {
    if (!FOLDERS.includes(o.split('/')[0]) || o.includes('..')) throw new Error(`Unexpected object path in manifest: ${o}`);
    if (!fs.existsSync(path.join(premiumDir, o))) throw new Error(`${o} is in the manifest but not in ${path.relative(ROOT, premiumDir)}/`);
  }

  const api = key && url ? storageApi({ url, key, fetch: fetchFn }) : null;
  let remote = [];
  if (api) {
    for (const folder of FOLDERS) remote.push(...await api.list(folder));
  } else {
    log('No credentials: listing the bucket is skipped, so stale objects are not shown.');
  }
  const plan = planPublish({ objects, remote, now, keepHours });
  const present = new Set(remote.map((o) => o.name));
  const fresh = plan.upload.filter((o) => !present.has(o)).length;

  log(`${dryRun ? 'Plan (dry run)' : 'Publishing'} to bucket "${BUCKET}"${url ? ` at ${new URL(url).host}` : ''}:`);
  log(`  upload  ${plan.upload.length} objects (${fresh} new, ${plan.upload.length - fresh} refreshed)`);
  for (const o of plan.upload) log(`    + ${o}${present.has(o) ? '' : '  (new)'}`);
  log(`  delete  ${plan.remove.length} stale objects (not uploaded for ${keepHours} h)`);
  for (const o of plan.remove) log(`    - ${o}`);
  if (plan.keep.length) log(`  keep    ${plan.keep.length} stale objects still inside the ${keepHours} h grace period`);
  if (dryRun) return plan;

  const queue = plan.upload.slice();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const o = queue.shift();
      await api.upload(o, fs.readFileSync(path.join(premiumDir, o)));
    }
  }));
  if (plan.remove.length) await api.remove(plan.remove);
  log(`Done: ${plan.upload.length} uploaded, ${plan.remove.length} deleted.`);
  return plan;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish({ argv: process.argv.slice(2), env: process.env }).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
