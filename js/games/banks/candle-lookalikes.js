// Candle pattern names and lookalike explanations (Pattern Flash).
// Shared with the free Daily Challenge, so it ships on the public site (the paid game module
// itself can be served from private Storage; see docs/ACCOUNTS.md §10).
import { CANDLE_PATTERNS } from '../../core/patterns.js';

export function labelOf(kind) {
  return CANDLE_PATTERNS[kind]?.name || String(kind).replace(/-/g, ' ');
}

// Lookalike pairs: why the picked pattern is not the one on the chart. Keyed 'answer|pick'.
const SAME_SHAPE_LOW = 'Same shape (small body at the top, long lower wick) but different context:';
const SAME_SHAPE_HIGH = 'Same shape (small body at the bottom, long upper wick) but different context:';
const PAIRS = {
  'hammer|hanging-man': `${SAME_SHAPE_LOW} a hanging man prints after a rally, a hammer after a decline. Check the prior trend: this one follows a decline.`,
  'hanging-man|hammer': `${SAME_SHAPE_LOW} a hammer prints after a decline, a hanging man after a rally. Check the prior trend: this one follows a rally.`,
  'shooting-star|inverted-hammer': `${SAME_SHAPE_HIGH} an inverted hammer comes after a decline, a shooting star after a rally. This one follows a rally.`,
  'inverted-hammer|shooting-star': `${SAME_SHAPE_HIGH} a shooting star comes after a rally, an inverted hammer after a decline. This one follows a decline.`,
  'bullish-engulfing|bearish-engulfing': 'Bearish engulfing is a green candle swallowed by a larger RED one after a rally. Here a red candle is swallowed by a larger GREEN one after a decline: bullish.',
  'bearish-engulfing|bullish-engulfing': 'Bullish engulfing is a red candle swallowed by a larger GREEN one after a decline. Here a green candle is swallowed by a larger RED one after a rally: bearish.',
  'morning-star|evening-star': 'An evening star tops a rally (green, small star above, then red). This three-candle turn sits at the bottom of a decline (red, small star below, then green): a morning star.',
  'evening-star|morning-star': 'A morning star ends a decline (red, small star below, then green). This three-candle turn sits at the top of a rally (green, small star above, then red): an evening star.',
  'hammer|inverted-hammer': 'An inverted hammer has its long wick ABOVE a small body. Here the long wick is below the body: a hammer.',
  'inverted-hammer|hammer': 'A hammer has its long wick BELOW a small body. Here the long wick is above the body: an inverted hammer.',
  'hammer|shooting-star': 'A shooting star has a long UPPER wick and follows a rally. Here the long wick is below the body after a decline: a hammer.',
  'shooting-star|hammer': 'A hammer has a long LOWER wick and follows a decline. Here the long wick is above the body after a rally: a shooting star.',
  'hanging-man|shooting-star': 'Both follow a rally, but a shooting star’s long wick is ABOVE the body. Here it is below the body: a hanging man.',
  'shooting-star|hanging-man': 'Both follow a rally, but a hanging man’s long wick is BELOW the body. Here it is above the body: a shooting star.',
  'dragonfly-doji|hammer': 'A hammer has a small but real body. Here open and close are (almost) equal at the top of the range, with no body to speak of: a dragonfly doji.',
  'hammer|dragonfly-doji': 'A dragonfly doji has no real body: open and close sit together at the high. This candle has a small real body near the top: a hammer.',
  'dragonfly-doji|doji': 'A plain doji has wicks on both sides. Here open, close and high are together at the top of one long lower wick (a “T”): a dragonfly doji.',
  'doji|dragonfly-doji': 'A dragonfly doji has its open and close at the high, with only a lower wick. This one has wicks on both sides: a plain doji.',
  'doji|hammer': 'A hammer has a small real body and a long LOWER wick only. Here open and close are (almost) equal with wicks on both sides: a doji.',
  'doji|shooting-star': 'A shooting star has a small real body and a long UPPER wick only. Here open and close are (almost) equal with wicks on both sides: a doji.',
};

/** Patterns commonly confused with `kind` (its lookalikes), most confusable first. */
export function lookalikesOf(kind) {
  return Object.keys(PAIRS).filter((key) => key.startsWith(`${kind}|`)).map((key) => key.split('|')[1]);
}

/** Why `pick` is the wrong name for a candle pattern `answer` (specific for lookalikes). */
export function candleWhy(answer, pick) {
  if (!pick || pick === answer) return '';
  const pair = PAIRS[`${answer}|${pick}`];
  if (pair) return pair;
  const p = CANDLE_PATTERNS[pick];
  const a = CANDLE_PATTERNS[answer];
  if (!p || !a) return '';
  let why = `${p.name}: ${p.summary}`;
  if (p.candles !== a.candles) why += ` The pattern on the chart uses ${a.candles} candle${a.candles === 1 ? '' : 's'}, not ${p.candles}.`;
  else if (p.bias !== a.bias && a.bias !== 'neutral' && p.bias !== 'neutral') why += ` That one is ${p.bias}; this one is ${a.bias}.`;
  return why;
}
