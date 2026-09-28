// scripts/publish-premium.mjs: the upload / prune plan and the Storage REST calls (fetch mocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planPublish, publish, storageApi } from '../../scripts/publish-premium.mjs';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

test('planPublish: upload everything in the manifest, prune old stale objects, keep recent ones', () => {
  const plan = planPublish({
    objects: ['beginner/lessons/a.2222222222.js', 'advanced/games/b.2222222222.js'],
    remote: [
      { name: 'beginner/lessons/a.2222222222.js', updated_at: hoursAgo(100) },
      { name: 'beginner/lessons/a.1111111111.js', updated_at: hoursAgo(72) },
      { name: 'advanced/games/b.1111111111.js', updated_at: hoursAgo(2) },
      { name: 'advanced/games/c.0000000000.js' }, // no timestamp → stale
      { name: 'other/readme.txt', updated_at: hoursAgo(1000) }, // outside the paid folders
    ],
    now: NOW,
    keepHours: 48,
  });
  assert.deepEqual(plan.upload, ['advanced/games/b.2222222222.js', 'beginner/lessons/a.2222222222.js']);
  assert.deepEqual(plan.remove, ['advanced/games/c.0000000000.js', 'beginner/lessons/a.1111111111.js']);
  assert.deepEqual(plan.keep, ['advanced/games/b.1111111111.js']);
});

/** A fake Storage REST endpoint over an in-memory bucket. */
function fakeStorage(initial = {}) {
  const bucket = new Map(Object.entries(initial));
  const calls = [];
  const fetch = async (url, { method, headers, body }) => {
    calls.push({ url, method, headers, body });
    const u = new URL(url);
    assert.equal(headers.Authorization, 'Bearer service-key');
    assert.equal(headers.apikey, 'service-key');
    const json = (v) => ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) });
    if (method === 'POST' && u.pathname === '/storage/v1/object/list/premium') {
      const { prefix } = JSON.parse(body);
      const seen = new Map();
      for (const [name, o] of bucket) {
        if (!name.startsWith(`${prefix}/`)) continue;
        const rest = name.slice(prefix.length + 1);
        const [head, ...tail] = rest.split('/');
        seen.set(head, tail.length ? { name: head, id: null } : { name: head, id: 'x', updated_at: o.updated_at });
      }
      return json([...seen.values()]);
    }
    if (method === 'POST' && u.pathname.startsWith('/storage/v1/object/premium/')) {
      assert.equal(headers['x-upsert'], 'true');
      assert.match(headers['Content-Type'], /^text\/javascript/);
      bucket.set(decodeURIComponent(u.pathname.slice('/storage/v1/object/premium/'.length)), { updated_at: new Date(NOW).toISOString(), body: String(body) });
      return json({});
    }
    if (method === 'DELETE' && u.pathname === '/storage/v1/object/premium') {
      for (const p of JSON.parse(body).prefixes) bucket.delete(p);
      return json([]);
    }
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  return { bucket, calls, fetch };
}

function premiumDir(objects) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-publish-'));
  for (const [obj, code] of Object.entries(objects)) {
    fs.mkdirSync(path.dirname(path.join(dir, obj)), { recursive: true });
    fs.writeFileSync(path.join(dir, obj), code);
  }
  const manifest = { bucket: 'premium', objects: Object.fromEntries(Object.keys(objects).map((o) => [o, `js/${o.split('/').slice(1).join('/')}`])) };
  fs.writeFileSync(path.join(dir, 'premium-manifest.json'), JSON.stringify(manifest));
  return dir;
}

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

test('publish uploads the manifest, deletes stale objects past the grace period and never logs the key', async () => {
  const dir = premiumDir({ 'beginner/lessons/a.2222222222.js': 'export default 1', 'advanced/games/b.2222222222.js': 'export default 2' });
  const s = fakeStorage({
    'beginner/lessons/a.1111111111.js': { updated_at: hoursAgo(72) },
    'advanced/games/b.1111111111.js': { updated_at: hoursAgo(1) },
  });
  const lines = [];
  try {
    const plan = await publish({ argv: [], env: ENV, fetch: s.fetch, premiumDir: dir, log: (l) => lines.push(l), now: NOW });
    assert.deepEqual(plan.remove, ['beginner/lessons/a.1111111111.js']);
    assert.deepEqual([...s.bucket.keys()].sort(), ['advanced/games/b.1111111111.js', 'advanced/games/b.2222222222.js', 'beginner/lessons/a.2222222222.js']);
    assert.equal(s.bucket.get('beginner/lessons/a.2222222222.js').body, 'export default 1');
    assert.ok(s.calls.every((c) => c.url.startsWith('https://proj.supabase.co/storage/v1/')));
    assert.ok(!lines.join('\n').includes('service-key'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run prints the plan and changes nothing', async () => {
  const dir = premiumDir({ 'beginner/lessons/a.2222222222.js': 'x' });
  const s = fakeStorage({ 'beginner/lessons/old.1111111111.js': { updated_at: hoursAgo(500) } });
  const lines = [];
  try {
    const plan = await publish({ argv: ['--dry-run'], env: ENV, fetch: s.fetch, premiumDir: dir, log: (l) => lines.push(l), now: NOW });
    assert.deepEqual(plan.remove, ['beginner/lessons/old.1111111111.js']);
    assert.ok(s.calls.every((c) => c.url.includes('/object/list/')), 'only listing calls');
    assert.match(lines.join('\n'), /Plan \(dry run\)[\s\S]*\+ beginner\/lessons\/a\.2222222222\.js[\s\S]*- beginner\/lessons\/old/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing credentials: an error, or a notice with --if-configured', async () => {
  const dir = premiumDir({ 'beginner/lessons/a.2222222222.js': 'x' });
  try {
    await assert.rejects(publish({ argv: [], env: {}, premiumDir: dir, log: () => {} }), /SUPABASE_SERVICE_ROLE_KEY/);
    const lines = [];
    assert.equal(await publish({ argv: ['--if-configured'], env: {}, premiumDir: dir, log: (l) => lines.push(l) }), null);
    assert.match(lines[0], /skipping/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a manifest outside the paid folders, and a missing build', async () => {
  const bad = premiumDir({ 'public/x.js': 'x' });
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-publish-'));
  try {
    await assert.rejects(publish({ argv: ['--dry-run'], env: {}, premiumDir: bad, log: () => {} }), /Unexpected object path/);
    await assert.rejects(publish({ argv: ['--dry-run'], env: {}, premiumDir: none, log: () => {} }), /PREMIUM_SOURCE=storage npm run build/);
  } finally {
    fs.rmSync(bad, { recursive: true, force: true });
    fs.rmSync(none, { recursive: true, force: true });
  }
});

test('storageApi surfaces HTTP errors with the status', async () => {
  const api = storageApi({ url: 'https://proj.supabase.co/', key: 'k', fetch: async () => ({ ok: false, status: 403, text: async () => 'denied' }) });
  await assert.rejects(api.upload('beginner/x.js', 'x'), /HTTP 403 denied/);
});
