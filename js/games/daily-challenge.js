// Daily Challenge — interactive GameShell module with question-relevant charts.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart, candleSVG } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, rsi } from '../core/indicators.js';
import { chartScenario } from '../core/patterns.js';
import { gameplayPreview, verdictFlourish, sampleCandle } from '../core/game-ui.js';

// [difficulty 0–2, question, options (the first is correct; shown shuffled), explanation, hint]
const BANK = [
  [0, "A candle opens at 100 and closes at 103. On a standard chart it is…", ["Green / bullish", "Red / bearish", "Grey", "A doji"], "<strong>Bullish.</strong> It closed above its open.", "Compare the close with the open."],
  [0, "Higher highs and higher lows describe…", ["An uptrend", "A downtrend", "A range", "A reversal"], "<strong>An uptrend:</strong> each swing goes a little higher.", "Both the peaks and the dips are rising."],
  [0, "Support is a price where…", ["Buyers have stepped in before", "Sellers always win", "Volume is zero", "The chart ends"], "<strong>Buyers stepped in before,</strong> so they may again.", "Think of a floor."],
  [1, "The 50-period MA crosses above the 200-period MA. This is…", ["A golden cross", "A death cross", "A divergence", "A fakeout"], "<strong>A golden cross:</strong> the faster average rises above the slower one.", "Golden is the bullish one."],
  [1, "Bid 1.0848, ask 1.0850. The spread is…", ["2 pips (0.0002)", "0.2 pips", "20 pips", "1.0849"], "<strong>2 pips.</strong> 1.0850 − 1.0848 = 0.0002.", "Ask minus bid; a pip is 0.0001 here."],
  [1, "Price breaks resistance, retests it from above and holds. The old resistance is now…", ["Support", "Resistance", "A trend line", "A gap"], "<strong>Support:</strong> role reversal.", "Broken ceilings often become floors."],
  [1, "RSI above 70 is usually called…", ["Overbought", "Oversold", "Neutral", "Divergent"], "<strong>Overbought:</strong> strong recent gains, not an automatic sell signal.", "70 is the upper line."],
  [2, "Entry 50, stop 48, target 56. Reward-to-risk?", ["3:1", "2:1", "1:3", "4:1"], "<strong>3:1.</strong> Reward 6 ÷ risk 2.", "Divide the distance to the target by the distance to the stop."],
  [2, "You risk 1% of a $10,000 account with a stop $2 away. How many shares?", ["50", "100", "500", "20"], "<strong>50 shares.</strong> $100 risk ÷ $2 per share.", "1% of $10,000 is your dollar risk."],
  [2, "Price makes a higher high while RSI makes a lower high. This is…", ["Bearish divergence", "Bullish divergence", "Hidden bullish divergence", "Confirmation"], "<strong>Bearish divergence:</strong> momentum is fading as price rises.", "Price and momentum disagree at the top."],
  [2, "A head and shoulders target is found by…", ["Projecting the head-to-neckline height from the breakout", "Doubling the left shoulder", "Using the 200 MA", "Taking the highest high"], "<strong>The measured move:</strong> the height from head to neckline, projected from the break.", "Measure the pattern, then project it."],
];
const CORRECT = BANK.map(() => 0);

const CHART_W = 440;
const CHART_H = 220;

/** Next unused question closest to the target difficulty; reuses the deck once it runs out. */
function pickQuestion(deck, used, difficulty) {
  if (used.size >= deck.length) used.clear();
  const target = Math.round(difficulty * 2);
  const open = deck.filter((i) => !used.has(i));
  const best = open.find((i) => BANK[i][0] === target) ?? open.find((i) => Math.abs(BANK[i][0] - target) === 1) ?? open[0];
  used.add(best);
  return best;
}

function wrapChart(node) {
  return h('div', { class: 'daily-chart', role: 'img' }, node);
}

/** Build one large illustrative chart keyed to the BANK question index. */
function questionChart(idx, seed) {
  const s = seed + idx * 17;
  switch (idx) {
    case 0: {
      const svg = candleSVG(
        { o: 100, h: 106, l: 98.5, c: 103 },
        { width: 72, height: 200, labels: true, prices: true, decimals: 1, ariaLabel: 'Bullish candle open 100 close 103' },
      );
      return wrapChart(svg);
    }
    case 1: {
      const ts = trendSeries({ seed: s, count: 36, direction: 'up', swings: 3, start: 100 });
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.1, showAxis: true,
        overlays: [
          { type: 'segment', a: { idx: 4, price: ts.candles[4].l }, b: { idx: 32, price: ts.candles[32].l }, color: 'bull', width: 1.5, dashed: true, label: 'Higher lows' },
        ],
        ariaLabel: 'Uptrend with higher highs and higher lows',
      }));
    }
    case 2: {
      const ts = trendSeries({ seed: s, count: 40, direction: 'up', swings: 4, start: 98 });
      const candles = ts.candles.map((k, i) => {
        if (i % 9 === 3 || i % 9 === 4) {
          const floor = 100;
          return { ...k, l: Math.min(k.l, floor), o: Math.max(k.o, floor + 0.3), c: Math.max(k.c, floor + 0.5), h: Math.max(k.h, floor + 1.2) };
        }
        return k;
      });
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [{ type: 'hline', price: 100, color: 'support', dashed: true, label: 'Support', width: 1.75 }],
        ariaLabel: 'Price bouncing at a support level',
      }));
    }
    case 3: {
      const ts = trendSeries({ seed: s + 3, count: 80, direction: 'up', swings: 2, start: 90, strength: 1.2 });
      const closes = ts.candles.map((k) => k.c);
      const ma50 = sma(closes, 20);
      const ma200 = sma(closes, 45);
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [
          { type: 'series', values: ma200, color: 'ma2', width: 2 },
          { type: 'series', values: ma50, color: 'ma1', width: 2 },
          { type: 'marker', idx: 62, position: 'below', shape: 'arrow', color: 'bull', text: 'Golden cross' },
        ],
        ariaLabel: 'Golden cross: faster MA rising above slower MA',
      }));
    }
    case 4: {
      const mid = 1.0849;
      const candles = trendSeries({ seed: s, count: 28, direction: 'up', swings: 2, start: mid }).candles.map((k) => ({
        ...k,
        o: +k.o.toFixed(4), h: +k.h.toFixed(4), l: +k.l.toFixed(4), c: +k.c.toFixed(4),
      }));
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.2, showAxis: true, decimals: 4,
        overlays: [
          { type: 'hline', price: 1.0850, color: 'bear', label: 'Ask 1.0850', width: 1.5 },
          { type: 'hline', price: 1.0848, color: 'bull', label: 'Bid 1.0848', width: 1.5 },
          { type: 'zone', from: 1.0848, to: 1.0850, color: 'accent', label: 'Spread 2 pips' },
        ],
        ariaLabel: 'Bid and ask levels showing a 2-pip spread',
      }));
    }
    case 5: {
      const ts = trendSeries({ seed: s + 5, count: 44, direction: 'up', swings: 3, start: 95 });
      const level = 102;
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [
          { type: 'hline', price: level, color: 'support', dashed: true, label: 'Old R → Support', width: 1.75 },
          { type: 'marker', idx: 28, price: level, position: 'above', shape: 'dot', color: 'accent', text: 'Break' },
          { type: 'marker', idx: 36, price: level, position: 'below', shape: 'dot', color: 'bull', text: 'Retest' },
        ],
        ariaLabel: 'Resistance broken then retested as support',
      }));
    }
    case 6: {
      const ts = trendSeries({ seed: s + 6, count: 40, direction: 'up', swings: 2, start: 100, strength: 1.4 });
      const r = rsi(ts.candles.map((k) => k.c), 14);
      const lastR = [...r].reverse().find((v) => Number.isFinite(v)) ?? 72;
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.1, showAxis: true,
        overlays: [
          { type: 'marker', idx: ts.candles.length - 1, position: 'above', shape: 'dot', color: 'warn', text: `RSI ~${Math.round(lastR)}` },
          { type: 'text', idx: Math.floor(ts.candles.length * 0.55), price: ts.candles[Math.floor(ts.candles.length * 0.55)].h * 1.01, text: 'Overbought zone', color: 'warn' },
        ],
        ariaLabel: 'Strong rally with RSI in overbought territory',
      }));
    }
    case 7: {
      const ts = trendSeries({ seed: s + 7, count: 32, direction: 'up', swings: 2, start: 49 });
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.16, showAxis: true,
        overlays: [
          { type: 'hline', price: 56, color: 'bull', label: 'Target 56', width: 1.5 },
          { type: 'hline', price: 50, color: 'accent', label: 'Entry 50', width: 1.75 },
          { type: 'hline', price: 48, color: 'bear', label: 'Stop 48', width: 1.5 },
          { type: 'zone', from: 48, to: 50, color: 'bear', label: 'Risk 2' },
          { type: 'zone', from: 50, to: 56, color: 'bull', label: 'Reward 6' },
        ],
        ariaLabel: 'Trade levels showing 3 to 1 reward to risk',
      }));
    }
    case 8: {
      const ts = trendSeries({ seed: s + 8, count: 30, direction: 'up', swings: 2, start: 48 });
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.16, showAxis: true,
        overlays: [
          { type: 'hline', price: 50, color: 'accent', label: 'Entry $50', width: 1.75 },
          { type: 'hline', price: 48, color: 'bear', label: 'Stop $48', width: 1.5 },
          { type: 'zone', from: 48, to: 50, color: 'bear', label: '$2 / share' },
          { type: 'text', idx: 8, price: 51.5, text: '1% of $10k = $100 → 50 shares', color: 'text' },
        ],
        ariaLabel: 'Entry and stop two dollars apart for position sizing',
      }));
    }
    case 9: {
      const ts = trendSeries({ seed: s + 9, count: 48, direction: 'up', swings: 3, start: 100 });
      const i1 = 22;
      const i2 = 40;
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [
          { type: 'segment', a: { idx: i1, price: ts.candles[i1].h }, b: { idx: i2, price: ts.candles[i2].h }, color: 'bear', width: 1.75, label: 'Price HH' },
          { type: 'segment', a: { idx: i1, price: ts.candles[i1].l + (ts.candles[i1].h - ts.candles[i1].l) * 0.35 }, b: { idx: i2, price: ts.candles[i2].l + (ts.candles[i2].h - ts.candles[i2].l) * 0.15 }, color: 'warn', width: 1.5, dashed: true, label: 'RSI LH' },
          { type: 'marker', idx: i2, position: 'above', shape: 'dot', color: 'bear', text: 'Bearish div' },
        ],
        ariaLabel: 'Price higher high with fading RSI — bearish divergence',
      }));
    }
    case 10: {
      try {
        const sc = chartScenario('head-and-shoulders', { seed: s + 10, count: 90, after: 8, outcome: 'success' });
        const neck = Number.isFinite(sc.level)
          ? sc.level
          : (sc.neckline && Number.isFinite(sc.neckline.y1) ? sc.neckline.y1 : sc.candles[Math.floor(sc.candles.length * 0.55)].l);
        const overlays = [
          { type: 'hline', price: neck, color: 'resistance', dashed: true, label: 'Neckline', width: 1.75 },
        ];
        if (sc.keyPoints) {
          for (const kp of sc.keyPoints) {
            if (kp.label && kp.label !== 'Breakout') {
              overlays.push({ type: 'marker', idx: kp.idx, price: kp.price, position: 'above', shape: 'dot', color: 'accent', text: kp.label });
            }
          }
        }
        if (Number.isFinite(sc.breakoutIdx)) {
          overlays.push({ type: 'marker', idx: sc.breakoutIdx, position: 'below', shape: 'arrow', color: 'bear', text: 'Break' });
        }
        const end = Math.min(sc.candles.length, (sc.breakoutIdx ?? sc.candles.length - 1) + 8);
        return wrapChart(miniChart(sc.candles.slice(0, end), {
          width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
          overlays,
          ariaLabel: 'Head and shoulders pattern with neckline',
        }));
      } catch {
        const ts = trendSeries({ seed: s + 10, count: 50, direction: 'down', swings: 4, start: 110 });
        return wrapChart(miniChart(ts.candles, {
          width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
          overlays: [{ type: 'hline', price: 100, color: 'resistance', dashed: true, label: 'Neckline' }],
          ariaLabel: 'Head and shoulders style chart with neckline',
        }));
      }
    }
    default:
      return wrapChart(sampleCandle('bull', { width: 64, height: 160 }));
  }
}

export default {
  id: 'daily-challenge',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 99, direction: 'up', title: 'Daily Challenge', score: 880, streak: 7, round: '1/1' }),
      rounds: 5,
      timer: { seconds: 25, perRound: true },
      howTo: ["Five questions, the same for everyone today.", "Answer fast: streaks multiply your score.", "Come back tomorrow to keep your streak alive."],
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        stage.append(questionChart(current, rng.int(1, 5000)));
        g.ask({
          question: q[1],
          options: rng.shuffle(q[2].map((label, i) => ({ label, value: i }))),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
          onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Daily locked' : 'Review & retry', detail: (q[3] || '').replace(/<[^>]+>/g, ' ').slice(0, 140), scoreDelta: ok ? 100 : 0 }),
        });
      },
    });
    return () => game.destroy();
  },
};
