// Candlestick patterns: candle geometry, textbook checks (Nison), generators, CANDLE_PATTERNS,
// detection (findCandlePatterns) and candleScenario(). Pure module (no DOM).
// Part of the pattern library; import from js/core/patterns.js, the public facade.

import { makeRng } from '../rng.js';
import { fromPath, addVolume } from '../data.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Candle geometry helpers
// ---------------------------------------------------------------------------------------------

const K = (o, h, l, c) => ({ o, h, l, c, v: 0, t: 0 });
/** Candle from open/close and wick lengths. */
const parts = (o, c, upper, lower) => K(o, Math.max(o, c) + upper, Math.min(o, c) - lower, c);
/** Mirror candles around price `p` (turns a bullish construction into its bearish twin). */
const mirrorCandles = (cs, p) => cs.map((k) => K(2 * p - k.o, 2 * p - k.l, 2 * p - k.h, 2 * p - k.c));

export const body = (k) => Math.abs(k.c - k.o);
export const span = (k) => k.h - k.l;
export const upperWick = (k) => k.h - Math.max(k.o, k.c);
export const lowerWick = (k) => Math.min(k.o, k.c) - k.l;
export const isBull = (k) => k.c > k.o;
export const isBear = (k) => k.c < k.o;
const mid = (k) => (k.o + k.c) / 2;

/**
 * Textbook thresholds shared by the generators (which stay a safe margin inside them), the
 * geometry checks (check() / checkCandlePattern) and CANDLE_RULES, so they cannot drift apart.
 * All fractions are of the candle's own range (high − low) unless noted.
 */
export const CANDLE_THRESHOLDS = Object.freeze({
  dojiBody: 0.08, // doji: |close − open| ≤ 8% of the range
  shadowTiny: 0.08, // dragonfly / gravestone: the short side ≤ 8% of the range
  shadowLong: 0.6, // dragonfly / gravestone: the long wick ≥ 60% of the range
  spinBodyMin: 0.1, // spinning top: body 10–30% of the range, both wicks longer than the body
  spinBodyMax: 0.3,
  marubozuBody: 0.9, // marubozu: body ≥ 90% of the range
  longBody: 0.6, // a "long" candle (harami mother, piercing / star first candle, soldiers): body ≥ 60%
  hammerBodyMin: 0.1, // hammer family: body ≥ 10% of the range,
  hammerWickRatio: 2, //   the long wick ≥ 2 × the body,
  hammerShortWick: 0.1, //   the other wick ≤ 10% of the range
  starBody: 0.35, // morning / evening star: middle body ≤ 35% of the first body
  soldierWick: 0.15, // soldiers / crows: the wick on the closing side ≤ 15% of the range
  tweezerPct: 0.001, // tweezers: the same high / low within 0.1% of price …
  tweezerRange: 0.04, //   … and within 4% of the larger candle's range
  // CANDLE_RULES only (real-market candles): significance and context.
  sizeLookback: 10, // average range of the 10 candles before the pattern ("typical range")
  contextLookback: 10, // contextTrend() window
  trendMove: 1.2, // contextTrend: regression move ≥ 1.2 typical ranges …
  trendNet: 0.8, //   … and a net move ≥ 0.8 typical ranges in the same direction
  extremeLookback: 8, // reversals print the lowest low / highest high of the 8 candles before them
  extremeTol: 0.1, //   (within 0.1 typical ranges; soldiers / crows: within 0.5)
});
const T = CANDLE_THRESHOLDS;
const isLong = (k) => span(k) > 0 && body(k) >= T.longBody * span(k);

// Geometry-only checks for each pattern (context is checked separately). Shared with ./candle-rules.js.
export const CHECKS = {
  doji: ([a]) => span(a) > 0 && body(a) <= T.dojiBody * span(a),
  'dragonfly-doji': ([a]) => CHECKS.doji([a]) && upperWick(a) <= T.shadowTiny * span(a) && lowerWick(a) >= T.shadowLong * span(a),
  'gravestone-doji': ([a]) => CHECKS.doji([a]) && lowerWick(a) <= T.shadowTiny * span(a) && upperWick(a) >= T.shadowLong * span(a),
  'spinning-top': ([a]) =>
    span(a) > 0 && body(a) >= T.spinBodyMin * span(a) && body(a) <= T.spinBodyMax * span(a) && upperWick(a) > body(a) && lowerWick(a) > body(a),
  'bullish-marubozu': ([a]) => isBull(a) && body(a) >= T.marubozuBody * span(a),
  'bearish-marubozu': ([a]) => isBear(a) && body(a) >= T.marubozuBody * span(a),
  hammer: ([a]) => hammerShape(a),
  'hanging-man': ([a]) => hammerShape(a),
  'inverted-hammer': ([a]) => invertedShape(a),
  'shooting-star': ([a]) => invertedShape(a),
  'bullish-engulfing': ([a, b]) => isBear(a) && isBull(b) && b.o < a.c && b.c > a.o,
  'bearish-engulfing': ([a, b]) => isBull(a) && isBear(b) && b.o > a.c && b.c < a.o,
  'bullish-harami': ([a, b]) => isBear(a) && isLong(a) && isBull(b) && b.o > a.c && b.c < a.o,
  'bearish-harami': ([a, b]) => isBull(a) && isLong(a) && isBear(b) && b.o < a.c && b.c > a.o,
  'piercing-line': ([a, b]) => isBear(a) && isLong(a) && isBull(b) && b.o < a.c && b.c > mid(a) && b.c < a.o,
  'dark-cloud-cover': ([a, b]) => isBull(a) && isLong(a) && isBear(b) && b.o > a.c && b.c < mid(a) && b.c > a.o,
  'tweezer-bottom': ([a, b]) => isBear(a) && isBull(b) && Math.abs(a.l - b.l) <= tweezerTol(a, b, a.l),
  'tweezer-top': ([a, b]) => isBull(a) && isBear(b) && Math.abs(a.h - b.h) <= tweezerTol(a, b, a.h),
  'morning-star': ([a, b, c]) =>
    isBear(a) && isLong(a) && body(b) <= T.starBody * body(a) && Math.max(b.o, b.c) < a.c && isBull(c) && c.c > mid(a),
  'evening-star': ([a, b, c]) =>
    isBull(a) && isLong(a) && body(b) <= T.starBody * body(a) && Math.min(b.o, b.c) > a.c && isBear(c) && c.c < mid(a),
  'three-white-soldiers': (cs) =>
    cs.every((k) => isBull(k) && isLong(k) && upperWick(k) <= T.soldierWick * span(k)) &&
    cs.slice(1).every((k, i) => k.o > cs[i].o && k.o < cs[i].c && k.c > cs[i].c),
  'three-black-crows': (cs) =>
    cs.every((k) => isBear(k) && isLong(k) && lowerWick(k) <= T.soldierWick * span(k)) &&
    cs.slice(1).every((k, i) => k.o < cs[i].o && k.o > cs[i].c && k.c < cs[i].c),
};
/** 'Same' high/low: within 0.1% of price and within 4% of the larger candle's range (so the
 *  rule also holds at FX scale, where 0.1% of 1.0850 is most of a candle). */
function tweezerTol(a, b, price) {
  return Math.min(T.tweezerPct * Math.abs(price), T.tweezerRange * Math.max(span(a), span(b)));
}
function hammerShape(a) {
  const s = span(a);
  return s > 0 && body(a) >= T.hammerBodyMin * s && lowerWick(a) >= T.hammerWickRatio * body(a) && upperWick(a) <= T.hammerShortWick * s;
}
function invertedShape(a) {
  const s = span(a);
  return s > 0 && body(a) >= T.hammerBodyMin * s && upperWick(a) >= T.hammerWickRatio * body(a) && lowerWick(a) <= T.hammerShortWick * s;
}

// ---------------------------------------------------------------------------------------------
// Candle generators. Each receives (rng, { price, range }): price = previous close (where the
// pattern opens), range = typical candle range. Bearish twins mirror the bullish construction.
// ---------------------------------------------------------------------------------------------

function genDoji(rng, { price: P, range: R }) {
  const s = R * rng.float(1.05, 1.5);
  const b = s * rng.float(0, T.dojiBody - 0.025);
  const rest = s - b;
  const up = rest * rng.float(0.35, 0.65);
  const o = P + rng.gauss(0, 0.04 * R);
  return [parts(o, o + rng.sign() * b, up, rest - up)];
}
function genDragonfly(rng, { price: P, range: R }) {
  const s = R * rng.float(1.45, 2.0);
  const b = s * rng.float(0, T.dojiBody - 0.035);
  const up = s * rng.float(0, T.shadowTiny - 0.03); // long wick ≥ 1 − 0.045 − 0.05 ≫ shadowLong
  const o = P + rng.gauss(0, 0.03 * R);
  return [parts(o, o + rng.sign() * b, up, s - b - up)];
}
function genSpinning(rng, { price: P, range: R }) {
  const s = R * rng.float(0.8, 1.2);
  const b = s * rng.float(T.spinBodyMin + 0.02, T.spinBodyMax - 0.02);
  const rest = s - b;
  const f = rng.float(0.42, 0.58);
  const o = P + rng.gauss(0, 0.05 * R);
  return [parts(o, o + rng.sign() * b, rest * f, rest * (1 - f))];
}
function genMarubozu(rng, { price: P, range: R }) {
  const s = R * rng.float(1.6, 2.3);
  const b = s * rng.float(T.marubozuBody + 0.02, 0.985);
  const rest = s - b;
  const f = rng.float(0.2, 0.8);
  return [parts(P, P + b, rest * f, rest * (1 - f))];
}
/** Small body at the top, long lower wick (hammer / hanging man). */
/** Hammer-family body / short-wick bounds, a margin inside the thresholds (long wick ≥ 2 × body). */
const HAMMER_UP_MAX = T.hammerShortWick - 0.04;
const HAMMER_BODY = [T.hammerBodyMin + 0.05, Math.min(0.3, (1 - HAMMER_UP_MAX) / (T.hammerWickRatio + 1) - 0.01)];
function genHammerShape(rng, { price: P, range: R }, bullProb, gap) {
  const s = R * rng.float(1.5, 2.1);
  const b = s * rng.float(HAMMER_BODY[0], HAMMER_BODY[1]);
  const up = s * rng.float(0, HAMMER_UP_MAX);
  const low = s - b - up;
  // Opens a little beyond the prior close in the trend's direction (a hanging man above it,
  // a hammer below it), so the candle prints at the extreme of the move.
  const o = P + gap * R * rng.float(0.1, 0.25);
  const c = rng.chance(bullProb) ? o + b : o - b;
  return [parts(o, c, up, low)];
}
/** Small body at the bottom, long upper wick (inverted hammer / shooting star). */
function genInvertedShape(rng, { price: P, range: R }, bullProb, gap) {
  const s = R * rng.float(1.5, 2.1);
  const b = s * rng.float(HAMMER_BODY[0], HAMMER_BODY[1]);
  const low = s * rng.float(0, HAMMER_UP_MAX);
  const up = s - b - low;
  // Opens a little beyond the prior close (below it after a decline, above it after a rally)
  // so the small body prints at the extreme of the move.
  const o = P + gap * R * rng.float(0.1, 0.25);
  const c = rng.chance(bullProb) ? o + b : o - b;
  return [parts(o, c, up, low)];
}
function genBullEngulfing(rng, { price: P, range: R }) {
  const b1 = R * rng.float(0.45, 0.8);
  const o1 = P + rng.gauss(0, 0.03 * R);
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.05, 0.2), R * rng.float(0.05, 0.2));
  const o2 = c1 - R * rng.float(0.04, 0.18);
  const c2 = o1 + R * rng.float(0.12, 0.5);
  // The engulfing candle trades clearly below the first low (so it never doubles as a tweezer).
  const l2 = Math.min(k1.l, o2) - R * rng.float(0.15, 0.3);
  return [k1, K(o2, c2 + R * rng.float(0.02, 0.15), l2, c2)];
}
function genBullHarami(rng, { price: P, range: R }) {
  const b1 = R * rng.float(1.3, 1.9);
  const o1 = P + rng.gauss(0, 0.03 * R);
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.04, 0.15), R * rng.float(0.07, 0.18));
  const b2 = b1 * rng.float(0.18, 0.38);
  const o2 = c1 + b1 * rng.float(0.12, 0.3);
  // The whole second candle sits inside the first body (the classic 'pregnant' picture).
  const c2 = o2 + b2;
  const up2 = Math.min(b1 * rng.float(0.03, 0.12), (o1 - c2) * 0.6);
  const lo2 = Math.min(b1 * rng.float(0.03, 0.12), (o2 - c1) * 0.5);
  return [k1, parts(o2, c2, up2, lo2)];
}
function genPiercing(rng, { price: P, range: R }) {
  const b1 = R * rng.float(1.3, 1.8);
  const o1 = P;
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.03, 0.15), R * rng.float(0.02, 0.1));
  const o2 = k1.l - R * rng.float(0.03, 0.18);
  const c2 = mid(k1) + b1 * rng.float(0.1, 0.38);
  return [k1, parts(o2, c2, R * rng.float(0.02, 0.12), R * rng.float(0.12, 0.25))];
}
function genTweezerBottom(rng, { price: P, range: R }) {
  const b1 = R * rng.float(0.6, 1.05);
  const o1 = P;
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.03, 0.2), R * rng.float(0.18, 0.4));
  // Second candle opens just inside the first body and closes above the first open, so the
  // pair is a pure tweezer (not also a harami, piercing line or engulfing).
  const o2 = c1 + R * rng.float(0.01, 0.06);
  const low2 = k1.l + rng.float(-1, 1) * Math.min(T.tweezerPct * 0.6 * k1.l, T.tweezerRange * 0.5 * R);
  const c2 = o1 + R * rng.float(0.08, 0.35);
  return [k1, K(o2, c2 + R * rng.float(0.03, 0.18), low2, c2)];
}
function genMorningStar(rng, { price: P, range: R }) {
  const b1 = R * rng.float(1.3, 1.8);
  const o1 = P;
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.03, 0.15), R * rng.float(0.03, 0.15));
  const top2 = c1 - R * rng.float(0.08, 0.3);
  const b2 = b1 * rng.float(0.04, T.starBody - 0.15);
  const [o2, c2] = rng.chance(0.5) ? [top2 - b2, top2] : [top2, top2 - b2];
  const k2 = parts(o2, c2, R * rng.float(0.1, 0.35), R * rng.float(0.1, 0.35));
  const o3 = top2 + R * rng.float(0.02, 0.15);
  const c3 = mid(k1) + b1 * rng.float(0.12, 0.42);
  return [k1, k2, parts(o3, c3, R * rng.float(0.02, 0.12), R * rng.float(0.01, 0.07))];
}
function genSoldiers(rng, { price: P, range: R }) {
  const out = [];
  let o = P;
  for (let i = 0; i < 3; i++) {
    const b = R * rng.float(1.0, 1.4);
    out.push(parts(o, o + b, b * rng.float(0.02, T.soldierWick - 0.05), b * rng.float(0.03, 0.14)));
    o += b * rng.float(0.45, 0.8);
  }
  return out;
}
const bearTwin = (gen) => (rng, opts) => mirrorCandles(gen(rng, opts), opts.price);

function def(id, name, candles, bias, kind, context, reliability, text, generate) {
  return {
    id,
    name,
    candles,
    bias,
    kind,
    context,
    reliability,
    ...text,
    generate(rng, { price = 100, range = 1.5 } = {}) {
      return generate(rng, { price, range }).map((k, i) => ({ ...k, t: i }));
    },
    check(cs) {
      return cs.length >= candles && CHECKS[id](cs.slice(-candles));
    },
  };
}

export const CANDLE_PATTERNS = {
  doji: def('doji', 'Doji', 1, 'neutral', 'indecision', 'any', 1, {
    summary: 'The open and close are at (almost) the same price, leaving a cross-shaped candle with little or no body.',
    psychology:
      'Buyers and sellers both moved price during the session but it finished where it started — neither side won. After a long move it shows the trend is losing momentum.',
    howToTrade:
      "A doji alone is not a signal. Note where it forms (at a key level, after a long run) and wait for the next candle to close beyond the doji's high or low before acting. Put the stop beyond the opposite end.",
  }, genDoji),
  'dragonfly-doji': def('dragonfly-doji', 'Dragonfly doji', 1, 'bullish', 'reversal', 'downtrend', 2, {
    summary: "A doji whose open, high and close sit at the top of a long lower wick — it looks like a 'T'.",
    psychology:
      'Sellers drove price sharply lower during the session, but buyers absorbed all of it and pushed price back up to the open. After a decline it shows lower prices are being rejected.',
    howToTrade:
      "Most meaningful after a decline or at support. Wait for a bullish candle that closes above the dragonfly's high; the stop goes below the low of the long wick.",
  }, genDragonfly),
  'gravestone-doji': def('gravestone-doji', 'Gravestone doji', 1, 'bearish', 'reversal', 'uptrend', 2, {
    summary: "A doji whose open, low and close sit at the bottom of a long upper wick — it looks like an upside-down 'T'.",
    psychology:
      'Buyers pushed price well higher, but by the close sellers had driven it all the way back to the open. After a rally it warns that higher prices are being rejected.',
    howToTrade:
      "Most meaningful after a rally or at resistance. Wait for a bearish candle that closes below the gravestone's low; the stop goes above the top of the long wick.",
  }, bearTwin(genDragonfly)),
  'spinning-top': def('spinning-top', 'Spinning top', 1, 'neutral', 'indecision', 'any', 1, {
    summary: 'A small body in the middle of the range, with upper and lower wicks that are both longer than the body.',
    psychology:
      'Buyers and sellers each had moments of control but neither could hold it. It signals indecision and often a pause in the trend.',
    howToTrade:
      "Treat it as a warning that momentum is fading, not as a trade signal. Look for a clear break of the spinning top's high or low, ideally at a support or resistance level.",
  }, genSpinning),
  'bullish-marubozu': def('bullish-marubozu', 'Bullish marubozu', 1, 'bullish', 'continuation', 'uptrend', 2, {
    summary: 'A long green candle with little or no wick: it opens at (or very near) the low and closes at (or very near) the high.',
    psychology: 'Buyers were in control from the first trade to the last and sellers never managed a pullback. It shows strong conviction.',
    howToTrade:
      "In an uptrend it confirms buying pressure and favours continuation. Rather than chasing the close, many traders wait for a pullback toward the middle of the candle, with a stop below its low.",
  }, genMarubozu),
  'bearish-marubozu': def('bearish-marubozu', 'Bearish marubozu', 1, 'bearish', 'continuation', 'downtrend', 2, {
    summary: 'A long red candle with little or no wick: it opens at (or very near) the high and closes at (or very near) the low.',
    psychology: 'Sellers were in control from the first trade to the last and buyers never managed a bounce. It shows strong selling conviction.',
    howToTrade:
      'In a downtrend it confirms selling pressure and favours continuation. Many traders wait for a bounce toward the middle of the candle before selling, with a stop above its high.',
  }, bearTwin(genMarubozu)),
  hammer: def('hammer', 'Hammer', 1, 'bullish', 'reversal', 'downtrend', 2, {
    summary: 'After a decline, a candle with a small body near the top of its range and a long lower wick at least twice the body.',
    psychology:
      'Sellers pushed price to new lows, but buyers stepped in hard and drove it back up to close near the high. The long wick shows lower prices were rejected.',
    howToTrade:
      "Only valid after a downtrend. Wait for confirmation — the next candle closing above the hammer's high — then enter with a stop just below the hammer's low.",
  }, (rng, o) => genHammerShape(rng, o, 0.65, -1)),
  'inverted-hammer': def('inverted-hammer', 'Inverted hammer', 1, 'bullish', 'reversal', 'downtrend', 1, {
    summary: 'After a decline, a small body near the bottom of the range with a long upper wick and little or no lower wick.',
    psychology:
      'Buyers attempted a rally during the session. They could not hold the gains, but the attempt shows selling pressure is weakening.',
    howToTrade:
      "Weaker than a hammer, so confirmation matters even more: wait for the next candle to close above the inverted hammer's body (ideally above its high). Stop below the pattern's low.",
  }, (rng, o) => genInvertedShape(rng, o, 0.6, -1)),
  'hanging-man': def('hanging-man', 'Hanging man', 1, 'bearish', 'reversal', 'uptrend', 1, {
    summary: 'After a rally, a candle shaped like a hammer: a small body near the top and a long lower wick at least twice the body.',
    psychology:
      'Sellers managed to drive price sharply lower during the session. Buyers recovered, but the sell-off shows supply is appearing near the highs.',
    howToTrade:
      "A warning rather than a signal. Wait for a bearish candle that closes below the hanging man's body before acting; the stop goes above its high.",
  }, (rng, o) => genHammerShape(rng, o, 0.4, 1)),
  'shooting-star': def('shooting-star', 'Shooting star', 1, 'bearish', 'reversal', 'uptrend', 2, {
    summary: 'After a rally, a small body near the bottom of the range with a long upper wick at least twice the body.',
    psychology: 'Buyers pushed price to new highs, but sellers took over and drove it back down near the open. Higher prices were rejected.',
    howToTrade:
      "Most useful at resistance after an uptrend. Confirmation is a bearish close below the star's body on the next candle; the stop goes above the top of the wick.",
  }, (rng, o) => genInvertedShape(rng, o, 0.35, 1)),
  'bullish-engulfing': def('bullish-engulfing', 'Bullish engulfing', 2, 'bullish', 'reversal', 'downtrend', 2, {
    summary: 'A red candle followed by a larger green candle whose body completely covers (engulfs) the red body.',
    psychology:
      'Sellers were in control, then buyers opened below them and overwhelmed them, closing above the previous open. Control has flipped to the buyers.',
    howToTrade:
      "Look for it after a downtrend or at support. Enter on the close (or when the next candle breaks the engulfing candle's high) with a stop below the pattern's low. Stronger on high volume.",
  }, genBullEngulfing),
  'bearish-engulfing': def('bearish-engulfing', 'Bearish engulfing', 2, 'bearish', 'reversal', 'uptrend', 2, {
    summary: 'A green candle followed by a larger red candle whose body completely covers (engulfs) the green body.',
    psychology:
      'Buyers were in control, then sellers opened above them and overwhelmed them, closing below the previous open. Control has flipped to the sellers.',
    howToTrade:
      "Look for it after an uptrend or at resistance. Enter on the close (or when the next candle breaks the engulfing candle's low) with a stop above the pattern's high. Stronger on high volume.",
  }, bearTwin(genBullEngulfing)),
  'bullish-harami': def('bullish-harami', 'Bullish harami', 2, 'bullish', 'reversal', 'downtrend', 1, {
    summary: "A long red candle followed by a small green candle whose body sits inside the red body. 'Harami' is Japanese for pregnant.",
    psychology:
      'The strong selling of the first candle stalls: the next session trades in a narrow range inside it. Momentum has faded and a reversal may be starting.',
    howToTrade:
      "A weak signal on its own. Wait for price to close above the first candle's open (the top of the big red body) before buying; the stop goes below the pattern's low.",
  }, genBullHarami),
  'bearish-harami': def('bearish-harami', 'Bearish harami', 2, 'bearish', 'reversal', 'uptrend', 1, {
    summary: 'A long green candle followed by a small red candle whose body sits inside the green body.',
    psychology:
      'The strong buying of the first candle stalls: the next session trades in a narrow range inside it. Momentum has faded and a top may be forming.',
    howToTrade:
      "Wait for price to close below the first candle's open (the bottom of the big green body) before selling; the stop goes above the pattern's high.",
  }, bearTwin(genBullHarami)),
  'piercing-line': def('piercing-line', 'Piercing line', 2, 'bullish', 'reversal', 'downtrend', 2, {
    summary:
      "After a decline, a long red candle followed by a green candle that opens below the red candle's low and closes above the middle of its body.",
    psychology:
      "The lower open looks like more selling, but buyers push price back up and reclaim more than half of the previous candle's losses.",
    howToTrade:
      "The deeper the green close into the red body, the stronger the signal. Confirm with a higher close on the next candle; put the stop below the pattern's low.",
  }, genPiercing),
  'dark-cloud-cover': def('dark-cloud-cover', 'Dark cloud cover', 2, 'bearish', 'reversal', 'uptrend', 2, {
    summary:
      "After a rally, a long green candle followed by a red candle that opens above the green candle's high and closes below the middle of its body.",
    psychology:
      "The higher open looks bullish, but sellers take over and erase more than half of the previous candle's gains — a dark cloud over the uptrend.",
    howToTrade: "Confirm with a lower close on the next candle. The stop goes above the pattern's high.",
  }, bearTwin(genPiercing)),
  'tweezer-top': def('tweezer-top', 'Tweezer top', 2, 'bearish', 'reversal', 'uptrend', 1, {
    summary: 'After a rally, a green candle and then a red candle that both top out at the same high.',
    psychology: 'Buyers pushed to the same price twice and were turned back both times — that high is acting as resistance.',
    howToTrade:
      "Stronger when it forms at an existing resistance level. Sell on a close below the second candle's low, with a stop just above the shared high.",
  }, bearTwin(genTweezerBottom)),
  'tweezer-bottom': def('tweezer-bottom', 'Tweezer bottom', 2, 'bullish', 'reversal', 'downtrend', 1, {
    summary: 'After a decline, a red candle and then a green candle that both bottom out at the same low.',
    psychology: 'Sellers pushed to the same price twice and failed both times — that low is acting as support.',
    howToTrade:
      "Stronger when it forms at an existing support level. Buy on a close above the second candle's high, with a stop just below the shared low.",
  }, genTweezerBottom),
  'morning-star': def('morning-star', 'Morning star', 3, 'bullish', 'reversal', 'downtrend', 3, {
    summary:
      "A three-candle bottom: a long red candle, a small-bodied 'star' whose body sits below it, then a long green candle that closes above the middle of the first candle.",
    psychology:
      'Selling is strong, then stalls (the star shows indecision), and finally buyers take over decisively. The mood shifts from fear to confidence over three sessions.',
    howToTrade:
      "Textbooks treat it as one of the clearer three-candle reversal shapes, but it still fails often — it carries the most weight at support after a downtrend. Enter on the close of the third candle or on a small pullback; the stop goes below the star's low.",
  }, genMorningStar),
  'evening-star': def('evening-star', 'Evening star', 3, 'bearish', 'reversal', 'uptrend', 3, {
    summary:
      "A three-candle top: a long green candle, a small-bodied 'star' whose body sits above it, then a long red candle that closes below the middle of the first candle.",
    psychology:
      'Buying is strong, then stalls (the star shows indecision), and finally sellers take over decisively. The mood shifts from greed to caution over three sessions.',
    howToTrade:
      "Textbooks treat it as one of the clearer three-candle reversal shapes, but it still fails often — it carries the most weight at resistance after an uptrend. Enter on the close of the third candle or on a small bounce; the stop goes above the star's high.",
  }, bearTwin(genMorningStar)),
  'three-white-soldiers': def('three-white-soldiers', 'Three white soldiers', 3, 'bullish', 'reversal', 'downtrend', 3, {
    summary: 'Three long green candles in a row, each opening inside the previous body and closing near its high at a higher close.',
    psychology:
      'Buyers take control and keep it for three sessions straight; every dip at the open gets bought. It marks a strong shift from selling to buying.',
    howToTrade:
      "Appears after a decline or a long base. Price has already moved a lot, so many traders wait for a small pullback before entering, with a stop below the middle of the pattern. Be wary if the third candle stalls with a long upper wick.",
  }, genSoldiers),
  'three-black-crows': def('three-black-crows', 'Three black crows', 3, 'bearish', 'reversal', 'uptrend', 3, {
    summary: 'Three long red candles in a row, each opening inside the previous body and closing near its low at a lower close.',
    psychology:
      'Sellers take control and keep it for three sessions straight; every bounce at the open gets sold. It marks a strong shift from buying to selling.',
    howToTrade:
      'Appears after a rally or at a top. Price has already dropped a lot, so many traders wait for a small bounce before selling, with a stop above the middle of the pattern.',
  }, bearTwin(genSoldiers)),
};

export const CANDLE_PATTERN_IDS = Object.keys(CANDLE_PATTERNS);

/** Geometry check for pattern `id` on the last N candles of `candles` (ignores trend context). */
export function checkCandlePattern(id, candles) {
  const p = CANDLE_PATTERNS[id];
  return !!p && p.check(candles);
}

/** Trend of the `lookback` candles ending just before `idx`: 'up' | 'down' | 'range'. */
export function trendBefore(candles, idx, lookback = 8) {
  const from = Math.max(0, idx - lookback);
  const seg = candles.slice(from, idx);
  if (seg.length < 3) return 'range';
  const n = seg.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  seg.forEach((c, i) => {
    sx += i;
    sy += c.c;
    sxy += i * c.c;
    sxx += i * i;
  });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const avgR = seg.reduce((s, c) => s + (c.h - c.l), 0) / n || 1;
  const move = (slope * (n - 1)) / avgR;
  return move > 1.2 ? 'up' : move < -1.2 ? 'down' : 'range';
}

/**
 * findCandlePatterns(candles, { ids, context = true, lookback = 8 }) → [{ id, start, end }]
 * Scans for every pattern whose geometry matches; with context = true the trend before the
 * pattern must match the pattern's context (downtrend / uptrend).
 */
export function findCandlePatterns(candles, { ids = CANDLE_PATTERN_IDS, context = true, lookback = 8 } = {}) {
  const out = [];
  for (let end = 0; end < candles.length; end++) {
    for (const id of ids) {
      const p = CANDLE_PATTERNS[id];
      const start = end - p.candles + 1;
      if (start < 0) continue;
      if (!p.check(candles.slice(start, end + 1))) continue;
      if (context && p.context !== 'any') {
        const tr = trendBefore(candles, start, lookback);
        if ((p.context === 'downtrend' && tr !== 'down') || (p.context === 'uptrend' && tr !== 'up')) continue;
      }
      out.push({ id, start, end });
    }
  }
  return out;
}

function leadIn(rng, { n, start, dir, R }) {
  if (n <= 0) return [];
  // Net move of the lead-in: ~0.45 typical ranges per candle, capped so long lead-ins stay realistic.
  const D = R * Math.min(n * rng.float(0.42, 0.55), 8 + n * 0.12);
  let pts;
  if (dir === 'range') {
    pts = n >= 16
      ? [[0, start], [0.3, start + 1.4 * R], [0.65, start - 1.2 * R], [1, start + 0.1 * R]]
      : [[0, start - 0.6 * R], [0.5, start + 1.1 * R], [1, start - 0.2 * R]];
  } else {
    // One clean trend leg; a pullback only when every leg can span at least ~5 candles.
    const s = dir === 'down' ? -1 : 1;
    pts = n >= 22
      ? [[0, start], [0.42, start + s * 0.6 * D], [0.64, start + s * 0.4 * D], [1, start + s * D]]
      : [[0, start], [1, start + s * D]];
  }
  return fromPath(pts, { seed: rng.fork('lead').seed, count: Math.max(2, n), noise: 0.3, exact: true, volume: false }).candles.slice(-n);
}

function followThrough(rng, { n, from, dir, R, beyond, confirm }) {
  if (n <= 0) return [];
  let first = from + dir * R * rng.float(0.45, 0.85);
  // A successful signal is confirmed the way its howToTrade text says: the first candle
  // closes beyond the confirmation level (e.g. above a hammer's high).
  if (confirm != null) {
    const c = confirm + dir * R * rng.float(0.1, 0.35);
    first = dir > 0 ? Math.max(first, c) : Math.min(first, c);
  }
  let end = first + dir * R * (n - 1) * rng.float(0.35, 0.55);
  if (beyond != null) end = dir > 0 ? Math.max(end, beyond + R * rng.float(0.4, 1.0)) : Math.min(end, beyond - R * rng.float(0.4, 1.0));
  let cs;
  if (n === 1) {
    cs = [parts(from, first, R * rng.float(0.05, 0.3), R * rng.float(0.05, 0.3))];
  } else {
    cs = fromPath([[0, first], [1, end]], { seed: rng.fork('after').seed, count: n, noise: 0.35, exact: true, volume: false }).candles;
    const c0 = cs[0];
    c0.o = from;
    c0.h = Math.max(c0.h, c0.o, c0.c);
    c0.l = Math.min(c0.l, c0.o, c0.c);
  }
  return cs;
}

const lastOf = (cs) => cs[cs.length - 1];
const bodyTop = (k) => Math.max(k.o, k.c);
const bodyBottom = (k) => Math.min(k.o, k.c);
/**
 * Confirmation level of each pattern (the price the next candle has to close beyond), taken
 * from its howToTrade text. Neutral patterns confirm beyond the high or low in `dir`.
 */
export const CONFIRM = {
  doji: (cs, dir) => (dir > 0 ? lastOf(cs).h : lastOf(cs).l),
  'spinning-top': (cs, dir) => (dir > 0 ? lastOf(cs).h : lastOf(cs).l),
  'dragonfly-doji': (cs) => lastOf(cs).h,
  'gravestone-doji': (cs) => lastOf(cs).l,
  'bullish-marubozu': (cs) => lastOf(cs).c,
  'bearish-marubozu': (cs) => lastOf(cs).c,
  hammer: (cs) => lastOf(cs).h,
  'hanging-man': (cs) => bodyBottom(lastOf(cs)),
  'inverted-hammer': (cs) => bodyTop(lastOf(cs)),
  'shooting-star': (cs) => bodyBottom(lastOf(cs)),
  'bullish-engulfing': (cs) => lastOf(cs).h,
  'bearish-engulfing': (cs) => lastOf(cs).l,
  'bullish-harami': (cs) => cs[0].o,
  'bearish-harami': (cs) => cs[0].o,
  'piercing-line': (cs) => lastOf(cs).h,
  'dark-cloud-cover': (cs) => lastOf(cs).l,
  'tweezer-bottom': (cs) => lastOf(cs).h,
  'tweezer-top': (cs) => lastOf(cs).l,
  'morning-star': (cs) => lastOf(cs).h,
  'evening-star': (cs) => lastOf(cs).l,
  'three-white-soldiers': (cs) => lastOf(cs).c,
  'three-black-crows': (cs) => lastOf(cs).c,
};

/**
 * Accept or reject a lead-in + pattern pair (candleScenario retries with fresh forks):
 *  - the last candles of the lead-in still move with the trend;
 *  - a reversal pattern marks the extreme of the move (preceding wicks are trimmed when only a
 *    wick is in the way);
 *  - no competing signal: no other instance of the same pattern, no earlier reversal signal
 *    with the same bias in the lead-in, and no other directional pattern overlapping the
 *    pattern candles (so "which pattern is this?" has one answer).
 * Returns the (possibly trimmed) lead-in and whether the pair is clean.
 */
function settleLeadIn(p, lead, pat, trend, R) {
  const out = lead.map((k) => ({ ...k }));
  let ok = true;
  const n = out.length;
  if (n >= 6 && trend !== 'range') {
    const d = (out[n - 1].c - out[n - 6].c) * (trend === 'up' ? 1 : -1);
    if (d < 0.4 * R) ok = false;
    // findCandlePatterns (and the games built on it) must see the same context.
    if (trendBefore(out, n, 8) !== trend) ok = false;
  }
  // Soldiers / crows start the new move from the lows (highs) rather than print them.
  if (p.id.startsWith('three-') && n) {
    const recent = out.slice(-12);
    if (p.bias === 'bullish' && Math.min(...pat.map((k) => k.l)) > Math.min(...recent.map((k) => k.l)) + 0.5 * R) ok = false;
    if (p.bias === 'bearish' && Math.max(...pat.map((k) => k.h)) < Math.max(...recent.map((k) => k.h)) - 0.5 * R) ok = false;
  }
  if (p.kind === 'reversal' && n && !p.id.startsWith('three-')) {
    const bull = p.bias === 'bullish';
    const ext = bull ? Math.min(...pat.map((k) => k.l)) : Math.max(...pat.map((k) => k.h));
    const gap = 0.1 * R; // clearly beyond (more than a tweezer's tolerance)
    for (let j = Math.max(0, n - 12); j < n; j++) {
      const k = out[j];
      if (bull && k.l <= ext + gap) {
        if (bodyBottom(k) <= ext + 1.2 * gap) ok = false;
        else k.l = ext + gap + (bodyBottom(k) - ext - gap) * 0.35;
      } else if (!bull && k.h >= ext - gap) {
        if (bodyTop(k) >= ext - 1.2 * gap) ok = false;
        else k.h = ext - gap - (ext - gap - bodyTop(k)) * 0.35;
      }
    }
  }
  if (ok) {
    const all = [...out, ...pat].map((k, i) => ({ ...k, t: i }));
    const s = n;
    const e = all.length - 1;
    for (const m of findCandlePatterns(all, { context: true })) {
      if (m.id === p.id) {
        if (m.start !== s) ok = false;
        continue;
      }
      const q = CANDLE_PATTERNS[m.id];
      if (q.bias === 'neutral') continue;
      // Straddles the lead-in and the pattern (e.g. hammer + prior candle = tweezer bottom), or
      // ends on the pattern's last candle: a second valid answer for the same candles.
      if (m.end >= s && (m.start < s || m.end === e)) ok = false;
      // A recent reversal signal in the same direction steals the pattern's thunder. (A
      // pattern's own first candle may match a one-candle pattern, e.g. the long red candle of
      // a piercing line is a bearish marubozu — that is part of the story, not a rival.)
      else if (m.end < s && m.end >= s - 12 && p.bias !== 'neutral' && q.kind === 'reversal' && q.bias === p.bias) ok = false;
      if (!ok) break;
    }
  }
  return { lead: out, ok };
}

/**
 * candleScenario(patternId, { seed, leadIn = 14, after = 0, start = 100, outcome = 'success' })
 * Lead-in trend matching the pattern's context (downtrend before bullish reversals, uptrend
 * before bearish ones, a trend in the pattern's direction for continuation patterns, any for
 * neutral ones), then the pattern, then `after` follow-through candles. outcome 'success'
 * moves in the pattern's bias direction and its first candle closes beyond the pattern's
 * confirmation level (`confirm`, per its howToTrade text); 'fail' moves against it (and beyond
 * the pattern's extreme when after >= 3). Neutral patterns move in a random direction.
 * The lead-in is chosen so that reversal patterns mark the extreme of the move and no other
 * directional pattern competes with the real one (see settleLeadIn).
 * → { candles, start, end, id, bias, context, trend, outcome, direction, confirm }
 */
export function candleScenario(patternId, { seed, leadIn: nLead = 14, after = 0, start = 100, outcome = 'success' } = {}) {
  const p = CANDLE_PATTERNS[patternId];
  if (!p) throw new Error(`Unknown candle pattern: ${patternId}`);
  const rng = makeRng(seed ?? 1);
  const R0 = start * rng.float(0.011, 0.016);
  let trend;
  if (p.context === 'downtrend') trend = 'down';
  else if (p.context === 'uptrend') trend = 'up';
  else trend = rng.pick(['up', 'down', 'range']);

  const nL = Math.max(0, Math.floor(nLead));
  let lead;
  let pat;
  let R;
  for (let attempt = 0; attempt < 40; attempt++) {
    const tag = `${patternId}:${attempt}`;
    const raw = leadIn(rng.fork(`leadin:${tag}`), { n: nL, start, dir: trend, R: R0 });
    const recent = raw.slice(-10);
    R = recent.length ? clamp(recent.reduce((s, c) => s + (c.h - c.l), 0) / recent.length, 0.7 * R0, 1.4 * R0) : R0;
    const P = raw.length ? raw[raw.length - 1].c : start;
    pat = p.generate(rng.fork(`pattern:${tag}`), { price: P, range: R });
    const settled = settleLeadIn(p, raw, pat, trend, R);
    lead = settled.lead;
    if (settled.ok) break;
  }

  let dir = p.bias === 'bullish' ? 1 : p.bias === 'bearish' ? -1 : rng.sign();
  const ok = outcome !== 'fail';
  if (!ok && p.bias !== 'neutral') dir = -dir;
  const patHigh = Math.max(...pat.map((k) => k.h));
  const patLow = Math.min(...pat.map((k) => k.l));
  const last = pat[pat.length - 1];
  const nAfter = Math.max(0, Math.floor(after));
  const beyond = !ok && p.bias !== 'neutral' && nAfter >= 3 ? (dir > 0 ? patHigh : patLow) : null;
  const confirm = CONFIRM[patternId](pat, dir);
  const follow = followThrough(rng.fork('follow'), { n: nAfter, from: last.c, dir, R, beyond, confirm: ok ? confirm : null });

  let candles = [...lead, ...pat, ...follow].map((k, i) => ({ ...k, t: i }));
  candles = addVolume(candles, { seed: rng.fork('vol').seed });
  const s = lead.length;
  const e = s + pat.length - 1;
  // Reversal candles on strong volume make the lesson; failed ones get a weaker print. (A
  // harami's second candle is an inside day, so it stays quiet either way.)
  if (p.bias !== 'neutral') {
    const prev = candles.slice(Math.max(0, s - 8), s);
    const avg = prev.length ? prev.reduce((a, c) => a + c.v, 0) / prev.length : candles[e].v;
    const vr = rng.fork('pattern-volume');
    if (patternId.endsWith('harami')) candles[e].v = Math.max(1, Math.round(Math.min(candles[e].v, avg * vr.float(0.6, 0.9))));
    else if (ok) candles[e].v = Math.max(candles[e].v, Math.round(avg * vr.float(1.35, 1.9)));
    else candles[e].v = Math.max(1, Math.round(Math.min(candles[e].v, avg * vr.float(0.75, 1.0))));
  }
  return { candles, start: s, end: e, id: patternId, bias: p.bias, context: p.context, trend, outcome: ok ? 'success' : 'fail', direction: dir, confirm };
}
