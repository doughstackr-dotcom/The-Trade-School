// progress-sync.js: pull + merge on sign-in, debounced push, owner switching, and staying quiet
// (never throwing) when signed out, offline or when storage / the network fails.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store, SCHEMA_VERSION } from '../../js/core/store.js';
import { createProgressSync, stableStringify, syncable, OWNER_KEY } from '../../js/core/progress-sync.js';

beforeEach(() => store.reset());

/** In-memory stand-in for the supabase-js query builder over public.progress. */
function fakeDb(rows = {}) {
  const db = { rows: structuredClone(rows), upserts: [], selects: 0, failPull: false, failPush: false };
  db.client = {
    from(table) {
      assert.equal(table, 'progress');
      return {
        select(cols) {
          assert.equal(cols, 'data');
          return {
            eq(col, uid) {
              assert.equal(col, 'user_id');
              return {
                async maybeSingle() {
                  db.selects++;
                  if (db.failPull) return { data: null, error: new Error('offline') };
                  const row = db.rows[uid];
                  return { data: row ? { data: structuredClone(row) } : null, error: null };
                },
              };
            },
          };
        },
        async upsert(rec, opts) {
          assert.deepEqual(Object.keys(rec).sort(), ['data', 'user_id']);
          assert.deepEqual(opts, { onConflict: 'user_id' });
          if (db.failPush) return { error: new Error('offline') };
          db.upserts.push(structuredClone(rec));
          db.rows[rec.user_id] = structuredClone(rec.data);
          return { error: null };
        },
      };
    },
  };
  return db;
}

function fakeAccess(db, user = null) {
  const listeners = new Set();
  const a = {
    user,
    loaded: true,
    getAccess: () => ({ user: a.user ? { id: a.user } : null }),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    loadedClient: () => (a.loaded ? db.client : null),
    signIn(id) { a.user = id; for (const fn of listeners) fn(a.getAccess()); },
  };
  return a;
}

function fakeTimers() {
  const t = { queue: new Map(), id: 0 };
  t.setTimeout = (fn) => { t.queue.set(++t.id, fn); return t.id; };
  t.clearTimeout = (id) => t.queue.delete(id);
  t.runAll = () => { const fns = [...t.queue.values()]; t.queue.clear(); fns.forEach((fn) => fn()); };
  return t;
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup({ rows = {}, user = null, storage = memStorage() } = {}) {
  const db = fakeDb(rows);
  const access = fakeAccess(db, user);
  const timers = fakeTimers();
  const sync = createProgressSync({ store, access, storage, timers, doc: null, win: null, now: () => 1e12 });
  return { db, access, timers, storage, sync };
}

const cloud = (over = {}) => ({
  v: SCHEMA_VERSION, xp: 400, lessons: { c: { done: true, at: 3 } }, badges: [], badgeDates: {}, ...over,
});

test('stableStringify / syncable: key order does not matter; settings are never uploaded', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] }), stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
  assert.equal(syncable({ xp: 1, settings: { sound: true } }).settings, undefined);
  assert.equal(syncable(null), null);
});

test('signed out: no client calls, local progress untouched', async () => {
  const { db, sync, timers } = setup();
  sync.start();
  store.addXP(20, '', { silent: true, noModal: true });
  await settle();
  timers.runAll();
  await settle();
  assert.equal(db.selects, 0);
  assert.equal(db.upserts.length, 0);
  assert.equal(store.state.xp, 20);
  sync.stop();
});

test('sign-in: guest progress is merged with the account copy, saved locally and pushed back', async () => {
  const { db, access, sync, storage } = setup({ rows: { u1: cloud() } });
  store.completeLesson('a', { silent: true, noModal: true });
  const localXp = store.state.xp;
  sync.start();
  access.signIn('u1');
  await settle(); await settle();
  assert.equal(db.selects, 1);
  assert.equal(store.state.xp, Math.max(localXp, 400));
  assert.ok(store.state.lessons.a?.done && store.state.lessons.c?.done, 'lessons from both sides');
  assert.equal(db.upserts.length, 1, 'merged result pushed once');
  assert.equal(db.upserts[0].user_id, 'u1');
  assert.equal(db.upserts[0].data.settings, undefined);
  assert.ok(db.rows.u1.lessons.a.done);
  assert.equal(storage.map.get(OWNER_KEY), 'u1');
  assert.deepEqual(sync.status(), { uid: 'u1', ready: true, dirty: false, pending: false });
  sync.stop();
});

test('sign-in with nothing new to send does not push', async () => {
  const { db, access, sync } = setup({ rows: { u1: cloud() }, storage: memStorage({ [OWNER_KEY]: 'u1' }) });
  store.replace(cloud());
  sync.start();
  access.signIn('u1');
  await settle(); await settle();
  assert.equal(db.selects, 1);
  assert.equal(db.upserts.length, 0);
  sync.stop();
});

test('after sign-in, changes are pushed once after the debounce', async () => {
  const { db, access, sync, timers } = setup({ rows: { u1: cloud() }, storage: memStorage({ [OWNER_KEY]: 'u1' }) });
  store.replace(cloud());
  sync.start();
  access.signIn('u1');
  await settle(); await settle();
  store.addXP(10, '', { silent: true, noModal: true });
  store.setLessonStep('c', 2, 3);
  assert.equal(sync.status().pending, true);
  assert.equal(db.upserts.length, 0, 'nothing sent before the debounce fires');
  timers.runAll();
  await settle();
  assert.equal(db.upserts.length, 1);
  assert.equal(db.rows.u1.xp, 410);
  assert.deepEqual(db.rows.u1.lessonSteps.c, { step: 2, max: 3 });
  sync.stop();
});

test('a different account on this device starts from its own cloud copy (no leaking)', async () => {
  const { access, sync, db } = setup({ rows: { u2: cloud({ xp: 90 }) }, storage: memStorage({ [OWNER_KEY]: 'u1' }) });
  store.addXP(999, '', { silent: true, noModal: true });
  store.setSetting('sound', false);
  sync.start();
  access.signIn('u2');
  await settle(); await settle();
  assert.equal(store.state.xp, 90);
  assert.equal(store.state.settings.sound, false, 'device settings kept');
  assert.equal(db.rows.u1, undefined);
  sync.stop();
});

test('pull failure: nothing is pushed, nothing throws; a later pull recovers', async () => {
  const { db, access, sync } = setup({ rows: { u1: cloud() } });
  db.failPull = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    sync.start();
    access.signIn('u1');
    await settle(); await settle();
    store.addXP(5, '', { silent: true, noModal: true });
    assert.equal(db.upserts.length, 0);
    assert.equal(sync.status().ready, false);
    db.failPull = false;
    assert.equal(await sync.pull(), true);
    assert.equal(db.upserts.length, 1, 'the local change made while offline is sent');
    assert.equal(sync.status().ready, true);
  } finally {
    console.warn = warn;
    sync.stop();
  }
});

test('push failure keeps the change pending for the next flush', async () => {
  const { db, access, sync, timers } = setup({ rows: { u1: cloud() }, storage: memStorage({ [OWNER_KEY]: 'u1' }) });
  store.replace(cloud());
  const warn = console.warn;
  console.warn = () => {};
  try {
    sync.start();
    access.signIn('u1');
    await settle(); await settle();
    db.failPush = true;
    store.addXP(7, '', { silent: true, noModal: true });
    timers.runAll();
    await settle();
    assert.equal(sync.status().dirty, true);
    db.failPush = false;
    assert.equal(await sync.flush(), true);
    assert.equal(db.rows.u1.xp, 407);
  } finally {
    console.warn = warn;
    sync.stop();
  }
});

test('a cloud copy from a newer app version is left alone', async () => {
  const future = cloud({ v: SCHEMA_VERSION + 1, xp: 5000 });
  const { db, access, sync } = setup({ rows: { u1: future } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    sync.start();
    access.signIn('u1');
    await settle(); await settle();
    assert.equal(store.state.xp, 0);
    assert.equal(db.upserts.length, 0);
    assert.deepEqual(db.rows.u1, future);
  } finally {
    console.warn = warn;
    sync.stop();
  }
});

test('blocked storage and a missing client never throw', async () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const { db, access, sync } = setup({ rows: { u1: cloud() }, storage: throwing });
  sync.start();
  access.signIn('u1');
  await settle(); await settle();
  assert.equal(store.state.xp, 400);
  assert.equal(db.upserts.length, 0, 'fresh device: the cloud copy already has everything');
  store.addXP(1, '', { silent: true, noModal: true });
  assert.equal(await sync.flush(), true);
  assert.equal(db.rows.u1.xp, 401);
  sync.stop();

  const s2 = setup({ rows: { u1: cloud() } });
  s2.access.loaded = false;
  s2.sync.start();
  s2.access.signIn('u1');
  await settle();
  assert.equal(s2.db.selects, 0);
  s2.sync.stop();
});

test('sign-out stops pushing', async () => {
  const { db, access, sync, timers } = setup({ rows: { u1: cloud() }, storage: memStorage({ [OWNER_KEY]: 'u1' }) });
  store.replace(cloud());
  sync.start();
  access.signIn('u1');
  await settle(); await settle();
  access.signIn(null);
  store.addXP(3, '', { silent: true, noModal: true });
  timers.runAll();
  await settle();
  assert.equal(db.upserts.length, 0);
  assert.equal(sync.status().uid, null);
  sync.stop();
});
