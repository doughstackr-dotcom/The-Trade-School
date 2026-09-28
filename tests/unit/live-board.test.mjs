// live-board.js pure helpers: board rotation window, open-session filtering, the crypto fallback,
// price formatting, candle patching from a quote, and the visibility-aware interval helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rotateBoardWindow, openBoardQuotes, fallbackBoardQuotes, applyQuoteToCandles, fmtPrice, fmtPct,
  startVisibleIntervals, BOARD_VISIBLE_MAX, DEFAULT_BOARD,
} from '../../js/core/live-board.js';

const q = (symbol) => ({ symbol, price: 1 });
const SUNDAY = Date.UTC(2026, 8, 27, 15, 0); // US equities + FX closed
const MONDAY = Date.UTC(2026, 8, 28, 15, 0); // 11:00 New York: everything open

test('rotateBoardWindow: short lists are shown whole and do not rotate', () => {
  const list = [q('A'), q('B')];
  assert.deepEqual(rotateBoardWindow(list, { offset: 7 }), { visible: list, offset: 0, rotating: false });
  assert.deepEqual(rotateBoardWindow(null), { visible: [], offset: 0, rotating: false });
  const exact = Array.from({ length: BOARD_VISIBLE_MAX }, (_, i) => q(`S${i}`));
  assert.equal(rotateBoardWindow(exact).rotating, false);
});

test('rotateBoardWindow: long lists show a wrapping window of `max` from the offset', () => {
  const list = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(q);
  const w = rotateBoardWindow(list, { offset: 5, max: 4 });
  assert.equal(w.rotating, true);
  assert.equal(w.offset, 5);
  assert.deepEqual(w.visible.map((x) => x.symbol), ['F', 'G', 'A', 'B']);
  assert.equal(rotateBoardWindow(list, { offset: 9, max: 4 }).offset, 2, 'offset wraps');
  assert.equal(rotateBoardWindow(list, { offset: -1, max: 4 }).offset, 6, 'negative offsets wrap too');
});

test('openBoardQuotes: keeps only symbols whose market is in session (crypto always)', () => {
  const quotes = DEFAULT_BOARD.map(q);
  assert.deepEqual(openBoardQuotes(quotes, SUNDAY).map((x) => x.symbol), ['BTC-USD']);
  assert.equal(openBoardQuotes(quotes, MONDAY).length, DEFAULT_BOARD.length);
  assert.deepEqual(openBoardQuotes([null, {}, ...quotes], SUNDAY).map((x) => x.symbol), ['BTC-USD']);
  assert.deepEqual(openBoardQuotes(null), []);
});

test('fallbackBoardQuotes: prefers 24/7 crypto, else everything', () => {
  assert.deepEqual(fallbackBoardQuotes(DEFAULT_BOARD.map(q)).map((x) => x.symbol), ['BTC-USD']);
  const noCrypto = [q('SPY'), q('QQQ')];
  assert.deepEqual(fallbackBoardQuotes(noCrypto), noCrypto);
  assert.deepEqual(fallbackBoardQuotes(null), []);
});

test('applyQuoteToCandles: patches the forming bar, ignores dead quotes, never mutates', () => {
  const candles = [{ o: 1, h: 2, l: 0.5, c: 1.5, t: 1 }, { o: 10, h: 12, l: 9, c: 11, t: 2 }];
  const copy = structuredClone(candles);
  const out = applyQuoteToCandles(candles, { price: 13, ok: true });
  assert.deepEqual(candles, copy);
  assert.equal(out.length, 2);
  assert.equal(out[1].c, 13);
  assert.ok(out[1].h >= 13, 'high stretches to the live price');
  assert.equal(applyQuoteToCandles(candles, { price: null }), candles);
  assert.equal(applyQuoteToCandles(candles, { price: 5, ok: false }), candles);
  assert.equal(applyQuoteToCandles([], { price: 5 }).length, 0);
});

test('fmtPrice / fmtPct: dashes for missing values, signed percentages', () => {
  assert.equal(fmtPrice(null), '—');
  assert.equal(fmtPct(undefined), '—');
  assert.match(fmtPrice(1234.5), /1,234\.50/);
  assert.match(fmtPct(1.234), /^\+1\.23%$/);
  assert.match(fmtPct(-0.5), /^[-−]0\.50%$/);
});

test('startVisibleIntervals: runs each task on its interval, skips while hidden, stops cleanly', async () => {
  const doc = { hidden: false };
  const calls = { a: 0, b: 0 };
  const stop = startVisibleIntervals([[() => calls.a++, 5], [() => calls.b++, 5]], { doc });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(calls.a > 0 && calls.b > 0);
  doc.hidden = true;
  const frozen = { ...calls };
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls, frozen, 'no ticks while the tab is hidden');
  stop();
  stop();
  doc.hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls, frozen, 'no ticks after stop()');
  assert.equal(typeof startVisibleIntervals(null)(), 'undefined');
});
