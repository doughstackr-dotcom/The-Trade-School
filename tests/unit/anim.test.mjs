import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tween, sleep, sequence, ease, reducedMotion, countUp } from '../../js/core/anim.js';

test('ease functions hit their end points', () => {
  for (const [name, fn] of Object.entries(ease)) {
    assert.ok(Math.abs(fn(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1)`);
  }
  assert.ok(ease.easeOutBack(0.8) > 1, 'easeOutBack overshoots');
  assert.ok(ease.easeOutCubic(0.5) > 0.5);
});

test('reducedMotion is false without a browser', () => {
  assert.equal(reducedMotion(), false);
});

test('tween animates numbers and arrays to the end value', async () => {
  const seen = [];
  const ok = await tween({ from: 0, to: 10, duration: 60, onUpdate: (v) => seen.push(v) });
  assert.equal(ok, true);
  assert.equal(seen[0], 0);
  assert.equal(seen[seen.length - 1], 10);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'monotonic with easeOutCubic');
  let last;
  await tween({ from: [0, 100], to: [10, 50], duration: 30, onUpdate: (v) => (last = v) });
  assert.deepEqual(last, [10, 50]);
  await tween({ from: { a: 1 }, to: { a: 3 }, duration: 0, onUpdate: (v) => (last = v) });
  assert.deepEqual(last, { a: 3 });
});

test('tween.cancel resolves false and stops updates', async () => {
  let n = 0;
  const p = tween({ from: 0, to: 1, duration: 1000, onUpdate: () => n++ });
  await sleep(40);
  p.cancel();
  const res = await p;
  assert.equal(res, false);
  const after = n;
  await sleep(60);
  assert.equal(n, after);
});

test('sleep waits roughly the requested time', async () => {
  const t0 = Date.now();
  await sleep(50);
  assert.ok(Date.now() - t0 >= 45);
  await sleep(0);
});

test('sequence runs steps in order; stop halts it', async () => {
  const order = [];
  const seq = sequence([async () => order.push(1), () => sleep(10).then(() => order.push(2)), () => order.push(3)]);
  assert.equal(await seq.play(), true);
  assert.deepEqual(order, [1, 2, 3]);

  const order2 = [];
  const seq2 = sequence([() => sleep(30).then(() => order2.push('a')), () => order2.push('b')]);
  const done = seq2.play();
  seq2.stop();
  assert.equal(await done, false);
  await sleep(50);
  assert.deepEqual(order2, ['a'], 'the running step finishes, later steps do not run');
  assert.equal(seq2.stopped, true);
});

test('countUp writes formatted text', async () => {
  const el = { textContent: '' };
  await countUp(el, 1234.5, { duration: 30, decimals: 1, prefix: '$', suffix: ' XP' });
  assert.equal(el.textContent, '$1,234.5 XP');
  const el2 = { textContent: '40' };
  await countUp(el2, 50, { duration: 0 });
  assert.equal(el2.textContent, '50');
});
