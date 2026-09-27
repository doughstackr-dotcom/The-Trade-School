// Setup scanner (ARCHITECTURE §12.4): finds textbook setups in any candle series — generated or
// real — with conservative, documented rules (precision over recall: a learner must only ever
// be shown genuine examples). Every detector is CAUSAL: a setup is decided on the close of
// `decisionIdx` using candles 0..decisionIdx only, so the candles after it are a fair outcome.
// Also: outcomeOf(), realRound() (a real-market round for games) and describeChart() (the Live
// Lab's plain-English read). Pure module (no DOM).

import { atr as atrOf, ema, sma, rsi as rsiOf, closes as closesOf, zigzag, supportResistance, linearRegression, swings as swingsOf } from './indicators.js';
import { CANDLE_PATTERNS, CANDLE_PATTERN_IDS, CANDLE_RULES, contextTrend, typicalRange, candleConfirm, candleScenario } from './patterns.js';
import { realisticMarket } from './data.js';
import { getCatalog, getHistory, revealLabel } from './market.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v) => (isNum(v) ? Math.round(v * 1000) / 1000 : v);

// ---------------------------------------------------------------------------------------------
// Setup kinds
// ---------------------------------------------------------------------------------------------

const K = (id, name, direction, group, rule) => ({ id, name, direction, group, rule });

/** Every setup kind with its name, direction, group and the rule it is detected by. */
export const SETUP_KINDS = Object.freeze({
  ...Object.fromEntries(
    CANDLE_PATTERN_IDS.map((id) => {
      const p = CANDLE_PATTERNS[id];
      return [id, K(id, p.name, p.bias, 'candle', `${p.name} geometry (patterns.js CANDLE_RULES), bigger than the typical candle, ${p.context === 'any' ? 'in any context' : `after a ${p.context}`}${p.kind === 'reversal' ? ', at the extreme of the move' : ''}.`)];
    }),
  ),
  'trend-up': K('trend-up', 'Uptrend', 'bullish', 'trend', 'Over 50 candles: regression rise ≥ 5 ATR with R² ≥ 0.5, the last two swing highs and lows both higher, EMA 20 above a rising EMA 50 and price above EMA 50. Reported once when the trend is first confirmed.'),
  'trend-down': K('trend-down', 'Downtrend', 'bearish', 'trend', 'Mirror of the uptrend: fall ≥ 5 ATR, R² ≥ 0.5, lower highs and lower lows, EMA 20 below a falling EMA 50, price below EMA 50.'),
  range: K('range', 'Trading range', 'neutral', 'trend', 'Over 40 candles: high-to-low height 3–8 ATR, regression drift ≤ 1.5 ATR, at least two swing highs near the top and two swing lows near the bottom (within a quarter of the height), and price still inside.'),
  'support-bounce': K('support-bounce', 'Support bounce', 'bullish', 'level', 'A support level made by ≥ 2 earlier swing lows (zigzag swings with ≥ 2 ATR reactions, within 0.5 ATR of each other, ≥ 5 candles apart) that has held (no close 0.3 ATR below it). Price falls back into it from ≥ 1 ATR above, tags it (low within 0.3 ATR above / 0.6 ATR below, close not below), and the next candle (or the same one) closes green ≥ 0.4 ATR above the level. Tolerances around the level use the smaller of the current ATR and the ATR at its last touch.'),
  'resistance-reject': K('resistance-reject', 'Resistance rejection', 'bearish', 'level', 'Mirror of the support bounce at a resistance made by ≥ 2 earlier swing highs.'),
  'breakout-up': K('breakout-up', 'Breakout up', 'bullish', 'level', 'The first close ≥ 0.2 ATR above a resistance made by ≥ 2 swing highs (≥ 2 ATR zigzag swings within 0.5 ATR) that held for ≥ 10 candles, on a candle with a body ≥ 0.4 ATR closing in its upper half.'),
  'breakout-down': K('breakout-down', 'Breakout down', 'bearish', 'level', 'Mirror of the breakout up through a support made by ≥ 2 swing lows.'),
  'fakeout-up': K('fakeout-up', 'Failed breakout up', 'bearish', 'level', 'The first close above a ≥ 2-touch resistance, then within 15 candles (without running more than 5 ATR above it) a close back ≥ 0.25 ATR below it: the breakout trapped buyers.'),
  'fakeout-down': K('fakeout-down', 'Failed breakout down', 'bullish', 'level', 'Mirror of the failed breakout up at a support.'),
  'golden-cross': K('golden-cross', 'Golden cross', 'bullish', 'ma', 'SMA 50 crosses above SMA 200 (other averages via the maFast / maSlow / maType options) with no opposite cross in the previous 20 candles, the fast average rising and price above it; not in the first 20 candles after the averages exist.'),
  'death-cross': K('death-cross', 'Death cross', 'bearish', 'ma', 'SMA 50 crosses below SMA 200 (or the maFast / maSlow averages), no opposite cross in 20 candles, fast average falling, price below it.'),
  'bullish-divergence': K('bullish-divergence', 'Bullish RSI divergence', 'bullish', 'momentum', 'A new swing low vs the lowest swing low 5–40 candles earlier, with a ≥ 1.5 ATR bounce between them: price makes a lower low (≥ 0.25 ATR lower) while RSI 14 makes a higher low (≥ 4 points higher) and the first RSI low is below 35. Decided 3 candles after the second low (when it is confirmed as a swing).'),
  'bearish-divergence': K('bearish-divergence', 'Bearish RSI divergence', 'bearish', 'momentum', 'Mirror: price higher high, RSI lower high (≥ 4 points), first RSI high above 65.'),
  'fib-pullback': K('fib-pullback', 'Fibonacci pullback', 'neutral', 'fib', 'A clean impulse of ≥ 3 ATR between two zigzag swings (mostly one-way: net move ≥ 0.55 × the candle-to-candle path), a pullback of ≥ 2 candles that ends between the 0.382 and 0.786 retracement (never closing beyond 0.786), and a candle in the impulse direction (body ≥ 0.3 ATR) that closes beyond the pullback candle within 3 candles of its extreme. meta.ratio is the retracement.'),
  'double-top': K('double-top', 'Double top', 'bearish', 'chart', 'Two zigzag peaks 8–80 candles apart within max(0.6 ATR, 25% of the height) of each other and clearly above everything between them, the lowest low between them ≥ 2.5 ATR below (the neckline), a rise into the first peak, and the first close below the trough (neckline) within 25 candles of the second peak.'),
  'double-bottom': K('double-bottom', 'Double bottom', 'bullish', 'chart', 'Mirror of the double top: two matching troughs, then the first close above the peak between them.'),
  'head-and-shoulders': K('head-and-shoulders', 'Head and shoulders', 'bearish', 'chart', 'A zigzag head that is the highest point of the pattern, ≥ 0.8 ATR above both shoulders (each the high of its side and ≥ 1 ATR above the neckline), shoulders within 35% of the head height of each other, a neckline (through the two troughs) whose troughs differ by ≤ 50% of the head height, a rise into the left shoulder, and within 25 candles of the right shoulder the first close ≥ 0.1 ATR below both the neckline and every close of the trough before the right shoulder.'),
  'inverse-head-and-shoulders': K('inverse-head-and-shoulders', 'Inverse head and shoulders', 'bullish', 'chart', 'Mirror of head and shoulders below a neckline through the two peaks.'),
  'bull-flag': K('bull-flag', 'Bull flag', 'bullish', 'chart', 'A pole rising ≥ 5 ATR in ≤ 20 candles (≥ 0.3 ATR per candle, net move ≥ 0.4 × the path), then a flag of 4–35 candles (at most 2.2 × the pole) that drifts sideways or gently down (closes falling at ≤ 0.5 × the pole’s pace), retraces ≤ 50% of the pole and more slowly than the pole rose, and is quieter (average candle range ≤ 0.85 × the pole’s), and the first close ≥ 0.1 ATR above the flag’s upper line (fitted to the flag’s own highs, never rising, touching the highest).'),
  'bear-flag': K('bear-flag', 'Bear flag', 'bearish', 'chart', 'Mirror of the bull flag after a falling pole.'),
});
export const SETUP_KIND_IDS = Object.freeze(Object.keys(SETUP_KINDS));
const CANDLE_KIND_SET = new Set(CANDLE_PATTERN_IDS);

// ---------------------------------------------------------------------------------------------
// Shared context (computed once per findSetups call)
// ---------------------------------------------------------------------------------------------

function makeCtx(candles, opts) {
  const n = candles.length;
  const A = Array.isArray(opts.atr) && opts.atr.length === n ? opts.atr : atrOf(candles, 14);
  const cl = closesOf(candles);
  const cache = {};
  const lazy = (k, fn) => (cache[k] !== undefined ? cache[k] : (cache[k] = fn()));
  return {
    candles,
    n,
    A,
    cl,
    get ema20() {
      return lazy('ema20', () => ema(cl, 20));
    },
    get ema50() {
      return lazy('ema50', () => ema(cl, 50));
    },
    get rsi() {
      return lazy('rsi', () => rsiOf(cl, 14));
    },
    zz: (mult) => lazy(`zz${mult}`, () => zigzag(candles, { atrMult: mult })),
    vol: candles.some((k) => (k.v || 0) > 0),
  };
}

/** ATR at i (null during warm-up). */
const atrAt = (ctx, i) => (isNum(ctx.A[i]) && ctx.A[i] > 0 ? ctx.A[i] : null);
const volRatio = (ctx, i, n = 20) => {
  if (!ctx.vol) return null;
  const from = Math.max(0, i - n);
  let s = 0;
  let m = 0;
  for (let j = from; j < i; j++) {
    s += ctx.candles[j].v || 0;
    m++;
  }
  return m && s > 0 ? r3((ctx.candles[i].v || 0) / (s / m)) : null;
};
const pt = (idx, price) => ({ idx, price });

/**
 * Measured-move target `height` beyond `from` in direction dir (1 up, −1 down). A downward
 * projection never reaches zero: when it would land under 10% of `from` (a big crypto pole on a
 * low-priced chart), the same PERCENTAGE move is projected instead (height / top, top = the
 * pattern's high).
 */
function measuredTarget(from, height, dir, top) {
  if (dir > 0) return from + height;
  const t = from - height;
  if (t > 0.1 * from) return t;
  return from * Math.max(0.05, 1 - height / Math.max(top || from + height, height * 1.0001));
}

/** Pivots of a zigzag known on the close of bar i (confirmed at or before i). */
function knownPivots(list, i) {
  let hi = list.length;
  let lo = 0;
  // pivots are ordered by idx and confirmedIdx increases with idx, so binary search works.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].confirmedIdx <= i) lo = mid + 1;
    else hi = mid;
  }
  return list.slice(0, lo);
}

// ---------------------------------------------------------------------------------------------
// Detectors. Each returns [{ kind, start, end, decisionIdx, direction, meta }].
// ---------------------------------------------------------------------------------------------

function detectCandles(ctx, kinds, from, to) {
  const out = [];
  const { candles } = ctx;
  const trendAt = new Map();
  const rangeAt = new Map();
  for (let i = Math.max(from, 3); i <= to; i++) {
    for (const id of kinds) {
      const p = CANDLE_PATTERNS[id];
      const s = i - p.candles + 1;
      if (s < 3) continue;
      if (!trendAt.has(s)) {
        trendAt.set(s, contextTrend(candles, s));
        rangeAt.set(s, typicalRange(candles, s));
      }
      if (!CANDLE_RULES[id](candles, i, { trend: trendAt.get(s), avgRange: rangeAt.get(s) })) continue;
      const cs = candles.slice(s, i + 1);
      const dir = p.bias === 'bullish' ? 1 : p.bias === 'bearish' ? -1 : 0;
      out.push({
        kind: id,
        start: s,
        end: i,
        decisionIdx: i,
        direction: p.bias,
        meta: {
          name: p.name,
          trend: trendAt.get(s),
          confirm: dir ? candleConfirm(id, cs, dir) : null,
          stop: dir > 0 ? Math.min(...cs.map((k) => k.l)) : dir < 0 ? Math.max(...cs.map((k) => k.h)) : null,
          high: Math.max(...cs.map((k) => k.h)),
          low: Math.min(...cs.map((k) => k.l)),
          volumeRatio: volRatio(ctx, i),
        },
      });
    }
  }
  return out;
}

function detectTrends(ctx, want, from, to) {
  const out = [];
  const { candles, cl } = ctx;
  const W = 50;
  const e20 = ctx.ema20;
  const e50 = ctx.ema50;
  const zz = ctx.zz(2);
  const last = { 'trend-up': -Infinity, 'trend-down': -Infinity };
  const prev = { 'trend-up': false, 'trend-down': false };
  for (let i = Math.max(W - 1, 55); i < ctx.n; i++) {
    const a = atrAt(ctx, i);
    if (!a || !isNum(e50[i]) || !isNum(e50[i - 5])) continue;
    const win = cl.slice(i - W + 1, i + 1);
    const { slope, r2 } = linearRegression(win);
    const move = (slope * (W - 1)) / a;
    const piv = knownPivots(zz, i).filter((p) => p.idx >= i - W + 1);
    const hs = piv.filter((p) => p.type === 'high').slice(-2);
    const ls = piv.filter((p) => p.type === 'low').slice(-2);
    const upStruct = hs.length === 2 && ls.length === 2 && hs[1].price > hs[0].price && ls[1].price > ls[0].price;
    const dnStruct = hs.length === 2 && ls.length === 2 && hs[1].price < hs[0].price && ls[1].price < ls[0].price;
    const cond = {
      'trend-up': move >= 5 && r2 >= 0.5 && upStruct && e20[i] > e50[i] && e50[i] > e50[i - 5] && cl[i] > e50[i],
      'trend-down': move <= -5 && r2 >= 0.5 && dnStruct && e20[i] < e50[i] && e50[i] < e50[i - 5] && cl[i] < e50[i],
    };
    for (const kind of ['trend-up', 'trend-down']) {
      if (cond[kind] && !prev[kind] && i - last[kind] >= 40) {
        last[kind] = i;
        if (want.has(kind) && i >= from && i <= to) out.push({
          kind,
          start: i - W + 1,
          end: i,
          decisionIdx: i,
          direction: kind === 'trend-up' ? 'bullish' : 'bearish',
          meta: { name: SETUP_KINDS[kind].name, slope: slope, r2: r3(r2), moveAtr: r3(move), swings: [...hs, ...ls].sort((x, y) => x.idx - y.idx).map((p) => ({ idx: p.idx, price: p.price, type: p.type })) },
        });
      }
      prev[kind] = cond[kind];
    }
  }
  return out;
}

function detectRange(ctx, from, to) {
  const out = [];
  const { candles, cl } = ctx;
  const W = 40;
  const zz = ctx.zz(1.5);
  let prev = false;
  let last = -Infinity;
  for (let i = W - 1; i < ctx.n; i++) {
    const a = atrAt(ctx, i);
    if (!a) {
      prev = false;
      continue;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - W + 1; j <= i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    const height = hi - lo;
    const { slope } = linearRegression(cl.slice(i - W + 1, i + 1));
    const drift = Math.abs(slope * (W - 1)) / a;
    let cond = height >= 3 * a && height <= 8 * a && drift <= 1.5;
    let tops = [];
    let bottoms = [];
    if (cond) {
      const piv = knownPivots(zz, i).filter((p) => p.idx >= i - W + 1);
      tops = piv.filter((p) => p.type === 'high' && p.price >= hi - 0.25 * height);
      bottoms = piv.filter((p) => p.type === 'low' && p.price <= lo + 0.25 * height);
      cond = tops.length >= 2 && bottoms.length >= 2 && cl[i] < hi && cl[i] > lo;
    }
    if (cond && !prev && i - last >= 40) {
      last = i;
      if (i >= from && i <= to) out.push({
        kind: 'range',
        start: i - W + 1,
        end: i,
        decisionIdx: i,
        direction: 'neutral',
        meta: { name: 'Trading range', top: hi, bottom: lo, height, heightAtr: r3(height / a), touchesTop: tops.length, touchesBottom: bottoms.length, tops: tops.map((p) => pt(p.idx, p.price)), bottoms: bottoms.map((p) => pt(p.idx, p.price)) },
      });
    }
    prev = cond;
  }
  return out;
}

/**
 * Horizontal levels known at bar i: clusters of ≥ 2 zigzag (2 ATR) pivots of `type` (confirmed by i,
 * within 0.5 ATR of each other, ≥ 5 bars apart) from the last `look` candles.
 */
function levelsAt(ctx, i, type, look = 100) {
  const a = atrAt(ctx, i);
  if (!a) return [];
  const piv = knownPivots(ctx.zz(2), i).filter((p) => p.type === type && p.idx >= i - look && p.idx <= i - 3);
  const sorted = piv.slice().sort((x, y) => x.price - y.price);
  const clusters = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    // Tolerance from the calmer of today's ATR and the ATR when the pivot formed, so one volatility
    // spike cannot merge distant swings into a "level".
    const tol = 0.5 * Math.min(a, atrAt(ctx, p.idx) || a, atrAt(ctx, c?.members[0].idx) || a);
    if (c && p.price - c.members[0].price <= tol) c.members.push(p);
    else clusters.push({ members: [p] });
  }
  const out = [];
  for (const c of clusters) {
    const ms = c.members.sort((x, y) => x.idx - y.idx);
    // Touches must be separate visits (≥ 5 candles apart).
    const touches = [];
    for (const m of ms) if (!touches.length || m.idx - touches[touches.length - 1].idx >= 5) touches.push(m);
    if (touches.length < 2) continue;
    const prices = touches.map((m) => m.price);
    out.push({
      price: prices.reduce((s, v) => s + v, 0) / prices.length,
      top: Math.max(...prices),
      bottom: Math.min(...prices),
      touches: touches.map((m) => pt(m.idx, m.price)),
      first: touches[0].idx,
      last: touches[touches.length - 1].idx,
    });
  }
  return out;
}

function detectLevels(ctx, want, from, to) {
  const out = [];
  const { candles } = ctx;
  const lastEmit = new Map();
  const emit = (kind, level, i, s) => {
    const key = `${kind}:${Math.round(level.price * 1e6)}`;
    if (i - (lastEmit.get(key) ?? -Infinity) < 10) return;
    lastEmit.set(key, i);
    if (i >= from) out.push(s); // earlier bars run too, so de-duplication never depends on `from`
  };
  for (let i = 20; i <= to; i++) {
    const a = atrAt(ctx, i);
    if (!a) continue;
    const k = candles[i];
    const body = Math.abs(k.c - k.o);
    for (const side of ['support', 'resistance']) {
      const sup = side === 'support';
      const levels = levelsAt(ctx, i, sup ? 'low' : 'high');
      for (const L of levels) {
        if (L.first > i - 10) continue;
        const edge = sup ? L.bottom : L.top; // the far edge of the level
        const d = sup ? 1 : -1;
        // Tolerances around the level use the calmer of today's ATR and the ATR at its last touch:
        // after a volatility spike, "near the level" must still mean near it.
        const aL = Math.min(a, atrAt(ctx, L.last) || a);
        // Held: no close decisively through it since the first touch (before the current bar).
        let held = true;
        for (let j = L.first; j < i; j++) if ((candles[j].c - edge) * d < -0.3 * aL) held = false;
        // Bounce / rejection.
        if (held && want.has(sup ? 'support-bounce' : 'resistance-reject')) {
          for (const t of [i - 1, i]) {
            if (t <= L.last + 2 || t < 5) continue;
            const kt = candles[t];
            const ext = sup ? kt.l : kt.h;
            const tag = sup ? ext <= L.top + 0.3 * aL && ext >= L.bottom - 0.6 * aL : ext >= L.bottom - 0.3 * aL && ext <= L.top + 0.6 * aL;
            if (!tag || (kt.c - edge) * d < 0) continue;
            if ((candles[t - 5].c - L.price) * d < 1 * a) continue; // came from ≥ 1 ATR away
            const turned = (k.c - k.o) * d > 0 && (k.c - L.price) * d >= 0.4 * a && (t === i || (k.c - (kt.h + kt.l) / 2) * d > 0);
            // The touch is the extreme of the last few candles.
            let extreme = true;
            for (let j = Math.max(0, t - 3); j <= i; j++) if (j !== t && (sup ? candles[j].l < kt.l : candles[j].h > kt.h)) extreme = false;
            if (!turned || !extreme) continue;
            const kind = sup ? 'support-bounce' : 'resistance-reject';
            emit(kind, L, i, {
              kind,
              start: L.first,
              end: i,
              decisionIdx: i,
              direction: sup ? 'bullish' : 'bearish',
              meta: { name: SETUP_KINDS[kind].name, level: L.price, zone: [L.bottom, L.top], touches: L.touches.length + 1, touchIdx: t, pivots: L.touches, stop: sup ? Math.min(kt.l, L.bottom) - 0.2 * a : Math.max(kt.h, L.top) + 0.2 * a, volumeRatio: volRatio(ctx, i) },
            });
            break;
          }
        }
        // Breakout: the first decisive close through the level after it held.
        const brk = sup ? 'breakout-down' : 'breakout-up';
        if (held && want.has(brk)) {
          const beyond = (k.c - edge) * -d;
          const prevInside = (candles[i - 1].c - edge) * -d <= 0;
          const strong = body >= 0.4 * a && (sup ? k.c <= (k.h + k.l) / 2 : k.c >= (k.h + k.l) / 2) && (k.c - k.o) * -d > 0;
          if (beyond >= 0.2 * a && prevInside && strong) {
            emit(brk, L, i, {
              kind: brk,
              start: L.first,
              end: i,
              decisionIdx: i,
              direction: sup ? 'bearish' : 'bullish',
              meta: { name: SETUP_KINDS[brk].name, level: edge, zone: [L.bottom, L.top], touches: L.touches.length, pivots: L.touches, stop: sup ? L.top + 0.5 * a : L.bottom - 0.5 * a, volumeRatio: volRatio(ctx, i) },
            });
          }
        }
        // Fakeout: a close through the level, then back inside within 15 candles.
        const fk = sup ? 'fakeout-down' : 'fakeout-up';
        if (want.has(fk) && (k.c - edge) * d >= 0.25 * a) {
          // i closes back inside. Walk back over the closes since the last one that was inside:
          // b = the earliest close beyond the level in that run (the breakout).
          let b = -1;
          let far = 0;
          for (let j = i - 1; j >= Math.max(L.last + 1, i - 15); j--) {
            if ((candles[j].c - edge) * d >= 0.25 * a) break; // an earlier close back inside
            if ((candles[j].c - edge) * -d > 0.05 * a) b = j;
          }
          if (b > 0) {
            // The level held until b (no earlier close beyond it), and price never ran far.
            let firstBeyond = true;
            for (let j = L.first; j < b; j++) if ((candles[j].c - edge) * -d > 0.05 * a) firstBeyond = false;
            for (let j = b; j < i; j++) far = Math.max(far, (sup ? edge - candles[j].l : candles[j].h - edge) / a);
            if (firstBeyond && far <= 5) {
              const extremeIdx = candles.slice(b, i + 1).reduce((best, kk, j) => ((sup ? kk.l < candles[best].l : kk.h > candles[best].h) ? b + j : best), b);
              emit(fk, L, i, {
                kind: fk,
                start: L.first,
                end: i,
                decisionIdx: i,
                direction: sup ? 'bullish' : 'bearish',
                meta: { name: SETUP_KINDS[fk].name, level: edge, zone: [L.bottom, L.top], touches: L.touches.length, pivots: L.touches, breakoutIdx: b, extremeIdx, stop: sup ? candles[extremeIdx].l - 0.2 * a : candles[extremeIdx].h + 0.2 * a },
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function detectCrosses(ctx, want, from, to, opts) {
  const out = [];
  const { candles, cl, n } = ctx;
  // Fixed defaults (never chosen from the series length: that would depend on the future).
  const fastP = opts.maFast || 50;
  const slowP = opts.maSlow || 200;
  const type = opts.maType === 'ema' ? 'ema' : 'sma';
  const f = type === 'ema' ? ema(cl, fastP) : sma(cl, fastP);
  const s = type === 'ema' ? ema(cl, slowP) : sma(cl, slowP);
  const label = (p) => `${type.toUpperCase()} ${p}`;
  let side = 0;
  let lastCross = -Infinity;
  for (let i = 1; i < n; i++) {
    if (!isNum(f[i]) || !isNum(s[i]) || !isNum(s[i - 20])) continue; // skip the warm-up
    const now = f[i] > s[i] ? 1 : f[i] < s[i] ? -1 : 0;
    if (!now) continue;
    if (side && now !== side) {
      const kind = now > 0 ? 'golden-cross' : 'death-cross';
      const clean = i - lastCross >= 20;
      const rising = isNum(f[i - 3]) && (f[i] - f[i - 3]) * now > 0;
      const price = (cl[i] - f[i]) * now > 0;
      if (clean && rising && price && want.has(kind) && i >= from && i <= to) {
        out.push({
          kind,
          start: Math.max(0, i - 30),
          end: i,
          decisionIdx: i,
          direction: now > 0 ? 'bullish' : 'bearish',
          meta: { name: SETUP_KINDS[kind].name, fast: label(fastP), slow: label(slowP), fastPeriod: fastP, slowPeriod: slowP, type, fastValue: f[i], slowValue: s[i] },
        });
      }
      lastCross = i;
    }
    side = now;
  }
  return out;
}

function detectDivergence(ctx, want, from, to) {
  const out = [];
  const { candles } = ctx;
  const R = ctx.rsi;
  const sw = swingsOf(candles, { left: 3, right: 3 });
  const oscAt = (idx, type) => {
    let best = null;
    for (let j = Math.max(0, idx - 2); j <= Math.min(R.length - 1, idx + 2); j++) {
      const v = R[j];
      if (!isNum(v)) continue;
      if (best == null || (type === 'low' ? v < best : v > best)) best = v;
    }
    return best;
  };
  for (const type of ['low', 'high']) {
    const kind = type === 'low' ? 'bullish-divergence' : 'bearish-divergence';
    if (!want.has(kind)) continue;
    const bull = type === 'low';
    const list = sw.filter((s) => s.type === type);
    for (let k = 1; k < list.length; k++) {
      const B = list[k];
      const d = B.idx + 3; // B is a confirmed swing once 3 more candles have closed
      if (d < from || d > to || d >= ctx.n) continue;
      const a = atrAt(ctx, B.idx);
      const rb = oscAt(B.idx, type);
      if (!a || rb == null) continue;
      // A: the most extreme swing of the same type 5–40 candles earlier.
      let A = null;
      for (let j = k - 1; j >= 0 && B.idx - list[j].idx <= 40; j--) {
        const c = list[j];
        if (B.idx - c.idx < 5) continue;
        if (!A || (bull ? c.price < A.price : c.price > A.price)) A = c;
      }
      if (!A) continue;
      const ra = oscAt(A.idx, type);
      if (ra == null) continue;
      // Two distinct lows (highs): a real bounce (pullback) of ≥ 1.5 ATR between them.
      const between = extremeBetween(candles, A.idx, B.idx, !bull);
      if (!between || Math.abs(between.price - A.price) < 1.5 * a) continue;
      const priceOk = bull ? B.price <= A.price - 0.25 * a : B.price >= A.price + 0.25 * a;
      const oscOk = bull ? rb >= ra + 4 && ra < 35 : rb <= ra - 4 && ra > 65;
      if (!priceOk || !oscOk) continue;
      out.push({
        kind,
        start: A.idx,
        end: d,
        decisionIdx: d,
        direction: bull ? 'bullish' : 'bearish',
        meta: { name: SETUP_KINDS[kind].name, oscillator: 'RSI 14', a: { idx: A.idx, price: A.price, rsi: r3(ra) }, b: { idx: B.idx, price: B.price, rsi: r3(rb) }, stop: bull ? B.price - 0.2 * a : B.price + 0.2 * a },
      });
    }
  }
  return out;
}

function detectFib(ctx, from, to) {
  const out = [];
  const { candles } = ctx;
  const zz = ctx.zz(2);
  const used = new Set();
  for (let i = 20; i <= to; i++) {
    const piv = knownPivots(zz, i);
    if (piv.length < 2) continue;
    const B = piv[piv.length - 1];
    const A = piv[piv.length - 2];
    if (used.has(B.idx) || B.idx >= i) continue;
    const up = B.type === 'high';
    const a = atrAt(ctx, B.idx);
    if (!a || Math.abs(B.price - A.price) < 3 * a) continue;
    // A clean impulse: mostly one-way (efficiency ≥ 0.55).
    let path = 0;
    for (let j = A.idx + 1; j <= B.idx; j++) path += Math.abs(candles[j].c - candles[j - 1].c);
    if (!(path > 0) || Math.abs(candles[B.idx].c - candles[A.idx].c) / path < 0.55) {
      used.add(B.idx);
      continue;
    }

    // The pullback so far: extreme since B.
    let cIdx = B.idx + 1;
    for (let j = B.idx + 1; j <= i; j++) if (up ? candles[j].l < candles[cIdx].l : candles[j].h > candles[cIdx].h) cIdx = j;
    if (cIdx >= i || i - cIdx > 3 || cIdx - B.idx < 2) continue;
    const C = up ? candles[cIdx].l : candles[cIdx].h;
    const size = Math.abs(B.price - A.price);
    const ratio = (up ? B.price - C : C - B.price) / size;
    if (ratio < 0.382 || ratio > 0.786) continue;
    const lvl786 = up ? B.price - 0.786 * size : B.price + 0.786 * size;
    let ok = true;
    for (let j = B.idx + 1; j <= i; j++) if (up ? candles[j].c < lvl786 : candles[j].c > lvl786) ok = false;
    // B must still be the extreme of the impulse (no new high after it).
    for (let j = B.idx + 1; j <= i; j++) if (up ? candles[j].h > B.price : candles[j].l < B.price) ok = false;
    const k = candles[i];
    const turn = Math.abs(k.c - k.o) >= 0.3 * a && (up ? k.c > k.o && k.c > candles[cIdx].h : k.c < k.o && k.c < candles[cIdx].l);
    if (!ok || !turn) continue;
    used.add(B.idx);
    if (i < from) continue;
    const levels = {};
    for (const r of [0.382, 0.5, 0.618, 0.786]) levels[r] = up ? B.price - r * size : B.price + r * size;
    const nearest = [0.382, 0.5, 0.618, 0.786].reduce((best, r) => (Math.abs(r - ratio) < Math.abs(best - ratio) ? r : best), 0.382);
    out.push({
      kind: 'fib-pullback',
      start: A.idx,
      end: i,
      decisionIdx: i,
      direction: up ? 'bullish' : 'bearish',
      meta: { name: 'Fibonacci pullback', ratio: r3(ratio), nearest, a: pt(A.idx, A.price), b: pt(B.idx, B.price), c: pt(cIdx, C), levels, impulseAtr: r3(size / a), stop: up ? C - 0.2 * a : C + 0.2 * a, target: B.price },
    });
  }
  return out;
}

/** Extreme (min low / max high) strictly between two indexes → { idx, price }. */
function extremeBetween(candles, a, b, low) {
  let best = null;
  for (let j = a + 1; j < b; j++) {
    const v = low ? candles[j].l : candles[j].h;
    if (!best || (low ? v < best.price : v > best.price)) best = { idx: j, price: v };
  }
  return best;
}
/** Highest high (lowest low when low) on [a, b]. */
function extremeOn(candles, a, b, low) {
  let v = low ? Infinity : -Infinity;
  for (let j = Math.max(0, a); j <= b; j++) v = low ? Math.min(v, candles[j].l) : Math.max(v, candles[j].h);
  return v;
}

/**
 * Double top / bottom: two zigzag peaks (troughs) with the deepest trough (highest peak) between
 * them as the neckline, then the first decisive close through the neckline.
 */
function detectDouble(ctx, want, from, to) {
  const out = [];
  const { candles } = ctx;
  const zz = ctx.zz(1.5);
  const seen = new Set();
  for (const top of [true, false]) {
    const kind = top ? 'double-top' : 'double-bottom';
    if (!want.has(kind)) continue;
    const d = top ? 1 : -1;
    const peaks = zz.filter((p) => p.type === (top ? 'high' : 'low'));
    for (let k2 = 1; k2 < peaks.length; k2++) {
      const P2 = peaks[k2];
      const a = atrAt(ctx, P2.idx);
      if (!a) continue;
      for (let k1 = k2 - 1; k1 >= 0; k1--) {
        const P1 = peaks[k1];
        if (P2.idx - P1.idx < 8) continue;
        if (P2.idx - P1.idx > 80) break;
        const T = extremeBetween(candles, P1.idx, P2.idx, top);
        if (!T || T.idx - P1.idx < 3 || P2.idx - T.idx < 3) continue;
        const ext = top ? Math.max(P1.price, P2.price) : Math.min(P1.price, P2.price);
        const inner = top ? Math.min(P1.price, P2.price) : Math.max(P1.price, P2.price);
        const height = (ext - T.price) * d;
        if (height < 2.5 * a || Math.abs(P1.price - P2.price) > Math.max(0.6 * a, 0.25 * height)) continue;
        // The two peaks are the extremes of the pattern: no swing between them comes close
        // (that would be a triple top).
        if (peaks.some((q) => q.idx > P1.idx && q.idx < P2.idx && (q.price - inner) * d > -0.1 * height)) continue;
        // A rise (fall) into the first peak.
        if (P1.idx < 5 || (extremeOn(candles, P1.idx - 25, P1.idx - 1, top) - T.price) * d >= 0) continue;
        for (let i = P2.idx + 1; i <= Math.min(ctx.n - 1, P2.idx + 25); i++) {
          if ((top ? candles[i].h > ext : candles[i].l < ext)) break; // a new extreme: no double top
          const through = (candles[i].c - T.price) * d;
          if (through >= 0) continue;
          if (through > -0.1 * a) break; // closed through, but not decisively: skip
          const key = `${kind}:${i}`;
          if (i >= from && i <= to && P2.confirmedIdx <= i && !seen.has(key)) {
            seen.add(key);
            out.push({
              kind,
              start: P1.idx,
              end: i,
              decisionIdx: i,
              direction: top ? 'bearish' : 'bullish',
              meta: { name: SETUP_KINDS[kind].name, points: [pt(P1.idx, P1.price), pt(T.idx, T.price), pt(P2.idx, P2.price)], neckline: T.price, height, target: measuredTarget(T.price, height, -d, ext), stop: ext + d * 0.2 * a, volumeRatio: volRatio(ctx, i) },
            });
          }
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Head and shoulders (inverse): a zigzag head, the nearest shoulders on each side that fit the
 * rules, troughs = the extremes between shoulder and head, then the first decisive close through
 * the neckline after the right shoulder.
 */
function detectHS(ctx, want, from, to) {
  const out = [];
  const { candles } = ctx;
  const zz = ctx.zz(1.5);
  const seen = new Set();
  for (const inv of [false, true]) {
    const kind = inv ? 'inverse-head-and-shoulders' : 'head-and-shoulders';
    if (!want.has(kind)) continue;
    const d = inv ? -1 : 1; // +1: peaks are highs
    const low = inv; // the pattern's peaks are lows for the inverse
    const peaks = zz.filter((p) => p.type === (inv ? 'low' : 'high'));
    for (let h = 1; h < peaks.length - 1; h++) {
      const H = peaks[h];
      let done = false;
      for (let r = h + 1; r < peaks.length && !done; r++) {
        const RS = peaks[r];
        if (RS.idx - H.idx > 40) break;
        if (RS.idx - H.idx < 4) continue;
        const a = atrAt(ctx, RS.idx);
        if (!a) continue;
        for (let l = h - 1; l >= 0 && !done; l--) {
          const LS = peaks[l];
          if (H.idx - LS.idx > 40) break;
          if (H.idx - LS.idx < 4) continue;
          // The head is the extreme of the whole pattern; each shoulder the extreme of its side.
          if ((extremeOn(candles, LS.idx, RS.idx, low) - H.price) * d > 0) continue;
          const T1 = extremeBetween(candles, LS.idx, H.idx, !low);
          const T2 = extremeBetween(candles, H.idx, RS.idx, !low);
          if (!T1 || !T2 || T1.idx - LS.idx < 2 || H.idx - T1.idx < 2 || T2.idx - H.idx < 2 || RS.idx - T2.idx < 2) continue;
          if ((extremeOn(candles, LS.idx, T1.idx, low) - LS.price) * d > 0 || (extremeOn(candles, T2.idx, RS.idx, low) - RS.price) * d > 0) continue;
          const neck = (x) => T1.price + ((T2.price - T1.price) * (x - T1.idx)) / (T2.idx - T1.idx);
          const headH = (H.price - neck(H.idx)) * d;
          if ((H.price - LS.price) * d < 0.8 * a || (H.price - RS.price) * d < 0.8 * a) continue;
          if (Math.abs(LS.price - RS.price) > 0.35 * headH) continue;
          if ((LS.price - neck(LS.idx)) * d < 1 * a || (RS.price - neck(RS.idx)) * d < 1 * a) continue;
          // A neckline can slope, but not so steeply that it stops describing the troughs.
          if (Math.abs(T2.price - T1.price) > 0.5 * headH) continue;
          // A trend into the pattern: price came from beyond the neckline.
          if (LS.idx < 5 || (extremeOn(candles, LS.idx - 25, LS.idx - 1, !low) - neck(LS.idx)) * d >= 0) continue;
          // The lowest close (highest, inverse) of the trough between the head and the right shoulder.
          let t2c = d > 0 ? Infinity : -Infinity;
          for (let j = H.idx + 1; j < RS.idx; j++) t2c = d > 0 ? Math.min(t2c, candles[j].c) : Math.max(t2c, candles[j].c);
          for (let i = RS.idx + 1; i <= Math.min(ctx.n - 1, RS.idx + 25); i++) {
            if ((inv ? candles[i].l < RS.price : candles[i].h > RS.price)) break; // right shoulder broken
            const nk = neck(i);
            // The break must clear the neckline AND the closes of the trough (peak) between the head
            // and the right shoulder: on a sloping neckline, crossing the line alone can happen while
            // price is still inside the pattern.
            const brk = d > 0 ? Math.min(nk, t2c) : Math.max(nk, t2c);
            const through = (candles[i].c - brk) * d;
            if (through >= 0) continue;
            if (through > -0.1 * a) break;
            const key = `${kind}:${i}`;
            if (i >= from && i <= to && RS.confirmedIdx <= i && !seen.has(key)) {
              seen.add(key);
              out.push({
                kind,
                start: LS.idx,
                end: i,
                decisionIdx: i,
                direction: inv ? 'bullish' : 'bearish',
                meta: {
                  name: SETUP_KINDS[kind].name,
                  points: [pt(LS.idx, LS.price), pt(T1.idx, T1.price), pt(H.idx, H.price), pt(T2.idx, T2.price), pt(RS.idx, RS.price)],
                  labels: ['Left shoulder', 'Neckline', 'Head', 'Neckline', 'Right shoulder'],
                  neckline: { x1: T1.idx, y1: T1.price, x2: i, y2: nk },
                  height: headH,
                  target: measuredTarget(nk, headH, -d, d > 0 ? H.price : nk + headH),
                  stop: RS.price + d * 0.2 * a,
                  volumeRatio: volRatio(ctx, i),
                },
              });
              done = true;
            }
            break;
          }
        }
      }
    }
  }
  return out;
}

function detectFlags(ctx, want, from, to) {
  const out = [];
  const { candles } = ctx;
  for (const bull of [true, false]) {
    const kind = bull ? 'bull-flag' : 'bear-flag';
    if (!want.has(kind)) continue;
    const d = bull ? 1 : -1;
    const hi = (j) => (bull ? candles[j].h : -candles[j].l); // "high" in the flag's direction
    const lo = (j) => (bull ? candles[j].l : -candles[j].h);
    let lastPole = -Infinity;
    for (let i = 25; i <= to; i++) {
      const a = atrAt(ctx, i);
      if (!a) continue;
      const k = candles[i];
      if ((k.c - k.o) * d <= 0) continue;
      // Candidate pole tops, nearest first: the extreme of everything after it.
      let runMax = -Infinity;
      for (let p = i - 1; p >= Math.max(1, i - 35); p--) {
        const isTop = hi(p) > runMax;
        runMax = Math.max(runMax, hi(p));
        if (!isTop || i - p < 3 || p === lastPole) continue;
        const ap = atrAt(ctx, p);
        if (!ap) continue;
        // Pole start: the lowest point in the 20 candles before the top.
        let s = p - 1;
        for (let j = p - 1; j >= Math.max(0, p - 20); j--) if (lo(j) < lo(s)) s = j;
        const poleH = hi(p) - lo(s);
        const poleLen = p - s;
        if (poleLen < 2 || poleH < 5 * ap || poleH / poleLen < 0.3 * ap) continue;
        // A pole is one decisive move: net close-to-close change ≥ 0.4 × the path travelled.
        let path = 0;
        for (let j = s + 1; j <= p; j++) path += Math.abs(candles[j].c - candles[j - 1].c);
        if (!(path > 0) || ((candles[p].c - candles[s].c) * d) / path < 0.4) continue;
        // The flag: p + 1 .. i − 1.
        const f0 = p + 1;
        const f1 = i - 1;
        const flagLen = f1 - f0 + 1;
        if (flagLen < 4 || flagLen > Math.max(12, 2.2 * poleLen)) continue;
        let flagLo = Infinity;
        for (let j = f0; j <= f1; j++) flagLo = Math.min(flagLo, lo(j));
        if (hi(p) - flagLo > 0.5 * poleH) continue;
        // The flag is a quiet pause: its candles are smaller than the pole's.
        let rf = 0;
        let rp = 0;
        for (let j = f0; j <= f1; j++) rf += candles[j].h - candles[j].l;
        for (let j = s + 1; j <= p; j++) rp += candles[j].h - candles[j].l;
        if (rf / flagLen > 0.85 * (rp / poleLen)) continue;
        // Drift sideways or against the pole.
        const cls = [];
        const hs = [];
        for (let j = f0; j <= f1; j++) {
          cls.push([j, candles[j].c * d]);
          hs.push([j, hi(j)]);
        }
        const drift = linearRegression(cls).slope;
        if (drift > 0.1 * a) continue;
        // A flag is a gentle pause, not a V-shaped reversal: its closes drift against the pole at
        // ≤ 0.5 × the pole's pace, and it retraces more slowly than the pole advanced (≤ 0.8×).
        const poleSlope = poleH / poleLen;
        if (-drift > 0.5 * poleSlope) continue;
        if ((((hi(p) - flagLo) / poleH) * poleLen) / flagLen > 0.8) continue;
        // Upper line: slope of the flag's own highs (not rising in the pole direction), shifted up
        // to touch the highest one. The pole top is not part of the fit: through a short, flat
        // pause it would tilt the line steeply against the pole, and "breaking" such a line only
        // means price stopped falling.
        const m = Math.min(0, linearRegression(hs).slope);
        let c0 = -Infinity;
        for (let j = f0; j <= f1; j++) c0 = Math.max(c0, hi(j) - m * j);
        const line = (x) => c0 + m * x;
        const closeD = k.c * d;
        if (closeD < line(i) + 0.1 * a) continue;
        if (candles[i - 1].c * d > line(i - 1)) continue; // not the first close beyond
        lastPole = p;
        if (i < from) break;
        const toPrice = (v) => v * d;
        let lowLine = Infinity;
        for (let j = f0; j <= f1; j++) lowLine = Math.min(lowLine, lo(j) - m * j);
        out.push({
          kind,
          start: s,
          end: i,
          decisionIdx: i,
          direction: bull ? 'bullish' : 'bearish',
          meta: {
            name: SETUP_KINDS[kind].name,
            poleStart: pt(s, toPrice(lo(s))),
            poleTop: pt(p, toPrice(hi(p))),
            flag: { from: f0, to: f1 },
            upper: bull ? { x1: f0, y1: toPrice(line(f0)), x2: i, y2: toPrice(line(i)) } : { x1: f0, y1: toPrice(lowLine + m * f0), x2: i, y2: toPrice(lowLine + m * i) },
            lower: bull ? { x1: f0, y1: toPrice(lowLine + m * f0), x2: i, y2: toPrice(lowLine + m * i) } : { x1: f0, y1: toPrice(line(f0)), x2: i, y2: toPrice(line(i)) },
            height: poleH,
            target: measuredTarget(k.c, poleH, d, toPrice(lo(s))),
            stop: toPrice(flagLo) - d * 0.2 * a,
            retrace: r3((hi(p) - flagLo) / poleH),
            volumeRatio: volRatio(ctx, i),
          },
        });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * findSetups(candles, { kinds = SETUP_KIND_IDS, atr, from = 0, to = n − 1, maFast = 50, maSlow = 200, maType = 'sma'|'ema' })
 *   → [{ kind, start, end, decisionIdx, direction: 'bullish'|'bearish'|'neutral', meta }]
 * sorted by decisionIdx. Only setups DECIDED between `from` and `to` are returned. `atr` may be a
 * precomputed atr(candles, 14) array. meta always has `name`; other fields per kind (levels,
 * points, neckline, target, stop, ratio, volumeRatio (null without volume) …).
 */
export function findSetups(candles, opts = {}) {
  const list = Array.isArray(candles) ? candles : [];
  const n = list.length;
  if (n < 5) return [];
  const want = new Set((opts.kinds || SETUP_KIND_IDS).filter((k) => SETUP_KINDS[k]));
  const from = clamp(Math.floor(opts.from ?? 0), 0, n - 1);
  const to = clamp(Math.floor(opts.to ?? n - 1), 0, n - 1);
  if (to < from || !want.size) return [];
  const ctx = makeCtx(list, opts);
  const out = [];
  const candleKinds = [...want].filter((k) => CANDLE_KIND_SET.has(k));
  if (candleKinds.length) out.push(...detectCandles(ctx, candleKinds, from, to));
  if (want.has('trend-up') || want.has('trend-down')) out.push(...detectTrends(ctx, want, from, to));
  if (want.has('range')) out.push(...detectRange(ctx, from, to));
  if (['support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'].some((k) => want.has(k))) out.push(...detectLevels(ctx, want, from, to));
  if (want.has('golden-cross') || want.has('death-cross')) out.push(...detectCrosses(ctx, want, from, to, opts));
  if (want.has('bullish-divergence') || want.has('bearish-divergence')) out.push(...detectDivergence(ctx, want, from, to));
  if (want.has('fib-pullback')) out.push(...detectFib(ctx, from, to));
  if (want.has('double-top') || want.has('double-bottom')) out.push(...detectDouble(ctx, want, from, to));
  if (want.has('head-and-shoulders') || want.has('inverse-head-and-shoulders')) out.push(...detectHS(ctx, want, from, to));
  if (want.has('bull-flag') || want.has('bear-flag')) out.push(...detectFlags(ctx, want, from, to));
  return out.filter((s) => s.decisionIdx >= from && s.decisionIdx <= to).sort((x, y) => x.decisionIdx - y.decisionIdx || (x.kind < y.kind ? -1 : 1));
}

/**
 * outcomeOf(candles, idx, { bars = 20, atr, direction }) → { move, r, pct, direction: 'up'|'down'|'flat',
 *   bars, maxUp, maxDown, result? }
 * What happened after the close of candle idx: move = close[idx + bars] − close[idx] (or the last
 * candle available), r = move in ATRs (ATR 14 at idx), 'flat' when |move| < 1 ATR, maxUp /
 * maxDown = the best / worst excursion in ATRs. With direction ('bullish'|'bearish'|1|−1),
 * result = 'followed' | 'failed' | 'flat' (did price go the setup's way by ≥ 1 ATR?).
 */
export function outcomeOf(candles, idx, { bars = 20, atr, direction } = {}) {
  const n = candles?.length || 0;
  if (!n || !(idx >= 0 && idx < n)) return null;
  const end = Math.min(n - 1, idx + Math.max(1, Math.floor(bars)));
  const A = Array.isArray(atr) && isNum(atr[idx]) ? atr[idx] : atrOf(candles.slice(0, idx + 1), 14)[idx];
  const unit = isNum(A) && A > 0 ? A : typicalRange(candles, idx + 1, 14) || Math.abs(candles[idx].c) * 0.01 || 1;
  const base = candles[idx].c;
  const move = candles[end].c - base;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = idx + 1; j <= end; j++) {
    hi = Math.max(hi, candles[j].h);
    lo = Math.min(lo, candles[j].l);
  }
  const dir = Math.abs(move) < unit ? 'flat' : move > 0 ? 'up' : 'down';
  const out = {
    move,
    r: r3(move / unit),
    pct: r3((move / base) * 100),
    direction: end > idx ? dir : 'flat',
    bars: end - idx,
    maxUp: end > idx ? r3((hi - base) / unit) : 0,
    maxDown: end > idx ? r3((base - lo) / unit) : 0,
    atr: unit,
  };
  const want = direction === 'bullish' || direction === 1 ? 'up' : direction === 'bearish' || direction === -1 ? 'down' : null;
  if (want) out.result = out.direction === 'flat' ? 'flat' : out.direction === want ? 'followed' : 'failed';
  return out;
}

/** Shift every index in a setup (start, end, decisionIdx and idx / x1 / x2 / *Idx inside meta). */
export function shiftSetup(setup, offset) {
  const shift = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => shift(x, null));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = shift(x, k);
      return o;
    }
    if (isNum(v) && key && (key === 'idx' || key === 'x1' || key === 'x2' || key === 'from' || key === 'to' || /Idx$/.test(key))) return v - offset;
    return v;
  };
  const meta = shift(setup.meta || {}, null);
  // zone: [bottom, top] are prices, restore them.
  if (setup.meta && setup.meta.zone) meta.zone = setup.meta.zone;
  return { ...setup, start: setup.start - offset, end: setup.end - offset, decisionIdx: setup.decisionIdx - offset, meta };
}

const setupCache = new Map();
function cachedSetups(key, candles, kinds, A) {
  if (setupCache.has(key)) return setupCache.get(key);
  const list = findSetups(candles, { kinds, atr: A });
  setupCache.set(key, list);
  if (setupCache.size > 24) setupCache.delete(setupCache.keys().next().value);
  return list;
}

/**
 * realRound(rng, { kinds, intervals = ['1d', '1w'], symbols, before = 60, after = 20, bars = 1000, tries = 6 })
 *   → Promise<{ candles, decisionIdx, setup: { kind, start, end, decisionIdx, direction, meta },
 *     outcome: { move, r, pct, direction, bars, maxUp, maxDown, result }, symbol, name, interval,
 *     decimals, from, to, decisionTime, title, attribution, delayed, source, mock, lead } | null>
 * Picks a market / timeframe from the catalog (rng decides), scans its history with findSetups and
 * samples one setup (kinds weighted evenly) whose `before` candles (the whole setup included) and
 * `after` candles fit. candles = the window (before + after), decisionIdx = before − 1, indexes in
 * setup are window-relative, `lead` = up to 250 candles before the window (indicator warm-up).
 * title = 'BTC-USD · Weekly · 12 Mar 2026' (the decision candle's date) — show it after the answer.
 * null when there is no data or nothing fits (callers fall back to textbook rounds).
 */
export async function realRound(rng, opts = {}) {
  const { kinds = SETUP_KIND_IDS, intervals = ['1d', '1w'], symbols = null, before = 60, after = 20, bars = 1000, tries = 6 } = opts;
  try {
    const cat = await getCatalog();
    const pairs = [];
    for (const s of cat.symbols) {
      if (symbols && !symbols.includes(s.id)) continue;
      for (const iv of s.intervals) if (intervals.includes(iv)) pairs.push({ s, iv });
    }
    if (!pairs.length) return null;
    const order = rng.shuffle(pairs);
    for (const { s, iv } of order.slice(0, Math.max(1, tries))) {
      const hist = await getHistory({ symbol: s.id, interval: iv, bars });
      const all = hist.candles || [];
      if (hist.status !== 'online' || all.length < before + after + 20) continue;
      const A = atrOf(all, 14);
      const key = `${hist.mock ? 'm:' : ''}${s.id}|${iv}|${all.length}|${all[all.length - 1].t}|${[...kinds].sort().join(',')}`;
      const setups = cachedSetups(key, all, kinds, A).filter((x) => x.decisionIdx - before + 1 >= 0 && x.start >= x.decisionIdx - before + 1 && x.decisionIdx + after <= all.length - 1);
      if (!setups.length) continue;
      const byKind = new Map();
      for (const x of setups) {
        if (!byKind.has(x.kind)) byKind.set(x.kind, []);
        byKind.get(x.kind).push(x);
      }
      const kind = rng.pick([...byKind.keys()]);
      const pick = rng.pick(byKind.get(kind));
      const d = pick.decisionIdx;
      const w0 = d - before + 1;
      const w1 = d + after;
      const window = all.slice(w0, w1 + 1);
      return {
        candles: window,
        decisionIdx: before - 1,
        setup: shiftSetup(pick, w0),
        outcome: outcomeOf(all, d, { bars: after, atr: A, direction: pick.direction }),
        symbol: s.id,
        name: s.name,
        interval: iv,
        decimals: s.decimals,
        from: window[0].t,
        to: window[window.length - 1].t,
        decisionTime: all[d].t,
        title: revealLabel({ symbol: s.id, interval: iv, t: all[d].t }),
        attribution: hist.attribution || '',
        delayed: !!hist.delayed,
        source: hist.source || null,
        mock: !!hist.mock,
        lead: all.slice(Math.max(0, w0 - 250), w0),
      };
    }
  } catch (err) {
    console.warn('realRound: no real round', err);
  }
  return null;
}

/**
 * simRound(rng, { kinds = SETUP_KIND_IDS, before = 60, after = 20, count = 400, tries = 24,
 *                 regime = 'mixed', start = 100, vol = 0.012, outcome, maFast, maSlow, maType })
 *   → { candles, decisionIdx, setup, outcome, lead, symbol: null, name: 'Simulated market',
 *       interval: null, decimals: 2, from: null, to: null, decisionTime: null, title: 'Simulated market',
 *       attribution: '', delayed: false, source: 'simulated', mock: false, sim: true } | null
 * The offline twin of realRound(): the same shape and the same window (decisionIdx = before − 1,
 * window-relative setup indexes, `lead` for indicator warm-up), but on a generated market, so it
 * works with no network. The setup is found by findSetups itself — it is genuine by exactly the
 * same rules as a real one. Candle-pattern kinds (rare on random data) come from candleScenario
 * (a lead-in of `before` candles; `outcome` 'success' | 'fail', default random) and are then
 * confirmed by the scanner. A kind is picked evenly (rng); if no simulated market in `tries`
 * contains it, the other kinds are tried. Synchronous and deterministic for a given rng.
 * Use it as the textbook fallback of a real round:
 *   const r = (await game.realRound(query)) || simRound(game.roundRng, query);
 * Never pass a simRound result to game.revealSource() (there is no market to reveal).
 */
export function simRound(rng, opts = {}) {
  const {
    kinds = SETUP_KIND_IDS, before = 60, after = 20, count = 400, tries = 24, regime = 'mixed', start = 100,
    vol = 0.012, outcome = null, maFast, maSlow, maType,
  } = opts;
  const list = [...new Set((kinds || []).filter((k) => SETUP_KINDS[k]))];
  if (!list.length || !rng) return null;
  const B = Math.max(10, Math.floor(before));
  const Aft = Math.max(0, Math.floor(after));
  const wrap = (all, pick, A) => {
    const d = pick.decisionIdx;
    const w0 = d - B + 1;
    const window = all.slice(w0, d + Aft + 1);
    return {
      candles: window,
      decisionIdx: B - 1,
      setup: shiftSetup(pick, w0),
      outcome: outcomeOf(all, d, { bars: Aft || 1, atr: A, direction: pick.direction }),
      lead: all.slice(Math.max(0, w0 - 250), w0),
      symbol: null,
      name: 'Simulated market',
      interval: null,
      decimals: 2,
      from: null,
      to: null,
      decisionTime: null,
      title: 'Simulated market',
      attribution: '',
      delayed: false,
      source: 'simulated',
      mock: false,
      sim: true,
    };
  };
  const order = rng.shuffle(list);
  for (const kind of order) {
    if (CANDLE_KIND_SET.has(kind)) {
      const p = CANDLE_PATTERNS[kind];
      for (let t = 0; t < 4; t++) {
        const sc = candleScenario(kind, {
          seed: rng.int(1, 2 ** 31 - 1), leadIn: Math.max(6, B - p.candles), after: Aft, start,
          outcome: outcome || (rng.chance(0.5) ? 'success' : 'fail'),
        });
        const all = sc.candles;
        if (sc.end - B + 1 < 0 || sc.end + Aft > all.length - 1) continue;
        const A = atrOf(all, 14);
        const pick = findSetups(all, { kinds: [kind], atr: A, from: sc.end, to: sc.end })[0];
        if (pick) return wrap(all, pick, A);
      }
      continue;
    }
    for (let t = 0; t < tries; t++) {
      const all = realisticMarket({ seed: rng.int(1, 2 ** 31 - 1), count: Math.max(count, B + Aft + 40), start, regime, vol, decimals: 2 });
      const A = atrOf(all, 14);
      const found = findSetups(all, { kinds: [kind], atr: A, maFast, maSlow, maType })
        .filter((x) => x.decisionIdx - B + 1 >= 0 && x.start >= x.decisionIdx - B + 1 && x.decisionIdx + Aft <= all.length - 1);
      if (found.length) return wrap(all, rng.pick(found), A);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// describeChart — the Live Lab's automatic read
// ---------------------------------------------------------------------------------------------

const fmtP = (p, dec) => (isNum(p) ? p.toFixed(dec) : '—');
function guessDecimals(candles) {
  const p = candles[candles.length - 1]?.c || 1;
  return p < 5 ? 4 : p < 50 ? 3 : 2;
}

/**
 * describeChart(candles, { decimals }) → { trend: 'up'|'down'|'range', levels: [{ price, type:
 *   'support'|'resistance', touches }], recentPatterns: [{ kind, idx, name, direction }], ma: {
 *   ema20, ema20Slope, priceVsEma20: 'above'|'below', sma50, priceVsSma50 }, rsi, atr, summary }
 * ema20Slope = % change of EMA 20 over the last 5 candles. levels: up to 2 nearest supports
 * below and 2 resistances above the last close. recentPatterns: setups decided in the last 10
 * candles (newest first). summary: 2–4 plain-English sentences.
 */
export function describeChart(candles, { decimals } = {}) {
  const cs = Array.isArray(candles) ? candles.filter((k) => k && [k.o, k.h, k.l, k.c].every(isNum)) : [];
  const n = cs.length;
  const dec = decimals ?? (n ? guessDecimals(cs) : 2);
  if (n < 20) {
    return { trend: 'range', levels: [], recentPatterns: [], ma: { ema20: null, ema20Slope: null, priceVsEma20: null, sma50: null, priceVsSma50: null }, rsi: null, atr: null, summary: 'Not enough candles yet to read this chart.' };
  }
  const cl = closesOf(cs);
  const A = atrOf(cs, 14);
  const a = A[n - 1] || typicalRange(cs, n, 14);
  const e20 = ema(cl, 20);
  const s50 = sma(cl, 50);
  const R = rsiOf(cl, 14);
  const last = cl[n - 1];

  // Trend: structure + slope over the last 60 candles.
  const win = cs.slice(-60);
  const { slope, r2 } = linearRegression(win.map((k) => k.c));
  const move = (slope * (win.length - 1)) / (a || 1);
  const zz = zigzag(cs, { atrMult: 2 }).filter((p) => p.idx >= n - 60);
  const hs = zz.filter((p) => p.type === 'high').slice(-2);
  const ls = zz.filter((p) => p.type === 'low').slice(-2);
  const hh = hs.length === 2 && hs[1].price > hs[0].price;
  const hl = ls.length === 2 && ls[1].price > ls[0].price;
  const lh = hs.length === 2 && hs[1].price < hs[0].price;
  const ll = ls.length === 2 && ls[1].price < ls[0].price;
  let trend = 'range';
  if (move >= 3 && r2 >= 0.3 && !(lh && ll)) trend = 'up';
  else if (move <= -3 && r2 >= 0.3 && !(hh && hl)) trend = 'down';
  else if (hh && hl && move > 1) trend = 'up';
  else if (lh && ll && move < -1) trend = 'down';

  // Levels near price.
  const recent = cs.slice(-200);
  const off = n - recent.length;
  const raw = supportResistance(recent, { tolerance: Math.max(0.002, (0.45 * a) / last), minTouches: 2, left: 3, right: 3 });
  const levels = raw.map((l) => ({ price: l.price, type: l.price < last ? 'support' : 'resistance', touches: l.touches, lastIdx: l.lastIdx + off }));
  const sup = levels.filter((l) => l.type === 'support').sort((x, y) => y.price - x.price).slice(0, 2);
  const res = levels.filter((l) => l.type === 'resistance').sort((x, y) => x.price - y.price).slice(0, 2);

  // Recent setups.
  const found = findSetups(cs, { from: Math.max(0, n - 10), atr: A });
  const recentPatterns = found
    .filter((s) => !['trend-up', 'trend-down', 'range'].includes(s.kind))
    .sort((x, y) => y.decisionIdx - x.decisionIdx)
    .slice(0, 5)
    .map((s) => ({ kind: s.kind, idx: s.decisionIdx, name: SETUP_KINDS[s.kind].name, direction: s.direction }));

  const ema20 = e20[n - 1];
  const ema20Slope = isNum(e20[n - 6]) && isNum(ema20) ? r3(((ema20 - e20[n - 6]) / e20[n - 6]) * 100) : null;
  const ma = {
    ema20: isNum(ema20) ? ema20 : null,
    ema20Slope,
    priceVsEma20: isNum(ema20) ? (last >= ema20 ? 'above' : 'below') : null,
    sma50: isNum(s50[n - 1]) ? s50[n - 1] : null,
    priceVsSma50: isNum(s50[n - 1]) ? (last >= s50[n - 1] ? 'above' : 'below') : null,
  };
  const rsi = isNum(R[n - 1]) ? Math.round(R[n - 1] * 10) / 10 : null;

  // Summary (2–4 sentences).
  const sentences = [];
  const emaDir = ema20Slope == null ? '' : ema20Slope > 0.05 ? 'rising ' : ema20Slope < -0.05 ? 'falling ' : 'flat ';
  const above = ma.priceVsEma20 === 'above';
  if (trend === 'up') {
    const why = hh && hl ? ' (higher highs and higher lows)' : '';
    sentences.push(above || !ma.priceVsEma20 ? `Price is in an uptrend${why} and trades above its ${emaDir}20-EMA.` : `Price is in an uptrend${why}, but has pulled back below its ${emaDir}20-EMA.`);
  } else if (trend === 'down') {
    const why = lh && ll ? ' (lower highs and lower lows)' : '';
    sentences.push(!above || !ma.priceVsEma20 ? `Price is in a downtrend${why} and trades below its ${emaDir}20-EMA.` : `Price has been in a downtrend${why}, but is bouncing above its ${emaDir}20-EMA.`);
  } else {
    const top = Math.max(...win.map((k) => k.h));
    const bot = Math.min(...win.map((k) => k.l));
    sentences.push(`Price is moving sideways, roughly between ${fmtP(bot, dec)} and ${fmtP(top, dec)}, with no clear trend.`);
  }
  const lv = [];
  if (sup[0]) lv.push(`nearest support is ${fmtP(sup[0].price, dec)} (${sup[0].touches} touches)`);
  if (res[0]) lv.push(`nearest resistance is ${fmtP(res[0].price, dec)} (${res[0].touches} touches)`);
  if (lv.length) sentences.push(`${lv.join('; ').replace(/^n/, 'N')}.`);
  if (recentPatterns[0]) {
    const p = recentPatterns[0];
    const ago = n - 1 - p.idx;
    const nm = /^(Fibonacci|RSI)/.test(p.name) ? p.name : p.name.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()).replace(/ RSI /i, ' RSI ');
    sentences.push(`${/^[AEIOU]/i.test(p.name) ? 'An' : 'A'} ${nm} ${ago === 0 ? 'just formed on the last candle' : `formed ${ago} candle${ago === 1 ? '' : 's'} ago`} (${p.direction === 'neutral' ? 'indecision' : p.direction}).`);
  }
  if (rsi != null && sentences.length < 4) {
    if (rsi >= 70) sentences.push(`RSI 14 is ${Math.round(rsi)}: overbought, so the move may be stretched.`);
    else if (rsi <= 30) sentences.push(`RSI 14 is ${Math.round(rsi)}: oversold, so selling may be exhausted.`);
    else sentences.push(`RSI 14 is ${Math.round(rsi)}, ${rsi >= 55 ? 'showing upward momentum' : rsi <= 45 ? 'showing downward momentum' : 'neutral'}.`);
  }
  return {
    trend,
    levels: [...sup, ...res].map(({ price, type, touches }) => ({ price, type, touches })),
    recentPatterns,
    ma,
    rsi,
    atr: isNum(a) ? a : null,
    summary: sentences.slice(0, 4).join(' '),
  };
}
