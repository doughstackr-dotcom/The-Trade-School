// Order Desk engine (private helper of the markets-orders unit: the Order Desk game and the
// "Markets, orders and the spread" lesson). Pure logic, no DOM: importable from node.
//
// Prices are integers in TICKS (price = ticks × TICK). A market is a path of last-trade prices,
// one per tick, plus the bid / ask around it (an uptick trades at the ask, a downtick at the bid)
// and a depth-of-market book. The simulator fills market, limit, stop and stop-limit orders the
// way a broker does: market orders walk the book, resting limits fill at their price or better,
// stops trigger on a trade at their price and then fill at the next available price (slippage in
// fast markets and gaps), stop-limits refuse prices beyond their limit.
import { makeRng, hashString } from '../core/rng.js';

export const TICK = 0.05; // price increment
export const DECIMALS = 2;
export const BAND = 9; // ladder rows each side of the round's reference price
export const PER = 5; // ticks per candle
export const HIST = 30; // history candles shown before the order
export const FUT = 12; // candles played out after the order
export const T_MAX = FUT * PER; // future ticks
export const SL_OFFSET = 3; // stop-limit orders: limit = stop ± 3 ticks
export const ORDER_TYPES = ['market', 'limit', 'stop', 'stop-limit'];
export const TYPE_LABEL = { market: 'Market', limit: 'Limit', stop: 'Stop', 'stop-limit': 'Stop-limit' };
export const TYPE_SHORT = { market: 'MKT', limit: 'LMT', stop: 'STP', 'stop-limit': 'STP LMT' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** ticks → price (rounded to the tick's decimals so 0.1 + 0.2 noise never shows). */
export function priceOf(ticks, tick = TICK, decimals = DECIMALS) {
  return Number((ticks * tick).toFixed(decimals));
}

/** ticks → '49.60' */
export function fmtTicks(ticks, tick = TICK, decimals = DECIMALS) {
  return (ticks * tick).toFixed(decimals);
}

/** '1,200' */
export function fmtSize(n) {
  return Math.round(n).toLocaleString('en-US');
}

// ------------------------------------------------------------------ paths

/**
 * walkPath(rng, { from, T, points, noise, maxStep, fast, lo, hi }) → Int[] | null
 * Last-trade path last[0..T] (last[0] = from) through waypoints [{ t, v, jump? }] (t ascending,
 * the last one at T). Between waypoints the path follows the straight line plus a Brownian
 * bridge (sd `noise` ticks per step; a waypoint's own `noise` overrides it for the segment that
 * ends there; noise 0 turns every segment straight), moving at most `maxStep` ticks per tick (3 inside `fast`
 * ticks). A `jump` waypoint holds the previous level and then jumps straight to v at t (a gap:
 * no trades in between). Returns null when a waypoint cannot be hit or the path leaves [lo, hi].
 */
export function walkPath(rng, { from, T, points = [], noise = 0.8, maxStep = 1, fast = null, lo = -Infinity, hi = Infinity } = {}) {
  const last = new Array(T + 1).fill(from);
  const pts = [{ t: 0, v: from }, ...points].sort((a, b) => a.t - b.t);
  if (pts[pts.length - 1].t !== T) pts.push({ t: T, v: pts[pts.length - 1].v });
  let cur = from;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const n = b.t - a.t;
    if (n <= 0) return null;
    if (b.jump) {
      for (let t = a.t + 1; t < b.t; t++) last[t] = cur;
      cur = b.v;
      last[b.t] = cur;
      continue;
    }
    const sd = b.noise ?? noise;
    const W = [0];
    for (let i = 1; i <= n; i++) W[i] = W[i - 1] + (sd > 0 && noise > 0 ? rng.gauss(0, sd) : 0);
    for (let i = 1; i <= n; i++) {
      const t = a.t + i;
      const ms = fast && fast[t] ? 3 : maxStep;
      const target = a.v + ((b.v - a.v) * i) / n + (W[i] - (i / n) * W[n]);
      let next = cur + clamp(Math.round(target) - cur, -ms, ms);
      // Stay able to reach the waypoint with the steps left.
      const rem = n - i;
      let reach = 0;
      for (let j = 1; j <= rem; j++) reach += fast && fast[t + j] ? 3 : maxStep;
      if (next > b.v + reach) next = Math.max(cur - ms, b.v + reach);
      if (next < b.v - reach) next = Math.min(cur + ms, b.v - reach);
      cur = next;
      last[t] = cur;
      if (cur < lo || cur > hi) return null;
    }
    if (cur !== b.v) return null;
  }
  for (const v of last) if (v < lo || v > hi) return null;
  return last;
}

/**
 * Bid / ask around the last-trade path: an uptick trades at the ask, a downtick at the bid, an
 * unchanged tick keeps the previous side (t = 0 trades at the bid). spread: number | Int[].
 */
export function quotes(last, spread = 1) {
  const bid = new Array(last.length);
  const ask = new Array(last.length);
  let role = 'bid';
  for (let t = 0; t < last.length; t++) {
    if (t > 0) {
      if (last[t] > last[t - 1]) role = 'ask';
      else if (last[t] < last[t - 1]) role = 'bid';
    }
    const s = Math.max(1, Array.isArray(spread) ? spread[t] ?? spread[spread.length - 1] : spread);
    if (role === 'bid') {
      bid[t] = last[t];
      ask[t] = last[t] + s;
    } else {
      ask[t] = last[t];
      bid[t] = last[t] - s;
    }
  }
  return { bid, ask };
}

/**
 * Candles from a tick path: candle k spans ticks [start + k·per, start + (k + 1)·per − 1], its
 * open is the first trade, close the last. upTo (inclusive tick) cuts the path (the last candle
 * is then still forming). Prices in price units; t = firstIndex + k.
 */
export function ticksToCandles(last, { per = PER, start = 1, upTo = last.length - 1, tick = TICK, decimals = DECIMALS, firstIndex = 0 } = {}) {
  const out = [];
  for (let k = 0; ; k++) {
    const a = start + k * per;
    if (a > upTo || a >= last.length) break;
    const b = Math.min(a + per - 1, upTo, last.length - 1);
    let h = -Infinity;
    let l = Infinity;
    let move = 0;
    for (let t = a; t <= b; t++) {
      h = Math.max(h, last[t]);
      l = Math.min(l, last[t]);
      if (t > 0) move += Math.abs(last[t] - last[t - 1]);
    }
    out.push({
      o: priceOf(last[a], tick, decimals),
      h: priceOf(h, tick, decimals),
      l: priceOf(l, tick, decimals),
      c: priceOf(last[b], tick, decimals),
      v: 400 + move * 260 + ((hashString(`v${a}`, last[a]) % 7) * 60),
      t: firstIndex + k,
    });
  }
  return out;
}

// ------------------------------------------------------------------ order book

/** Resting size at a price level: a stable per-level shape, deeper levels hold more. Lots of 100. */
export function levelSize(level, side, dist, salt = 0) {
  const u = hashString(`${side}:${level}`, salt) / 4294967296;
  const base = 240 + 150 * Math.min(Math.max(0, dist), 8);
  return Math.max(100, Math.round((base * (0.5 + 1.0 * u)) / 100) * 100);
}

/**
 * Depth of market around bid / ask → { bid, ask, bids: [{ p, size, fixed? }], asks: [...] } (best
 * first). overrides: { asks: [sizes], bids: [sizes] } pins the first levels (fixed: they never jitter).
 */
export function makeBook({ bid, ask, depth = 2 * BAND + 2, salt = 0, overrides = {} } = {}) {
  const side = (s, best, dir) => Array.from({ length: depth }, (_, i) => {
    const p = best + dir * i;
    const fixedSize = overrides[s]?.[i];
    return fixedSize != null ? { p, size: fixedSize, fixed: true } : { p, size: levelSize(p, s, i, salt) };
  });
  return { bid, ask, bids: side('bids', bid, -1), asks: side('asks', ask, 1) };
}

/** A lively copy: every unpinned level changes by up to ±`amount` (fraction), lots of 100. */
export function jitterBook(book, rng, amount = 0.22) {
  const j = (lv) => (lv.fixed ? { ...lv } : { ...lv, size: Math.max(100, Math.round((lv.size * (1 + rng.float(-amount, amount))) / 100) * 100) });
  return { ...book, bids: book.bids.map(j), asks: book.asks.map(j) };
}

// ------------------------------------------------------------------ order simulation

/**
 * simulate(order, market) → result
 *   order:  { side: 'buy'|'sell', type: 'market'|'limit'|'stop'|'stop-limit', price, limit?, size }
 *           (prices in ticks; stop-limit: price = stop, limit = limit price)
 *   market: { last, bid, ask, fast?, book }  — index 0 is "now" (when the order is sent)
 * → { fills: [{ t, p, size }], filled, avg, full, firstT, doneT, triggered, triggerT, immediate,
 *     marketable, restingAt, status: 'filled'|'partial'|'open'|'triggered'|'idle', events }
 * Rules: market orders (and marketable limits, up to their limit) walk the book at t = 0.
 * A resting buy limit fills when a trade prints at or below it, at the limit or the better ask
 * (sell: mirrored). A buy stop triggers on a trade at or above its price (sell: at or below) and
 * fills the whole size at the ask of that tick — in a fast market at the worse of that tick and
 * the next. A stop already beyond the market triggers at once. A stop-limit triggers the same
 * way, fills at once only if the ask is within its limit, and otherwise rests as a limit order.
 */
export function simulate(order, m) {
  const buy = order.side === 'buy';
  const size = Math.max(1, Math.round(order.size || 100));
  const { last, bid, ask } = m;
  const fast = m.fast || [];
  const T = last.length - 1;
  const fills = [];
  const events = [];
  let remaining = size;
  let mode = order.type; // 'market' | 'limit' | 'stop' | 'stop-limit' | 'done'
  let lim = order.type === 'limit' ? order.price : order.type === 'stop-limit' ? order.limit ?? order.price + (buy ? SL_OFFSET : -SL_OFFSET) : null;
  let triggered = false;
  let triggerT = null;
  let immediate = false;
  let marketable = false;
  let restFrom = 1;

  const walk = (t, cap) => {
    const levels = buy ? m.book.asks : m.book.bids;
    let lastP = buy ? ask[t] : bid[t];
    for (const lv of levels) {
      if (remaining <= 0) break;
      if (cap != null && (buy ? lv.p > cap : lv.p < cap)) break;
      const take = Math.min(remaining, lv.size);
      if (take > 0) {
        fills.push({ t, p: lv.p, size: take });
        events.push({ t, kind: 'fill', p: lv.p, size: take, walk: true });
        remaining -= take;
      }
      lastP = lv.p;
    }
    if (remaining > 0 && cap == null) {
      // Book exhausted (never in the game's books): the rest one tick further out.
      const p = lastP + (buy ? 1 : -1);
      fills.push({ t, p, size: remaining });
      events.push({ t, kind: 'fill', p, size: remaining, walk: true });
      remaining = 0;
    }
  };
  const fillAll = (t, p) => {
    fills.push({ t, p, size: remaining });
    events.push({ t, kind: 'fill', p, size: remaining });
    remaining = 0;
  };
  const worse = (t) => {
    const p0 = buy ? ask[t] : bid[t];
    if (!fast[t] || t + 1 > T) return p0;
    const p1 = buy ? ask[t + 1] : bid[t + 1];
    return buy ? Math.max(p0, p1) : Math.min(p0, p1);
  };
  const crossed = (t, level) => (buy ? last[t] >= level : last[t] <= level);

  // ---- t = 0: the moment the order arrives
  if (mode === 'market') {
    walk(0, null);
    marketable = true;
  } else if (mode === 'limit') {
    if (buy ? lim >= ask[0] : lim <= bid[0]) {
      marketable = true;
      walk(0, lim);
    }
    if (remaining > 0) events.push({ t: 0, kind: 'rest', p: lim });
  } else if (mode === 'stop' || mode === 'stop-limit') {
    if (crossed(0, order.price)) {
      triggered = true;
      triggerT = 0;
      immediate = true;
      events.push({ t: 0, kind: 'trigger', p: order.price });
      if (mode === 'stop') walk(0, null);
      else {
        if (buy ? ask[0] <= lim : bid[0] >= lim) {
          marketable = true;
          walk(0, lim);
        }
        mode = 'limit';
        if (remaining > 0) events.push({ t: 0, kind: 'rest', p: lim });
      }
    } else events.push({ t: 0, kind: 'rest', p: order.price });
  }
  if (remaining <= 0) mode = 'done';

  // ---- the market plays out
  for (let t = 1; t <= T && remaining > 0; t++) {
    if (mode === 'stop' && crossed(t, order.price)) {
      triggered = true;
      triggerT = t;
      events.push({ t, kind: 'trigger', p: order.price });
      fillAll(t, worse(t));
    } else if (mode === 'stop-limit' && crossed(t, order.price)) {
      triggered = true;
      triggerT = t;
      events.push({ t, kind: 'trigger', p: order.price });
      const now = buy ? ask[t] : bid[t];
      if (buy ? now <= lim : now >= lim) fillAll(t, now);
      else {
        mode = 'limit';
        restFrom = t + 1;
        events.push({ t, kind: 'rest', p: lim });
      }
    } else if (mode === 'limit' && t >= restFrom && (buy ? last[t] <= lim : last[t] >= lim)) {
      fillAll(t, buy ? Math.min(lim, ask[t]) : Math.max(lim, bid[t]));
    }
  }

  const filled = size - remaining;
  const avg = filled ? fills.reduce((s, f) => s + f.p * f.size, 0) / filled : null;
  const status = remaining === 0 ? 'filled' : filled ? 'partial' : triggered ? 'triggered' : order.type === 'market' ? 'filled' : 'open';
  return {
    order: { ...order, size, limit: order.type === 'stop-limit' ? lim : order.type === 'limit' ? lim : null },
    fills,
    filled,
    avg,
    full: remaining === 0,
    firstT: fills.length ? fills[0].t : null,
    doneT: remaining === 0 && fills.length ? fills[fills.length - 1].t : null,
    triggered,
    triggerT,
    immediate,
    marketable,
    restingAt: remaining > 0 && (mode === 'limit' || mode === 'stop' || mode === 'stop-limit') ? (mode === 'limit' ? lim : order.price) : null,
    status,
    events,
  };
}

/** First tick ≥ from where the last trade is at or beyond level in direction dir (+1 up, −1 down). */
export function firstCross(last, level, dir, from = 1) {
  for (let t = from; t < last.length; t++) if (dir > 0 ? last[t] >= level : last[t] <= level) return t;
  return null;
}

/**
 * Did the order do what the client asked? goal:
 *   { kind: 'now' }                                 — fully filled the moment it was sent
 *   { kind: 'better', side, level }                 — at the level or better; no fill is fine only
 *                                                     if the market never traded there
 *   { kind: 'trigger', side, level, early = 0 }     — only once price trades at the level (up to
 *                                                     `early` ticks before it for protective exits),
 *                                                     filled within two candles, at any price
 *   { kind: 'capped', side, level, cap }            — as trigger, but never at a worse price than
 *                                                     cap; no fill is fine when no price inside the
 *                                                     cap traded after the trigger
 * → { met, reachT, reason: short code }
 */
export function evalGoal(goal, res, m, { per = PER } = {}) {
  const { last, bid, ask } = m;
  const buy = goal.side === 'buy';
  if (goal.kind === 'now') {
    const met = res.full && res.doneT === 0;
    return { met, reachT: 0, reason: met ? 'filled-now' : res.filled ? 'partial-or-late' : 'not-filled' };
  }
  if (goal.kind === 'better') {
    const dir = buy ? -1 : 1; // the level sits below (buy) / above (sell) the market
    const reachT = firstCross(last, goal.level, dir);
    if (res.filled) {
      const priceOk = buy ? res.avg <= goal.level + 1e-9 : res.avg >= goal.level - 1e-9;
      if (!priceOk) return { met: false, reachT, reason: 'worse-price' };
      if (!res.full) return { met: false, reachT, reason: 'partial' };
      return { met: true, reachT, reason: 'filled-better' };
    }
    return reachT == null ? { met: true, reachT, reason: 'never-offered' } : { met: false, reachT, reason: 'missed' };
  }
  // trigger / capped: act only once price travels to the level
  const dir = buy ? 1 : -1;
  const early = goal.early || 0;
  const reachEarly = firstCross(last, goal.level - dir * early, dir);
  const reachT = firstCross(last, goal.level, dir);
  if (goal.kind === 'trigger') {
    if (!res.filled) return reachT == null ? { met: true, reachT, reason: 'never-reached' } : { met: false, reachT, reason: 'not-filled' };
    if (reachEarly == null || res.firstT < reachEarly) return { met: false, reachT, reason: 'too-early' };
    if (!res.full) return { met: false, reachT, reason: 'partial' };
    if (reachT != null && res.doneT > reachT + 2 * per) return { met: false, reachT, reason: 'too-late' };
    return { met: true, reachT, reason: 'filled-after-trigger' };
  }
  // capped
  const inCap = (t) => (buy ? ask[t] <= goal.cap : bid[t] >= goal.cap);
  if (res.filled) {
    if (reachEarly == null || res.firstT < reachEarly) return { met: false, reachT, reason: 'too-early' };
    const priceOk = buy ? res.avg <= goal.cap + 1e-9 : res.avg >= goal.cap - 1e-9;
    if (!priceOk) return { met: false, reachT, reason: 'beyond-cap' };
    if (!res.full) return { met: false, reachT, reason: 'partial' };
    return { met: true, reachT, reason: 'filled-in-cap' };
  }
  if (reachT == null) return { met: true, reachT, reason: 'never-reached' };
  for (let t = reachT; t < last.length; t++) if (inCap(t)) return { met: false, reachT, reason: 'missed-in-cap' };
  return { met: true, reachT, reason: 'protected' };
}

/**
 * Plain-English description of what an order will do from the current quote.
 * state: { last, bid, ask } in ticks. → { text, marketable, immediate }
 */
export function describeOrder(order, state, { tick = TICK, decimals = DECIMALS } = {}) {
  const f = (t) => fmtTicks(t, tick, decimals);
  const buy = order.side === 'buy';
  const verb = buy ? 'buy' : 'sell';
  const n = fmtSize(order.size || 0);
  const best = buy ? state.ask : state.bid;
  const bestName = buy ? 'ask' : 'bid';
  if (!order.side) return { text: 'Pick a side: buy or sell.', marketable: false, immediate: false };
  if (!order.type) return { text: 'Pick an order type.', marketable: false, immediate: false };
  if (order.type === 'market') {
    return { text: `Fills now at the best ${bestName} (${f(best)}${order.size ? '' : ''}) and, if ${n} shares are more than wait there, at the next prices too.`, marketable: true, immediate: true };
  }
  const p = order.price;
  if (order.type === 'limit') {
    if (buy ? p >= state.ask : p <= state.bid) {
      return { text: `Your limit ${f(p)} is ${buy ? 'at or above the ask' : 'at or below the bid'}, so it fills at once (a marketable limit) at ${f(best)} or better.`, marketable: true, immediate: true };
    }
    return { text: `Waits to ${verb} at ${f(p)} or ${buy ? 'lower' : 'higher'}. Fills only if the price comes to you; it may never fill.`, marketable: false, immediate: false };
  }
  const beyond = buy ? state.last >= p : state.last <= p;
  if (order.type === 'stop') {
    if (beyond) return { text: `The price is already ${buy ? 'at or above' : 'at or below'} ${f(p)}, so this stop triggers at once and ${verb}s at market.`, marketable: true, immediate: true };
    return { text: `Does nothing until a trade prints at ${f(p)} or ${buy ? 'higher' : 'lower'}, then ${verb}s at the next available price.`, marketable: false, immediate: false };
  }
  const lim = order.limit ?? p + (buy ? SL_OFFSET : -SL_OFFSET);
  if (beyond) return { text: `Triggers at once (the price is already past ${f(p)}) and then ${verb}s only at ${f(lim)} or better.`, marketable: false, immediate: true };
  return { text: `Triggers when a trade prints at ${f(p)} or ${buy ? 'higher' : 'lower'}, then ${verb}s only at ${f(lim)} or better. If the price jumps past ${f(lim)}, it does not fill.`, marketable: false, immediate: false };
}

// ------------------------------------------------------------------ scenarios

/**
 * Client requests. type/side = the right order; goal = what the client needs (evalGoal);
 * tier 0 = Easy (market / limit / stop basics), 1 = shorts, covers and big orders,
 * 2 = stop-limit decisions in gaps.
 */
export const KINDS = {
  'now-buy': { type: 'market', side: 'buy', goal: 'now', tier: 0 },
  'now-sell': { type: 'market', side: 'sell', goal: 'now', tier: 0 },
  'cap-buy': { type: 'limit', side: 'buy', goal: 'better', tier: 0 },
  'target-sell': { type: 'limit', side: 'sell', goal: 'better', tier: 0, position: 'long' },
  'stoploss-sell': { type: 'stop', side: 'sell', goal: 'trigger', tier: 0, position: 'long', exit: true },
  'breakout-buy': { type: 'stop', side: 'buy', goal: 'trigger', tier: 0 },
  'now-big': { type: 'market', side: 'either', goal: 'now', tier: 1 },
  'short-limit': { type: 'limit', side: 'sell', goal: 'better', tier: 1 },
  'breakdown-short': { type: 'stop', side: 'sell', goal: 'trigger', tier: 1 },
  'cover-stop': { type: 'stop', side: 'buy', goal: 'trigger', tier: 1, position: 'short', exit: true },
  'cover-target': { type: 'limit', side: 'buy', goal: 'better', tier: 1, position: 'short' },
  'stoplimit-cap': { type: 'stop-limit', side: 'buy', goal: 'capped', tier: 2 },
  'stoplimit-exit': { type: 'stop-limit', side: 'sell', goal: 'capped', tier: 2, position: 'long' },
  'stoplimit-trap': { type: 'stop', side: 'sell', goal: 'trigger', tier: 2, position: 'long', exit: true },
};
export const KIND_IDS = Object.keys(KINDS);

const CLIENTS = [
  ['Maya', 'Long-term investor'], ['Theo', 'Day trader'], ['Priya', 'Swing trader'], ['Sam', 'Portfolio manager'],
  ['Lena', 'Retail client'], ['Omar', 'Swing trader'], ['Jun', 'Day trader'], ['Rosa', 'Pension fund desk'],
  ['Ines', 'Retail client'], ['Kofi', 'Hedge fund desk'], ['Ava', 'Long-term investor'], ['Nico', 'Momentum trader'],
];

/** Which kinds a round may use at this difficulty (0–1). */
export function kindsFor(difficulty) {
  if (difficulty < 0.35) return KIND_IDS.filter((k) => KINDS[k].tier === 0);
  if (difficulty < 0.6) return KIND_IDS.filter((k) => KINDS[k].tier <= 1);
  return KIND_IDS.slice();
}

/** Stop-limit orders are offered (as an answer and a distractor) from Normal difficulty up. */
export const stopLimitOffered = (difficulty) => difficulty >= 0.45;
/** The client's side is set for the player on Easy; from Normal up they pick it. */
export const sideLocked = (difficulty) => difficulty < 0.4;

/**
 * Picks a kind for the next round: tier weights by difficulty, the four order types kept in
 * balance (types used recently weigh less) and never the same kind twice in a row.
 * recent: [{ kind, type }] newest last.
 */
export function pickKind(rng, difficulty, recent = []) {
  const pool = kindsFor(difficulty);
  const lastKind = recent.length ? recent[recent.length - 1].kind : null;
  const recentTypes = recent.slice(-4).map((r) => r.type);
  const weights = pool.map((k) => {
    const K = KINDS[k];
    if (k === lastKind) return 0;
    const used = recentTypes.filter((t) => t === K.type).length;
    let w = 1 / (1 + 1.6 * used);
    if (K.tier === 1) w *= difficulty < 0.6 ? 1.3 : 1;
    if (K.tier === 2) w *= 1.25;
    // Stop-limit decisions are the Hard lesson: give their type a fair share of the rounds.
    if (K.type === 'stop-limit') w *= 1.4;
    return w;
  });
  return rng.weighted(pool, weights);
}

const r100 = (n) => Math.max(100, Math.round(n / 100) * 100);

/** Waypoint time as a fraction of the playout (ticks), snapped to 1..T. */
const at = (T, f) => clamp(Math.round(T * f), 1, T);
/** First tick of the candle that contains fraction f (a gap can only open a candle). */
const candleStart = (T, f, per = PER) => clamp(1 + Math.round((T * f) / per) * per, 1 + per, T - per);

/**
 * buildScenario(rng, { kind, difficulty }) → a validated round.
 * { kind, type, side, size, level, cap, goal, tol: [lo, hi], variant, client, position,
 *   ref (ticks of the reference price), band: [lo, hi], hist, future: { last, bid, ask, fast,
 *   spread }, book, histCandles, T, tries, fallback }
 * Every scenario is generate-and-test: the path is regenerated (forked rng) until the right
 * order at every sensible price meets the goal, the tempting wrong orders do not, and the whole
 * market stays on the ladder. After 30 tries a noiseless hand-tuned path is used.
 */
export function buildScenario(rng, { kind, difficulty = 0.5, debug = null } = {}) {
  const K = KINDS[kind];
  if (!K) throw new Error(`order-desk: unknown kind ${kind}`);
  const d = clamp(difficulty, 0, 1);
  const ref = rng.int(400, 1800); // 20.00 – 90.00
  const lo = ref - BAND;
  const hi = ref + BAND;
  const T = T_MAX;
  const side = K.side === 'either' ? (rng.chance(0.5) ? 'buy' : 'sell') : K.side;
  const buy = side === 'buy';
  const [name, role] = rng.pick(CLIENTS);

  // Variant choice (what the market will do) is part of the round, not of the retry loop.
  let variant = 'reach';
  if (K.goal === 'better') {
    if (d >= 0.5 && rng.chance(0.25)) variant = 'miss';
    else if (d >= 0.6 && rng.chance(0.3)) variant = 'gap';
  } else if (K.goal === 'trigger') {
    if (kind === 'stoplimit-trap') variant = 'gap';
    else if (K.exit && d >= 0.45 && rng.chance(0.15)) variant = 'miss';
    else if (d >= 0.55 && rng.chance(0.35)) variant = 'gap';
    else if (d >= 0.35 && rng.chance(0.45)) variant = 'fast';
    else variant = 'calm';
  } else if (K.goal === 'capped') {
    variant = rng.chance(0.65) ? 'gap' : 'calm';
  } else variant = 'now';
  // One-tick spreads, sometimes two on Hard (gap rounds keep one: they need the room on the ladder).
  const s0 = d >= 0.55 && K.tier < 2 && variant !== 'gap' ? rng.int(1, 2) : 1;
  // How far the client's level sits from the market: clearly away on Easy, closer on Hard.
  const dist = variant === 'gap' ? rng.int(3, 4) : d < 0.35 ? rng.int(4, 6) : rng.int(3, 5);

  // Client level (ticks) and the sensible-price window.
  let level = null;
  let cap = null;
  let tol = null;
  let goal;
  const bid0 = ref;
  const ask0 = ref + s0;
  if (K.goal === 'now') {
    goal = { kind: 'now', side };
  } else if (K.goal === 'better') {
    level = buy ? ask0 - dist : bid0 + dist;
    tol = buy ? [level - 1, level] : [level, level + 1];
    goal = { kind: 'better', side, level };
  } else if (K.goal === 'trigger') {
    const dd = kind === 'stoplimit-trap' ? 3 : dist;
    level = buy ? ref + dd : ref - dd;
    // Entries: at the level or one tick beyond it. Protective exits: at the level or one tick earlier.
    tol = K.exit ? (buy ? [level - 1, level] : [level, level + 1]) : buy ? [level, level + 1] : [level - 1, level];
    goal = { kind: 'trigger', side, level, early: K.exit ? 1 : 0 };
  } else {
    level = buy ? ref + 3 : ref - 3;
    cap = buy ? level + SL_OFFSET : level - SL_OFFSET;
    tol = [level, level];
    goal = { kind: 'capped', side, level, cap };
  }

  // Size and position.
  let size = r100(rng.int(1, 8) * 100);
  let overrides = {};
  if (kind === 'now-big') {
    const lv = [r100(rng.int(2, 4) * 100), r100(rng.int(3, 6) * 100), r100(rng.int(5, 9) * 100)];
    size = lv[0] + lv[1] + r100(rng.int(1, Math.max(1, lv[2] / 100 - 1)) * 100);
    overrides = buy ? { asks: lv } : { bids: lv };
  } else if (K.goal === 'now') {
    size = r100(rng.int(1, 3) * 100);
    const top = size + r100(rng.int(2, 6) * 100);
    overrides = buy ? { asks: [top] } : { bids: [top] };
  }
  // Entries make the story consistent: a take-profit sits beyond the entry, a stop-loss behind it.
  let position = null;
  if (K.position === 'long') {
    const entry = kind === 'target-sell' ? ref - rng.int(1, 6) : ref + rng.int(0, 4);
    position = { side: 'long', size, entry };
  }
  if (K.position === 'short') {
    const entry = kind === 'cover-target' ? ref + rng.int(1, 6) : ref - rng.int(0, 4);
    position = { side: 'short', size, entry };
  }
  if (kind === 'now-sell') position = { side: 'long', size, entry: ref + rng.int(-6, 6) };

  const correctType = K.type;
  const orderAt = (type, p, sd = side) => ({ side: sd, type, price: p, limit: type === 'stop-limit' ? p + (sd === 'buy' ? SL_OFFSET : -SL_OFFSET) : null, size });
  const correct = (p) => orderAt(correctType, p);

  // Orders that must fail (the lesson of the round).
  const distractors = [];
  if (K.goal === 'now') distractors.push(orderAt('limit', buy ? bid0 - 2 : ask0 + 2));
  if (K.goal === 'better') distractors.push(orderAt('market', null), orderAt('stop', level));
  if (K.goal === 'trigger') distractors.push(orderAt('market', null), orderAt('limit', level));
  if (kind === 'stoplimit-trap') distractors.push(orderAt('stop-limit', level));
  if (K.goal === 'capped' && variant === 'gap') distractors.push(orderAt('stop', level));
  if (K.goal === 'capped') distractors.push(orderAt('limit', level));

  const salt = rng.int(1, 1e9);
  const makeFuture = (r, noise) => {
    const fast = new Array(T + 2).fill(false);
    const spread = new Array(T + 1).fill(s0);
    const pts = [];
    const dirTo = level != null ? Math.sign(level - ref) || 1 : buy ? 1 : -1;
    if (K.goal === 'now') {
      // The market moves away from the client: waiting for a better price would have missed.
      const away = buy ? 1 : -1;
      pts.push({ t: at(T, r.float(0.15, 0.3)), v: ref + away * r.int(0, 1) });
      pts.push({ t: at(T, r.float(0.5, 0.65)), v: ref + away * r.int(2, 4) });
      pts.push({ t: T, v: ref + away * r.int(4, 6) });
    } else if (K.goal === 'better') {
      const tr = at(T, r.float(0.38, 0.6));
      pts.push({ t: at(T, r.float(0.1, 0.2)), v: ref - dirTo * r.int(0, 1) });
      if (variant === 'gap') {
        // Price gaps straight through the limit: it fills at a better price than asked.
        const tg = candleStart(T, r.float(0.4, 0.6));
        pts.push({ t: tg - 1, v: level - dirTo * 1 });
        pts.push({ t: tg, v: level + dirTo * 2, jump: true });
        pts.push({ t: Math.min(T - 2, tg + r.int(4, 8)), v: level - dirTo * r.int(2, 3) });
      } else {
        const over = variant === 'miss' ? -1 : 1; // miss: turns one tick short of the level
        pts.push({ t: tr, v: level + dirTo * over });
        pts.push({ t: Math.min(T - 2, tr + r.int(8, 14)), v: level - dirTo * r.int(3, 5) });
      }
      pts.push({ t: T, v: pts[pts.length - 1].v - dirTo * r.int(0, 2) });
    } else {
      // trigger / capped: the level sits in the direction the market must travel.
      const test = level - dirTo * 2;
      pts.push({ t: at(T, r.float(0.12, 0.22)), v: test - dirTo * r.int(0, 1) });
      pts.push({ t: at(T, r.float(0.28, 0.36)), v: ref + dirTo * r.int(0, 1) });
      if (variant === 'miss') {
        pts.push({ t: at(T, r.float(0.5, 0.6)), v: level - dirTo * 2 });
        pts.push({ t: T, v: ref - dirTo * r.int(0, 2) });
      } else if (variant === 'gap') {
        const tg = candleStart(T, r.float(0.5, 0.62));
        // Stop-limit lessons gap past the limit (SL_OFFSET) and stay there; plain stops slip 2–3 ticks.
        const deep = K.goal === 'capped' || kind === 'stoplimit-trap';
        const through = deep ? SL_OFFSET + 2 : r.int(2, 3);
        pts.push({ t: tg - 2, v: level - dirTo * 1, noise: 0.45 });
        pts.push({ t: tg, v: level + dirTo * through, jump: true, exact: deep });
        const end = deep ? through : Math.min(through + 2, BAND - Math.abs(level - ref));
        pts.push({ t: Math.min(T, tg + r.int(6, 12)), v: level + dirTo * end, noise: 0.35, exact: deep });
        if (!deep) for (let t = tg; t <= tg + 3 && t <= T; t++) spread[t] = s0 + 1;
      } else if (variant === 'fast') {
        const tb = at(T, r.float(0.5, 0.6));
        pts.push({ t: tb - 1, v: level - dirTo * 1 });
        pts.push({ t: tb, v: level + dirTo * 2 });
        for (let t = tb; t <= tb + 2; t++) {
          fast[t] = true;
          spread[t] = s0 + r.int(1, 2);
        }
        pts.push({ t: Math.min(T, tb + r.int(8, 14)), v: level + dirTo * r.int(3, 4) });
      } else {
        const tb = at(T, r.float(0.5, 0.62));
        pts.push({ t: tb, v: level + dirTo * 1 });
        pts.push({ t: Math.min(T, tb + r.int(8, 14)), v: level + dirTo * r.int(3, 4) });
      }
      if (pts[pts.length - 1].t < T) {
        const tail = variant === 'miss' ? 0 : variant === 'gap' && (K.goal === 'capped' || kind === 'stoplimit-trap') ? 0 : dirTo * r.int(0, 1);
        pts.push({ t: T, v: pts[pts.length - 1].v + tail, noise: variant === 'gap' ? 0.35 : undefined, exact: pts[pts.length - 1].exact });
      }
    }
    // Keep waypoints on the ladder, with room for the spread and a little noise.
    for (const p of pts) if (!p.exact) p.v = clamp(p.v, lo + 1 + s0, hi - 1 - s0);
    const last = walkPath(r, { from: ref, T, points: pts, noise, maxStep: 1, fast, lo, hi });
    if (!last) return null;
    const q = quotes(last, spread);
    for (let t = 0; t <= T; t++) if (q.bid[t] < lo || q.ask[t] > hi) return null;
    return { last, bid: q.bid, ask: q.ask, fast: fast.slice(0, T + 1), spread };
  };

  const book = makeBook({ bid: bid0, ask: ask0, salt, overrides });
  const fail = (why) => {
    if (debug) debug.push(why);
    return false;
  };
  const check = (fut) => {
    const m = { ...fut, book };
    if (tol) {
      for (let p = tol[0]; p <= tol[1]; p++) {
        const g = evalGoal(goal, simulate(correct(p), m), m);
        if (!g.met) return fail(`correct@${p - level}:${g.reason}`);
      }
    } else if (!evalGoal(goal, simulate(correct(null), m), m).met) return fail('correct');
    for (const o of distractors) if (evalGoal(goal, simulate(o, m), m).met) return fail(`distractor:${o.type}`);
    const reach = level != null ? firstCross(fut.last, level, Math.sign(level - ref) || 1) : null;
    if (variant === 'miss' && reach != null) return fail('miss-reached');
    if ((variant === 'reach' || variant === 'calm' || variant === 'fast' || variant === 'gap') && level != null) {
      if (reach == null || reach > T - 2 * PER) return fail('late'); // the outcome must be visible
      const res = simulate(correct(level), m);
      const slip = res.filled ? Math.abs(res.avg - level) : 0;
      if (variant === 'fast' && K.goal === 'trigger' && slip < 1) return fail('fast-noslip');
      if (variant === 'gap' && K.goal === 'trigger' && slip < 2) return fail('gap-noslip');
      if (variant === 'reach' && K.goal === 'better') {
        const dirTo = Math.sign(level - ref);
        const ext = dirTo < 0 ? Math.min(...fut.last) : Math.max(...fut.last);
        if (Math.abs(ext - level) > 2) return fail('overshoot'); // turns near the level, not far past it
      }
    }
    return true;
  };

  let fut = null;
  let tries = 0;
  let fallback = false;
  for (; tries < 30 && !fut; tries++) {
    const f = makeFuture(rng.fork(`future-${tries}`), 0.75);
    if (!f) fail('path');
    else if (check(f)) fut = f;
  }
  if (!fut) {
    fallback = true;
    const f = makeFuture(rng.fork('future-fallback'), 0);
    fut = f && check(f) ? f : null;
  }
  if (!fut) return null;

  // History: a wandering tape that ends at the reference price, inside the ladder.
  let hist = null;
  const H = HIST * PER;
  for (let i = 0; i < 30 && !hist; i++) {
    const r = rng.fork(`hist-${i}`);
    const pts = [];
    const nMid = r.int(2, 4);
    for (let k = 1; k <= nMid; k++) pts.push({ t: Math.round((H * k) / (nMid + 1)), v: ref + r.int(-6, 6) });
    pts.push({ t: H, v: ref });
    hist = walkPath(r, { from: ref + r.int(-5, 5), T: H, points: pts, noise: 0.9, maxStep: 1, lo: lo + 1, hi: hi - 1 });
  }
  if (!hist) hist = walkPath(rng.fork('hist-fallback'), { from: ref, T: H, points: [{ t: H, v: ref }], noise: 0, lo, hi });
  const histCandles = ticksToCandles(hist, { start: 1, firstIndex: 0 });

  return {
    kind, type: correctType, side, size, level, cap, goal, tol, variant, position,
    client: { name, role }, ref, band: [lo, hi], s0,
    hist, histCandles, future: fut, book, T, tries, fallback,
    sideLocked: sideLocked(d), stopLimit: stopLimitOffered(d) || K.type === 'stop-limit',
    difficulty: d,
  };
}

/** The market seen by the simulator for a scenario, with the book as displayed when sent. */
export function marketOf(scn, book = scn.book) {
  return { ...scn.future, book };
}

/** Candles of the playout up to tick t (the last one may be forming), indexed after the history. */
export function futureCandles(scn, upTo) {
  if (upTo < 1) return [];
  return ticksToCandles(scn.future.last, { start: 1, upTo, firstIndex: scn.histCandles.length });
}

/** Candle index (in the full chart) of a playout tick. */
export function candleIndexOf(scn, t) {
  return scn.histCandles.length + Math.max(0, Math.floor((t - 1) / PER));
}

export { makeRng };
