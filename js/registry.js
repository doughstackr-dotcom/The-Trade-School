// The Trade School — curriculum catalogue.
// PURE DATA (plus a few pure helpers). Must stay importable from node: no DOM, no side effects.
import { tokenToPath } from './core/routes.js';

export const TIERS = [
  {
    id: 'beginner',
    title: 'Beginner',
    subtitle: 'Read the chart',
    blurb:
      'What every candle is telling you, how much to risk on a trade, how trends and levels form, how ' +
      'moving averages and volume confirm a move, and how orders fill. Ten short units, each with a game to lock it in, then a capstone that puts it all together.',
  },
  {
    id: 'advanced',
    title: 'Advanced',
    subtitle: 'Plan the trade',
    blurb:
      'Chart patterns, Fibonacci, indicators, multiple timeframes and breakouts, then the parts most traders ' +
      'skip: confluence, risk and psychology. Turn a read of the chart into a plan with an entry, a stop and a target, and stick to it.',
  },
];

// Units pair a lesson with its game(s). Order = recommended learning order.
export const UNITS = [
  { id: 'u-candle-anatomy', tier: 'beginner', title: 'Candlestick anatomy', lesson: 'candle-anatomy', games: ['candle-builder'] },
  { id: 'u-chart-basics', tier: 'beginner', title: 'Chart types, scales & timeframes', lesson: 'chart-basics', games: ['chart-match'] },
  // Risk sits before any pattern/setup lesson so sizing is a habit before learners meet trade ideas.
  // Risk Manager stays an Advanced-tier game (plan access unchanged); it is paired here as well.
  { id: 'u-risk-basics', tier: 'beginner', title: 'Risk & position sizing', lesson: 'risk-basics', games: ['risk-manager'] },
  { id: 'u-candle-patterns', tier: 'beginner', title: 'Candlestick patterns', lesson: 'candle-patterns', games: ['pattern-flash'] },
  { id: 'u-trends', tier: 'beginner', title: 'Trends & market structure', lesson: 'trends', games: ['trend-spotter'] },
  { id: 'u-support-resistance', tier: 'beginner', title: 'Support & resistance', lesson: 'support-resistance', games: ['level-hunter'] },
  { id: 'u-trendlines', tier: 'beginner', title: 'Trend lines & channels', lesson: 'trendlines', games: ['trendline-challenge'] },
  { id: 'u-moving-averages', tier: 'beginner', title: 'Moving averages', lesson: 'moving-averages', games: ['cross-catcher'] },
  { id: 'u-volume', tier: 'beginner', title: 'Volume', lesson: 'volume', games: ['volume-verdict'] },
  { id: 'u-markets-orders', tier: 'beginner', title: 'Markets, orders & the spread', lesson: 'markets-orders', games: ['order-desk'] },
  { id: 'u-beginner-capstone', tier: 'beginner', title: 'Put it together', lesson: null, games: ['what-next', 'setup-swipe', 'daily-challenge'] },

  { id: 'u-chart-patterns', tier: 'advanced', title: 'Reversal & continuation chart patterns', lesson: 'chart-patterns', games: ['pattern-detective'] },
  { id: 'u-fibonacci', tier: 'advanced', title: 'Fibonacci retracements & extensions', lesson: 'fibonacci', games: ['fib-sniper'] },
  { id: 'u-indicators', tier: 'advanced', title: 'Indicators & divergence', lesson: 'indicators', games: ['divergence-detective'] },
  { id: 'u-multi-timeframe', tier: 'advanced', title: 'Multi-timeframe analysis', lesson: 'multi-timeframe', games: ['timeframe-stack'] },
  { id: 'u-breakouts', tier: 'advanced', title: 'Breakouts, fakeouts & liquidity', lesson: 'breakouts', games: ['trap-or-trade'] },
  { id: 'u-confluence-risk', tier: 'advanced', title: 'Confluence, timing & risk', lesson: 'confluence-risk', games: ['risk-manager'] },
  { id: 'u-psychology', tier: 'advanced', title: 'Trading psychology & your plan', lesson: 'psychology', games: ['tilt-control'] },
  { id: 'u-advanced-capstone', tier: 'advanced', title: 'Capstone', lesson: null, games: ['what-next', 'trade-simulator', 'live-predict'] },
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
    id: 'chart-basics', type: 'lesson', tier: 'beginner', minutes: 10,
    title: 'Chart types, scales and timeframes',
    blurb: 'Line, bar and candlestick charts, linear versus log scale, and how the same market looks on a daily and a weekly chart. Pick the right view before you read it.',
    topics: ['Line vs bar vs candle', 'Linear vs log scale', 'Timeframes', 'Volume bars'],
    path: './lessons/chart-basics.js',
  },
  {
    id: 'risk-basics', type: 'lesson', tier: 'beginner', minutes: 14,
    title: 'Risk & position sizing',
    blurb: 'Decide what you can lose before you look for trades: the 1% guideline, sizing a position from your stop, R-multiples, expectancy, drawdown math, leverage and margin, and what spreads and fees really cost.',
    topics: ['Risk per trade', 'Position sizing', 'R-multiples & expectancy', 'Drawdown & risk of ruin', 'Leverage & margin', 'Trading costs'],
    path: './lessons/risk-basics.js',
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
    id: 'volume', type: 'lesson', tier: 'beginner', minutes: 10,
    title: 'Volume: the fuel behind moves',
    blurb: 'Volume shows how much conviction sits behind a move. Read volume spikes, dry-ups and climaxes, and learn why breakouts on thin volume so often fail.',
    topics: ['Reading volume bars', 'Confirmation', 'Climax & exhaustion', 'Breakout volume'],
    path: './lessons/volume.js',
  },
  {
    id: 'markets-orders', type: 'lesson', tier: 'beginner', minutes: 10,
    title: 'Markets, orders and the spread',
    blurb: 'What a market is, who is on the other side of your trade, and how market, limit, stop, stop-limit and trailing orders fill. Read the bid, the ask and the spread, and know what a gap does to a stop, before you ever click Buy.',
    topics: ['Exchanges & brokers', 'Bid, ask & spread', 'Market & limit orders', 'Stop, stop-limit & trailing stops', 'Time in force', 'Gaps & slippage'],
    path: './lessons/markets-orders.js',
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
    id: 'breakouts', type: 'lesson', tier: 'advanced', minutes: 14,
    title: 'Breakouts, fakeouts and liquidity',
    blurb: 'Why levels break, why so many first breaks fail, and where the stop orders sit that fuel both. Trade the confirmed break, fade the trap, or wait for the retest.',
    topics: ['Clean breakouts', 'Fakeouts & traps', 'Stop clusters & liquidity', 'The retest', 'Volume confirmation'],
    path: './lessons/breakouts.js',
  },
  {
    id: 'confluence-risk', type: 'lesson', tier: 'advanced', minutes: 15,
    title: 'Confluence, timing & risk',
    blurb: 'Stack independent reasons for a trade, choose the moment to act, place stops with structure and ATR, and test an idea (backtest, forward test) before you trust it. Builds on Beginner risk & sizing.',
    topics: ['Confluence', 'Entry triggers', 'ATR-based stops', 'Sizing recap', 'Backtesting & its pitfalls'],
    path: './lessons/confluence-risk.js',
  },
  {
    id: 'psychology', type: 'lesson', tier: 'advanced', minutes: 12,
    title: 'Trading psychology and your plan',
    blurb: 'Fear, greed, revenge trading and tilt: the mistakes that cost more than any bad setup. Write a trading plan you will actually follow, keep a trading journal, and review your trades honestly.',
    topics: ['Fear & greed', 'Tilt & revenge trading', 'Trading plan', 'Trading journal & reviews', 'Process over outcome'],
    path: './lessons/psychology.js',
  },
];

// Play styles every game can offer (ARCHITECTURE §12.1) and chart sources (§12.2).
const ALL_STYLES = ['practice', 'arcade', 'survival'];
const TEXTBOOK = ['textbook'];
const WITH_REAL = ['textbook', 'real'];

// kind: 'quiz' | 'draw' | 'predict' | 'simulation' | 'calc' | 'memory' | 'swipe' | 'story' | 'live'
// styles: play styles offered on the intro (GameShell default = entry.styles)
// sources: chart sources offered on the intro (GameShell default = entry.sources)
export const GAMES = [
  {
    id: 'order-desk', type: 'game', tier: 'beginner', minutes: 6, kind: 'simulation',
    title: 'Order Desk',
    blurb: 'Fill client orders on a live price ladder. Pick market, limit or stop and watch the fill.',
    skills: ['Market, limit & stop', 'Bid/ask spread', 'Slippage'],
    styles: ALL_STYLES, sources: TEXTBOOK,
    path: './games/order-desk.js',
  },
  {
    id: 'candle-builder', type: 'game', tier: 'beginner', minutes: 6, kind: 'draw',
    title: 'Candle Builder',
    blurb: 'Drag open, high, low and close to build the candle a story describes — then read candles back into stories.',
    skills: ['OHLC', 'Bodies & wicks'],
    styles: ALL_STYLES, sources: TEXTBOOK,
    path: './games/candle-builder.js',
  },
  {
    id: 'chart-match', type: 'game', tier: 'beginner', minutes: 5, kind: 'memory',
    title: 'Chart Match',
    blurb: 'Flip cards to match candles, chart types and patterns to their descriptions. Fewer flips, higher score.',
    skills: ['Chart types', 'Candles', 'Pattern names'],
    styles: ALL_STYLES, sources: TEXTBOOK,
    path: './games/chart-match.js',
  },
  {
    id: 'pattern-flash', type: 'game', tier: 'beginner', minutes: 5, kind: 'quiz',
    title: 'Pattern Flash',
    blurb: 'Timed rounds: name the candlestick pattern before the clock runs out. Streaks multiply your score.',
    skills: ['Candlestick patterns', 'Speed reading'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/pattern-flash.js',
  },
  {
    id: 'trend-spotter', type: 'game', tier: 'beginner', minutes: 6, kind: 'quiz',
    title: 'Trend Spotter',
    blurb: 'Up, down or sideways? Call the trend fast, then tag the swing highs and lows (HH, HL, LH, LL).',
    skills: ['Trend direction', 'Swing labels'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/trend-spotter.js',
  },
  {
    id: 'level-hunter', type: 'game', tier: 'beginner', minutes: 7, kind: 'draw',
    title: 'Level Hunter',
    blurb: 'Place support and resistance lines where price really turned. Then call bounce or break.',
    skills: ['Support', 'Resistance', 'Breakouts'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/level-hunter.js',
  },
  {
    id: 'trendline-challenge', type: 'game', tier: 'beginner', minutes: 6, kind: 'draw',
    title: 'Trendline Challenge',
    blurb: 'Draw the trend line that best connects the swings. Earn points for clean touches, lose them for cutting candles.',
    skills: ['Trend lines', 'Channels'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/trendline-challenge.js',
  },
  {
    id: 'cross-catcher', type: 'game', tier: 'beginner', minutes: 5, kind: 'simulation',
    title: 'Cross Catcher',
    blurb: 'A chart replays bar by bar. Hit the button when the fast MA crosses the slow MA — and call golden or death cross.',
    skills: ['Moving averages', 'Crossovers'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/cross-catcher.js',
  },
  {
    id: 'volume-verdict', type: 'game', tier: 'beginner', minutes: 5, kind: 'swipe',
    title: 'Volume Verdict',
    blurb: 'Swipe right if volume confirms the move, left if it smells like a trap.',
    skills: ['Volume', 'Confirmation', 'Traps'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/volume-verdict.js',
  },
  {
    id: 'what-next', type: 'game', tier: 'both', minutes: 8, kind: 'predict',
    title: 'What Happens Next?',
    blurb: 'The chart freezes at a decision point. Call up, down or sideways (or long/short/wait in Advanced) and watch the reveal.',
    skills: ['Reading context', 'Prediction', 'Trade decisions'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/what-next.js',
  },
  {
    id: 'setup-swipe', type: 'game', tier: 'both', minutes: 5, kind: 'swipe',
    title: 'Setup Swipe',
    blurb: 'Rapid-fire setups: swipe Take or Skip. Discipline means skipping the weak ones.',
    skills: ['Setup quality', 'Discipline', 'Checklists'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/setup-swipe.js',
  },
  {
    id: 'daily-challenge', type: 'game', tier: 'both', minutes: 4, kind: 'quiz',
    title: 'Daily Challenge',
    blurb: 'Five fresh questions every day, the same for everyone. Keep your streak alive.',
    skills: ['Mixed review', 'Consistency'],
    styles: ['arcade'], sources: TEXTBOOK, daily: true,
    path: './games/daily-challenge.js',
  },
  {
    id: 'pattern-detective', type: 'game', tier: 'advanced', minutes: 8, kind: 'draw',
    title: 'Pattern Detective',
    blurb: 'Identify head & shoulders, double tops, wedges, flags and more. Then mark the neckline and the target.',
    skills: ['Chart patterns', 'Necklines', 'Measured targets'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/pattern-detective.js',
  },
  {
    id: 'fib-sniper', type: 'game', tier: 'advanced', minutes: 7, kind: 'draw',
    title: 'Fib Sniper',
    blurb: 'Anchor the Fibonacci tool on the right swing, then pick the level where price will bounce.',
    skills: ['Fibonacci', 'Swing anchoring', 'Confluence'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/fib-sniper.js',
  },
  {
    id: 'divergence-detective', type: 'game', tier: 'advanced', minutes: 7, kind: 'quiz',
    title: 'Divergence Detective',
    blurb: 'Compare price with RSI. Spot bullish and bearish divergence before the turn — and when momentum simply confirms.',
    skills: ['RSI', 'Divergence', 'Confirmation'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/divergence-detective.js',
  },
  {
    id: 'timeframe-stack', type: 'game', tier: 'advanced', minutes: 8, kind: 'predict',
    title: 'Timeframe Stack',
    blurb: 'Read weekly, daily and hourly charts together. Trade only when the timeframes agree.',
    skills: ['Multi-timeframe', 'Trend alignment'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/timeframe-stack.js',
  },
  {
    id: 'trap-or-trade', type: 'game', tier: 'advanced', minutes: 7, kind: 'predict',
    title: 'Trap or Trade',
    blurb: 'Price just broke the level. Trade the breakout, fade the trap, or wait for the retest?',
    skills: ['Breakouts', 'Fakeouts', 'Retests'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/trap-or-trade.js',
  },
  {
    id: 'risk-manager', type: 'game', tier: 'both', minutes: 8, kind: 'calc',
    title: 'Risk Manager',
    blurb: 'Size positions, place stops and targets, and score setups for confluence. Protect the account.',
    skills: ['Position sizing', 'Stops & targets', 'R-multiples'],
    styles: ALL_STYLES, sources: WITH_REAL,
    path: './games/risk-manager.js',
  },
  {
    id: 'tilt-control', type: 'game', tier: 'advanced', minutes: 8, kind: 'story',
    title: 'Tilt Control',
    blurb: 'A trading day full of temptations. Stick to your plan and keep your head when the market tests you.',
    skills: ['Trading plan', 'Discipline', 'Emotions'],
    styles: ['practice', 'arcade'], sources: TEXTBOOK,
    path: './games/tilt-control.js',
  },
  {
    id: 'trade-simulator', type: 'game', tier: 'advanced', minutes: 12, kind: 'simulation',
    title: 'Trade Simulator',
    blurb: 'Replay a market bar by bar with real tools. Buy, sell, set stops and targets, and grade your trading.',
    skills: ['Execution', 'Trade management', 'Journaling'],
    styles: ['practice', 'arcade'], sources: WITH_REAL,
    path: './games/trade-simulator.js',
  },
  {
    id: 'live-predict', type: 'game', tier: 'both', minutes: 6, kind: 'live',
    title: 'Live Predict',
    blurb: 'Real prices, right now. Read the live chart, make your call and watch the candle close.',
    skills: ['Live reading', 'Prediction', 'Real markets'],
    styles: ALL_STYLES, sources: ['real'],
    path: './games/live-predict.js',
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
  'order-desk': 'layers',
  'chart-match': 'grid',
  'volume-verdict': 'chart',
  'setup-swipe': 'check',
  'daily-challenge': 'flame',
  'trap-or-trade': 'flag',
  'tilt-control': 'compass',
  'live-predict': 'bolt',
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
  { id: 'survivor', title: 'Survivor', description: 'Survive 15 rounds in a Survival run.', icon: 'shield' },
  { id: 'play-your-way', title: 'Play Your Way', description: 'Finish one game in Practice, Arcade and Survival.', icon: 'grid' },
  { id: 'daily-streak-7', title: 'Habit Former', description: 'Complete the Daily Challenge seven days in a row.', icon: 'flame' },
  { id: 'dashboard-visit', title: 'Floor Manager', description: 'Open the Dashboard and survey the curriculum.', icon: 'grid' },
  { id: 'first-real-chart', title: 'Tape Reader', description: 'Finish a round on a real-market chart.', icon: 'eye' },
  { id: 'streak-keeper', title: 'Steady Hand', description: 'Keep a best run streak of 5 or more.', icon: 'flame' },

  ...GAMES.map((g) => ({
    id: `${g.id}-ace`,
    title: `${g.title} Ace`,
    description: `Earn 3 stars in ${g.title}${/[.?!]$/.test(g.title) ? '' : '.'}`,
    icon: ACE_ICONS[g.id] || 'star',
    game: g.id,
  })),
];

// ---------------------------------------------------------------- play styles, sources, kinds

/** Play styles (§12.1). `icon` is a ui.js icon name, except 'heart' (GameShell draws it: styleIcon()). */
export const STYLES = [
  { id: 'practice', label: 'Practice', short: 'No clock, hints and retries', icon: 'book',
    blurb: 'No clock. Hints and retries. Learn at your own pace (half XP).' },
  { id: 'arcade', label: 'Arcade', short: 'Rounds, a clock and streaks', icon: 'bolt',
    blurb: 'Fixed rounds, a clock and streak multipliers. Chase three stars.' },
  { id: 'survival', label: 'Survival', short: 'Three lives, rising difficulty', icon: 'heart',
    blurb: 'Three lives. Rounds keep coming and get harder until you run out.' },
];

/** Practice difficulty picker → game.difficulty. (Not the XP levels: those are store.LEVELS.) */
export const DIFFICULTY_LEVELS = [
  { id: 'easy', label: 'Easy', value: 0.2 },
  { id: 'normal', label: 'Normal', value: 0.5 },
  { id: 'hard', label: 'Hard', value: 0.85 },
];

/** Chart sources (§12.2). */
export const SOURCES = [
  { id: 'textbook', label: 'Textbook', blurb: 'Clean generated examples of each setup.' },
  { id: 'real', label: 'Real market', blurb: 'Historical charts from real markets. The symbol and date stay hidden until you answer.' },
];

/** Game kinds with a label and a ui.js icon name. */
export const GAME_KINDS = [
  { id: 'quiz', label: 'Quiz', icon: 'grid' },
  { id: 'draw', label: 'Draw', icon: 'trendline' },
  { id: 'predict', label: 'Predict', icon: 'eye' },
  { id: 'memory', label: 'Memory', icon: 'layers' },
  { id: 'swipe', label: 'Swipe', icon: 'arrow-right' },
  { id: 'story', label: 'Story', icon: 'book' },
  { id: 'simulation', label: 'Simulation', icon: 'play' },
  { id: 'calc', label: 'Calculate', icon: 'ruler' },
  { id: 'live', label: 'Live', icon: 'bolt' },
];

/** Arcade filter chips (home). 'calc' games sit under Simulation. */
export const ARCADE_FILTERS = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'quiz', label: 'Quiz', kinds: ['quiz'] },
  { id: 'draw', label: 'Draw', kinds: ['draw'] },
  { id: 'predict', label: 'Predict', kinds: ['predict'] },
  { id: 'memory', label: 'Memory', kinds: ['memory'] },
  { id: 'swipe', label: 'Swipe', kinds: ['swipe'] },
  { id: 'story', label: 'Story', kinds: ['story'] },
  { id: 'simulation', label: 'Simulation', kinds: ['simulation', 'calc'] },
  { id: 'live', label: 'Live', kinds: ['live'] },
];

/** Stand-alone pages (routes: /playbook, /playbook/<setupId>, /live, /platforms; /affiliate aliases to platforms). */
export const PAGES = [
  { id: 'games', title: 'Games', hash: 'games', param: false, path: './pages/games.js',
    blurb: 'The arcade: practice, arcade and survival modes across every skill game. One free daily hook; the rest unlock with a plan.' },
  { id: 'playbook', title: 'Setup Playbook', hash: 'playbook', param: true, path: './pages/playbook.js',
    blurb: 'Exact, rule-based setups: checklist, entry, stop and target, animated walk-throughs and real examples.' },
  { id: 'live', title: 'Live Market Lab', hash: 'live', param: false, path: './pages/live.js',
    blurb: 'A live chart with indicator toggles and a plain-English read of trend, levels and patterns.' },
  { id: 'platforms', title: 'Platforms', hash: 'platforms', param: false, path: './pages/affiliate.js',
    blurb: 'Trading platforms and tools we partner with — affiliate / referral links with clear placeholders until filled.' },
];

/** Developer-only entries: routable by id (findEntry) but not part of the curriculum lists. */
export const DEV_ENTRIES = [
  {
    id: '_kit-demo', type: 'lesson', tier: 'beginner', minutes: 5, dev: true,
    title: 'Lesson kit demo',
    blurb: 'Developer preview of the LessonShell media helpers (localhost only).',
    topics: ['storyStep', 'realExampleStep', 'checklistStep', 'compareStep'],
    path: './lessons/_kit-demo.js',
  },
];

// ---------------------------------------------------------------- helpers (pure)

/** Lesson or game by id (has .type = 'lesson' | 'game'), or null. */
export function findEntry(id) {
  return LESSONS.find((l) => l.id === id) || GAMES.find((g) => g.id === id) || DEV_ENTRIES.find((d) => d.id === id) || null;
}

export function findStyle(id) {
  return STYLES.find((s) => s.id === id) || null;
}

export function findKind(id) {
  return GAME_KINDS.find((k) => k.id === id) || null;
}

export function findPage(id) {
  return PAGES.find((p) => p.id === id) || null;
}

/** Play styles a game offers (entry.styles, default all three). */
export function stylesOf(id) {
  const e = typeof id === 'string' ? findEntry(id) : id;
  return e?.styles?.length ? e.styles : STYLES.map((s) => s.id);
}

/** Chart sources a game offers (entry.sources, default ['textbook']). */
export function sourcesOf(id) {
  const e = typeof id === 'string' ? findEntry(id) : id;
  return e?.sources?.length ? e.sources : ['textbook'];
}

/** Tiers whose units contain a lesson/game id (a 'both' game may sit in one tier's units only). */
export function tiersOf(id) {
  return [...new Set(UNITS.filter((u) => u.lesson === id || u.games.includes(id)).map((u) => u.tier))];
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
  let t = tier || (entry.tier === 'both' ? tiersOf(id)[0] || 'beginner' : entry.tier);
  let path = learningPath(t);
  let i = path.findIndex((p) => p.id === id);
  if (i < 0) {
    // A 'both' game listed under the other tier only (e.g. live-predict in the Advanced capstone).
    const other = tiersOf(id).find((x) => x !== t);
    if (other) {
      t = other;
      path = learningPath(t);
      i = path.findIndex((p) => p.id === id);
    }
  }
  if (i >= 0 && i < path.length - 1) return path[i + 1];
  if (t === 'beginner') return learningPath('advanced')[0] || null;
  return null;
}

/** Route token (the old hash without '#') for a lesson or game id: 'l.<id>' / 'g.<id>'. */
export function hashFor(id) {
  const e = findEntry(id);
  if (!e) return 'home';
  return (e.type === 'lesson' ? 'l.' : 'g.') + id;
}

/** URL path for a lesson or game id: '/lessons/<id>' / '/games/<id>' ('/' if unknown). */
export function pathFor(id) {
  return tokenToPath(hashFor(id));
}

/** Lessons / games shown under a tier ('both'-tier games appear under both). */
export function lessonsOf(tier) {
  return LESSONS.filter((l) => l.tier === tier);
}
export function gamesOf(tier) {
  return GAMES.filter((g) => g.tier === tier || g.tier === 'both');
}
