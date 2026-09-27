// The Trade School — curriculum catalogue.
// PURE DATA (plus a few pure helpers). Must stay importable from node: no DOM, no side effects.

export const TIERS = [
  {
    id: 'beginner',
    title: 'Beginner',
    subtitle: 'Read the chart',
    blurb:
      'Learn what every candle is telling you, how trends and levels form, and how moving averages ' +
      'smooth out the noise. Six short units, each with a game to lock it in, then a capstone that puts it all together.',
  },
  {
    id: 'advanced',
    title: 'Advanced',
    subtitle: 'Plan the trade',
    blurb:
      'Chart patterns, Fibonacci, indicators, divergence and multiple timeframes, then the part most ' +
      'traders skip: confluence, timing and risk. Turn a read of the chart into a plan with an entry, a stop and a target.',
  },
];

// Units pair a lesson with its game(s). Order = recommended learning order.
export const UNITS = [
  { id: 'u-candle-anatomy', tier: 'beginner', title: 'Candlestick anatomy', lesson: 'candle-anatomy', games: ['candle-builder'] },
  { id: 'u-candle-patterns', tier: 'beginner', title: 'Candlestick patterns', lesson: 'candle-patterns', games: ['pattern-flash'] },
  { id: 'u-trends', tier: 'beginner', title: 'Trends & market structure', lesson: 'trends', games: ['trend-spotter'] },
  { id: 'u-support-resistance', tier: 'beginner', title: 'Support & resistance', lesson: 'support-resistance', games: ['level-hunter'] },
  { id: 'u-trendlines', tier: 'beginner', title: 'Trend lines & channels', lesson: 'trendlines', games: ['trendline-challenge'] },
  { id: 'u-moving-averages', tier: 'beginner', title: 'Moving averages', lesson: 'moving-averages', games: ['cross-catcher'] },
  { id: 'u-beginner-capstone', tier: 'beginner', title: 'Put it together', lesson: null, games: ['what-next'] },

  { id: 'u-chart-patterns', tier: 'advanced', title: 'Reversal & continuation chart patterns', lesson: 'chart-patterns', games: ['pattern-detective'] },
  { id: 'u-fibonacci', tier: 'advanced', title: 'Fibonacci retracements & extensions', lesson: 'fibonacci', games: ['fib-sniper'] },
  { id: 'u-indicators', tier: 'advanced', title: 'Indicators & divergence', lesson: 'indicators', games: ['divergence-detective'] },
  { id: 'u-multi-timeframe', tier: 'advanced', title: 'Multi-timeframe analysis', lesson: 'multi-timeframe', games: ['timeframe-stack'] },
  { id: 'u-confluence-risk', tier: 'advanced', title: 'Confluence, timing & risk', lesson: 'confluence-risk', games: ['risk-manager'] },
  { id: 'u-advanced-capstone', tier: 'advanced', title: 'Capstone', lesson: null, games: ['what-next', 'trade-simulator'] },
];

export const LESSONS = [
  {
    id: 'candle-anatomy', type: 'lesson', tier: 'beginner', minutes: 8,
    title: 'Anatomy of a candlestick',
    blurb: 'Open, high, low and close: what the body and the wicks record, and how a single candle tells the story of one trading period.',
    topics: ['OHLC', 'Body & wicks', 'Bullish vs bearish', 'Timeframes'],
    path: './lessons/candle-anatomy.js',
  },
  {
    id: 'candle-patterns', type: 'lesson', tier: 'beginner', minutes: 14,
    title: 'Candlestick patterns',
    blurb: 'Dojis, hammers, engulfing bars and stars: the one-, two- and three-candle patterns that hint at a turn, and why context decides whether they matter.',
    topics: ['Doji', 'Hammer & shooting star', 'Engulfing & harami', 'Morning & evening star', 'Confirmation'],
    path: './lessons/candle-patterns.js',
  },
  {
    id: 'trends', type: 'lesson', tier: 'beginner', minutes: 10,
    title: 'Trends & market structure',
    blurb: 'Higher highs and higher lows, lower highs and lower lows. Label the swings, tell a trend from a range, and spot when the structure breaks.',
    topics: ['Swing highs & lows', 'HH · HL · LH · LL', 'Ranges', 'Break of structure'],
    path: './lessons/trends.js',
  },
  {
    id: 'support-resistance', type: 'lesson', tier: 'beginner', minutes: 12,
    title: 'Support & resistance',
    blurb: 'Why price keeps reacting at the same prices, how to draw zones instead of razor-thin lines, and what happens when a level finally breaks.',
    topics: ['Zones', 'Touches', 'Breakouts & fakeouts', 'Role reversal', 'Round numbers'],
    path: './lessons/support-resistance.js',
  },
  {
    id: 'trendlines', type: 'lesson', tier: 'beginner', minutes: 10,
    title: 'Trend lines & channels',
    blurb: 'Connect swing lows in an uptrend and swing highs in a downtrend, add a parallel line to make a channel, and read what a trend-line break means.',
    topics: ['Drawing trend lines', 'Valid touches', 'Channels', 'Trend-line breaks'],
    path: './lessons/trendlines.js',
  },
  {
    id: 'moving-averages', type: 'lesson', tier: 'beginner', minutes: 12,
    title: 'Moving averages',
    blurb: 'SMA versus EMA, reading the slope, using an average as dynamic support, and what golden and death crosses really tell you (and when they lie).',
    topics: ['SMA vs EMA', 'Slope', 'Dynamic support', 'Golden & death cross', 'Lag'],
    path: './lessons/moving-averages.js',
  },
  {
    id: 'chart-patterns', type: 'lesson', tier: 'advanced', minutes: 16,
    title: 'Reversal & continuation patterns',
    blurb: 'Head and shoulders, double tops and bottoms, triangles, wedges, flags and cup-and-handle: how each forms, where the breakout is, and how to measure a target.',
    topics: ['Head & shoulders', 'Double & triple tops', 'Triangles & wedges', 'Flags', 'Measured moves'],
    path: './lessons/chart-patterns.js',
  },
  {
    id: 'fibonacci', type: 'lesson', tier: 'advanced', minutes: 12,
    title: 'Fibonacci retracements & extensions',
    blurb: 'Anchor the tool on a clean swing, watch the 38.2–61.8% pullback zone, and project extension targets for where a move may run.',
    topics: ['Anchoring a swing', 'Retracement levels', 'The golden zone', 'Extensions', 'Confluence'],
    path: './lessons/fibonacci.js',
  },
  {
    id: 'indicators', type: 'lesson', tier: 'advanced', minutes: 16,
    title: 'Indicators & divergence',
    blurb: 'RSI, MACD, Bollinger Bands and volume: what each one measures, the settings that matter, and how divergence warns that a move is running out of steam.',
    topics: ['RSI', 'MACD', 'Bollinger Bands', 'Volume', 'Divergence'],
    path: './lessons/indicators.js',
  },
  {
    id: 'multi-timeframe', type: 'lesson', tier: 'advanced', minutes: 12,
    title: 'Multi-timeframe analysis',
    blurb: 'Use the higher timeframe for direction, the middle one for the setup and the lower one for timing, and only act when they line up.',
    topics: ['Top-down analysis', 'Timeframe ratios', 'Alignment', 'Entry timing'],
    path: './lessons/multi-timeframe.js',
  },
  {
    id: 'confluence-risk', type: 'lesson', tier: 'advanced', minutes: 15,
    title: 'Confluence, timing & risk',
    blurb: 'Stack independent reasons for a trade, choose the moment to act, then size the position so one loss never hurts much. Stops, targets, R-multiples and expectancy.',
    topics: ['Confluence', 'Entry triggers', 'Stop placement', 'Position sizing', 'R-multiples & expectancy'],
    path: './lessons/confluence-risk.js',
  },
];

export const GAMES = [
  {
    id: 'candle-builder', type: 'game', tier: 'beginner', minutes: 6, kind: 'draw',
    title: 'Candle Builder',
    blurb: 'Drag open, high, low and close to build the candle a story describes — then read candles back into stories.',
    skills: ['OHLC', 'Bodies & wicks'],
    path: './games/candle-builder.js',
  },
  {
    id: 'pattern-flash', type: 'game', tier: 'beginner', minutes: 5, kind: 'quiz',
    title: 'Pattern Flash',
    blurb: 'Timed rounds: name the candlestick pattern before the clock runs out. Streaks multiply your score.',
    skills: ['Candlestick patterns', 'Speed reading'],
    path: './games/pattern-flash.js',
  },
  {
    id: 'trend-spotter', type: 'game', tier: 'beginner', minutes: 6, kind: 'quiz',
    title: 'Trend Spotter',
    blurb: 'Up, down or sideways? Call the trend fast, then tag the swing highs and lows (HH, HL, LH, LL).',
    skills: ['Trend direction', 'Swing labels'],
    path: './games/trend-spotter.js',
  },
  {
    id: 'level-hunter', type: 'game', tier: 'beginner', minutes: 7, kind: 'draw',
    title: 'Level Hunter',
    blurb: 'Place support and resistance lines where price really turned. Then call bounce or break.',
    skills: ['Support', 'Resistance', 'Breakouts'],
    path: './games/level-hunter.js',
  },
  {
    id: 'trendline-challenge', type: 'game', tier: 'beginner', minutes: 6, kind: 'draw',
    title: 'Trendline Challenge',
    blurb: 'Draw the trend line that best connects the swings. Earn points for clean touches, lose them for cutting candles.',
    skills: ['Trend lines', 'Channels'],
    path: './games/trendline-challenge.js',
  },
  {
    id: 'cross-catcher', type: 'game', tier: 'beginner', minutes: 5, kind: 'simulation',
    title: 'Cross Catcher',
    blurb: 'A chart replays bar by bar. Hit the button when the fast MA crosses the slow MA — and call golden or death cross.',
    skills: ['Moving averages', 'Crossovers'],
    path: './games/cross-catcher.js',
  },
  {
    id: 'what-next', type: 'game', tier: 'both', minutes: 8, kind: 'predict',
    title: 'What Happens Next?',
    blurb: 'The chart freezes at a decision point. Call up, down or sideways (or long/short/wait in Advanced) and watch the reveal.',
    skills: ['Reading context', 'Prediction', 'Trade decisions'],
    path: './games/what-next.js',
  },
  {
    id: 'pattern-detective', type: 'game', tier: 'advanced', minutes: 8, kind: 'draw',
    title: 'Pattern Detective',
    blurb: 'Identify head & shoulders, double tops, wedges, flags and more. Then mark the neckline and the target.',
    skills: ['Chart patterns', 'Necklines', 'Measured targets'],
    path: './games/pattern-detective.js',
  },
  {
    id: 'fib-sniper', type: 'game', tier: 'advanced', minutes: 7, kind: 'draw',
    title: 'Fib Sniper',
    blurb: 'Anchor the Fibonacci tool on the right swing, then pick the level where price will bounce.',
    skills: ['Fibonacci', 'Swing anchoring', 'Confluence'],
    path: './games/fib-sniper.js',
  },
  {
    id: 'divergence-detective', type: 'game', tier: 'advanced', minutes: 7, kind: 'quiz',
    title: 'Divergence Detective',
    blurb: 'Compare price with RSI and MACD. Spot bullish and bearish divergence before the turn.',
    skills: ['RSI', 'MACD', 'Divergence'],
    path: './games/divergence-detective.js',
  },
  {
    id: 'timeframe-stack', type: 'game', tier: 'advanced', minutes: 8, kind: 'predict',
    title: 'Timeframe Stack',
    blurb: 'Read weekly, daily and hourly charts together. Trade only when the timeframes agree.',
    skills: ['Multi-timeframe', 'Trend alignment'],
    path: './games/timeframe-stack.js',
  },
  {
    id: 'risk-manager', type: 'game', tier: 'advanced', minutes: 8, kind: 'calc',
    title: 'Risk Manager',
    blurb: 'Size positions, place stops and targets, and score setups for confluence. Protect the account.',
    skills: ['Position sizing', 'Stops & targets', 'R-multiples'],
    path: './games/risk-manager.js',
  },
  {
    id: 'trade-simulator', type: 'game', tier: 'advanced', minutes: 12, kind: 'simulation',
    title: 'Trade Simulator',
    blurb: 'Replay a market bar by bar with real tools. Buy, sell, set stops and targets, and grade your trading.',
    skills: ['Execution', 'Trade management', 'Journaling'],
    path: './games/trade-simulator.js',
  },
];

const ACE_ICONS = {
  'candle-builder': 'candle',
  'pattern-flash': 'spark',
  'trend-spotter': 'trend-up',
  'level-hunter': 'ruler',
  'trendline-challenge': 'trendline',
  'cross-catcher': 'cross',
  'what-next': 'eye',
  'pattern-detective': 'search',
  'fib-sniper': 'target',
  'divergence-detective': 'chart',
  'timeframe-stack': 'layers',
  'risk-manager': 'shield',
  'trade-simulator': 'trophy',
};

export const BADGES = [
  { id: 'first-lesson', title: 'First Candle', description: 'Finish your first lesson.', icon: 'book' },
  { id: 'first-game', title: 'Opening Bell', description: 'Finish your first game.', icon: 'play' },
  { id: 'beginner-graduate', title: 'Chart Reader', description: 'Complete every Beginner lesson.', icon: 'medal' },
  { id: 'advanced-graduate', title: 'Trade Planner', description: 'Complete every Advanced lesson.', icon: 'trophy' },
  { id: 'streak-10', title: 'On a Run', description: 'Answer 10 in a row correctly in one game.', icon: 'flame' },
  { id: 'perfect-score', title: 'Flawless', description: 'Finish any game without a single miss.', icon: 'star-fill' },
  { id: 'xp-1000', title: 'Four Figures', description: 'Earn 1,000 XP.', icon: 'bolt' },
  { id: 'xp-4000', title: 'Market Wizard', description: 'Earn 4,000 XP and reach the top level.', icon: 'crown' },
  { id: 'explorer', title: 'Explorer', description: 'Play every game in the arcade at least once.', icon: 'compass' },
  ...GAMES.map((g) => ({
    id: `${g.id}-ace`,
    title: `${g.title} Ace`,
    description: `Earn 3 stars in ${g.title}${/[.?!]$/.test(g.title) ? '' : '.'}`,
    icon: ACE_ICONS[g.id] || 'star',
    game: g.id,
  })),
];

// ---------------------------------------------------------------- helpers (pure)

/** Lesson or game by id (has .type = 'lesson' | 'game'), or null. */
export function findEntry(id) {
  return LESSONS.find((l) => l.id === id) || GAMES.find((g) => g.id === id) || null;
}

export function findTier(id) {
  return TIERS.find((t) => t.id === id) || null;
}

export function findBadge(id) {
  return BADGES.find((b) => b.id === id) || null;
}

/** Units of a tier, in order. */
export function unitsOf(tier) {
  return UNITS.filter((u) => u.tier === tier);
}

/** The unit containing a lesson/game id. For 'both'-tier games pass the preferred tier. */
export function unitOf(id, tier = null) {
  const matches = UNITS.filter((u) => u.lesson === id || u.games.includes(id));
  if (!matches.length) return null;
  return (tier && matches.find((u) => u.tier === tier)) || matches[0];
}

/** Ordered learning path of a tier: [{ type, id, unit }] (lesson first, then its games). */
export function learningPath(tier) {
  const out = [];
  for (const u of unitsOf(tier)) {
    if (u.lesson) out.push({ type: 'lesson', id: u.lesson, unit: u.id });
    for (const g of u.games) out.push({ type: 'game', id: g, unit: u.id });
  }
  return out;
}

/** The item after `id` in the recommended order (continues from Beginner into Advanced). */
export function nextItem(id, tier = null) {
  const entry = findEntry(id);
  if (!entry) return null;
  const t = tier || (entry.tier === 'both' ? 'beginner' : entry.tier);
  const path = learningPath(t);
  const i = path.findIndex((p) => p.id === id);
  if (i >= 0 && i < path.length - 1) return path[i + 1];
  if (t === 'beginner') return learningPath('advanced')[0] || null;
  return null;
}

/** Route hash (without '#') for a lesson or game id. */
export function hashFor(id) {
  const e = findEntry(id);
  if (!e) return 'home';
  return (e.type === 'lesson' ? 'l.' : 'g.') + id;
}

/** Lessons / games shown under a tier ('both'-tier games appear under both). */
export function lessonsOf(tier) {
  return LESSONS.filter((l) => l.tier === tier);
}
export function gamesOf(tier) {
  return GAMES.filter((g) => g.tier === tier || g.tier === 'both');
}
