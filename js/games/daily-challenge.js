// Daily Challenge — interactive GameShell module with question-relevant charts.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart, candleSVG } from '../core/chart.js';
import { trendSeries, synthesize } from '../core/data.js';
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
  [0, "A candle closes above its open. Which side controlled that session?", ["Buyers, on net", "Sellers, on net", "Neither side traded", "The exchange set the close"], "<strong>Buyers, on net.</strong> A close above the open is a bullish candle.", "Compare the open and close, not the wick.", 0],
  [0, "On the candle shown, the upper wick spans which prices?", ["Close 103 to high 106", "Low 98.5 to open 100", "Open 100 to close 103", "Low 98.5 to high 106"], "<strong>103 to 106.</strong> The upper wick runs from the body top to the high.", "Find the top of the body first.", 0],
  [0, "When swing lows step upward, what does that suggest?", ["Buyers are defending progressively higher prices", "Each low must break support", "Volume must be zero", "The next candle cannot fall"], "<strong>Higher lows</strong> show buyers stepping in at higher prices; no trend is guaranteed forever.", "Look at where buyers enter each dip.", 1],
  [0, "What is the safest way to use a support line?", ["Treat it as an area to watch for a reaction", "Assume price cannot cross it", "Buy every touch without a stop", "Place every target exactly on it"], "<strong>Watch the reaction.</strong> Support is a zone inferred from prior behavior, not a guaranteed floor.", "Does a past bounce guarantee the next one?", 2],
  [0, "Price breaks an old ceiling and then holds above it on a retest. What changed?", ["The ceiling may now act as support", "Volume must disappear", "The trend must reverse down", "The bid and ask became equal"], "<strong>Role reversal.</strong> Old resistance can become support after a confirmed break and retest.", "A former ceiling can become a floor.", 5],
  [0, "A chart makes higher highs but lower lows at the same time. Is that a clean uptrend?", ["No, the structure is mixed", "Yes, highs alone define it", "Yes, lows do not matter", "It must be a golden cross"], "<strong>Mixed structure.</strong> A clean uptrend needs higher highs and higher lows.", "Check both sides of the swing structure.", 11],
  [1, "Which average usually reacts faster to fresh price changes?", ["The shorter-period average", "The longer-period average", "They always react equally", "Neither uses recent closes"], "<strong>The shorter average</strong> uses fewer past values and usually responds sooner.", "Fewer observations mean less lag.", 3],
  [1, "If the ask rises while the bid stays fixed, what happens to the spread?", ["It widens", "It narrows", "It becomes negative", "It stays unchanged"], "<strong>It widens.</strong> Spread equals ask minus bid.", "Subtract bid from ask.", 4],
  [1, "What does RSI above 70 prove by itself?", ["Only that recent gains are strong by that measure", "That price must fall next candle", "That a short trade is risk-free", "That the 200 MA crossed"], "<strong>Strong recent gains.</strong> Overbought can persist and is not an automatic short signal.", "An indicator reading is context, not certainty.", 6],
  [1, "Entry 50 and stop 48: how much is risked per share?", ["$2", "$48", "$50", "$98"], "<strong>$2 per share.</strong> Entry minus stop is the planned risk distance.", "Subtract the stop from the entry.", 7],
  [1, "On a $10,000 account, what is a 1% risk budget?", ["$100", "$10", "$1,000", "$500"], "<strong>$100.</strong> Multiply account size by 0.01.", "One percent means one hundredth.", 8],
  [1, "Which clue would weaken an upside breakout at resistance?", ["A quick close back below the old ceiling", "A decisive close above it", "A successful retest from above", "Volume expansion with follow-through"], "<strong>Close back inside.</strong> A failed break can trap late buyers.", "Did price hold beyond the level?", 12],
  [2, "Entry 50, stop 48, exit 54. What was the trade result before costs?", ["+2R", "+1R", "+3R", "−2R"], "<strong>+2R.</strong> The $4 gain is twice the $2 planned risk.", "Gain divided by initial risk per share.", 13],
  [2, "Entry 50, stop 48, and 50 shares. What is the planned dollar loss if stopped?", ["$100", "$50", "$200", "$2"], "<strong>$100.</strong> $2 per share × 50 shares.", "Risk per share multiplied by shares.", 8],
  [2, "A strategy wins 40% at +2R and loses 60% at −1R. Expectancy?", ["+0.2R", "−0.2R", "+0.8R", "0R"], "<strong>+0.2R.</strong> 0.4 × 2 − 0.6 × 1.", "Weighted average of win and loss outcomes.", 14],
  [2, "What does bearish RSI divergence guarantee?", ["Nothing; it warns momentum may be fading", "An immediate reversal", "A profitable short trade", "A specific measured target"], "<strong>No guarantee.</strong> Divergence can persist before any reversal, if one comes at all.", "A warning is not a forecast with certainty.", 9],
  [2, "Why measure from a head and shoulders neckline rather than from the left shoulder?", ["The head-to-neckline height defines the pattern's measured move", "The left shoulder is always the highest point", "The neckline cannot slope", "Targets are fixed by the 200 MA"], "<strong>Head to neckline</strong> is the usual measured-move height; it remains an estimate.", "Find the maximum pattern height.", 10],
  [2, "Two open trades each risk 1.5R. If the desk caps combined open risk at 3R, can it add another 1R trade?", ["No; that would raise heat to 4R", "Yes; each trade is separate", "Yes if both are in profit", "Only if the new trade has no stop"], "<strong>No.</strong> 1.5R + 1.5R + 1R = 4R, above the 3R cap.", "Add all open risk before adding a trade.", 16],
  [2, "A strong rally leaves RSI above 70 for several bars. Which response follows a written plan?", ["Wait for a defined setup and risk level", "Short immediately on the first 70 print", "Remove stops on long trades", "Double size because RSI is high"], "<strong>Use the plan.</strong> An extreme reading is context; it does not replace an entry and stop.", "What independent trigger is present?", 6],
];
const CORRECT = BANK.map(() => 0);

const CHART_W = 720;
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
  // Keep timed questions and their evidence on one desktop viewport. A labelled candle SVG has
  // a tall viewBox and needs its own width cap so it does not stretch into a giant poster.
  if (node.classList?.contains('tc-candle-svg')) node.style.maxWidth = '360px';
  return h('div', { class: 'daily-chart', style: { maxWidth: '840px', marginInline: 'auto' } }, node);
}

/** Build one large illustrative chart keyed to the BANK question index. */
function questionChart(idx, seed) {
  const s = seed + idx * 17;
  switch (idx) {
    case 0: {
      const svg = candleSVG(
        { o: 100, h: 106, l: 98.5, c: 103 },
        { width: 72, height: 200, labels: true, prices: true, decimals: 1, ariaLabel: 'Candle with open 100, high 106, low 98.5 and close 103' },
      );
      return wrapChart(svg);
    }
    case 1: {
      const ts = trendSeries({ seed: s, count: 36, direction: 'up', swings: 3, start: 100 });
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.1, showAxis: true,
        overlays: [
          { type: 'segment', a: { idx: 4, price: ts.candles[4].l }, b: { idx: 32, price: ts.candles[32].l }, color: 'bull', width: 1.5, dashed: true },
        ],
        ariaLabel: 'Price chart with marked swing lows',
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
        overlays: [{ type: 'hline', price: 100, color: 'support', dashed: true, label: 'Level', width: 1.75 }],
        ariaLabel: 'Price chart repeatedly approaching a marked level',
      }));
    }
    case 3: {
      // Construct an actual 50/200 crossing rather than labelling a 20/45 illustration as one.
      const closes = Array.from({ length: 260 }, (_, i) => i < 170 ? 112 - 0.12 * i : 91.6 + 0.3 * (i - 170));
      const candles = synthesize(closes, { seed: s + 3, scale: 0.6 });
      const ma50 = sma(closes, 50);
      const ma200 = sma(closes, 200);
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [
          { type: 'series', values: ma200, color: 'ma2', width: 2 },
          { type: 'series', values: ma50, color: 'ma1', width: 2 },
        ],
        ariaLabel: 'Price chart with 50-period and 200-period moving averages',
      }));
    }
    case 4: {
      const mid = 1.0849;
      const closes = Array.from({ length: 28 }, (_, i) => mid + Math.sin(i / 3) * 0.00024);
      const candles = synthesize(closes, { seed: s, scale: 0.00012 }).map((k) => ({
        ...k, o: +k.o.toFixed(4), h: +k.h.toFixed(4), l: +k.l.toFixed(4), c: +k.c.toFixed(4),
      }));
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.2, showAxis: true, decimals: 4,
        overlays: [
          { type: 'hline', price: 1.0850, color: 'bear', label: 'Ask 1.0850', width: 1.5 },
          { type: 'hline', price: 1.0848, color: 'bull', label: 'Bid 1.0848', width: 1.5 },
          { type: 'zone', from: 1.0848, to: 1.0850, color: 'accent', label: 'Bid–ask gap' },
        ],
        ariaLabel: 'Bid and ask levels on a forex chart',
      }));
    }
    case 5: {
      const ts = trendSeries({ seed: s + 5, count: 44, direction: 'up', swings: 3, start: 95 });
      const level = 102;
      return wrapChart(miniChart(ts.candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [
          { type: 'hline', price: level, color: 'support', dashed: true, label: 'Retest level', width: 1.75 },
          { type: 'marker', idx: 28, price: level, position: 'above', shape: 'dot', color: 'accent', text: 'Break' },
          { type: 'marker', idx: 36, price: level, position: 'below', shape: 'dot', color: 'bull', text: 'Retest' },
        ],
        ariaLabel: 'Price chart with a break and retest at a marked level',
      }));
    }
    case 6: {
      const closes = Array.from({ length: 40 }, (_, i) => 100 + 0.35 * i + 0.05 * Math.sin(i));
      const candles = synthesize(closes, { seed: s + 6, scale: 0.45 });
      const r = rsi(candles.map((k) => k.c), 14);
      const lastR = [...r].reverse().find((v) => Number.isFinite(v)) ?? 72;
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.1, showAxis: true,
        overlays: [
          { type: 'marker', idx: candles.length - 1, position: 'above', shape: 'dot', color: 'warn', text: `RSI ${Math.round(lastR)}` },
        ],
        ariaLabel: `Rising price chart with RSI reading ${Math.round(lastR)}`,
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
          { type: 'zone', from: 48, to: 50, color: 'bear', label: 'Risk zone' },
          { type: 'zone', from: 50, to: 56, color: 'bull', label: 'Reward zone' },
        ],
        ariaLabel: 'Trade chart with entry, stop and target levels',
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
        ],
        ariaLabel: 'Price chart with two marked swing highs; momentum details are in the question',
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
    case 11: {
      const pivots = [100, 104, 96, 106, 94, 108, 92, 110, 90, 112];
      const closes = pivots.flatMap((price, i) => i === pivots.length - 1 ? [price]
        : Array.from({ length: 4 }, (_, j) => price + (pivots[i + 1] - price) * j / 4));
      const candles = synthesize(closes, { seed: s + 11, scale: 0.1 });
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.12, showAxis: true,
        overlays: [
          { type: 'segment', a: { idx: 4, price: candles[4].h }, b: { idx: 28, price: candles[28].h }, color: 'bull', width: 1.5, dashed: true },
          { type: 'segment', a: { idx: 8, price: candles[8].l }, b: { idx: 32, price: candles[32].l }, color: 'bear', width: 1.5, dashed: true },
        ],
        ariaLabel: 'Price chart with marked swing highs and lows',
      }));
    }
    case 12: {
      const closes = [97, 97.5, 98.1, 98.7, 99.2, 99.6, 100.2, 101, 101.4, 100.8, 99.7, 99.2, 98.8, 98.4];
      const candles = synthesize(closes, { seed: s + 12, scale: 0.12 });
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.16, showAxis: true,
        overlays: [{ type: 'hline', price: 100, color: 'resistance', dashed: true, label: 'Old ceiling', width: 1.75 }],
        ariaLabel: 'Price chart with candles on both sides of a marked old ceiling',
      }));
    }
    case 13: {
      const closes = Array.from({ length: 28 }, (_, i) => 50 + 4 * i / 27 + 0.12 * Math.sin(i / 2));
      const candles = synthesize(closes, { seed: s + 13, scale: 0.1 });
      return wrapChart(miniChart(candles, {
        width: CHART_W, height: CHART_H, yPad: 0.2, showAxis: true,
        overlays: [
          { type: 'hline', price: 54, color: 'bull', label: 'Exit 54', width: 1.5 },
          { type: 'hline', price: 50, color: 'accent', label: 'Entry 50', width: 1.75 },
          { type: 'hline', price: 48, color: 'bear', label: 'Stop 48', width: 1.5 },
        ],
        ariaLabel: 'Trade chart with entry, stop and exit levels',
      }));
    }
    case 14:
      return wrapChart(h('div', { class: 'card', style: { padding: '1rem', width: '100%' } },
        h('p', { class: 'eyebrow' }, 'Strategy outcomes'),
        h('div', { class: 'row row--sm' },
          h('span', { class: 'chip chip--accent' }, '40% wins · +2R'),
          h('span', { class: 'chip' }, '60% losses · −1R'))));
    case 16:
      return wrapChart(h('div', { class: 'card', style: { padding: '1rem', width: '100%' } },
        h('p', { class: 'eyebrow' }, 'Desk risk limit · 3R'),
        h('div', { class: 'row row--sm' },
          h('span', { class: 'chip' }, 'Open trade A · 1.5R'),
          h('span', { class: 'chip' }, 'Open trade B · 1.5R'),
          h('span', { class: 'chip chip--accent' }, 'Proposed trade · 1R'))));
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
      preview: (el) => gameplayPreview(el, { seed: 99, direction: 'up', title: 'Daily Challenge', score: 200, streak: 2, round: '2/5', width: 520, height: 200 }),
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
        const chart = questionChart(q[5] ?? current, rng.int(1, 5000));
        stage.append(chart);
        const quiz = g.ask({
          question: q[1],
          options: rng.shuffle(q[2].map((label, i) => ({ label, value: i }))),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
          onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Daily locked' : 'Review & retry', detail: (q[3] || '').replace(/<[^>]+>/g, ' ').slice(0, 140), scoreDelta: ok ? 100 : 0 }),
        });
        stage.insertBefore(quiz, chart);
      },
    });
    return () => game.destroy();
  },
};
