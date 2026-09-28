// premium-loader.js: signed URL → fetch → blob: import for paid modules (PREMIUM_SOURCE =
// 'storage'), with Supabase, fetch and import() mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPremiumLoader, PremiumAccessError, PremiumLoadError, BUCKET, SIGNED_URL_TTL,
} from '../../js/core/premium-loader.js';

const ORIGIN = 'https://tts.example';
const LESSON = 'beginner/lessons/markets-orders.abc123def0.js';
const HELPER = 'beginner/lessons/markets-orders-visuals.abc123def0.js';

/** A fake world: objects in the bucket, a supabase-js-like client, fetch, blob URLs, import(). */
function world({ objects = {}, session = { user: { id: 'u1' } }, sign = null, fetchImpl = null } = {}) {
  const w = { signed: [], fetched: [], created: new Map(), revoked: [], imported: [], nextId: 0 };
  w.client = {
    auth: { async getSession() { return { data: { session } }; } },
    storage: {
      from(bucket) {
        assert.equal(bucket, BUCKET);
        return {
          async createSignedUrl(p, ttl) {
            w.signed.push({ path: p, ttl });
            if (sign) return sign(p);
            if (!(p in objects)) return { data: null, error: { name: 'StorageApiError', message: 'Object not found', status: 400 } };
            return { data: { signedUrl: `https://storage.example/sign/${p}?token=t` }, error: null };
          },
        };
      },
    },
  };
  w.loader = createPremiumLoader({
    getClient: async () => w.client,
    origin: ORIGIN,
    fetch: fetchImpl || (async (url) => {
      w.fetched.push(url);
      const p = new URL(url).pathname.replace('/sign/', '');
      return p in objects
        ? { ok: true, status: 200, text: async () => objects[p] }
        : { ok: false, status: 404, text: async () => '' };
    }),
    createObjectURL: (blob) => {
      const url = `blob:${ORIGIN}/${++w.nextId}`;
      w.created.set(url, blob);
      return url;
    },
    revokeObjectURL: (url) => w.revoked.push(url),
    importModule: async (url) => {
      const blob = w.created.get(url);
      assert.ok(blob, `import of an unknown blob URL ${url}`);
      assert.equal(blob.type, 'text/javascript');
      const text = await blob.text();
      w.imported.push({ url, text });
      return { default: { mount() {} }, text };
    },
  });
  return w;
}

test('loads a paid module: signed URL (60 s), fetch, imports pointed at the site, blob import, revoke', async () => {
  const w = world({
    objects: {
      [LESSON]: `import{h}from"/js/core/ui.0123456789.js";import{v}from"premium:${HELPER}";export default{mount(){}};`,
      [HELPER]: 'import{x}from\'/js/core/chart.0123456789.js\';export const v=1;',
    },
  });
  const mod = await w.loader.load(`premium:${LESSON}`);
  assert.equal(typeof mod.default.mount, 'function');
  assert.deepEqual(w.signed.map((s) => s.ttl), [SIGNED_URL_TTL, SIGNED_URL_TTL]);
  assert.equal(SIGNED_URL_TTL, 60);
  assert.deepEqual(w.signed.map((s) => s.path).sort(), [HELPER, LESSON].sort());
  const [entry] = w.imported;
  assert.match(entry.text, /from"https:\/\/tts\.example\/js\/core\/ui\.0123456789\.js"/);
  assert.doesNotMatch(entry.text, /premium:/);
  const helperUrl = entry.text.match(/from"(blob:[^"]+)"/)[1];
  assert.match(await w.created.get(helperUrl).text(), /from'https:\/\/tts\.example\/js\/core\/chart\.0123456789\.js'/);
  // The entry's URL is revoked after import; the dependency's stays usable for the session.
  assert.deepEqual(w.revoked, [entry.url]);
});

test('modules are cached per session; a failure is not cached', async () => {
  let fail = true;
  const text = 'export default{mount(){}};';
  const w = world({
    objects: { [LESSON]: text },
    fetchImpl: async () => {
      if (fail) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, text: async () => text };
    },
  });
  await assert.rejects(w.loader.load(LESSON), PremiumLoadError);
  fail = false;
  const a = await w.loader.load(LESSON);
  const b = await w.loader.load(`premium:${LESSON}`);
  assert.equal(a, b);
  assert.equal(w.imported.length, 1);
});

test('signed out → PremiumAccessError(signin), before any Storage call', async () => {
  const w = world({ session: null, objects: { [LESSON]: 'export default{}' } });
  await assert.rejects(w.loader.load(LESSON), (err) => err instanceof PremiumAccessError && err.code === 'signin');
  assert.equal(w.signed.length, 0);
});

test('Storage refusing the object (RLS hides it: 400 / 403 / 404) → PremiumAccessError(denied)', async () => {
  for (const status of [400, 403, 404]) {
    const w = world({ sign: () => ({ data: null, error: { message: 'Object not found', status } }) });
    await assert.rejects(w.loader.load(LESSON), (err) => err.name === 'PremiumAccessError' && err.code === 'denied' && err.status === status);
  }
  // supabase-js may report the status as a string statusCode
  const w = world({ sign: () => ({ data: null, error: { message: 'Unauthorized', statusCode: '403' } }) });
  await assert.rejects(w.loader.load(LESSON), (err) => err.name === 'PremiumAccessError' && err.status === 403);
});

test('an expired / refused download (HTTP 4xx) is an access error, 5xx a load error', async () => {
  const w403 = world({ objects: { [LESSON]: 'x' }, fetchImpl: async () => ({ ok: false, status: 403, text: async () => '' }) });
  await assert.rejects(w403.loader.load(LESSON), PremiumAccessError);
  const w500 = world({ objects: { [LESSON]: 'x' }, fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) });
  await assert.rejects(w500.loader.load(LESSON), (err) => err instanceof PremiumLoadError && /503/.test(err.message));
});

test('network failures are PremiumLoadError: unknown storage error, thrown client, missing client', async () => {
  const unknown = world({ sign: () => ({ data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } }) });
  await assert.rejects(unknown.loader.load(LESSON), PremiumLoadError);
  const throwing = world({ sign: () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(throwing.loader.load(LESSON), PremiumLoadError);
  const none = createPremiumLoader({ getClient: async () => null });
  await assert.rejects(none.load(LESSON), PremiumLoadError);
  const broken = createPremiumLoader({ getClient: async () => { throw new Error('vendor blocked'); } });
  await assert.rejects(broken.load(LESSON), PremiumLoadError);
});

test('only beginner/… and advanced/… object paths are loaded', async () => {
  const w = world();
  for (const bad of ['secret/x.js', '../beginner/x.js', 'beginner/x.txt', '']) {
    await assert.rejects(w.loader.load(bad), PremiumLoadError);
  }
  assert.equal(w.signed.length, 0);
});

test('an import cycle between paid modules is reported, not followed forever', async () => {
  const other = 'beginner/games/b.abc123def0.js';
  const w = world({
    objects: {
      [LESSON]: `import"premium:${other}";`,
      [other]: `import"premium:${LESSON}";`,
    },
  });
  await assert.rejects(w.loader.load(LESSON), (err) => err instanceof PremiumLoadError && /cycle/.test(err.message));
});

test('local source (localhost smoke) reads /__premium/<object> without Supabase', async () => {
  const urls = [];
  const loader = createPremiumLoader({
    localBase: '/__premium/',
    getClient: async () => { throw new Error('must not be called'); },
    fetch: async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => 'export default{}' };
    },
    createObjectURL: () => 'blob:x/1',
    revokeObjectURL: () => {},
    importModule: async () => ({ default: {} }),
  });
  await loader.load(LESSON);
  assert.deepEqual(urls, [`/__premium/${LESSON}`]);
});

test('loader errors never look like a stale-chunk import failure (router must not reload)', () => {
  // Same pattern as isChunkLoadError() in js/core/router.js.
  const chunk = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
  for (const err of [
    new PremiumAccessError('Your plan does not include this module.', 'denied', 403),
    new PremiumAccessError('Sign in to open this module.', 'signin'),
    new PremiumLoadError('Could not download this module. Check your connection and try again.'),
  ]) assert.doesNotMatch(err.message, chunk);
});
