import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, randomSeed, hashString, toSeed } from '../../js/core/rng.js';

test('same seed → identical sequence; different seeds differ', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const c = makeRng(43);
  const sa = Array.from({ length: 50 }, () => a.next());
  const sb = Array.from({ length: 50 }, () => b.next());
  const sc = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('matches the canonical mulberry32 implementation', () => {
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  for (const seed of [1, 42, 123456789, 4294967295]) {
    const r = makeRng(seed);
    const ref = mulberry32(seed);
    for (let i = 0; i < 1000; i++) assert.equal(r.next(), ref());
  }
  const r = makeRng(1);
  assert.deepEqual([r.next(), r.next(), r.next()].map((v) => Math.round(v * 4294967296)), [2693262067, 11749833, 2265367787]);
});

test('helpers stay in range and are deterministic', () => {
  const r = makeRng(7);
  for (let i = 0; i < 2000; i++) {
    const n = r.int(-3, 5);
    assert.ok(Number.isInteger(n) && n >= -3 && n <= 5);
    const f = r.float(2, 3);
    assert.ok(f >= 2 && f < 3);
    assert.ok([-1, 1].includes(r.sign()));
  }
  const arr = [1, 2, 3, 4, 5, 6];
  const sh = makeRng(9).shuffle(arr);
  assert.deepEqual([...sh].sort(), arr, 'shuffle is a permutation');
  assert.deepEqual(arr, [1, 2, 3, 4, 5, 6], 'shuffle does not mutate');
  assert.deepEqual(makeRng(9).shuffle(arr), sh);
  assert.ok(arr.includes(makeRng(3).pick(arr)));
  assert.equal(makeRng(3).pick([]), undefined);
});

test('int covers both ends inclusively', () => {
  const r = makeRng(11);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(r.int(1, 4));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('gauss has roughly the requested mean and sd', () => {
  const r = makeRng(123);
  const xs = Array.from({ length: 20000 }, () => r.gauss(5, 2));
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
  assert.ok(Math.abs(mean - 5) < 0.06, `mean ${mean}`);
  assert.ok(Math.abs(sd - 2) < 0.06, `sd ${sd}`);
});

test('chance(p) frequency', () => {
  const r = makeRng(5);
  let hits = 0;
  for (let i = 0; i < 10000; i++) if (r.chance(0.3)) hits++;
  assert.ok(Math.abs(hits / 10000 - 0.3) < 0.02);
});

test('fork: stable per label, independent of draws, different per label', () => {
  const a = makeRng(99);
  const f1 = a.fork('prices').next();
  a.next();
  a.next();
  const f2 = a.fork('prices').next();
  assert.equal(f1, f2, 'fork ignores how many numbers the parent drew');
  assert.notEqual(makeRng(99).fork('prices').next(), makeRng(99).fork('volume').next());
  assert.notEqual(makeRng(99).fork('prices').next(), makeRng(100).fork('prices').next());
});

test('seeds: strings hash, numbers normalise to uint32, randomSeed is uint32', () => {
  assert.equal(toSeed('abc'), hashString('abc'));
  assert.equal(toSeed(-1), 4294967295);
  assert.equal(toSeed('17'), 17);
  assert.equal(makeRng('hello').next(), makeRng('hello').next());
  for (let i = 0; i < 20; i++) {
    const s = randomSeed();
    assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
  }
});

test('weighted and sample', () => {
  const r = makeRng(8);
  let a = 0;
  for (let i = 0; i < 4000; i++) if (r.weighted(['a', 'b'], [3, 1]) === 'a') a++;
  assert.ok(Math.abs(a / 4000 - 0.75) < 0.03);
  const s = makeRng(2).sample([1, 2, 3, 4, 5], 3);
  assert.equal(new Set(s).size, 3);
});
