import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPremiumModuleCache,
  premiumStoragePath,
  resolvePremiumModuleUrl,
  shouldLoadFromPremiumStorage,
  testInternals,
} from '../../js/core/premium-loader.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearPremiumModuleCache();
});

test('premiumStoragePath maps gated entries to plan-prefixed private storage paths', () => {
  assert.equal(
    premiumStoragePath({ id: 'candle-anatomy', tier: 'beginner', path: './lessons/candle-anatomy.js' }),
    'beginner/lessons/candle-anatomy.js',
  );
  assert.equal(
    premiumStoragePath({ id: 'fib-sniper', tier: 'advanced', path: './games/fib-sniper.js' }),
    'advanced/games/fib-sniper.js',
  );
  assert.equal(premiumStoragePath({ id: 'daily-challenge', tier: 'both', path: './games/daily-challenge.js' }), null);
  assert.equal(premiumStoragePath({ id: 'x', tier: 'beginner', path: '../secrets.js' }), null);
});

test('storage mode is opt-in and keeps local/open development on public modules', () => {
  const entry = { id: 'candle-anatomy', tier: 'beginner', path: './lessons/candle-anatomy.js' };
  assert.equal(shouldLoadFromPremiumStorage(entry, { enforcing: false }), false);
});

test('edge transport fetches premium source with user JWT and apikey headers', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response("export default { id: 'edge-ok' };", {
      status: 200,
      headers: { 'content-type': 'text/javascript' },
    });
  };
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'jwt-test' } } };
      },
    },
  };
  const entry = { id: 'candle-anatomy', tier: 'beginner', path: './lessons/candle-anatomy.js' };
  const url = await testInternals.resolvePremiumModuleUrlWithSource(
    entry,
    { enforcing: true, user: { id: 'u1' }, level: 'beginner' },
    'edge',
    { client },
  );
  assert.match(url, /^blob:/);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/functions\/v1\/premium-content\?path=beginner%2Flessons%2Fcandle-anatomy\.js$/);
  assert.equal(seen[0].init.headers.authorization, 'Bearer jwt-test');
  assert.ok(seen[0].init.headers.apikey);
  assert.equal(seen[0].init.cache, 'no-store');
});

test('edge transport fails closed on endpoint errors', async () => {
  globalThis.fetch = async () => Response.json({ error: 'tier' }, { status: 403 });
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'jwt-test' } } };
      },
    },
  };
  await assert.rejects(
    () => testInternals.loadStorageModule(client, 'advanced/games/fib-sniper.js', 'games/fib-sniper.js', 'u1:beginner', undefined, [], 'edge'),
    /tier/,
  );
});

test('resolvePremiumModuleUrl fails closed without a signed-in user', async () => {
  const entry = { id: 'candle-anatomy', tier: 'beginner', path: './lessons/candle-anatomy.js' };
  await assert.rejects(
    () => testInternals.resolvePremiumModuleUrlWithSource(entry, { enforcing: true, user: null }, 'storage'),
    /Sign in to open this premium module/,
  );
  assert.equal(await resolvePremiumModuleUrl(entry, { enforcing: true, user: null }), null);
});

test('premium import rewriting keeps shared code public and same-folder helpers private', async () => {
  const calls = [];
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'premium');
        return {
          async download(path) {
            calls.push(path);
            return {
              data: new Blob([
                "import { h } from '../core/ui.js';\nexport const helper = h;\n",
              ], { type: 'text/javascript' }),
              error: null,
            };
          },
        };
      },
    },
  };
  const source = [
    "import { LessonShell } from '../core/lesson-kit.js';",
    "import { helper } from './markets-orders-visuals.js';",
    "export default { helper, LessonShell };",
  ].join('\n');
  const rewritten = await testInternals.rewriteImports(
    source,
    'beginner/lessons/markets-orders.js',
    'lessons/markets-orders.js',
    client,
    [],
  );
  assert.match(rewritten, /\/js\/core\/lesson-kit\.js/);
  assert.match(rewritten, /blob:/);
  assert.deepEqual(calls, ['beginner/lessons/markets-orders-visuals.js']);
});

test('premium import rewriting handles dynamic same-folder imports and helper chains', async () => {
  const calls = [];
  const sources = {
    'advanced/games/main.js': "const mod = await import('./helper.js');\nexport default mod;\n",
    'advanced/games/helper.js': "import { h } from '../core/ui.js';\nexport const helper = h;\n",
  };
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'premium');
        return {
          async download(path) {
            calls.push(path);
            const source = sources[path];
            assert.ok(source, `unexpected ${path}`);
            return { data: new Blob([source], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  const url = await testInternals.loadStorageModule(client, 'advanced/games/main.js', 'games/main.js');
  assert.match(url, /^blob:/);
  assert.deepEqual(calls, ['advanced/games/main.js', 'advanced/games/helper.js']);
});

test('premium import rewriting rejects circular same-folder private imports', async () => {
  const sources = {
    'beginner/lessons/a.js': "import './b.js';\nexport default {};",
    'beginner/lessons/b.js': "import './a.js';\nexport default {};",
  };
  const client = {
    storage: {
      from() {
        return {
          async download(path) {
            const source = sources[path];
            assert.ok(source, `unexpected ${path}`);
            return { data: new Blob([source], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  await assert.rejects(
    () => testInternals.loadStorageModule(client, 'beginner/lessons/a.js', 'lessons/a.js', 'user-a:beginner'),
    /Circular premium module import/,
  );
});

test('premium cache is scoped by entitlement, not only storage path', async () => {
  const calls = [];
  const client = {
    storage: {
      from() {
        return {
          async download(path) {
            calls.push(path);
            return { data: new Blob(['export default {};'], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  const a = await testInternals.loadStorageModule(client, 'beginner/lessons/x.js', 'lessons/x.js', 'user-a:beginner');
  const again = await testInternals.loadStorageModule(client, 'beginner/lessons/x.js', 'lessons/x.js', 'user-a:beginner');
  const b = await testInternals.loadStorageModule(client, 'beginner/lessons/x.js', 'lessons/x.js', 'user-b:beginner');
  assert.equal(a, again);
  assert.notEqual(a, b);
  assert.deepEqual(calls, ['beginner/lessons/x.js', 'beginner/lessons/x.js']);
});

test('premium cache scope changes when entitlement level changes', () => {
  assert.equal(
    testInternals.entitlementKey({ user: { id: 'u1' }, level: 'beginner' }),
    'u1:beginner',
  );
  assert.equal(
    testInternals.entitlementKey({ user: { id: 'u1' }, level: 'advanced' }),
    'u1:advanced',
  );
});

test('storage download failures do not cache a permanent success or fail open', async () => {
  let failed = false;
  const client = {
    storage: {
      from() {
        return {
          async download() {
            if (!failed) {
              failed = true;
              return { data: null, error: { message: 'JWT expired' } };
            }
            return { data: new Blob(['export default {};'], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  await assert.rejects(
    () => testInternals.loadStorageModule(client, 'beginner/lessons/x.js', 'lessons/x.js'),
    /JWT expired/,
  );
  const url = await testInternals.loadStorageModule(client, 'beginner/lessons/x.js', 'lessons/x.js');
  assert.match(url, /^blob:/);
});

test('stale rejected pending download does not delete a newer scoped cache entry', async () => {
  let releaseOld;
  let calls = 0;
  const oldReady = new Promise((resolve) => { releaseOld = resolve; });
  const client = {
    storage: {
      from() {
        return {
          async download() {
            calls += 1;
            if (calls === 1) {
              await oldReady;
              return { data: null, error: { message: 'old request failed' } };
            }
            return { data: new Blob(['export default {};'], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  const old = testInternals.loadStorageModule(client, 'beginner/lessons/q.js', 'lessons/q.js', 'user-a:beginner');
  clearPremiumModuleCache();
  const fresh = await testInternals.loadStorageModule(client, 'beginner/lessons/q.js', 'lessons/q.js', 'user-a:beginner');
  releaseOld();
  await assert.rejects(() => old, /old request failed|access changed/i);
  assert.equal(await testInternals.loadStorageModule(client, 'beginner/lessons/q.js', 'lessons/q.js', 'user-a:beginner'), fresh);
  assert.equal(testInternals.moduleCache.size, 1);
});

test('in-flight premium downloads are discarded when access changes', async () => {
  let release;
  const downloadReady = new Promise((resolve) => { release = resolve; });
  const client = {
    storage: {
      from() {
        return {
          async download() {
            await downloadReady;
            return { data: new Blob(['export default {};'], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  const pending = testInternals.loadStorageModule(client, 'beginner/lessons/z.js', 'lessons/z.js', 'user-a:beginner');
  assert.equal(testInternals.moduleCache.size, 1);
  clearPremiumModuleCache();
  release();
  await assert.rejects(() => pending, /access changed/i);
  assert.equal(testInternals.moduleCache.size, 0);
  assert.equal(testInternals.objectUrls.size, 0);
});

test('clearPremiumModuleCache revokes object URLs and clears pending module state', async () => {
  const client = {
    storage: {
      from() {
        return {
          async download() {
            return { data: new Blob(['export default {};'], { type: 'text/javascript' }), error: null };
          },
        };
      },
    },
  };
  await testInternals.loadStorageModule(client, 'beginner/lessons/y.js', 'lessons/y.js');
  assert.equal(testInternals.moduleCache.size, 1);
  assert.ok(testInternals.objectUrls.size >= 1);
  clearPremiumModuleCache();
  assert.equal(testInternals.moduleCache.size, 0);
  assert.equal(testInternals.objectUrls.size, 0);
});
