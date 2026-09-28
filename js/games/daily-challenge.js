// Daily Challenge — five questions per local date (the same for everyone), drawn from a bank that
// spans every unit, plus up to two "Review" questions from the player's own recent misses in
// this and other games (spaced repetition, store.recordMiss / recentMisses).
import { GameShell, QuestionBank, bankOptions, explainChoice, trackAnswer } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart, candleSVG } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, rsi } from '../core/indicators.js';
import { chartScenario, candleScenario, CANDLE_PATTERNS, CHART_PATTERNS } from '../core/patterns.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { QUESTIONS as ORDER_QUESTIONS } from './banks/order-desk-questions.js';
import { QUESTIONS as TILT_QUESTIONS } from './banks/tilt-control-questions.js';
import { CARDS as SETUP_CARDS } from './banks/setup-swipe-cards.js';
import { candleWhy, lookalikesOf } from './banks/candle-lookalikes.js';

export const DAILY_COUNT = 5;
export const MAX_REVIEWS = 2;

// { id, level 0–2, q, a (correct option), wrong: { option: why it is wrong }, explain, hint,
//   chart: spec for questionChart() or null }
export const QUESTIONS = [
  // ---- Candlestick anatomy
  {
    id: 'd-candle-color', level: 0, chart: { t: 'candle', o: 100, h: 106, l: 98.5, c: 103 },
    q: 'A candle opens at 100 and closes at 103. On a standard chart it is…',
    a: 'Green / bullish',
    wrong: {
      'Red / bearish': 'Red means the close is BELOW the open. Here it closed 3 above.',
      'Grey': 'Standard charts colour a candle by close vs open: green when it closes higher.',
      'A doji': 'A doji opens and closes at (almost) the same price. A 3-point body is not a doji.',
    },
    explain: '<strong>Bullish.</strong> It closed above its open.',
    hint: 'Compare the close with the open.',
  },
  {
    id: 'd-upper-wick', level: 0, chart: { t: 'candle', o: 50, h: 56, l: 48, c: 53 },
    q: 'Open 50, high 56, low 48, close 53. How long is the upper wick?',
    a: '3',
    wrong: {
      '6': 'That is high minus open. The upper wick starts at the top of the BODY, which on a green candle is the close (53).',
      '8': 'That is the whole range, high minus low.',
      '2': 'That is the lower wick: open 50 minus low 48.',
    },
    explain: '<strong>3.</strong> Upper wick = high − max(open, close) = 56 − 53.',
    hint: 'Where does the body end on a green candle?',
  },
  {
    id: 'd-red-body-top', level: 0, chart: { t: 'candle', o: 104, h: 105.5, l: 99, c: 100 },
    q: 'On a red (bearish) candle, the top of the body is the…',
    a: 'Open',
    wrong: {
      'Close': 'On a red candle price FELL from open to close, so the close is at the bottom of the body.',
      'High': 'The high is the top of the upper wick, above the body.',
      'Low': 'The low is the bottom of the lower wick.',
    },
    explain: '<strong>The open.</strong> Red candles open high and close lower.',
    hint: 'Which way did price travel during a red candle?',
  },
  {
    id: 'd-lower-wick', level: 1, chart: { t: 'candle', o: 101, h: 102.5, l: 94, c: 102 },
    q: 'A long lower wick on a candle means…',
    a: 'Price traded well below the close, but buyers pushed it back up',
    wrong: {
      'Sellers controlled the close': 'The close is far ABOVE the low: buyers won the end of that fight.',
      'Nothing traded below the body': 'The wick is exactly the part that traded below the body.',
      'The candle must be bearish': 'Wicks do not set the colour. Close vs open does.',
    },
    explain: '<strong>Rejection of lower prices.</strong> Sellers pushed down, buyers pushed back.',
    hint: 'The wick shows where price went and did not stay.',
  },
  // ---- Chart basics
  {
    id: 'd-daily-candle', level: 0, chart: { t: 'trend', dir: 'up', count: 24 },
    q: 'On a daily chart, each candle shows…',
    a: 'One trading day of price action',
    wrong: {
      'One hour of trading': 'That is an hourly chart. The timeframe is how much time each candle covers.',
      'The whole week': 'That is a weekly chart.',
      'A single trade': 'A candle summarises every trade in its period: open, high, low and close.',
    },
    explain: '<strong>One day.</strong> Each candle summarises one period of the chart’s timeframe.',
    hint: 'The timeframe names the period of each candle.',
  },
  {
    id: 'd-line-chart', level: 0, chart: null,
    q: 'A basic line chart usually connects…',
    a: 'The closing prices',
    wrong: {
      'The highs': 'Line charts are normally drawn through closes; highs and lows need bars or candles.',
      'The opening prices': 'Opens are rarely used for line charts; the close is the most-watched price of each period.',
      'Each day’s average price': 'That would be a moving average or a VWAP, not the basic line chart.',
    },
    explain: '<strong>The closes.</strong> Simple and clean, but it hides the range of each period.',
    hint: 'Which price of the day gets the most attention?',
  },
  {
    id: 'd-log-scale', level: 1, chart: null,
    q: 'On a logarithmic price scale, equal vertical distances represent…',
    a: 'Equal percentage moves',
    wrong: {
      'Equal dollar moves': 'That is a linear scale. On a log scale 10 → 20 takes the same height as 50 → 100.',
      'Equal amounts of time': 'Time runs along the horizontal axis, not the vertical one.',
      'Equal volume': 'Volume is a separate measure, usually shown as bars under the chart.',
    },
    explain: '<strong>Equal percentages.</strong> A doubling is always the same height, which keeps long histories readable.',
    hint: '10 → 20 and 50 → 100 are both +100%.',
  },
  // ---- Candlestick patterns
  {
    id: 'd-hammer-context', level: 1, chart: { t: 'cpattern', id: 'hanging-man' },
    q: 'A hammer and a hanging man look the same. What tells them apart?',
    a: 'The trend before them',
    wrong: {
      'The colour of the body': 'Either can be green or red. The prior trend is what defines them.',
      'The length of the upper wick': 'Both have little or no upper wick; that is why they look alike.',
      'The volume': 'Volume can support the read, but the definition is the prior trend.',
    },
    explain: '<strong>Context.</strong> After a decline it is a hammer (bullish); after a rally, a hanging man (bearish). The chart shows a hanging man.',
    hint: 'Same shape, different place.',
  },
  {
    id: 'd-engulfing', level: 0, chart: { t: 'cpattern', id: 'bullish-engulfing' },
    q: 'After a decline, a red candle is followed by a larger green candle whose body covers the red body. This is…',
    a: 'Bullish engulfing',
    wrong: {
      'Bearish engulfing': 'Bearish engulfing is the mirror: a green candle swallowed by a larger RED one after a rally.',
      'Bullish harami': 'In a harami the second body sits INSIDE the first. Here it covers it.',
      'A doji': 'A doji has (almost) no body. These are two candles with real bodies.',
    },
    explain: '<strong>Bullish engulfing.</strong> Buyers overpowered the previous session’s sellers.',
    hint: 'Engulf = swallow.',
  },
  {
    id: 'd-doji', level: 0, chart: { t: 'candle', o: 100, h: 104, l: 96, c: 100.1 },
    q: 'A candle whose open and close are (almost) the same is a…',
    a: 'Doji',
    wrong: {
      'Marubozu': 'A marubozu is the opposite: a big body with little or no wick.',
      'Hammer': 'A hammer has a small but real body and a long lower wick.',
      'Bullish engulfing': 'Engulfing patterns need two candles with real bodies.',
    },
    explain: '<strong>A doji:</strong> indecision. Its meaning depends on where it prints.',
    hint: 'Look at the body.',
  },
  {
    id: 'd-confirmation', level: 1, chart: { t: 'cpattern', id: 'hammer', after: 2 },
    q: 'What usually counts as confirmation of a hammer?',
    a: 'A later close above the hammer’s high',
    wrong: {
      'The hammer candle itself': 'The hammer is the signal. Confirmation is what the next candle(s) do.',
      'A close below the hammer’s low': 'That is the opposite: it invalidates the hammer.',
      'High volume on the day before the hammer': 'Volume before the pattern says little about whether buyers followed through after it.',
    },
    explain: '<strong>Follow-through.</strong> A close above the hammer’s high shows buyers kept control.',
    hint: 'What should the next candles do if buyers really took over?',
  },
  // ---- Trends
  {
    id: 'd-uptrend-def', level: 0, chart: { t: 'legacy', n: 'uptrend' },
    q: 'Higher highs and higher lows describe…',
    a: 'An uptrend',
    wrong: {
      'A downtrend': 'A downtrend is the mirror: lower highs and lower lows.',
      'A range': 'In a range the highs and lows keep returning to about the same levels.',
      'A reversal': 'A reversal is a CHANGE of trend. Rising highs and lows are the trend continuing.',
    },
    explain: '<strong>An uptrend:</strong> each swing goes a little higher.',
    hint: 'Both the peaks and the dips are rising.',
  },
  {
    id: 'd-downtrend-def', level: 0, chart: { t: 'trend', dir: 'down' },
    q: 'Lower highs and lower lows describe…',
    a: 'A downtrend',
    wrong: {
      'An uptrend': 'An uptrend makes higher highs and higher lows.',
      'A range': 'In a range the swings keep returning to about the same levels.',
      'A double bottom': 'A double bottom is two matching lows, not a series of lower ones.',
    },
    explain: '<strong>A downtrend:</strong> each bounce fails lower and each low undercuts the last.',
    hint: 'Both the peaks and the dips are falling.',
  },
  {
    id: 'd-trend-break', level: 1, chart: null,
    q: 'In an uptrend, what is the first structural warning that the trend may be breaking?',
    a: 'Price makes a lower low, below the last higher low',
    wrong: {
      'A single red candle': 'Pullbacks are full of red candles. Structure is about swing highs and lows.',
      'A new higher high': 'A higher high is the trend continuing, not breaking.',
      'RSI above 70': 'Overbought readings are common in strong trends. They are not a structure break.',
    },
    explain: '<strong>A lower low.</strong> Losing the last higher low is the first break of uptrend structure.',
    hint: 'What defines an uptrend? Which part of that fails first?',
  },
  // ---- Support & resistance
  {
    id: 'd-support-def', level: 0, chart: { t: 'legacy', n: 'support' },
    q: 'Support is a price where…',
    a: 'Buyers have stepped in before',
    wrong: {
      'Sellers always win': 'That describes resistance, and nothing “always” happens at a level.',
      'Volume is zero': 'Support is about where buyers showed up, not about volume vanishing.',
      'The chart ends': 'Support is a level inside the chart where price bounced before.',
    },
    explain: '<strong>Buyers stepped in before,</strong> so they may again.',
    hint: 'Think of a floor.',
  },
  {
    id: 'd-resistance-def', level: 0, chart: { t: 'level', kind: 'resistance' },
    q: 'Resistance is a price where…',
    a: 'Sellers have stepped in before',
    wrong: {
      'Buyers have stepped in before': 'That is support, a floor under price.',
      'Price can never go higher': 'Resistance can break. It is where sellers showed up before, not a wall.',
      'The spread is widest': 'Resistance is about past reactions, not the bid–ask spread.',
    },
    explain: '<strong>Sellers stepped in before,</strong> capping rallies there.',
    hint: 'Think of a ceiling.',
  },
  {
    id: 'd-role-reversal', level: 1, chart: { t: 'legacy', n: 'retest' },
    q: 'Price breaks resistance, retests it from above and holds. The old resistance is now…',
    a: 'Support',
    wrong: {
      'Still resistance': 'Price is now ABOVE the level and holding it: it acts as a floor.',
      'A trend line': 'It is a horizontal level, not a line through swing points.',
      'A gap': 'A gap is a jump in price with no trading in between.',
    },
    explain: '<strong>Support:</strong> role reversal.',
    hint: 'Broken ceilings often become floors.',
  },
  {
    id: 'd-level-zone', level: 1, chart: null,
    q: 'Support and resistance are best treated as…',
    a: 'Zones, not exact prices',
    wrong: {
      'Exact prices, to the cent': 'Markets overshoot and undershoot levels. Treating them as exact lines leads to false “breaks”.',
      'Guaranteed turning points': 'Levels are where reactions are more likely, never guaranteed.',
      'Only valid on daily charts': 'Levels form on every timeframe.',
    },
    explain: '<strong>Zones.</strong> Allow a little room around a level, and around your stop.',
    hint: 'Do reactions happen at exactly one price?',
  },
  {
    id: 'd-round-numbers', level: 1, chart: null,
    q: 'Why do round numbers like 50 or 100 often act as support or resistance?',
    a: 'Many traders place orders and stops at them',
    wrong: {
      'Exchanges require it': 'No rule makes round numbers special. Traders’ habits do.',
      'Price can’t trade between round numbers': 'Price trades at any tick size in between.',
      'They are Fibonacci levels': 'Fibonacci levels are ratios of a move, not round numbers.',
    },
    explain: '<strong>Clusters of orders.</strong> Round numbers attract limit orders, stops and attention.',
    hint: 'Where do people like to set their prices?',
  },
  // ---- Trend lines
  {
    id: 'd-trendline', level: 0, chart: { t: 'legacy', n: 'uptrend' },
    q: 'An uptrend line is drawn by connecting…',
    a: 'Two or more rising swing lows',
    wrong: {
      'Rising swing highs': 'A line through the highs is the upper line of a channel. The trend line itself supports the lows.',
      'The open of every candle': 'Trend lines connect swing points, not every candle.',
      'The highest high and the lowest low': 'That spans the whole range but ignores the swings the trend is built from.',
    },
    explain: '<strong>The rising lows.</strong> The more clean touches, the more the line is respected.',
    hint: 'In an uptrend the line supports price from below.',
  },
  {
    id: 'd-channel', level: 1, chart: null,
    q: 'What does a rising channel add to an uptrend line?',
    a: 'A parallel line through the swing highs',
    wrong: {
      'A second line through the same lows': 'That is still just the trend line.',
      'A horizontal line at the last high': 'A horizontal line is a resistance level, not a channel.',
      'A moving average': 'A moving average is calculated from prices, not drawn through swing points.',
    },
    explain: '<strong>A parallel upper line.</strong> Price oscillates between the two until it breaks out.',
    hint: 'Channel = two parallel lines.',
  },
  // ---- Moving averages
  {
    id: 'd-golden-cross', level: 1, chart: { t: 'legacy', n: 'golden' },
    q: 'The 50-period MA crosses above the 200-period MA. This is…',
    a: 'A golden cross',
    wrong: {
      'A death cross': 'A death cross is the fast average crossing BELOW the slow one.',
      'A divergence': 'Divergence compares price with an oscillator such as RSI, not two averages.',
      'A fakeout': 'A fakeout is a failed break of a price level.',
    },
    explain: '<strong>A golden cross:</strong> the faster average rises above the slower one.',
    hint: 'Golden is the bullish one.',
  },
  {
    id: 'd-death-cross', level: 1, chart: { t: 'ma', dir: 'down' },
    q: 'The 50-period MA crosses below the 200-period MA. This is…',
    a: 'A death cross',
    wrong: {
      'A golden cross': 'A golden cross is the fast average crossing ABOVE the slow one.',
      'Bearish divergence': 'Divergence compares price with an oscillator, not two averages.',
      'A breakout': 'A breakout is price closing through a level.',
    },
    explain: '<strong>A death cross.</strong> Like every cross it lags: much of the fall has often happened already.',
    hint: 'The bearish twin of the golden cross.',
  },
  {
    id: 'd-ema-sma', level: 1, chart: null,
    q: 'Compared with an SMA of the same length, an EMA…',
    a: 'Reacts faster, because recent prices weigh more',
    wrong: {
      'Reacts more slowly': 'The opposite: the exponential weighting favours recent prices, so an EMA turns sooner.',
      'Ignores the latest price': 'The latest price has the MOST weight in an EMA.',
      'Is calculated from highs only': 'Both are normally calculated from closing prices.',
    },
    explain: '<strong>Faster.</strong> An SMA weighs every price in the window equally.',
    hint: 'E is for exponential weighting of recent prices.',
  },
  {
    id: 'd-ma-lag', level: 0, chart: null,
    q: 'Moving averages are called “lagging” indicators because…',
    a: 'They are calculated from past prices',
    wrong: {
      'They are drawn a day late': 'They update with every candle, but each value averages prices that already happened.',
      'They predict future prices': 'They describe the past; they do not forecast.',
      'They are calculated from volume': 'Price moving averages use prices, usually closes.',
    },
    explain: '<strong>Built from the past.</strong> That smooths noise, and delays signals.',
    hint: 'What goes into the average?',
  },
  // ---- Volume
  {
    id: 'd-volume-def', level: 0, chart: null,
    q: 'Volume shows…',
    a: 'How many shares or contracts traded in each period',
    wrong: {
      'The size of each candle’s range': 'That is the high–low range, a price measure.',
      'Buyers minus sellers': 'Every trade has a buyer and a seller. Volume counts what changed hands.',
      'The bid–ask spread': 'The spread is a price gap on the order book, not a quantity traded.',
    },
    explain: '<strong>Quantity traded.</strong> It measures participation, not direction.',
    hint: 'How much changed hands?',
  },
  {
    id: 'd-volume-breakout', level: 1, chart: null,
    q: 'A breakout on volume far above average suggests…',
    a: 'Strong participation behind the move',
    wrong: {
      'The breakout will certainly hold': 'Volume improves the odds; it guarantees nothing. Strong-volume breakouts fail too.',
      'Nobody is interested': 'Heavy volume means many people are interested.',
      'The move is already over': 'Heavy volume at a breakout is usually read as the start of interest, not the end.',
    },
    explain: '<strong>Participation.</strong> Thin breakouts are more prone to fail; heavy ones carry more conviction.',
    hint: 'What does a big volume bar tell you about interest?',
  },
  // ---- Markets & orders
  {
    id: 'd-fx-spread', level: 1, chart: { t: 'legacy', n: 'spread' },
    q: 'Bid 1.0848, ask 1.0850. The spread is…',
    a: '2 pips (0.0002)',
    wrong: {
      '0.2 pips': 'One pip here is 0.0001, so 0.0002 is 2 pips.',
      '20 pips': 'That would be 0.0020, ten times the real gap.',
      '1.0849': 'That is the midpoint, not the spread.',
    },
    explain: '<strong>2 pips.</strong> 1.0850 − 1.0848 = 0.0002.',
    hint: 'Ask minus bid; a pip is 0.0001 here.',
  },
  {
    id: 'd-market-order', level: 0, chart: null,
    q: 'A market order…',
    a: 'Fills right away at the best available price',
    wrong: {
      'Fills only at the price you choose': 'That is a limit order.',
      'Waits until price reaches your level': 'That is a stop order.',
      'Can only be sent at the open': 'Market orders can be sent whenever the market is open.',
    },
    explain: '<strong>Speed over price.</strong> You get filled, but you pay the spread and any slippage.',
    hint: 'Market = now.',
  },
  {
    id: 'd-stop-loss', level: 0, chart: { t: 'trade', entry: 50, stop: 48, target: 54 },
    q: 'A stop-loss order is mainly used to…',
    a: 'Limit the loss if price moves against you',
    wrong: {
      'Guarantee a profit': 'A stop exits a trade going the wrong way. It cannot guarantee a profit.',
      'Guarantee the exact exit price': 'Stops become market orders when triggered, and gaps can fill them worse.',
      'Enter a trade at a better price': 'That is closer to what a limit order does.',
    },
    explain: '<strong>Cap the loss.</strong> It turns “I hope it comes back” into a defined risk.',
    hint: 'Stop… the loss.',
  },
  {
    id: 'd-gap-down', level: 1, chart: null,
    q: 'A stock closes at 50 and opens the next morning at 46. This is…',
    a: 'A gap down',
    wrong: {
      'A gap up': 'It opened LOWER than it closed.',
      'Slippage': 'Slippage is the difference between the price you expected and your fill. This is a jump in the market price itself.',
      'A stop hunt': 'The move may trigger stops, but the name for the jump itself is a gap.',
    },
    explain: '<strong>A gap down.</strong> Nothing traded between 50 and 46, so stops in that zone fill near 46.',
    hint: 'Did price trade between 50 and 46?',
  },
  // ---- Chart patterns
  {
    id: 'd-double-top', level: 1, chart: { t: 'chart', id: 'double-top' },
    q: 'Two peaks at about the same price, with a trough between them (an “M”), form a…',
    a: 'Double top',
    wrong: {
      'Double bottom': 'A double bottom is the “W”: two matching lows.',
      'Head and shoulders': 'Head and shoulders has three peaks, the middle one highest.',
      'Bull flag': 'A bull flag is a sharp rally followed by a small downward-drifting pause.',
    },
    explain: '<strong>A double top.</strong> It completes on a close below the trough between the peaks.',
    hint: 'Count the peaks.',
  },
  {
    id: 'd-bull-flag', level: 1, chart: { t: 'chart', id: 'bull-flag' },
    q: 'A sharp rally followed by a small, orderly pullback in a slightly downward channel is a…',
    a: 'Bull flag',
    wrong: {
      'Bear flag': 'A bear flag hangs under a sharp DROP and drifts up.',
      'Rising wedge': 'A rising wedge climbs slowly between two converging rising lines.',
      'Double top': 'A double top needs two peaks at about the same price.',
    },
    explain: '<strong>A bull flag:</strong> a pause in an uptrend, confirmed by a close above the flag.',
    hint: 'Pole, then flag.',
  },
  {
    id: 'd-ascending-triangle', level: 2, chart: { t: 'chart', id: 'ascending-triangle' },
    q: 'Flat resistance on top with rising lows underneath forms…',
    a: 'An ascending triangle',
    wrong: {
      'A descending triangle': 'A descending triangle has flat SUPPORT with falling highs.',
      'A symmetrical triangle': 'In a symmetrical triangle both lines slope toward each other.',
      'A falling wedge': 'A falling wedge slopes down on both sides.',
    },
    explain: '<strong>An ascending triangle.</strong> Buyers keep paying more into the same sellers; it more often breaks up, but not always.',
    hint: 'Which side is flat, and which is rising?',
  },
  {
    id: 'd-hs-target', level: 2, chart: { t: 'legacy', n: 'hs' },
    q: 'A head and shoulders target is usually found by…',
    a: 'Projecting the head-to-neckline height from the breakout',
    wrong: {
      'Doubling the left shoulder': 'The shoulders define the pattern, but the measured move uses the head’s height.',
      'Using the 200-period moving average': 'Moving averages are not part of the pattern’s measured move.',
      'Taking the highest high': 'That is the head itself, above the pattern, not a downside target.',
    },
    explain: '<strong>The measured move:</strong> the height from head to neckline, projected from the break. A guideline, not a promise.',
    hint: 'Measure the pattern, then project it.',
  },
  // ---- Fibonacci
  {
    id: 'd-fib-levels', level: 1, chart: null,
    q: 'Which retracement levels are watched most in a Fibonacci pullback?',
    a: '38.2%, 50% and 61.8%',
    wrong: {
      '10%, 20% and 30%': 'These are not Fibonacci ratios, and pullbacks that shallow are rarely what traders measure.',
      '100% and 200%': '100% is the whole move and 200% an extension, not pullback levels.',
      '25% and 75%': 'Quarters are not Fibonacci ratios.',
    },
    explain: '<strong>38.2%, 50% and 61.8%.</strong> (50% is not a Fibonacci ratio, but it is watched just as closely.)',
    hint: 'The golden ratio is 0.618.',
  },
  {
    id: 'd-fib-calc', level: 2, chart: { t: 'fib', a: 100, b: 150 },
    q: 'A move runs from 100 to 150. Where is the 50% retracement?',
    a: '125',
    wrong: {
      '75': 'That is 50% of the PRICE. The retracement is half of the MOVE (50 points) back from the high.',
      '130.9': 'That is the 38.2% level: 150 − 0.382 × 50.',
      '119.1': 'That is the 61.8% level: 150 − 0.618 × 50.',
    },
    explain: '<strong>125.</strong> 150 − 0.5 × (150 − 100).',
    hint: 'Half of the move, measured back from the high.',
  },
  // ---- Indicators
  {
    id: 'd-rsi-70', level: 1, chart: { t: 'legacy', n: 'rsi' },
    q: 'RSI above 70 is usually called…',
    a: 'Overbought',
    wrong: {
      'Oversold': 'Oversold is RSI below 30.',
      'Neutral': 'The neutral zone is roughly 30–70.',
      'Divergent': 'Divergence compares the direction of RSI swings with price swings; a single reading is not divergence.',
    },
    explain: '<strong>Overbought:</strong> strong recent gains, not an automatic sell signal.',
    hint: '70 is the upper line.',
  },
  {
    id: 'd-rsi-30', level: 0, chart: { t: 'rsi', dir: 'down' },
    q: 'RSI below 30 is usually called…',
    a: 'Oversold',
    wrong: {
      'Overbought': 'Overbought is RSI above 70.',
      'A buy signal on its own': 'Oversold can stay oversold in a strong downtrend. It is context, not a trigger.',
      'Bullish divergence': 'Divergence needs price and RSI swings to disagree, not a single low reading.',
    },
    explain: '<strong>Oversold:</strong> strong recent losses. In a downtrend it can stay that way.',
    hint: '30 is the lower line.',
  },
  {
    id: 'd-bear-div', level: 2, chart: { t: 'legacy', n: 'beardiv' },
    q: 'Price makes a higher high while RSI makes a lower high. This is…',
    a: 'Bearish divergence',
    wrong: {
      'Bullish divergence': 'Bullish divergence forms at lows: price lower low, RSI higher low.',
      'Hidden bullish divergence': 'Hidden bullish divergence forms at pullback lows in an uptrend (price higher low, RSI lower low).',
      'Confirmation': 'Confirmation would need RSI to make a higher high too. Here it did not.',
    },
    explain: '<strong>Bearish divergence:</strong> momentum is fading as price rises. A warning, not a trigger.',
    hint: 'Price and momentum disagree at the top.',
  },
  {
    id: 'd-bull-div', level: 2, chart: null,
    q: 'Price makes a lower low while RSI makes a higher low. This is…',
    a: 'Bullish divergence',
    wrong: {
      'Bearish divergence': 'Bearish divergence forms at highs: price higher high, RSI lower high.',
      'Confirmation of the downtrend': 'Confirmation would need RSI to make a lower low too.',
      'Overbought': 'Overbought is about RSI above 70, not about swing comparison.',
    },
    explain: '<strong>Bullish divergence:</strong> selling momentum is fading at the new low. Wait for price to confirm.',
    hint: 'Price and momentum disagree at the bottom.',
  },
  {
    id: 'd-div-confirm', level: 2, chart: null,
    q: 'Price makes a higher high and RSI also makes a higher high. This is…',
    a: 'Confirmation: momentum agrees with price',
    wrong: {
      'Bearish divergence': 'Bearish divergence needs RSI to make a LOWER high while price makes a higher high. Here both rose.',
      'Bullish divergence': 'Bullish divergence forms at lows (price lower low, RSI higher low).',
      'Overbought, so a sell signal': 'A high RSI is not divergence and not a sell signal on its own; strong trends stay overbought.',
    },
    explain: '<strong>Confirmation.</strong> Momentum is backing the new high.',
    hint: 'Do price and RSI agree?',
  },
  // ---- Multi-timeframe & breakouts
  {
    id: 'd-mtf', level: 1, chart: null,
    q: 'The weekly chart is in a strong uptrend and the hourly chart shows a pullback. A multi-timeframe trader usually looks to…',
    a: 'Buy when the hourly pullback ends, with the weekly trend',
    wrong: {
      'Short the hourly pullback against the weekly trend': 'Possible, but that fights the bigger trend. The higher timeframe is the tailwind.',
      'Ignore the weekly chart': 'The higher timeframe sets the context; ignoring it removes the main filter.',
      'Trade only the 1-minute chart': 'Dropping to ever-smaller timeframes adds noise, not clarity.',
    },
    explain: '<strong>Trade with the higher timeframe.</strong> Use the lower one to time the entry.',
    hint: 'Which timeframe sets the direction?',
  },
  {
    id: 'd-fakeout', level: 1, chart: { t: 'chart', id: 'ascending-triangle', outcome: 'fail' },
    q: 'Price closes above resistance, then closes back below it a few candles later. This is…',
    a: 'A failed breakout (fakeout)',
    wrong: {
      'A confirmed breakout': 'A confirmed breakout holds above the level. This one fell back below.',
      'A retest': 'A retest dips back TO the level and holds above it. Closing back below means it failed.',
      'A golden cross': 'A golden cross is about moving averages, not price levels.',
    },
    explain: '<strong>A fakeout.</strong> Buyers who chased the break are trapped, which can fuel a move the other way.',
    hint: 'Did the break hold?',
  },
  // ---- Risk
  {
    id: 'd-rr-3to1', level: 2, chart: { t: 'trade', entry: 50, stop: 48, target: 56 },
    q: 'Entry 50, stop 48, target 56. Reward-to-risk?',
    a: '3:1',
    wrong: {
      '2:1': 'Reward is 56 − 50 = 6 and risk is 50 − 48 = 2: that is 3 to 1.',
      '1:3': 'That is upside down: reward goes first.',
      '4:1': 'That measures the reward from the stop (56 − 48 = 8). Measure it from the entry.',
    },
    explain: '<strong>3:1.</strong> Reward 6 ÷ risk 2.',
    hint: 'Divide the distance to the target by the distance to the stop.',
  },
  {
    id: 'd-size-50', level: 2, chart: { t: 'legacy', n: 'size' },
    q: 'You risk 1% of a $10,000 account with a stop $2 away. How many shares?',
    a: '50',
    wrong: {
      '100': 'That risks $200, 2% of the account. 1% is $100.',
      '500': 'That risks $1,000, 10% of the account.',
      '20': 'That looks like $100 ÷ $5. The stop is $2 away: $100 ÷ $2 = 50.',
    },
    explain: '<strong>50 shares.</strong> $100 risk ÷ $2 per share.',
    hint: '1% of $10,000 is your dollar risk.',
  },
  {
    id: 'd-one-percent', level: 0, chart: null,
    q: 'Why do many traders risk only about 1% of the account on each trade?',
    a: 'So a normal losing streak can’t do serious damage',
    wrong: {
      'Because 1% trades always win': 'Size has no effect on whether a trade wins.',
      'Because brokers require it': 'Brokers don’t set your risk per trade; your plan does.',
      'To grow the account as fast as possible': 'Small risk is about survival first. Bigger risk grows AND shrinks the account faster.',
    },
    explain: '<strong>Survival.</strong> Ten losses in a row at 1% cost about 10%; at 10% risk they would cost about 65%.',
    hint: 'What does a losing streak do at 1% vs 10% risk?',
  },
  {
    id: 'd-drawdown', level: 2, chart: null,
    q: 'An account loses 50%. What gain is needed to get back to where it started?',
    a: '100%',
    wrong: {
      '50%': 'A 50% gain on the smaller balance only gets you back to 75% of the start: 50 × 1.5 = 75.',
      '25%': 'That gets you from 50 to 62.5, not back to 100.',
      '150%': 'From 50, +100% already gets you to 100.',
    },
    explain: '<strong>100%.</strong> From 50 you need +50 points, which is +100%. Losses are harder to recover than they look.',
    hint: 'Start at 100, fall to 50. What % takes 50 back to 100?',
  },
  {
    id: 'd-expectancy', level: 2, chart: null,
    q: 'Win rate 50%, average win 2R, average loss 1R. Expectancy per trade?',
    a: '+0.5R',
    wrong: {
      '+1R': 'That forgets the losses: 0.5 × 2R = 1R, minus 0.5 × 1R.',
      '+1.5R': 'Recompute: 0.5 × 2R − 0.5 × 1R.',
      '0R': 'Winning twice as much as you lose, half the time, is a positive edge.',
    },
    explain: '<strong>+0.5R</strong> per trade on average: 0.5 × 2R − 0.5 × 1R. An average over many trades, not a promise for the next one.',
    hint: 'Win rate × average win − loss rate × average loss.',
  },
  {
    id: 'd-r-multiple', level: 1, chart: null,
    q: 'You planned to risk $200 on a trade and made $500. In R-multiples that is…',
    a: '+2.5R',
    wrong: {
      '+5R': 'That uses $100 as R. R is your planned risk: $200.',
      '+0.4R': 'That divides the risk by the profit. R-multiple = profit ÷ planned risk.',
      '+500R': 'R-multiples divide by the planned risk; $500 is just the dollar profit.',
    },
    explain: '<strong>+2.5R.</strong> $500 ÷ $200.',
    hint: 'Profit ÷ planned risk.',
  },
  {
    id: 'd-stop-placement', level: 1, chart: null,
    q: 'Where does a logical stop-loss usually go?',
    a: 'Where the trade idea is proven wrong, such as just beyond the level',
    wrong: {
      'A fixed $1 below entry on every trade': 'The market doesn’t care about round dollar amounts. A stop that ignores structure sits in the noise.',
      'As close as possible, to keep the loss tiny': 'Too tight and normal noise stops you out of good trades. Size the position to the stop, not the stop to a wish.',
      'Nowhere: just watch the trade': 'Without a stop the loss has no limit, and sizing becomes guesswork.',
    },
    explain: '<strong>Where you are wrong.</strong> Then size the position so that distance equals your planned risk.',
    hint: 'What would prove the idea wrong?',
  },
  // ---- Psychology
  {
    id: 'd-revenge', level: 0, chart: null,
    q: 'Trading bigger right after a loss to “win it back” is called…',
    a: 'Revenge trading',
    wrong: {
      'Scaling in': 'Scaling in is a planned way of adding to a position, not an emotional reaction to a loss.',
      'Hedging': 'Hedging offsets risk with an opposite position.',
      'Risk management': 'It is the opposite: it increases risk just when judgement is weakest.',
    },
    explain: '<strong>Revenge trading.</strong> A planned loss is a cost of business; the market owes you nothing.',
    hint: 'Driven by the urge to get even.',
  },
  {
    id: 'd-fomo', level: 0, chart: null,
    q: 'Chasing a fast-moving stock because you are afraid of missing out is…',
    a: 'FOMO trading',
    wrong: {
      'Trend following': 'Trend following is a planned approach with rules for entry and exit. Chasing on emotion is not.',
      'Value investing': 'Value investing buys what looks cheap after analysis, not what is running.',
      'Scalping': 'Scalping is a style of very short trades, not an emotion.',
    },
    explain: '<strong>FOMO.</strong> If it is not in your plan, it is not your trade.',
    hint: 'Fear Of Missing Out.',
  },
];

const CHART_W = 720;
const CHART_H = 220;

function wrapChart(node) {
  return h('div', { class: 'daily-chart', role: 'img' }, node);
}

const baseOpts = { width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true };

/** Pre-built illustrations from the first version of the bank. */
function legacyChart(n, s) {
  switch (n) {
    case 'uptrend': {
      const ts = trendSeries({ seed: s, count: 36, direction: 'up', swings: 3, start: 100 });
      return miniChart(ts.candles, {
        ...baseOpts, yPad: 0.1,
        overlays: [{ type: 'segment', a: { idx: 4, price: ts.candles[4].l }, b: { idx: 32, price: ts.candles[32].l }, color: 'bull', width: 1.5, dashed: true, label: 'Higher lows' }],
        ariaLabel: 'Uptrend with higher highs and higher lows',
      });
    }
    case 'support': {
      const ts = trendSeries({ seed: s, count: 40, direction: 'up', swings: 4, start: 98 });
      const candles = ts.candles.map((k, i) => {
        if (i % 9 === 3 || i % 9 === 4) {
          const floor = 100;
          return { ...k, l: Math.min(k.l, floor), o: Math.max(k.o, floor + 0.3), c: Math.max(k.c, floor + 0.5), h: Math.max(k.h, floor + 1.2) };
        }
        return k;
      });
      return miniChart(candles, { ...baseOpts, overlays: [{ type: 'hline', price: 100, color: 'support', dashed: true, label: 'Support', width: 1.75 }], ariaLabel: 'Price bouncing at a support level' });
    }
    case 'golden': {
      const ts = trendSeries({ seed: s + 3, count: 80, direction: 'up', swings: 2, start: 90, strength: 1.2 });
      const closes = ts.candles.map((k) => k.c);
      return miniChart(ts.candles, {
        ...baseOpts,
        overlays: [
          { type: 'series', values: sma(closes, 45), color: 'ma2', width: 2 },
          { type: 'series', values: sma(closes, 20), color: 'ma1', width: 2 },
        ],
        ariaLabel: 'A faster moving average rising above a slower one',
      });
    }
    case 'spread': {
      const candles = trendSeries({ seed: s, count: 28, direction: 'up', swings: 2, start: 1.0849 }).candles.map((k) => ({
        ...k, o: +k.o.toFixed(4), h: +k.h.toFixed(4), l: +k.l.toFixed(4), c: +k.c.toFixed(4),
      }));
      return miniChart(candles, {
        ...baseOpts, yPad: 0.2, decimals: 4,
        overlays: [
          { type: 'hline', price: 1.0850, color: 'bear', label: 'Ask 1.0850', width: 1.5 },
          { type: 'hline', price: 1.0848, color: 'bull', label: 'Bid 1.0848', width: 1.5 },
        ],
        ariaLabel: 'Bid and ask levels',
      });
    }
    case 'retest': {
      const ts = trendSeries({ seed: s + 5, count: 44, direction: 'up', swings: 3, start: 95 });
      const level = 102;
      return miniChart(ts.candles, {
        ...baseOpts,
        overlays: [
          { type: 'hline', price: level, color: 'accent', dashed: true, label: 'Old resistance', width: 1.75 },
          { type: 'marker', idx: 28, price: level, position: 'above', shape: 'dot', color: 'accent', text: 'Break' },
          { type: 'marker', idx: 36, price: level, position: 'below', shape: 'dot', color: 'bull', text: 'Retest' },
        ],
        ariaLabel: 'Resistance broken then retested from above',
      });
    }
    case 'rsi': {
      const ts = trendSeries({ seed: s + 6, count: 40, direction: 'up', swings: 2, start: 100, strength: 1.4 });
      const r = rsi(ts.candles.map((k) => k.c), 14);
      const lastR = [...r].reverse().find((v) => Number.isFinite(v)) ?? 72;
      return miniChart(ts.candles, {
        ...baseOpts, yPad: 0.1,
        overlays: [{ type: 'marker', idx: ts.candles.length - 1, position: 'above', shape: 'dot', color: 'warn', text: `RSI ~${Math.round(lastR)}` }],
        ariaLabel: 'Strong rally with a high RSI reading',
      });
    }
    case 'size': {
      const ts = trendSeries({ seed: s + 8, count: 30, direction: 'up', swings: 2, start: 48 });
      return miniChart(ts.candles, {
        ...baseOpts, yPad: 0.16,
        overlays: [
          { type: 'hline', price: 50, color: 'accent', label: 'Entry $50', width: 1.75 },
          { type: 'hline', price: 48, color: 'bear', label: 'Stop $48', width: 1.5 },
          { type: 'zone', from: 48, to: 50, color: 'bear', label: '$2 / share' },
        ],
        ariaLabel: 'Entry and stop two dollars apart for position sizing',
      });
    }
    case 'beardiv': {
      const ts = trendSeries({ seed: s + 9, count: 48, direction: 'up', swings: 3, start: 100 });
      const i1 = 22;
      const i2 = 40;
      return miniChart(ts.candles, {
        ...baseOpts,
        overlays: [
          { type: 'segment', a: { idx: i1, price: ts.candles[i1].h }, b: { idx: i2, price: ts.candles[i2].h }, color: 'bear', width: 1.75, label: 'Price: higher high' },
          { type: 'marker', idx: i2, position: 'above', shape: 'dot', color: 'warn', text: 'RSI: lower high' },
        ],
        ariaLabel: 'Price making a higher high while RSI makes a lower high',
      });
    }
    case 'hs': {
      const sc = chartScenario('head-and-shoulders', { seed: s + 10, count: 90, after: 8, outcome: 'success' });
      const neck = Number.isFinite(sc.level) ? sc.level : sc.candles[Math.floor(sc.candles.length * 0.55)].l;
      const overlays = [{ type: 'hline', price: neck, color: 'resistance', dashed: true, label: 'Neckline', width: 1.75 }];
      for (const kp of sc.keyPoints || []) {
        if (kp.label && kp.label !== 'Breakout') overlays.push({ type: 'marker', idx: kp.idx, price: kp.price, position: 'above', shape: 'dot', color: 'accent', text: kp.label });
      }
      const end = Math.min(sc.candles.length, (sc.breakoutIdx ?? sc.candles.length - 1) + 8);
      return miniChart(sc.candles.slice(0, end), { ...baseOpts, overlays, ariaLabel: 'Head and shoulders pattern with neckline' });
    }
    default:
      return null;
  }
}

/** One large illustrative chart for a question's chart spec (null → no chart). */
export function questionChart(spec, seed) {
  if (!spec) return null;
  const s = seed;
  let node = null;
  try {
    switch (spec.t) {
      case 'legacy':
        node = legacyChart(spec.n, s);
        break;
      case 'candle':
        node = candleSVG({ o: spec.o, h: spec.h, l: spec.l, c: spec.c }, {
          width: 72, height: 200, labels: true, prices: true, decimals: 1,
          ariaLabel: `Candle: open ${spec.o}, high ${spec.h}, low ${spec.l}, close ${spec.c}`,
        });
        break;
      case 'trend': {
        const ts = trendSeries({ seed: s, count: spec.count || 40, direction: spec.dir || 'up', swings: 3, start: 100 });
        node = miniChart(ts.candles, { ...baseOpts, ariaLabel: `${spec.dir === 'down' ? 'Down' : 'Up'}trend chart` });
        break;
      }
      case 'level': {
        const ts = trendSeries({ seed: s, count: 44, direction: 'range', swings: 4, start: 100 });
        const top = Math.max(...ts.candles.map((k) => k.h));
        node = miniChart(ts.candles, { ...baseOpts, overlays: [{ type: 'hline', price: top, color: 'resistance', dashed: true, label: 'Resistance', width: 1.75 }], ariaLabel: 'Rallies capped at a resistance level' });
        break;
      }
      case 'ma': {
        const ts = trendSeries({ seed: s, count: 80, direction: spec.dir || 'down', swings: 2, start: 110, strength: 1.2 });
        const closes = ts.candles.map((k) => k.c);
        node = miniChart(ts.candles, {
          ...baseOpts,
          overlays: [
            { type: 'series', values: sma(closes, 45), color: 'ma2', width: 2 },
            { type: 'series', values: sma(closes, 20), color: 'ma1', width: 2 },
          ],
          ariaLabel: 'A faster moving average crossing a slower one',
        });
        break;
      }
      case 'rsi': {
        const ts = trendSeries({ seed: s, count: 40, direction: spec.dir || 'down', swings: 2, start: 100, strength: 1.4 });
        const r = rsi(ts.candles.map((k) => k.c), 14);
        const lastR = [...r].reverse().find((v) => Number.isFinite(v)) ?? 28;
        node = miniChart(ts.candles, { ...baseOpts, overlays: [{ type: 'marker', idx: ts.candles.length - 1, position: 'below', shape: 'dot', color: 'warn', text: `RSI ~${Math.round(lastR)}` }], ariaLabel: 'Sharp decline with a low RSI reading' });
        break;
      }
      case 'trade': {
        const { entry, stop, target } = spec;
        const ts = trendSeries({ seed: s, count: 30, direction: 'up', swings: 2, start: entry - (entry - stop) * 0.5 });
        node = miniChart(ts.candles, {
          ...baseOpts, yPad: 0.16,
          overlays: [
            { type: 'hline', price: target, color: 'bull', label: `Target ${target}`, width: 1.5 },
            { type: 'hline', price: entry, color: 'accent', label: `Entry ${entry}`, width: 1.75 },
            { type: 'hline', price: stop, color: 'bear', label: `Stop ${stop}`, width: 1.5 },
          ],
          ariaLabel: `Trade levels: entry ${entry}, stop ${stop}, target ${target}`,
        });
        break;
      }
      case 'fib': {
        const { a, b } = spec;
        const ts = trendSeries({ seed: s, count: 30, direction: 'up', swings: 2, start: 100 }).candles;
        const lo = Math.min(...ts.map((k) => k.l));
        const hi = Math.max(...ts.map((k) => k.h));
        const k = (b - a) / (hi - lo || 1);
        const map = (p) => a + (p - lo) * k;
        const candles = ts.map((c) => ({ ...c, o: map(c.o), h: map(c.h), l: map(c.l), c: map(c.c) }));
        node = miniChart(candles, {
          ...baseOpts,
          overlays: [
            { type: 'hline', price: b, color: 'bull', label: `High ${b}`, width: 1.5 },
            { type: 'hline', price: a, color: 'bear', label: `Low ${a}`, width: 1.5 },
          ],
          ariaLabel: `A move from ${a} to ${b}`,
        });
        break;
      }
      case 'cpattern': {
        const p = CANDLE_PATTERNS[spec.id];
        if (!p) break;
        const sc = candleScenario(spec.id, { seed: s, leadIn: 16, after: spec.after || 0, outcome: 'success' });
        node = miniChart(sc.candles, {
          ...baseOpts,
          overlays: [{ type: 'zone', from: Math.min(...sc.candles.slice(sc.start, sc.end + 1).map((c) => c.l)), to: Math.max(...sc.candles.slice(sc.start, sc.end + 1).map((c) => c.h)), color: 'accent' }],
          ariaLabel: 'Candlestick pattern at the end of a move',
        });
        break;
      }
      case 'chart': {
        if (!CHART_PATTERNS[spec.id]) break;
        const sc = chartScenario(spec.id, { seed: s, count: 80, after: 10, outcome: spec.outcome || 'success' });
        const end = Math.min(sc.candles.length, (sc.breakoutIdx ?? sc.candles.length - 1) + (spec.outcome === 'fail' ? 10 : 3));
        const overlays = Number.isFinite(sc.level) ? [{ type: 'hline', price: sc.level, color: 'accent', dashed: true, width: 1.5 }] : [];
        node = miniChart(sc.candles.slice(0, end), { ...baseOpts, overlays, ariaLabel: 'Chart pattern' });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.warn('[daily-challenge] chart failed:', err);
    node = null;
  }
  return node ? wrapChart(node) : null;
}

// ---------------------------------------------------------------- review items (spaced repetition)

const DAILY_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const REVIEW_CHART_PATTERNS = ['double-top', 'double-bottom', 'head-and-shoulders', 'inverse-head-and-shoulders', 'bull-flag', 'bear-flag'];
const DIVERGENCE_REVIEW = { 'bear-div': 'd-bear-div', 'bull-div': 'd-bull-div', confirm: 'd-div-confirm' };
/** Banks whose misses can come back as Review questions. */
export const REVIEW_BANKS = ['daily', 'order-desk', 'tilt-control', 'setup-swipe', 'candle-pattern', 'chart-pattern', 'divergence'];

/**
 * A missed item ({ bank, id }) as a Daily Challenge question in the bank format, or null when it
 * can't be shown. rng picks distractors for pattern reviews.
 */
export function reviewItem(miss, rng) {
  const { bank, id } = miss || {};
  const mcq = (list) => list.find((q) => q.id === id) || null;
  if (bank === 'daily') return DAILY_BY_ID.get(id) || null;
  if (bank === 'divergence') return DAILY_BY_ID.get(DIVERGENCE_REVIEW[id]) || null;
  if (bank === 'order-desk') {
    const q = mcq(ORDER_QUESTIONS);
    return q ? { ...q, chart: null } : null;
  }
  if (bank === 'tilt-control') {
    const q = mcq(TILT_QUESTIONS);
    return q ? { ...q, chart: null } : null;
  }
  if (bank === 'setup-swipe') {
    const c = mcq(SETUP_CARDS);
    if (!c) return null;
    const a = c.take ? 'Take' : 'Skip';
    return { id: c.id, level: c.level, q: `Take or skip? ${c.text}`, a, wrong: { [c.take ? 'Skip' : 'Take']: c.why }, explain: c.explain, hint: c.hint, chart: null };
  }
  if (bank === 'candle-pattern') {
    const p = CANDLE_PATTERNS[id];
    if (!p) return null;
    const looks = lookalikesOf(id);
    const others = rng.shuffle(Object.keys(CANDLE_PATTERNS).filter((k) => k !== id && !looks.includes(k) && CANDLE_PATTERNS[k].candles === p.candles));
    const picks = [...looks.slice(0, 2), ...others].slice(0, 3);
    const wrong = Object.fromEntries(picks.map((k) => [CANDLE_PATTERNS[k].name, candleWhy(id, k)]));
    return { id, level: 1, q: 'Name the candlestick pattern at the end of this chart.', a: p.name, wrong, explain: `<strong>${p.name}.</strong> ${p.summary}`, hint: 'Check the prior trend and where the long wick is.', chart: { t: 'cpattern', id } };
  }
  if (bank === 'chart-pattern') {
    const p = CHART_PATTERNS[id];
    if (!p) return null;
    const picks = rng.shuffle(REVIEW_CHART_PATTERNS.filter((k) => k !== id)).slice(0, 3);
    const wrong = Object.fromEntries(picks.map((k) => [CHART_PATTERNS[k].name, `${CHART_PATTERNS[k].name}: ${CHART_PATTERNS[k].summary}`]));
    return { id, level: 1, q: 'Which chart pattern is this?', a: p.name, wrong, explain: `<strong>${p.name}.</strong> ${p.summary}`, hint: 'Count the swings and find the line that breaks.', chart: { t: 'chart', id } };
  }
  return null;
}

/** Up to `max` review items from the player's recent misses, skipping ids already in `skipIds`. */
export function reviewItems(store, rng, { skipIds = new Set(), max = MAX_REVIEWS } = {}) {
  let misses = [];
  try {
    misses = store?.recentMisses?.({ banks: REVIEW_BANKS }) || [];
  } catch {
    misses = [];
  }
  const out = [];
  const seen = new Set(skipIds);
  for (const m of misses) {
    if (out.length >= max) break;
    const item = reviewItem(m, rng);
    const key = `${m.bank}:${item?.id}`;
    if (!item || seen.has(item.id) || seen.has(key)) continue;
    seen.add(item.id);
    seen.add(key);
    out.push({ review: true, bank: m.bank, missId: m.id, q: item });
  }
  return out;
}

export default {
  id: 'daily-challenge',
  mount(root, ctx) {
    const bank = new QuestionBank(QUESTIONS, { id: 'daily' });
    let plan = [];
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 99, direction: 'up', title: 'Daily Challenge', score: 880, streak: 7, round: '1/1', width: 520, height: 200 }),
      rounds: DAILY_COUNT,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'Five questions, the same for everyone today, from every unit of the course.',
        'Plus up to two Review questions: ones you missed recently, here or in other games.',
        'Answer fast: streaks multiply your score. Come back tomorrow to keep your streak alive.',
      ],
      onStart(g, { rng }) {
        const key = g.dailyKey || g.store?.dailyKey?.() || new Date().toISOString().slice(0, 10);
        plan = bank.daily(key, DAILY_COUNT).map((q) => ({ review: false, bank: 'daily', q }));
        plan.push(...reviewItems(g.store, rng.fork('review'), { skipIds: new Set(plan.map((p) => p.q.id)) }));
        g.rounds = plan.length;
        g.maxScore = plan.length * 100;
      },
      onRound(g, { rng, round, stage }) {
        const item = plan[round - 1] || plan[plan.length - 1];
        if (!item) throw new Error('no daily question');
        const q = item.q;
        if (item.review) {
          stage.append(h('p', { class: 'eyebrow' }, 'Review · you missed this one recently'));
        }
        const chart = questionChart(q.chart, rng.int(1, 5000));
        if (chart) stage.append(chart);
        g.ask({
          question: q.q,
          options: bankOptions(q, rng),
          answer: q.a,
          explain: explainChoice(q.explain, q.wrong),
          hint: q.hint,
          onAnswer: (ok) => {
            trackAnswer(g.store, item.bank, item.review ? item.missId : q.id, ok);
            verdictFlourish(stage, { ok, title: ok ? (item.review ? 'Review cleared' : 'Daily locked') : 'Review & retry', detail: (q.explain || '').replace(/<[^>]+>/g, ' ').slice(0, 140), scoreDelta: ok ? 100 : 0 });
          },
        });
      },
    });
    return () => game.destroy();
  },
};
