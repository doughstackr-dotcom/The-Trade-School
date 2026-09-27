// Glossary: plain-English definitions with instant search and A–Z jump chips.
import { h, icon } from '../core/ui.js';
import { findEntry } from '../registry.js';

// cat: candles | structure | patterns | indicators | timeframes | risk
export const TERMS = [
  // ---- candlesticks
  { term: 'Candlestick', cat: 'candles', lesson: 'candle-anatomy', def: 'A drawing of price over one period (a minute, an hour, a day…). The body spans the open and close; thin wicks reach up to the high and down to the low.' },
  { term: 'OHLC', aka: 'open high low close', cat: 'candles', lesson: 'candle-anatomy', def: 'Open, High, Low, Close — the four prices every candle records for its period.' },
  { term: 'Open', cat: 'candles', lesson: 'candle-anatomy', def: 'The first traded price of a period. Compared with the close, it tells you who won the period: buyers or sellers.' },
  { term: 'Close', cat: 'candles', lesson: 'candle-anatomy', def: 'The last traded price of a period. Most traders treat the close as the most important price, because it is where the period’s battle ended.' },
  { term: 'High and low', cat: 'candles', lesson: 'candle-anatomy', def: 'The highest and lowest prices reached during the period. They form the tips of the upper and lower wicks.' },
  { term: 'Body', aka: 'real body', cat: 'candles', lesson: 'candle-anatomy', def: 'The thick part of a candle between the open and the close. A long body shows conviction; a tiny body shows indecision.' },
  { term: 'Wick', aka: 'shadow tail', cat: 'candles', lesson: 'candle-anatomy', def: 'The thin lines above and below the body. A long wick marks prices that were visited and then rejected.' },
  { term: 'Bullish and bearish candles', aka: 'green red up down candle', cat: 'candles', lesson: 'candle-anatomy', def: 'A bullish (up) candle closes above its open; a bearish (down) candle closes below its open. Colour conventions vary, but the open-versus-close rule does not.' },
  { term: 'Doji', cat: 'candles', lesson: 'candle-patterns', def: 'A candle whose open and close are almost equal, leaving a very thin body. It signals indecision; after a strong move it can warn that momentum is stalling.' },
  { term: 'Hammer', cat: 'candles', lesson: 'candle-patterns', def: 'After a decline: a small body near the top of the range with a lower wick at least twice the body. Sellers pushed price down, buyers pushed it back. Needs a bullish follow-through candle to confirm.' },
  { term: 'Shooting star', cat: 'candles', lesson: 'candle-patterns', def: 'After an advance: a small body near the bottom of the range with a long upper wick. Buyers tried higher prices and were rejected. A bearish warning that needs confirmation.' },
  { term: 'Hanging man', cat: 'candles', lesson: 'candle-patterns', def: 'The hammer shape, but appearing after an uptrend. It shows selling pressure inside the candle and needs a bearish close afterwards to matter.' },
  { term: 'Inverted hammer', cat: 'candles', lesson: 'candle-patterns', def: 'After a decline: a small body near the low with a long upper wick. Buyers are starting to test higher prices; wait for a bullish confirmation candle.' },
  { term: 'Engulfing pattern', aka: 'bullish engulfing bearish engulfing', cat: 'candles', lesson: 'candle-patterns', def: 'A two-candle reversal: the second body completely covers the first body and closes in the opposite direction. Strongest at a key level after a clear trend.' },
  { term: 'Harami', aka: 'inside bar', cat: 'candles', lesson: 'candle-patterns', def: 'A two-candle pattern where a small body sits inside the previous large body. Momentum is pausing; the break of the pattern gives the direction.' },
  { term: 'Morning star', cat: 'candles', lesson: 'candle-patterns', def: 'A three-candle bottom: a long bearish candle, a small-bodied candle, then a strong bullish candle that closes well into the first body.' },
  { term: 'Evening star', cat: 'candles', lesson: 'candle-patterns', def: 'The mirror of the morning star at a top: a long bullish candle, a small-bodied candle, then a strong bearish candle closing deep into the first body.' },
  { term: 'Marubozu', cat: 'candles', lesson: 'candle-patterns', def: 'A candle with little or no wicks. One side controlled the whole period from open to close.' },
  { term: 'Spinning top', cat: 'candles', lesson: 'candle-patterns', def: 'A small body with wicks on both sides. Buyers and sellers both tried and neither won — indecision.' },
  { term: 'Three white soldiers', aka: 'three black crows', cat: 'candles', lesson: 'candle-patterns', def: 'Three strong candles in a row in the same direction, each closing near its extreme. Soldiers are bullish; the bearish mirror is called three black crows.' },
  { term: 'Confirmation', cat: 'candles', lesson: 'candle-patterns', def: 'Evidence after a pattern that it is working — usually the next candle closing in the pattern’s direction. Acting before confirmation is cheaper but fails more often.' },

  // ---- structure & levels
  { term: 'Trend', cat: 'structure', lesson: 'trends', def: 'The overall direction of price. An uptrend makes higher highs and higher lows; a downtrend makes lower highs and lower lows.' },
  { term: 'Range', aka: 'sideways consolidation', cat: 'structure', lesson: 'trends', def: 'A market moving sideways between roughly flat support and resistance, without making new highs or lows.' },
  { term: 'Swing high and swing low', aka: 'pivot', cat: 'structure', lesson: 'trends', def: 'A swing high is a peak with lower highs on both sides; a swing low is a trough with higher lows on both sides. They are the skeleton of every chart.' },
  { term: 'Market structure', aka: 'HH HL LH LL higher high higher low lower high lower low', cat: 'structure', lesson: 'trends', def: 'The sequence of swing points, labelled HH (higher high), HL (higher low), LH (lower high) and LL (lower low). It tells you the trend without any indicator.' },
  { term: 'Break of structure', aka: 'BOS', cat: 'structure', lesson: 'trends', def: 'When price breaks the last swing point against the trend — for example an uptrend making a lower low. The first sign the trend may be changing.' },
  { term: 'Pullback', aka: 'retracement', cat: 'structure', lesson: 'trends', def: 'A temporary move against the trend before it resumes. Trend traders look to enter on pullbacks rather than chase.' },
  { term: 'Support', cat: 'structure', lesson: 'support-resistance', def: 'A price area where buying has repeatedly stopped declines. The more clean touches, the more traders are watching it.' },
  { term: 'Resistance', cat: 'structure', lesson: 'support-resistance', def: 'A price area where selling has repeatedly stopped advances.' },
  { term: 'Zone', cat: 'structure', lesson: 'support-resistance', def: 'Support and resistance are areas, not exact prices. Drawing a band through the wicks and bodies of the reactions is more realistic than a razor-thin line.' },
  { term: 'Role reversal', aka: 'polarity flip', cat: 'structure', lesson: 'support-resistance', def: 'Once broken, resistance often becomes support (and support becomes resistance), because traders who missed the move wait for price to return.' },
  { term: 'Breakout', cat: 'structure', lesson: 'support-resistance', def: 'A decisive close beyond a level or pattern boundary, ideally with rising volume.' },
  { term: 'Fakeout', aka: 'false breakout', cat: 'structure', lesson: 'support-resistance', def: 'Price pokes through a level and quickly returns, trapping breakout traders. Waiting for a close — or a retest — filters many fakeouts.' },
  { term: 'Retest', cat: 'structure', lesson: 'support-resistance', def: 'Price comes back to a level it just broke, from the other side. A retest that holds is a classic lower-risk entry.' },
  { term: 'Round numbers', aka: 'psychological levels', cat: 'structure', lesson: 'support-resistance', def: 'Prices such as 100.00 or 1.1000 attract orders simply because people like round numbers, so they often act as support or resistance.' },
  { term: 'Trend line', cat: 'structure', lesson: 'trendlines', def: 'A straight line through at least two swing lows in an uptrend (or swing highs in a downtrend). A third touch that holds makes it more meaningful.' },
  { term: 'Channel', cat: 'structure', lesson: 'trendlines', def: 'A trend line plus a parallel line on the other side of price. Price tends to travel between the two.' },

  // ---- moving averages & indicators
  { term: 'Moving average', aka: 'MA', cat: 'indicators', lesson: 'moving-averages', def: 'The average closing price of the last N periods, recalculated each bar. It smooths out noise and shows direction; its slope matters more than any single cross.' },
  { term: 'SMA', aka: 'simple moving average', cat: 'indicators', lesson: 'moving-averages', def: 'Simple moving average: every close in the window counts equally.' },
  { term: 'EMA', aka: 'exponential moving average', cat: 'indicators', lesson: 'moving-averages', def: 'Exponential moving average: recent closes get more weight, so it reacts faster than an SMA of the same length.' },
  { term: 'Golden cross', cat: 'indicators', lesson: 'moving-averages', def: 'A faster moving average crossing above a slower one (classically the 50 over the 200). Bullish, but lagging — the move has usually already started.' },
  { term: 'Death cross', cat: 'indicators', lesson: 'moving-averages', def: 'A faster moving average crossing below a slower one. Bearish and lagging; in sideways markets crosses whipsaw back and forth.' },
  { term: 'Dynamic support', aka: 'dynamic resistance', cat: 'indicators', lesson: 'moving-averages', def: 'A moving average that price keeps bouncing off during a trend — support (or resistance) that moves with time.' },
  { term: 'Lag', cat: 'indicators', lesson: 'moving-averages', def: 'Indicators built from past prices always react after price does. Longer settings lag more but whipsaw less.' },
  { term: 'Oscillator', cat: 'indicators', lesson: 'indicators', def: 'An indicator that swings within a band or around a centre line, measuring momentum rather than price itself. RSI and MACD are oscillators.' },
  { term: 'RSI', aka: 'relative strength index', cat: 'indicators', lesson: 'indicators', def: 'Relative Strength Index (J. Welles Wilder, usually 14 periods): a 0–100 momentum gauge. Above 70 is called overbought and below 30 oversold — in strong trends it can stay there for a long time.' },
  { term: 'Overbought and oversold', cat: 'indicators', lesson: 'indicators', def: 'Readings where an oscillator says price has moved far, fast. They describe a condition, not a signal to reverse — trends can stay overbought.' },
  { term: 'MACD', aka: 'moving average convergence divergence', cat: 'indicators', lesson: 'indicators', def: 'The 12-period EMA minus the 26-period EMA, plotted with a 9-period EMA “signal” line and a histogram of the gap between them. It shows momentum and its turns.' },
  { term: 'Bollinger Bands', aka: 'squeeze', cat: 'indicators', lesson: 'indicators', def: 'A 20-period SMA with bands two standard deviations above and below. The bands widen when volatility rises and pinch together (a squeeze) in quiet markets, which often precede big moves.' },
  { term: 'Volume', cat: 'indicators', lesson: 'indicators', def: 'How much was traded in a period. Rising volume on a breakout suggests real participation; a breakout on thin volume is easier to fake.' },
  { term: 'Divergence', aka: 'bullish divergence bearish divergence', cat: 'indicators', lesson: 'indicators', def: 'Price makes a new high (or low) but the oscillator does not. Bearish divergence: higher high in price, lower high in RSI. Bullish divergence: lower low in price, higher low in RSI. Momentum is fading — wait for price to confirm.' },
  { term: 'Hidden divergence', cat: 'indicators', lesson: 'indicators', def: 'In an uptrend, price makes a higher low while the oscillator makes a lower low (mirror for downtrends). It points to trend continuation rather than reversal.' },
  { term: 'ATR', aka: 'average true range volatility', cat: 'indicators', lesson: 'confluence-risk', def: 'Average True Range: the average size of each period’s range, including gaps. Traders use it to size stops to the market’s normal noise.' },

  // ---- patterns & fibonacci
  { term: 'Head and shoulders', aka: 'inverse head and shoulders', cat: 'patterns', lesson: 'chart-patterns', def: 'Three peaks with the middle one highest. A close below the neckline confirms a bearish reversal; the inverse version (three troughs) is bullish.' },
  { term: 'Neckline', cat: 'patterns', lesson: 'chart-patterns', def: 'The line through the lows between the shoulders of a head and shoulders (or the highs of an inverse one). Its break confirms the pattern.' },
  { term: 'Double top', aka: 'double bottom triple top triple bottom', cat: 'patterns', lesson: 'chart-patterns', def: 'Two failed attempts at the same high, confirmed when price closes below the low between them. The double bottom is the bullish mirror.' },
  { term: 'Triangle', aka: 'ascending descending symmetrical', cat: 'patterns', lesson: 'chart-patterns', def: 'Price squeezing between two converging lines. Ascending triangles have a flat top and rising lows (often bullish); descending ones have a flat bottom and falling highs.' },
  { term: 'Wedge', aka: 'rising wedge falling wedge', cat: 'patterns', lesson: 'chart-patterns', def: 'Both boundary lines slope the same way and converge. Rising wedges tend to break down; falling wedges tend to break up.' },
  { term: 'Flag', aka: 'bull flag bear flag pennant', cat: 'patterns', lesson: 'chart-patterns', def: 'A short, tight pullback channel after a sharp move (the pole). Usually a continuation: the break of the flag often travels about the length of the pole.' },
  { term: 'Cup and handle', cat: 'patterns', lesson: 'chart-patterns', def: 'A rounded bottom (the cup) followed by a small shallow pullback (the handle) below resistance, before a breakout.' },
  { term: 'Measured move', aka: 'price target', cat: 'patterns', lesson: 'chart-patterns', def: 'A target method: take the pattern’s height and project it from the breakout point. A guide, not a promise.' },
  { term: 'Fibonacci retracement', aka: 'fib', cat: 'patterns', lesson: 'fibonacci', def: 'Horizontal levels at 23.6%, 38.2%, 50%, 61.8% and 78.6% of a completed swing, where pullbacks often pause. (50% is not a Fibonacci ratio but is widely watched.)' },
  { term: 'Golden zone', aka: 'golden pocket', cat: 'patterns', lesson: 'fibonacci', def: 'The 50%–61.8% retracement area of a swing — a popular place to look for the trend to resume, especially when it lines up with support.' },
  { term: 'Fibonacci extension', cat: 'patterns', lesson: 'fibonacci', def: 'Levels beyond the swing (127.2%, 161.8%, 261.8%) used to project where a move might run — typically as profit targets.' },
  { term: 'Swing anchor', cat: 'patterns', lesson: 'fibonacci', def: 'The two points you draw a Fibonacci tool between: the start and the end of a clear, completed swing (low to high in an uptrend).' },

  // ---- timeframes
  { term: 'Timeframe', cat: 'timeframes', lesson: 'multi-timeframe', def: 'The length of time each candle represents: 1 minute, 1 hour, 1 day, 1 week and so on. The same market can trend on one timeframe and range on another.' },
  { term: 'Multi-timeframe analysis', aka: 'top-down analysis MTF', cat: 'timeframes', lesson: 'multi-timeframe', def: 'Reading several timeframes together: the higher one for direction, the middle one for the setup, the lower one for entry timing. A ratio of about 4–6× between them works well.' },
  { term: 'Higher timeframe', aka: 'HTF', cat: 'timeframes', lesson: 'multi-timeframe', def: 'The bigger picture chart. Trades that go with the higher-timeframe trend usually have the wind at their back.' },
  { term: 'Session', aka: 'Asia London New York', cat: 'timeframes', lesson: 'confluence-risk', def: 'The trading hours of a major market centre. Liquidity and volatility change between sessions, and the overlap of two big sessions is often the busiest time.' },

  // ---- risk & execution
  { term: 'Confluence', cat: 'risk', lesson: 'confluence-risk', def: 'Several independent reasons pointing at the same price or direction — say a support zone, the 61.8% retracement and a rising moving average. More confluence, better odds; never certainty.' },
  { term: 'Entry trigger', cat: 'risk', lesson: 'confluence-risk', def: 'The specific event that gets you in, such as a bullish engulfing candle closing at support. Setups tell you where to look; triggers tell you when.' },
  { term: 'Stop loss', cat: 'risk', lesson: 'confluence-risk', def: 'A pre-set order that exits a losing trade. Put it where your idea is proven wrong (beyond the level or swing), not at a random distance.' },
  { term: 'Take profit', aka: 'target', cat: 'risk', lesson: 'confluence-risk', def: 'A pre-set order that closes a trade at your target, often the next resistance or a measured-move level.' },
  { term: 'Risk–reward ratio', aka: 'risk reward R:R', cat: 'risk', lesson: 'confluence-risk', def: 'Potential reward divided by potential risk. Risking 1 to make 2 is 1:2. A good ratio lets you be wrong more often than right and still come out ahead.' },
  { term: 'R-multiple', aka: 'R', cat: 'risk', lesson: 'confluence-risk', def: 'Profit or loss measured in units of the amount you risked (R). Risk $100 and make $250: +2.5R. Lose the full stop: −1R.' },
  { term: 'Position size', aka: 'position sizing', cat: 'risk', lesson: 'confluence-risk', def: 'How many units to trade: (account × risk %) ÷ (distance from entry to stop). Size comes from the stop, not the other way round.' },
  { term: 'Risk per trade', cat: 'risk', lesson: 'confluence-risk', def: 'The share of the account you accept losing on one trade, commonly 0.5–2%. Small enough that a losing streak is survivable.' },
  { term: 'Expectancy', cat: 'risk', lesson: 'confluence-risk', def: 'The average result per trade: (win rate × average win) − (loss rate × average loss), usually in R. Positive expectancy is the whole game.' },
  { term: 'Win rate', cat: 'risk', lesson: 'confluence-risk', def: 'The percentage of trades that make money. Meaningless on its own — a 35% win rate is fine with 1:3 trades.' },
  { term: 'Drawdown', cat: 'risk', lesson: 'confluence-risk', def: 'The fall in account value from a peak to a later low. Keeping risk per trade small keeps drawdowns shallow.' },
  { term: 'Slippage', cat: 'risk', lesson: 'confluence-risk', def: 'The difference between the price you expected and the price you got, common in fast markets and on stop orders.' },
  { term: 'Spread', aka: 'bid ask', cat: 'risk', lesson: 'confluence-risk', def: 'The gap between the bid (best price to sell) and the ask (best price to buy). You pay it on every round trip, so it matters most for short-term trading.' },
  { term: 'Liquidity', cat: 'risk', lesson: 'confluence-risk', def: 'How easily something trades without moving the price. Liquid markets have tight spreads and little slippage.' },
  { term: 'Long and short', aka: 'buy sell', cat: 'risk', lesson: 'confluence-risk', def: 'Going long means buying to profit from a rise. Going short means selling (usually borrowed) to profit from a fall.' },
  { term: 'Order types', aka: 'market order limit order stop order', cat: 'risk', lesson: 'confluence-risk', def: 'A market order fills now at the best available price; a limit order fills only at your price or better; a stop order becomes a market order once price reaches a trigger.' },
  { term: 'Gap', cat: 'risk', lesson: 'candle-anatomy', def: 'A jump between one candle’s close and the next candle’s open, often after news or a market close. Stops can fill beyond their price in a gap.' },
];

const CATS = {
  candles: 'Candlesticks',
  structure: 'Structure & levels',
  indicators: 'Indicators',
  patterns: 'Patterns & Fibonacci',
  timeframes: 'Timeframes',
  risk: 'Risk & execution',
};

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export default {
  id: 'glossary',
  mount(root) {
    const sorted = [...TERMS].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
    const letterOf = (t) => {
      const c = t.term[0].toUpperCase();
      return /[A-Z]/.test(c) ? c : '#';
    };
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    const items = sorted.map((t) => {
      const lesson = t.lesson ? findEntry(t.lesson) : null;
      const el = h('div', { class: 'term' },
        h('dt', { class: 'term__name' },
          h('span', { class: 'term__word' }, t.term),
          h('span', { class: 'term__cat' }, CATS[t.cat] || '')),
        h('dd', { class: 'term__def' },
          h('p', null, t.def),
          lesson ? h('a', { class: 'term__link', href: `#l.${lesson.id}` }, icon('book', { size: 14 }), `Lesson: ${lesson.title}`) : null));
      return { t, el, hay: norm(`${t.term} ${t.aka || ''} ${t.def} ${CATS[t.cat] || ''}`), letter: letterOf(t) };
    });

    const sections = new Map();
    for (const it of items) {
      if (!sections.has(it.letter)) {
        const dl = h('dl', { class: 'term-list' });
        const sec = h('section', { class: 'glossary__group', id: `gl-${it.letter}`, 'aria-labelledby': `gl-h-${it.letter}` },
          h('h2', { class: 'glossary__letter', id: `gl-h-${it.letter}` }, it.letter), dl);
        sections.set(it.letter, { sec, dl, items: [] });
      }
      const s = sections.get(it.letter);
      s.dl.append(it.el);
      s.items.push(it);
    }

    const count = h('span', { class: 'glossary__count faint', 'aria-live': 'polite' });
    const empty = h('div', { class: 'glossary__empty card card--inset', hidden: true },
      h('p', null, h('strong', null, 'No terms match that search.')),
      h('p', { class: 'muted' }, 'Try a shorter word, or browse by letter.'));

    const chips = letters.map((L) => h('button', {
      type: 'button',
      class: 'az__chip mono',
      'data-letter': L,
      disabled: !sections.has(L),
      'aria-label': sections.has(L) ? `Jump to ${L}` : `${L} (no terms)`,
      on: { click: () => {
        if (search.value) {
          search.value = '';
          apply();
        }
        const s = sections.get(L);
        s?.sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      } },
    }, L));

    const search = h('input', {
      class: 'input glossary__search',
      type: 'search',
      placeholder: 'Search — try “RSI” or “wick”',
      'aria-label': 'Search the glossary',
      autocomplete: 'off',
      spellcheck: 'false',
      on: { input: () => apply() },
    });

    function apply() {
      const q = norm(search.value.trim());
      let shown = 0;
      for (const it of items) {
        const hit = !q || q.split(/\s+/).every((w) => it.hay.includes(w));
        it.el.hidden = !hit;
        if (hit) shown++;
      }
      for (const [L, s] of sections) {
        const any = s.items.some((it) => !it.el.hidden);
        s.sec.hidden = !any;
        const chip = chips.find((c) => c.dataset.letter === L);
        if (chip) chip.classList.toggle('is-dim', !any);
      }
      count.textContent = q ? `${shown} of ${items.length} terms` : `${items.length} terms`;
      empty.hidden = shown > 0;
    }

    root.append(h('div', { class: 'container glossary' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Reference'),
        h('h1', null, 'Glossary'),
        h('p', { class: 'lead' }, 'Every term used in the lessons and games, in plain English. Tap a lesson link to see it in action.')),
      h('div', { class: 'glossary__tools' },
        h('div', { class: 'glossary__searchwrap' }, icon('search', { size: 18 }), search, count),
        h('nav', { class: 'az', 'aria-label': 'Jump to letter' }, chips)),
      empty,
      h('div', { class: 'glossary__list' }, [...sections.values()].map((s) => s.sec))));

    apply();
  },
};
