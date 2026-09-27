// Candlestick-pattern and chart-pattern definitions, generators and scenarios.
// Candlestick geometry follows Nison; chart patterns follow Edwards & Magee / Bulkowski.
// Pure module (no DOM).

import { makeRng } from './rng.js';
import { fromPath, addVolume } from './data.js';

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
const isLong = (k) => span(k) > 0 && body(k) >= 0.6 * span(k);

// Geometry-only checks for each pattern (context is checked separately).
const CHECKS = {
  doji: ([a]) => span(a) > 0 && body(a) <= 0.08 * span(a),
  'dragonfly-doji': ([a]) => CHECKS.doji([a]) && upperWick(a) <= 0.08 * span(a) && lowerWick(a) >= 0.6 * span(a),
  'gravestone-doji': ([a]) => CHECKS.doji([a]) && lowerWick(a) <= 0.08 * span(a) && upperWick(a) >= 0.6 * span(a),
  'spinning-top': ([a]) =>
    span(a) > 0 && body(a) >= 0.1 * span(a) && body(a) <= 0.3 * span(a) && upperWick(a) > body(a) && lowerWick(a) > body(a),
  'bullish-marubozu': ([a]) => isBull(a) && body(a) >= 0.9 * span(a),
  'bearish-marubozu': ([a]) => isBear(a) && body(a) >= 0.9 * span(a),
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
  'tweezer-bottom': ([a, b]) => isBear(a) && isBull(b) && Math.abs(a.l - b.l) <= 0.001 * a.l,
  'tweezer-top': ([a, b]) => isBull(a) && isBear(b) && Math.abs(a.h - b.h) <= 0.001 * a.h,
  'morning-star': ([a, b, c]) =>
    isBear(a) && isLong(a) && body(b) <= 0.35 * body(a) && Math.max(b.o, b.c) < a.c && isBull(c) && c.c > mid(a),
  'evening-star': ([a, b, c]) =>
    isBull(a) && isLong(a) && body(b) <= 0.35 * body(a) && Math.min(b.o, b.c) > a.c && isBear(c) && c.c < mid(a),
  'three-white-soldiers': (cs) =>
    cs.every((k) => isBull(k) && isLong(k) && upperWick(k) <= 0.15 * span(k)) &&
    cs.slice(1).every((k, i) => k.o > cs[i].o && k.o < cs[i].c && k.c > cs[i].c),
  'three-black-crows': (cs) =>
    cs.every((k) => isBear(k) && isLong(k) && lowerWick(k) <= 0.15 * span(k)) &&
    cs.slice(1).every((k, i) => k.o < cs[i].o && k.o > cs[i].c && k.c < cs[i].c),
};
function hammerShape(a) {
  const s = span(a);
  return s > 0 && body(a) >= 0.1 * s && lowerWick(a) >= 2 * body(a) && upperWick(a) <= 0.1 * s;
}
function invertedShape(a) {
  const s = span(a);
  return s > 0 && body(a) >= 0.1 * s && upperWick(a) >= 2 * body(a) && lowerWick(a) <= 0.1 * s;
}

// ---------------------------------------------------------------------------------------------
// Candle generators. Each receives (rng, { price, range }): price = previous close (where the
// pattern opens), range = typical candle range. Bearish twins mirror the bullish construction.
// ---------------------------------------------------------------------------------------------

function genDoji(rng, { price: P, range: R }) {
  const s = R * rng.float(1.05, 1.5);
  const b = s * rng.float(0, 0.055);
  const rest = s - b;
  const up = rest * rng.float(0.35, 0.65);
  const o = P + rng.gauss(0, 0.04 * R);
  return [parts(o, o + rng.sign() * b, up, rest - up)];
}
function genDragonfly(rng, { price: P, range: R }) {
  const s = R * rng.float(1.45, 2.0);
  const b = s * rng.float(0, 0.045);
  const up = s * rng.float(0, 0.05);
  const o = P + rng.gauss(0, 0.03 * R);
  return [parts(o, o + rng.sign() * b, up, s - b - up)];
}
function genSpinning(rng, { price: P, range: R }) {
  const s = R * rng.float(0.8, 1.2);
  const b = s * rng.float(0.12, 0.28);
  const rest = s - b;
  const f = rng.float(0.42, 0.58);
  const o = P + rng.gauss(0, 0.05 * R);
  return [parts(o, o + rng.sign() * b, rest * f, rest * (1 - f))];
}
function genMarubozu(rng, { price: P, range: R }) {
  const s = R * rng.float(1.6, 2.3);
  const b = s * rng.float(0.92, 0.985);
  const rest = s - b;
  const f = rng.float(0.2, 0.8);
  return [parts(P, P + b, rest * f, rest * (1 - f))];
}
/** Small body at the top, long lower wick (hammer / hanging man). */
function genHammerShape(rng, { price: P, range: R }, bullProb) {
  const s = R * rng.float(1.5, 2.1);
  const b = s * rng.float(0.15, 0.3);
  const up = s * rng.float(0, 0.06);
  const low = s - b - up;
  const o = P;
  const c = rng.chance(bullProb) ? o + b : o - b;
  return [parts(o, c, up, low)];
}
/** Small body at the bottom, long upper wick (inverted hammer / shooting star). */
function genInvertedShape(rng, { price: P, range: R }, bullProb, gap) {
  const s = R * rng.float(1.5, 2.1);
  const b = s * rng.float(0.15, 0.3);
  const low = s * rng.float(0, 0.06);
  const up = s - b - low;
  const o = P + gap * R * rng.float(0, 0.15);
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
  return [k1, parts(o2, c2, R * rng.float(0.02, 0.15), R * rng.float(0.03, 0.2))];
}
function genBullHarami(rng, { price: P, range: R }) {
  const b1 = R * rng.float(1.3, 1.9);
  const o1 = P + rng.gauss(0, 0.03 * R);
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.04, 0.15), R * rng.float(0.04, 0.15));
  const b2 = b1 * rng.float(0.18, 0.38);
  const o2 = c1 + b1 * rng.float(0.12, 0.3);
  return [k1, parts(o2, o2 + b2, b1 * rng.float(0.03, 0.12), b1 * rng.float(0.03, 0.12))];
}
function genPiercing(rng, { price: P, range: R }) {
  const b1 = R * rng.float(1.3, 1.8);
  const o1 = P;
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.03, 0.15), R * rng.float(0.02, 0.1));
  const o2 = k1.l - R * rng.float(0.03, 0.18);
  const c2 = mid(k1) + b1 * rng.float(0.1, 0.38);
  return [k1, parts(o2, c2, R * rng.float(0.02, 0.12), R * rng.float(0.02, 0.12))];
}
function genTweezerBottom(rng, { price: P, range: R }) {
  const b1 = R * rng.float(0.6, 1.05);
  const o1 = P;
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.03, 0.2), R * rng.float(0.18, 0.4));
  const o2 = c1 + R * rng.float(-0.03, 0.08);
  const low2 = k1.l + rng.float(-1, 1) * Math.min(0.0006 * k1.l, 0.04 * R);
  const c2 = o2 + R * rng.float(0.55, 1.0);
  return [k1, K(o2, c2 + R * rng.float(0.03, 0.18), low2, c2)];
}
function genMorningStar(rng, { price: P, range: R }) {
  const b1 = R * rng.float(1.3, 1.8);
  const o1 = P;
  const c1 = o1 - b1;
  const k1 = parts(o1, c1, R * rng.float(0.03, 0.15), R * rng.float(0.03, 0.15));
  const top2 = c1 - R * rng.float(0.08, 0.3);
  const b2 = b1 * rng.float(0.04, 0.2);
  const [o2, c2] = rng.chance(0.5) ? [top2 - b2, top2] : [top2, top2 - b2];
  const k2 = parts(o2, c2, R * rng.float(0.1, 0.35), R * rng.float(0.1, 0.35));
  const o3 = top2 + R * rng.float(0.02, 0.15);
  const c3 = mid(k1) + b1 * rng.float(0.12, 0.42);
  return [k1, k2, parts(o3, c3, R * rng.float(0.02, 0.12), R * rng.float(0.02, 0.12))];
}
function genSoldiers(rng, { price: P, range: R }) {
  const out = [];
  let o = P;
  for (let i = 0; i < 3; i++) {
    const b = R * rng.float(1.0, 1.4);
    out.push(parts(o, o + b, b * rng.float(0.02, 0.1), b * rng.float(0.03, 0.14)));
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
  }, (rng, o) => genHammerShape(rng, o, 0.65)),
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
  }, (rng, o) => genHammerShape(rng, o, 0.4)),
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
      "One of the more reliable reversal patterns when it forms at support after a downtrend. Enter on the close of the third candle or on a small pullback; the stop goes below the star's low.",
  }, genMorningStar),
  'evening-star': def('evening-star', 'Evening star', 3, 'bearish', 'reversal', 'uptrend', 3, {
    summary:
      "A three-candle top: a long green candle, a small-bodied 'star' whose body sits above it, then a long red candle that closes below the middle of the first candle.",
    psychology:
      'Buying is strong, then stalls (the star shows indecision), and finally sellers take over decisively. The mood shifts from greed to caution over three sessions.',
    howToTrade:
      "One of the more reliable reversal patterns when it forms at resistance after an uptrend. Enter on the close of the third candle or on a small bounce; the stop goes above the star's high.",
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

function followThrough(rng, { n, from, dir, R, beyond }) {
  if (n <= 0) return [];
  const first = from + dir * R * rng.float(0.45, 0.85);
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

/**
 * candleScenario(patternId, { seed, leadIn = 14, after = 0, start = 100, outcome = 'success' })
 * Lead-in trend matching the pattern's context (downtrend before bullish reversals, uptrend
 * before bearish ones, a trend in the pattern's direction for continuation patterns, any for
 * neutral ones), then the pattern, then `after` follow-through candles. outcome 'success'
 * moves in the pattern's bias direction; 'fail' moves against it (and beyond the pattern's
 * extreme when there is room). Neutral patterns move in a random direction.
 * → { candles, start, end, id, bias, context, trend, outcome, direction }
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

  const lead = leadIn(rng.fork('leadin'), { n: Math.max(0, Math.floor(nLead)), start, dir: trend, R: R0 });
  const recent = lead.slice(-10);
  const R = recent.length ? clamp(recent.reduce((s, c) => s + (c.h - c.l), 0) / recent.length, 0.7 * R0, 1.4 * R0) : R0;
  const P = lead.length ? lead[lead.length - 1].c : start;
  const pat = p.generate(rng.fork('pattern'), { price: P, range: R });

  let dir = p.bias === 'bullish' ? 1 : p.bias === 'bearish' ? -1 : rng.sign();
  const ok = outcome !== 'fail';
  if (!ok && p.bias !== 'neutral') dir = -dir;
  const patHigh = Math.max(...pat.map((k) => k.h));
  const patLow = Math.min(...pat.map((k) => k.l));
  const last = pat[pat.length - 1];
  const nAfter = Math.max(0, Math.floor(after));
  const beyond = !ok && p.bias !== 'neutral' && nAfter >= 3 ? (dir > 0 ? patHigh : patLow) : null;
  const follow = followThrough(rng.fork('follow'), { n: nAfter, from: last.c, dir, R, beyond });

  let candles = [...lead, ...pat, ...follow].map((k, i) => ({ ...k, t: i }));
  candles = addVolume(candles, { seed: rng.fork('vol').seed });
  const s = lead.length;
  const e = s + pat.length - 1;
  // Reversal candles on strong volume make the lesson; failed ones get a weaker print.
  if (p.bias !== 'neutral') candles[e].v = Math.round(candles[e].v * (ok ? rng.float(1.3, 1.7) : rng.float(0.8, 1.05)));
  return { candles, start: s, end: e, id: patternId, bias: p.bias, context: p.context, trend, outcome: ok ? 'success' : 'fail', direction: dir };
}

// ---------------------------------------------------------------------------------------------
// Chart patterns. path(rng) builds waypoints (prices around 100) for the prior trend, the
// formation and the breakout. chartScenario() adds the follow-through, generates candles and
// measures everything from the generated candles.
// ---------------------------------------------------------------------------------------------

/** items: [{ w, p, label? }] → x positions from cumulative weights (first item at x = 0). */
function place(items) {
  const total = items.slice(1).reduce((s, it) => s + it.w, 0);
  let acc = 0;
  return items.map((it, i) => {
    if (i > 0) acc += it.w;
    return { ...it, x: acc / total };
  });
}
const lineAt = (a, b, x) => a.p + ((b.p - a.p) * (x - a.x)) / (b.x - a.x || 1);

function finish(items, extra, inverted) {
  const pts = items.map((it) => [it.x, inverted ? 200 - it.p : it.p]);
  const labels = {};
  items.forEach((it, i) => {
    if (it.label) labels[i] = it.label;
  });
  const out = { points: pts, labels, ...extra, direction: inverted ? -extra.direction : extra.direction };
  if (inverted && extra.boundaries) out.boundaries = { upper: extra.boundaries.lower, lower: extra.boundaries.upper };
  return out;
}

function priorTrend(rng, s, target) {
  return [
    { w: 0, p: s },
    { w: 1.0, p: s + (target - s) * rng.float(0.5, 0.62) },
    { w: 0.5, p: s + (target - s) * rng.float(0.26, 0.36) },
  ];
}

function headAndShoulders(rng, inv) {
  const LS = 100;
  const T1 = LS * (1 - rng.float(0.045, 0.06));
  const head = LS * (1 + rng.float(0.055, 0.1));
  const T2 = T1 * (1 + rng.float(-0.01, 0.01));
  const RS = LS * (1 + rng.float(-0.012, 0.01));
  const s = T1 * (1 - rng.float(0.05, 0.075));
  const items = place([
    ...priorTrend(rng, s, LS),
    { w: 1.1, p: LS, label: 'Left shoulder' },
    { w: 0.9, p: T1, label: 'Neckline' },
    { w: 1.0, p: head, label: 'Head' },
    { w: 1.0, p: T2, label: 'Neckline' },
    { w: 0.9, p: RS, label: 'Right shoulder' },
    { w: 0.75, p: 0, label: 'Breakout' },
  ]);
  items[8].p = lineAt({ x: items[4].x, p: T1 }, { x: items[6].x, p: T2 }, items[8].x) - LS * rng.float(0.015, 0.025);
  return finish(items, { breakoutPoint: 8, startPoint: 2, keyStart: 3, neckline: [4, 6], direction: -1, measure: { type: 'neckline', extreme: [5] } }, inv);
}

function doubleTop(rng, inv) {
  const P1 = 100;
  const T = P1 * (1 - rng.float(0.045, 0.075));
  const P2 = P1 * (1 + rng.float(-0.01, 0.008));
  const s = T * (1 - rng.float(0.05, 0.08));
  const items = place([
    ...priorTrend(rng, s, P1),
    { w: 1.1, p: P1, label: inv ? 'Bottom 1' : 'Top 1' },
    { w: 1.3, p: T, label: 'Neckline' },
    { w: 1.3, p: P2, label: inv ? 'Bottom 2' : 'Top 2' },
    { w: 0.9, p: T * (1 - rng.float(0.015, 0.025)), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 6, startPoint: 2, keyStart: 3, neckline: [4, 4], direction: -1, measure: { type: 'neckline', extreme: [3, 5] } }, inv);
}

function tripleTop(rng, inv) {
  const P1 = 100;
  const T1 = P1 * (1 - rng.float(0.045, 0.065));
  const P2 = P1 * (1 + rng.float(-0.008, 0.008));
  const T2 = T1 * (1 + rng.float(-0.008, 0.008));
  const P3 = P1 * (1 + rng.float(-0.01, 0.006));
  const s = Math.min(T1, T2) * (1 - rng.float(0.05, 0.075));
  const top = inv ? 'Bottom' : 'Top';
  const items = place([
    ...priorTrend(rng, s, P1),
    { w: 1.0, p: P1, label: `${top} 1` },
    { w: 0.9, p: T1, label: 'Neckline' },
    { w: 0.9, p: P2, label: `${top} 2` },
    { w: 0.9, p: T2, label: 'Neckline' },
    { w: 0.9, p: P3, label: `${top} 3` },
    { w: 0.8, p: 0, label: 'Breakout' },
  ]);
  items[8].p = lineAt({ x: items[4].x, p: T1 }, { x: items[6].x, p: T2 }, items[8].x) - P1 * rng.float(0.015, 0.025);
  return finish(items, { breakoutPoint: 8, startPoint: 2, keyStart: 3, neckline: [4, 6], direction: -1, measure: { type: 'neckline', extreme: [3, 5, 7] } }, inv);
}

/** Rising wedge (inv = falling wedge). */
function risingWedge(rng, inv) {
  const W0 = 100 * rng.float(0.055, 0.075);
  const W1 = W0 * rng.float(0.28, 0.38);
  const riseL = 100 * rng.float(0.075, 0.1);
  const L0 = 94;
  const lower = (u) => L0 + riseL * u;
  const upper = (u) => lower(u) + W0 + (W1 - W0) * u;
  const width = (u) => upper(u) - lower(u);
  const Wt = 5.2;
  const us = [0, 0.17, 0.36, 0.55, 0.73, 0.88, 1.0];
  const up = inv ? 'Lower line' : 'Upper line';
  const lo = inv ? 'Upper line' : 'Lower line';
  const s = L0 * (1 - rng.float(0.05, 0.07));
  const items = place([
    { w: 0, p: s },
    { w: 1.3, p: L0 + W0 * rng.float(0.55, 0.8) },
    { w: 0.55, p: lower(0), label: lo },
    { w: (us[1] - us[0]) * Wt, p: upper(us[1]), label: up },
    { w: (us[2] - us[1]) * Wt, p: lower(us[2]) + width(us[2]) * 0.03, label: lo },
    { w: (us[3] - us[2]) * Wt, p: upper(us[3]) - width(us[3]) * 0.03, label: up },
    { w: (us[4] - us[3]) * Wt, p: lower(us[4]), label: lo },
    { w: (us[5] - us[4]) * Wt, p: upper(us[5]), label: up },
    { w: (us[6] - us[5]) * Wt, p: lower(us[6]) - 100 * rng.float(0.013, 0.02), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 8, startPoint: 2, keyStart: 2, boundaries: { upper: [3, 7], lower: [2, 6] }, direction: -1, measure: { type: 'boundaries' } }, inv);
}

/** Ascending triangle (inv = descending triangle). */
function ascendingTriangle(rng, inv) {
  const R = 100;
  const L1 = R * (1 - rng.float(0.05, 0.065));
  const L3 = R - (R - L1) * rng.float(0.25, 0.35);
  const uL1 = 0.17;
  const uL3 = 0.86;
  const low = (u) => L1 + ((L3 - L1) * (u - uL1)) / (uL3 - uL1);
  const Wt = 5.0;
  const us = [0, uL1, 0.4, 0.57, 0.72, uL3, 1.0];
  const res = inv ? 'Support' : 'Resistance';
  const sup = inv ? 'Falling resistance' : 'Rising support';
  const s = L1 * (1 - rng.float(0.04, 0.06));
  const items = place([
    ...priorTrend(rng, s, R),
    { w: 1.0, p: R, label: res },
    { w: (us[1] - us[0]) * Wt, p: L1, label: sup },
    { w: (us[2] - us[1]) * Wt, p: R * (1 - rng.float(0, 0.0015)), label: res },
    { w: (us[3] - us[2]) * Wt, p: low(us[3]) + (R - low(us[3])) * 0.04, label: sup },
    { w: (us[4] - us[3]) * Wt, p: R, label: res },
    { w: (us[5] - us[4]) * Wt, p: L3, label: sup },
    { w: (us[6] - us[5]) * Wt, p: R * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 9, startPoint: 3, keyStart: 3, boundaries: { upper: [3, 7], lower: [4, 8] }, direction: 1, measure: { type: 'boundaries' } }, inv);
}

function symmetricalTriangle(rng) {
  const inv = rng.chance(0.5);
  const C0 = 100;
  const W0 = 100 * rng.float(0.07, 0.09);
  const apex = rng.float(1.25, 1.45);
  const tilt = 100 * rng.float(-0.004, 0.004);
  const width = (u) => W0 * (1 - u / apex);
  const upper = (u) => C0 + width(u) / 2 + tilt * u;
  const lower = (u) => C0 - width(u) / 2 + tilt * u;
  const Wt = 5.0;
  const us = [0, 0.18, 0.4, 0.58, 0.76, 0.9, 1.02];
  const up = inv ? 'Lower line' : 'Upper line';
  const lo = inv ? 'Upper line' : 'Lower line';
  const s = lower(0.18) - 100 * rng.float(0.035, 0.05);
  const items = place([
    ...priorTrend(rng, s, upper(0)),
    { w: 1.0, p: upper(0), label: up },
    { w: (us[1] - us[0]) * Wt, p: lower(us[1]), label: lo },
    { w: (us[2] - us[1]) * Wt, p: upper(us[2]) - width(us[2]) * 0.04, label: up },
    { w: (us[3] - us[2]) * Wt, p: lower(us[3]) + width(us[3]) * 0.04, label: lo },
    { w: (us[4] - us[3]) * Wt, p: upper(us[4]), label: up },
    { w: (us[5] - us[4]) * Wt, p: lower(us[5]), label: lo },
    { w: (us[6] - us[5]) * Wt, p: upper(us[6]) + 100 * rng.float(0.014, 0.022), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 9, startPoint: 3, keyStart: 3, boundaries: { upper: [3, 7], lower: [4, 8] }, direction: 1, measure: { type: 'boundaries' } }, inv);
}

/** Bull flag (inv = bear flag). */
function bullFlag(rng, inv) {
  const poleStart = 100 * rng.float(0.9, 0.93);
  const Hp = poleStart * rng.float(0.095, 0.13);
  const top = poleStart + Hp;
  const slope = Hp * rng.float(0.12, 0.2);
  const Wc = Hp * rng.float(0.2, 0.27);
  const upper = (u) => top - slope * u;
  const lower = (u) => upper(u) - Wc;
  // Proportions: the flag lasts under twice as long as the pole (a textbook flag is a brief
  // pause); the prior trend gets the room so the pole stands out as the steepest move.
  const Wf = 1.45;
  const us = [0, 0.24, 0.5, 0.76, 1.0];
  const s = poleStart * (1 - rng.float(0.035, 0.055));
  const items = place([
    { w: 0, p: s },
    { w: 1.7, p: poleStart * (1 + rng.float(0.018, 0.03)) },
    { w: 0.75, p: poleStart, label: 'Flagpole start' },
    { w: 0.8, p: top, label: inv ? 'Flagpole bottom' : 'Flagpole top' },
    { w: (us[1] - us[0]) * Wf, p: lower(us[1]), label: 'Flag' },
    { w: (us[2] - us[1]) * Wf, p: upper(us[2]) - Wc * 0.03, label: 'Flag' },
    { w: (us[3] - us[2]) * Wf, p: lower(us[3]), label: 'Flag' },
    { w: (us[4] - us[3]) * Wf, p: upper(us[4]) + Hp * rng.float(0.13, 0.2), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 7, startPoint: 2, keyStart: 3, boundaries: { upper: [3, 5], lower: [4, 6] }, direction: 1, measure: { type: 'pole', from: 2, to: 3 } }, inv);
}

function cupAndHandle(rng) {
  const R = 100;
  const D = R * rng.float(0.1, 0.15);
  const cup = (u) => R - D * (1 - Math.pow(Math.abs(2 * u - 1), 2.6));
  const s = R * (1 - rng.float(0.08, 0.11));
  const Wc = 4.4;
  const us = [0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9, 1.0];
  const rim2 = R * (1 - rng.float(0, 0.006));
  const items = place([
    ...priorTrend(rng, s, R),
    { w: 0.9, p: R, label: 'Left rim' },
    ...us.slice(1).map((u, i) => ({
      w: (u - us[i]) * Wc,
      p: u === 1 ? rim2 : cup(u),
      label: u === 0.5 ? 'Cup bottom' : u === 1 ? 'Right rim' : undefined,
    })),
    { w: 1.1, p: rim2 - D * rng.float(0.28, 0.4), label: 'Handle' },
    { w: 0.75, p: R * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  const bo = items.length - 1;
  return finish(items, { breakoutPoint: bo, startPoint: 3, keyStart: 3, neckline: [3, 3], direction: 1, measure: { type: 'neckline', extreme: [7] } }, false);
}

function roundingBottom(rng) {
  const L = 100;
  const D = L * rng.float(0.1, 0.15);
  const saucer = (u) => L - D * Math.pow(Math.sin(Math.PI * u), 0.65);
  const Ws = 5.0;
  const us = [0, 0.12, 0.26, 0.4, 0.5, 0.6, 0.74, 0.88, 1.0];
  const items = place([
    { w: 0, p: L * (1 + rng.float(0.08, 0.11)) },
    { w: 1.3, p: L * (1 - rng.float(0.015, 0.025)) },
    { w: 0.45, p: L, label: 'Left lip' },
    ...us.slice(1).map((u, i) => ({
      w: (u - us[i]) * Ws,
      p: u === 1 ? L * (1 - rng.float(0.005, 0.012)) : saucer(u),
      label: u === 0.5 ? 'Bottom' : undefined,
    })),
    { w: 0.6, p: L * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  const bo = items.length - 1;
  return finish(items, { breakoutPoint: bo, startPoint: 2, keyStart: 2, neckline: [2, 2], direction: 1, measure: { type: 'neckline', extreme: [6] } }, false);
}

function cdef(id, name, bias, kind, reliability, text, path) {
  return { id, name, bias, kind, reliability, ...text, path };
}

export const CHART_PATTERNS = {
  'head-and-shoulders': cdef('head-and-shoulders', 'Head and shoulders', 'bearish', 'reversal', 3, {
    summary:
      'Three peaks at the end of an uptrend: a left shoulder, a higher head, and a right shoulder at about the height of the left one. The neckline joins the two lows between them.',
    psychology:
      'Buyers make one more new high with the head, then fail to do it again: the right shoulder stops well below the head. When price closes below the neckline, everyone who bought the shoulders is trapped and selling speeds up.',
    howToTrade:
      'Wait for a candle to close below the neckline. Sell the break or a retest of the neckline from below, with a stop above the right shoulder.',
    target: 'Measure from the top of the head down to the neckline and project that distance down from the breakout point.',
  }, (rng) => headAndShoulders(rng, false)),
  'inverse-head-and-shoulders': cdef('inverse-head-and-shoulders', 'Inverse head and shoulders', 'bullish', 'reversal', 3, {
    summary:
      'Three troughs at the end of a downtrend: a left shoulder, a lower head, and a right shoulder at about the depth of the left one. The neckline joins the two highs between them.',
    psychology:
      'Sellers push to one more new low with the head, then fail to repeat it: the right shoulder holds well above the head. A close above the neckline shows buyers have taken control.',
    howToTrade:
      'Wait for a close above the neckline. Buy the break or a retest of the neckline from above, with a stop below the right shoulder.',
    target: 'Measure from the bottom of the head up to the neckline and project that distance up from the breakout point.',
  }, (rng) => headAndShoulders(rng, true)),
  'double-top': cdef('double-top', 'Double top', 'bearish', 'reversal', 2, {
    summary: "Two peaks at about the same price with a trough between them, shaped like an 'M'. The neckline is the low between the peaks.",
    psychology:
      'Buyers push to a high and are rejected, try again and fail at the same level — sellers are defending it. A break below the trough confirms that control has changed hands.',
    howToTrade:
      'It is only a double top once price closes below the neckline. Sell the break or a retest of the neckline, with a stop above the peaks.',
    target: 'Measure from the peaks down to the neckline and project that height down from the breakout.',
  }, (rng) => doubleTop(rng, false)),
  'double-bottom': cdef('double-bottom', 'Double bottom', 'bullish', 'reversal', 2, {
    summary: "Two troughs at about the same price with a peak between them, shaped like a 'W'. The neckline is the high between the troughs.",
    psychology:
      'Sellers push price down to the same low twice and fail both times — buyers are defending that level. A close above the middle peak confirms buyers are in control.',
    howToTrade:
      'Wait for a close above the neckline. Buy the break or a retest of the neckline, with a stop below the lows.',
    target: 'Measure from the lows up to the neckline and project that height up from the breakout.',
  }, (rng) => doubleTop(rng, true)),
  'triple-top': cdef('triple-top', 'Triple top', 'bearish', 'reversal', 2, {
    summary: 'Three peaks at about the same level with two troughs between them. The neckline (support) runs through the troughs.',
    psychology:
      'Buyers attack the same resistance three times and fail every time. Each failure leaves more trapped buyers, and a break of support releases the selling.',
    howToTrade: 'Wait for a close below the neckline through the troughs. Sell the break or a retest, with a stop above the peaks.',
    target: 'Project the pattern height (peaks to neckline) down from the breakout.',
  }, (rng) => tripleTop(rng, false)),
  'triple-bottom': cdef('triple-bottom', 'Triple bottom', 'bullish', 'reversal', 2, {
    summary: 'Three troughs at about the same level with two peaks between them. The neckline (resistance) runs through the peaks.',
    psychology:
      'Sellers attack the same support three times and fail every time. Buyers keep absorbing the selling, and a break above resistance releases the buying.',
    howToTrade: 'Wait for a close above the neckline through the peaks. Buy the break or a retest, with a stop below the lows.',
    target: 'Project the pattern height (lows to neckline) up from the breakout.',
  }, (rng) => tripleTop(rng, true)),
  'rising-wedge': cdef('rising-wedge', 'Rising wedge', 'bearish', 'reversal', 2, {
    summary:
      'Price climbs between two rising trend lines that converge, with the lower line steeper than the upper one. It usually breaks down.',
    psychology:
      'Each new high is only slightly higher while dips are bought at ever higher prices: buyers are still pushing but gaining less ground each time, a sign the rally is running out of fuel.',
    howToTrade:
      'Wait for a close below the lower trend line. Sell the break or a retest of the line from below, with a stop above the last swing high inside the wedge.',
    target: "Project the wedge's height at its widest point down from the breakout; price often returns to where the wedge began.",
  }, (rng) => risingWedge(rng, false)),
  'falling-wedge': cdef('falling-wedge', 'Falling wedge', 'bullish', 'reversal', 2, {
    summary:
      'Price falls between two descending trend lines that converge, with the upper line steeper than the lower one. It usually breaks out upward.',
    psychology:
      'Each new low is only slightly lower and the drops keep shrinking: sellers are losing momentum even while price drifts down.',
    howToTrade:
      'Wait for a close above the upper trend line. Buy the break or a retest of the line from above, with a stop below the last swing low inside the wedge.',
    target: "Project the wedge's height at its widest point up from the breakout; a return to where the wedge began is common.",
  }, (rng) => risingWedge(rng, true)),
  'ascending-triangle': cdef('ascending-triangle', 'Ascending triangle', 'bullish', 'continuation', 2, {
    summary: 'A flat resistance line on top and rising lows underneath. It most often breaks upward, continuing an uptrend.',
    psychology:
      'Sellers defend one fixed price, but buyers keep stepping in at higher and higher prices. Eventually the supply at resistance runs out.',
    howToTrade:
      'Wait for a close above the flat resistance, ideally on rising volume. Buy the break or a retest of old resistance as support, with a stop below the last higher low.',
    target: "Take the triangle's height at its widest point (the start) and project it up from the breakout.",
  }, (rng) => ascendingTriangle(rng, false)),
  'descending-triangle': cdef('descending-triangle', 'Descending triangle', 'bearish', 'continuation', 2, {
    summary: 'A flat support line underneath and falling highs above it. It most often breaks downward, continuing a downtrend.',
    psychology:
      'Buyers defend one fixed price, but sellers get more aggressive, selling at lower and lower highs. Eventually support gives way.',
    howToTrade:
      'Wait for a close below the flat support. Sell the break or a retest of old support from below, with a stop above the last lower high.',
    target: "Take the triangle's height at its widest point (the start) and project it down from the breakout.",
  }, (rng) => ascendingTriangle(rng, true)),
  'symmetrical-triangle': cdef('symmetrical-triangle', 'Symmetrical triangle', 'neutral', 'continuation', 2, {
    summary:
      'Lower highs and higher lows squeeze price between two converging trend lines. It usually breaks in the direction of the trend that came before it.',
    psychology:
      'Buyers and sellers both become less aggressive and the range contracts like a coiled spring. The breakout shows which side has won.',
    howToTrade:
      "Don't guess the direction — wait for a close outside one of the lines. Put the stop just inside the opposite side of the triangle. Breakouts very close to the apex are less reliable.",
    target: "Project the triangle's height at its widest point from the breakout, in the breakout's direction.",
  }, (rng) => symmetricalTriangle(rng)),
  'bull-flag': cdef('bull-flag', 'Bull flag', 'bullish', 'continuation', 2, {
    summary: 'A sharp rally (the flagpole) followed by a small, orderly pullback inside a slightly downward-sloping channel (the flag).',
    psychology:
      'After a burst of buying, some traders take profits, but the selling is light and controlled. When the pause ends, buyers resume the trend.',
    howToTrade:
      "Buy a close above the flag's upper line, with a stop below the flag's low. A good flag is short and retraces less than half of the pole.",
    target: 'Add the length of the flagpole to the breakout point.',
  }, (rng) => bullFlag(rng, false)),
  'bear-flag': cdef('bear-flag', 'Bear flag', 'bearish', 'continuation', 2, {
    summary: 'A sharp drop (the flagpole) followed by a small, orderly bounce inside a slightly upward-sloping channel (the flag).',
    psychology:
      'After a burst of selling, some traders cover and price bounces weakly. When the pause ends, sellers resume the downtrend.',
    howToTrade:
      "Sell a close below the flag's lower line, with a stop above the flag's high. A good flag is short and retraces less than half of the pole.",
    target: 'Subtract the length of the flagpole from the breakout point.',
  }, (rng) => bullFlag(rng, true)),
  'cup-and-handle': cdef('cup-and-handle', 'Cup and handle', 'bullish', 'continuation', 2, {
    summary: "A rounded 'U'-shaped base (the cup) followed by a short, shallow pullback (the handle) just below the cup's rim.",
    psychology:
      'The cup shows selling slowly drying up and buyers gradually returning. The handle is a final shake-out of nervous holders before price clears resistance at the rim.',
    howToTrade:
      'Buy a close above the rim, ideally on strong volume, with a stop below the handle low. Handles should be short and stay in the upper part of the cup.',
    target: "Measure the cup's depth (rim to bottom) and add it to the breakout at the rim.",
  }, (rng) => cupAndHandle(rng)),
  'rounding-bottom': cdef('rounding-bottom', 'Rounding bottom', 'bullish', 'reversal', 2, {
    summary: "A long, gradual 'saucer'-shaped bottom where a downtrend slowly flattens out and turns back up.",
    psychology:
      'Selling pressure fades gradually rather than suddenly. Over many sessions sentiment shifts from bearish, to neutral, to bullish.',
    howToTrade:
      'Wait for a close above the level where the saucer began (its left lip). Buy the break or a retest, with a stop below the right side of the base.',
    target: "Project the saucer's depth up from the breakout level.",
  }, (rng) => roundingBottom(rng)),
};

export const CHART_PATTERN_IDS = Object.keys(CHART_PATTERNS);

/**
 * Make a generated chart pattern read the way the textbook draws it:
 *  - before the breakout no candle closes beyond the broken line (that close would BE the
 *    breakout) and, for triangles / wedges / flags, every close stays between the two lines;
 *    wicks may poke through a line, but only a little;
 *  - the breakout candle closes decisively beyond the line;
 *  - a successful breakout holds: later closes stay beyond the broken level (a retest may wick
 *    back to the line).
 * Out-of-bounds opens/closes are reflected back inside (not flattened onto the line), so the
 * adjusted candles still look like ordinary candles. Extremes on the lines are untouched.
 */
function tidyChart(candles, { rng, from, breakoutIdx, dir, level, upperL, lowerL, lvl, height, ok }) {
  const n = candles.length;
  const fix = (c) => {
    c.h = Math.max(c.h, c.o, c.c);
    c.l = Math.min(c.l, c.o, c.c);
  };
  let sr = 0;
  for (let i = from; i <= breakoutIdx; i++) sr += candles[i].h - candles[i].l;
  const avgR = sr / Math.max(1, breakoutIdx - from + 1) || height * 0.1;
  const m = 0.04 * avgR;
  const poke = Math.max(0.2 * avgR, 0.025 * height);
  const reflect = (v, lo, hi) => {
    if (lo > hi) return (lo + hi) / 2;
    if (v < lo) return Math.min(hi, lo + (lo - v) * 0.6);
    if (v > hi) return Math.max(lo, hi - (v - hi) * 0.6);
    return v;
  };

  // 1. Formation: closes (and opens) inside, wicks poke through a line by at most `poke`.
  for (let i = Math.max(0, from); i < breakoutIdx; i++) {
    const c = candles[i];
    let lo = -Infinity;
    let hi = Infinity;
    let wickLo = -Infinity;
    let wickHi = Infinity;
    if (dir > 0) {
      hi = level(i) - m;
      wickHi = level(i) + poke;
    } else {
      lo = level(i) + m;
      wickLo = level(i) - poke;
    }
    if (upperL) {
      hi = Math.min(hi, upperL(i) - m);
      lo = Math.max(lo, lowerL(i) + m);
      wickHi = Math.min(wickHi, upperL(i) + poke);
      wickLo = Math.max(wickLo, lowerL(i) - poke);
    }
    c.o = reflect(c.o, lo, hi);
    c.c = reflect(c.c, lo, hi);
    c.h = Math.max(Math.max(c.o, c.c), Math.min(c.h, wickHi));
    c.l = Math.min(Math.min(c.o, c.c), Math.max(c.l, wickLo));
  }

  // 2. Decisive breakout close.
  const b = candles[breakoutIdx];
  const minPen = Math.max(0.3 * avgR, 0.05 * height);
  const L = level(breakoutIdx);
  if ((b.c - L) * dir < minPen) {
    b.c = L + dir * minPen * rng.float(1, 1.4);
    if (dir > 0) b.h = Math.max(b.h, b.c + avgR * rng.float(0.03, 0.2));
    else b.l = Math.min(b.l, b.c - avgR * rng.float(0.03, 0.2));
    fix(b);
    const nx = candles[breakoutIdx + 1];
    if (nx) {
      nx.o = b.c;
      fix(nx);
    }
  }

  // 3. A successful breakout holds beyond the broken level (and, for ~10 bars, beyond the
  //    extended line when that is further out).
  if (ok) {
    for (let i = breakoutIdx + 1; i < n; i++) {
      const c = candles[i];
      let ref = lvl;
      if (i <= breakoutIdx + 10) ref = dir > 0 ? Math.max(lvl, level(i)) : Math.min(lvl, level(i));
      const lo = dir > 0 ? ref + m : -Infinity;
      const hi = dir > 0 ? Infinity : ref - m;
      c.o = reflect(c.o, lo, hi);
      c.c = reflect(c.c, lo, hi);
      fix(c);
    }
  }
}

/**
 * chartScenario(patternId, { seed, count = 110, start = 100, after = 20, outcome = 'success' })
 * The prior trend + formation + breakout fill the first count − after candles; `after`
 * follow-through candles show the outcome: 'success' heads for the measured-move target (often
 * with a retest of the broken level first); 'fail' breaks out briefly, then reverses back
 * through the pattern (a failed breakout / trap).
 * → { candles, patternStart, patternEnd, breakoutIdx, keyPoints: [{ idx, price, label }],
 *     neckline: { x1, y1, x2, y2 } | null, boundaries: { upper: {x1,y1,x2,y2}, lower: {…} } | null,
 *     target, height, level, bias, direction, outcome, reachedTarget, id, name }
 * Coordinates are candle idx / price. patternEnd = breakoutIdx − 1. `level` is the broken
 * line's price at the breakout candle.
 */
export function chartScenario(patternId, { seed, count = 110, start = 100, after = 20, outcome = 'success' } = {}) {
  const P = CHART_PATTERNS[patternId];
  if (!P) throw new Error(`Unknown chart pattern: ${patternId}`);
  const rng = makeRng(seed ?? 1);
  const shape = P.path(rng.fork('path'));
  const k = start / 100;
  const n = Math.max(40, Math.floor(count));
  const nAfter = clamp(Math.floor(after), 0, n - 30);
  const xb = (n - nAfter - 1) / (n - 1);
  const ok = outcome !== 'fail';
  const dir = shape.direction;
  const bo = shape.breakoutPoint;
  const pts = shape.points.map(([x, p]) => [x * xb, p * k]);

  // Approximate geometry in x-space to plan the follow-through.
  const lineX = (pair) => {
    const [a, b] = pair;
    const A = pts[a];
    const B = pts[b];
    if (a === b) return () => A[1];
    return (x) => A[1] + ((B[1] - A[1]) * (x - A[0])) / (B[0] - A[0]);
  };
  let levelX;
  let heightX;
  if (shape.neckline) {
    levelX = lineX(shape.neckline);
    const ext = shape.measure.extreme.map((i) => Math.abs(pts[i][1] - levelX(pts[i][0])));
    heightX = Math.max(...ext);
  } else {
    const upperX = lineX(shape.boundaries.upper);
    const lowerX = lineX(shape.boundaries.lower);
    levelX = dir > 0 ? upperX : lowerX;
    if (shape.measure.type === 'pole') heightX = Math.abs(pts[shape.measure.to][1] - pts[shape.measure.from][1]);
    else {
      const x0 = Math.min(pts[shape.boundaries.upper[0]][0], pts[shape.boundaries.lower[0]][0]);
      heightX = upperX(x0) - lowerX(x0);
    }
  }
  const B = pts[bo][1];
  const lvlB = levelX(pts[bo][0]);
  // The real breakout candle can come a little before the breakout waypoint; on a sloping line
  // that moves the measured target, so plan from the most distant level in that window.
  const lvlPrev = levelX(pts[bo - 1][0]);
  const lvlPlan = dir > 0 ? Math.max(lvlB, lvlPrev) : Math.min(lvlB, lvlPrev);
  const targetX = lvlPlan + dir * heightX;
  const afterPts = [];
  const xa = (f) => xb + f * (1 - xb);
  if (nAfter >= 4) {
    if (ok) {
      if (rng.chance(0.55) && nAfter >= 8) {
        // Retest: price comes back to the broken line and holds on the far side of it (the
        // wick touches the line; closes stay beyond — otherwise it would read as a failure).
        const f = rng.float(0.22, 0.32);
        const lineNow = levelX(xa(f));
        const ref = dir > 0 ? Math.max(lvlPlan, lineNow) : Math.min(lvlPlan, lineNow);
        afterPts.push([xa(f), ref + dir * heightX * rng.float(0.0, 0.05)]);
      }
      afterPts.push([xa(rng.float(0.75, 0.88)), targetX + dir * heightX * rng.float(0.06, 0.14)]);
      afterPts.push([1, targetX + dir * heightX * rng.float(-0.18, 0.12)]);
    } else {
      afterPts.push([xa(rng.float(0.1, 0.18)), B + dir * heightX * rng.float(0.08, 0.18)]);
      afterPts.push([xa(rng.float(0.45, 0.55)), levelX(xa(0.5)) - dir * heightX * rng.float(0.3, 0.45)]);
      afterPts.push([1, lvlB - dir * heightX * rng.float(0.8, 1.05)]);
    }
  } else if (nAfter > 0) {
    afterPts.push([1, B + (ok ? dir : -dir) * heightX * 0.25 * nAfter / 4]);
  }
  const all = [...pts, ...afterPts];
  const { candles: raw, anchors } = fromPath(all, { seed: rng.fork('candles').seed, count: n, noise: 0.35, wick: 0.6, exact: true, volume: true });
  const candles = raw;
  const A = (i) => anchors[i];

  // Real geometry from the generated candles.
  const lineIdx = (pair) => {
    const a = A(pair[0]);
    const b = A(pair[1]);
    if (pair[0] === pair[1]) return () => a.price;
    return (x) => a.price + ((b.price - a.price) * (x - a.idx)) / (b.idx - a.idx);
  };
  let level;
  let upperL = null;
  let lowerL = null;
  if (shape.neckline) level = lineIdx(shape.neckline);
  else {
    upperL = lineIdx(shape.boundaries.upper);
    lowerL = lineIdx(shape.boundaries.lower);
    level = dir > 0 ? upperL : lowerL;
  }
  const lastFormation = A(bo - 1).idx;
  let breakoutIdx = A(bo).idx;
  for (let i = lastFormation + 1; i <= A(bo).idx; i++) {
    const c = candles[i].c;
    if ((dir > 0 && c > level(i)) || (dir < 0 && c < level(i))) {
      breakoutIdx = i;
      break;
    }
  }
  const patternStart = A(shape.startPoint).idx;
  const patternEnd = Math.max(patternStart, breakoutIdx - 1);
  const keyStartIdx = A(shape.keyStart).idx;

  let height;
  if (shape.neckline) height = Math.max(...shape.measure.extreme.map((i) => Math.abs(A(i).price - level(A(i).idx))));
  else if (shape.measure.type === 'pole') height = Math.abs(A(shape.measure.to).price - A(shape.measure.from).price);
  else {
    const x0 = Math.min(A(shape.boundaries.upper[0]).idx, A(shape.boundaries.lower[0]).idx);
    height = upperL(x0) - lowerL(x0);
  }
  const lvl = level(breakoutIdx);
  const target = lvl + dir * height;

  tidyChart(candles, { rng: rng.fork('tidy'), from: keyStartIdx, breakoutIdx, dir, level, upperL, lowerL, lvl, height, ok });

  const seg = (fn, x1, x2) => ({ x1, y1: fn(x1), x2, y2: fn(x2) });
  const neckline = shape.neckline ? seg(level, keyStartIdx, breakoutIdx) : null;
  let boundaries = null;
  if (shape.boundaries) {
    const x0 = Math.min(A(shape.boundaries.upper[0]).idx, A(shape.boundaries.lower[0]).idx);
    boundaries = { upper: seg(upperL, x0, breakoutIdx), lower: seg(lowerL, x0, breakoutIdx) };
  }

  const keyPoints = [];
  Object.entries(shape.labels).forEach(([i, label]) => {
    const a = A(Number(i));
    if (label === 'Breakout') return;
    keyPoints.push({ idx: a.idx, price: a.price, label });
  });
  keyPoints.push({ idx: breakoutIdx, price: candles[breakoutIdx].c, label: 'Breakout' });
  keyPoints.sort((a, b) => a.idx - b.idx);

  // Volume: fades while the pattern forms, expands on a genuine breakout, stays weak on a trap.
  const span = Math.max(1, patternEnd - patternStart);
  for (let i = patternStart; i <= patternEnd; i++) candles[i].v = Math.max(1, Math.round(candles[i].v * (1 - 0.5 * ((i - patternStart) / span))));
  if (shape.measure.type === 'pole') {
    for (let i = A(shape.measure.from).idx + 1; i <= A(shape.measure.to).idx; i++) candles[i].v = Math.round(candles[i].v * 1.6);
  }
  const avgV = (a, b) => {
    const cs = candles.slice(Math.max(0, a), Math.max(a + 1, b));
    return cs.reduce((s, c) => s + c.v, 0) / Math.max(1, cs.length);
  };
  const vRecent = avgV(Math.max(patternStart, breakoutIdx - 10), breakoutIdx);
  const vForm = avgV(keyStartIdx, breakoutIdx); // the formation itself (a flag excludes its pole)
  const vrng = rng.fork('bo-volume');
  // Real breakout: 1.8–2.6× the recent average, still above average for two more bars.
  // Trap: the breakout bar is below the recent average — no conviction behind it.
  const boost = ok ? [vrng.float(1.8, 2.6), vrng.float(1.3, 1.7), vrng.float(1.05, 1.3)] : [vrng.float(0.6, 0.85), vrng.float(0.6, 0.9), vrng.float(0.7, 0.95)];
  boost.forEach((b, j) => {
    const c = candles[breakoutIdx + j];
    if (!c) return;
    const want = ok ? Math.max(vRecent * b, j === 0 ? vForm * 1.4 : 0) : vRecent * b;
    c.v = Math.max(1, Math.round(ok ? Math.max(c.v, want) : Math.min(c.v, want)));
  });

  let reachedTarget = false;
  for (let i = breakoutIdx; i < n; i++) {
    if ((dir > 0 && candles[i].h >= target) || (dir < 0 && candles[i].l <= target)) {
      reachedTarget = true;
      break;
    }
  }

  return {
    id: patternId,
    name: P.name,
    candles,
    patternStart,
    patternEnd,
    breakoutIdx,
    keyPoints,
    neckline,
    boundaries,
    target,
    height,
    level: lvl,
    bias: dir > 0 ? 'bullish' : 'bearish',
    direction: dir,
    outcome: ok ? 'success' : 'fail',
    reachedTarget,
  };
}
