// Setup Swipe — Take or Skip a described setup; the card's chart shows that setup.
// Charts come from the scanner's simRound (a genuine detected setup of the card's kind) or from
// small builders (a pullback that ends in a candle pattern, a range, a runaway trend), so what
// the card says is what the chart shows. After the call, the chart reveals one sample outcome.
import { GameShell, QuestionBank, trackAnswer, bindSwipeCard } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { candleScenario } from '../core/patterns.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { rsi } from '../core/indicators.js';
import { gameplayPreview, swipeCard, verdictFlourish } from '../core/game-ui.js';

// { id, level 0–2, text, take (the disciplined call), explain, why (shown when you get it wrong),
//   hint, chart: { t: 'sim', kinds, plus? (extra candles shown), lowVolume?, rsi? }
//               | { t: 'pullback', trend: 'up'|'down', pattern, plus? } | { t: 'range', doji? }
//               | { t: 'runaway', trend } }
export const CARDS = [
  {
    id: 'ss-uptrend-engulfing', level: 0, take: true,
    text: 'Uptrend. A short pullback ends with a bullish engulfing candle. Stop below the engulfing low; the prior high is 2.5R away.',
    explain: '<strong>Take.</strong> Trend, pullback and trigger agree, the stop is defined and the reward is well above the risk.',
    why: 'Nothing is missing here: trend, a pullback, a trigger candle, a defined stop and 2.5R of reward. Skipping every good setup is also a way to fail.',
    hint: 'Count the reasons: trend, location, trigger, reward-to-risk.',
    chart: { t: 'pullback', trend: 'up', pattern: 'bullish-engulfing' },
  },
  {
    id: 'ss-bull-flag', level: 0, take: true,
    text: 'A sharp rally (the pole), a tight flag drifting down, then a close above the flag. Stop below the flag low, target 2R.',
    explain: '<strong>Take.</strong> A continuation pattern in the trend’s direction, a trigger (the close above the flag) and a defined stop.',
    why: 'This is a complete plan: pattern, trigger, stop and 2R target. Waiting for something “more certain” means waiting for something that doesn’t exist.',
    hint: 'Is there a trigger and a stop?',
    chart: { t: 'sim', kinds: ['bull-flag'] },
  },
  {
    id: 'ss-mid-range', level: 0, take: false,
    text: 'No clear trend. Price sits in the middle of a range with no trigger candle. Buy here?',
    explain: '<strong>Skip.</strong> Mid-range with no trigger is a coin flip with a spread attached.',
    why: 'In the middle of a range there is no level to lean on and no logical stop: the nearest support and resistance are equally far away.',
    hint: 'Where is the level? Where is the trigger?',
    chart: { t: 'range' },
  },
  {
    id: 'ss-no-stop', level: 0, take: false,
    text: 'A bull flag breaks out. You plan to enter without a stop and “see how it goes”.',
    explain: '<strong>Skip.</strong> Without a stop, the loss has no limit and position size can’t be calculated.',
    why: 'The pattern may be fine, but the plan is not: no stop means no defined risk. A good chart does not fix a bad plan.',
    hint: 'What is the maximum you can lose?',
    chart: { t: 'sim', kinds: ['bull-flag'] },
  },
  {
    id: 'ss-oversized', level: 0, take: false,
    text: 'A textbook bounce off support. To make it “worth it”, you would risk 10% of the account on this one trade.',
    explain: '<strong>Skip (or resize).</strong> A good setup at 10% risk is a bad trade: a few normal losses would do serious damage to the account.',
    why: 'The setup is fine; the size is not. Ten percent risk per trade means a normal losing streak can wipe out a large part of the account. Size it at your plan’s risk instead.',
    hint: 'How many losses in a row could you survive at that size?',
    chart: { t: 'sim', kinds: ['support-bounce'] },
  },
  {
    id: 'ss-doji-chop', level: 0, take: false,
    text: 'A doji prints in the middle of a choppy range. Trade it as a reversal signal?',
    explain: '<strong>Skip.</strong> A doji shows indecision. In the middle of a range there is nothing to reverse.',
    why: 'Reversal candles need something to reverse: a trend into a level. A doji in the middle of chop is just more chop.',
    hint: 'What would the doji be reversing?',
    chart: { t: 'range', doji: true },
  },
  {
    id: 'ss-low-volume-breakout', level: 1, take: false,
    text: 'Breakout above resistance on the lowest volume in weeks, and the stop would be three times wider than usual.',
    explain: '<strong>Skip.</strong> Weak volume and poor risk: this is how many fakeouts look.',
    why: 'A break through resistance on almost no volume shows little conviction, and a stop three times wider means a smaller position or a bigger loss. Two red flags at once.',
    hint: 'Check the volume bar and the size of the stop.',
    chart: { t: 'sim', kinds: ['breakout-up'], lowVolume: true },
  },
  {
    id: 'ss-hammer-confirmed', level: 1, take: true,
    text: 'After a downtrend, a hammer prints at the low and the next candle closes above the hammer’s high. Stop under the wick, target 2R.',
    explain: '<strong>Take.</strong> Context, pattern and confirmation are all there, with a clear stop.',
    why: 'The waiting is already done: the hammer came after a decline and the next close confirmed it. The stop under the wick defines the risk.',
    hint: 'Was the pattern confirmed?',
    chart: { t: 'sim', kinds: ['hammer'], outcome: 'success', plus: 1 },
  },
  {
    id: 'ss-pullback-hammer', level: 1, take: true,
    text: 'Uptrend. A short pullback ends in a hammer, and the next candle closes above its high. Stop under the hammer’s low, target the prior high, 2.5R.',
    explain: '<strong>Take.</strong> Buying a confirmed pullback in an uptrend, with a tight, logical stop.',
    why: 'Trend, pullback, confirmed trigger, defined stop and 2.5R: everything a plan needs.',
    hint: 'Trend + pullback + confirmation.',
    chart: { t: 'pullback', trend: 'up', pattern: 'hammer', plus: 1 },
  },
  {
    id: 'ss-downtrend-engulfing', level: 1, take: true,
    text: 'Downtrend. A bounce stalls and prints a bearish engulfing candle. Stop above the engulfing high, target the recent low, 2R.',
    explain: '<strong>Take.</strong> Selling a failed bounce in a downtrend: trend, trigger and a defined stop line up.',
    why: 'This is the mirror of buying a pullback in an uptrend: trend, a bounce, a bearish trigger, a stop above it and 2R.',
    hint: 'Which way is the trend, and where is the trigger?',
    chart: { t: 'pullback', trend: 'down', pattern: 'bearish-engulfing' },
  },
  {
    id: 'ss-bear-flag', level: 1, take: true,
    text: 'A sharp drop (the pole), a flag drifting up, then a close below the flag. Stop above the flag high, target 2R.',
    explain: '<strong>Take.</strong> A continuation pattern with the trend, a trigger and a defined stop.',
    why: 'Pattern, trigger, stop and target are all defined. Short setups follow the same rules as long ones.',
    hint: 'Is the trigger in the trend’s direction?',
    chart: { t: 'sim', kinds: ['bear-flag'] },
  },
  {
    id: 'ss-support-bounce', level: 1, take: true,
    text: 'Price returns to a support level that held twice before and closes green off it. Stop below support, target near resistance, 2R.',
    explain: '<strong>Take.</strong> A tested level, a reaction candle and a stop just beyond the level.',
    why: 'The level has history, the bounce candle is the trigger, and the stop sits where the idea is wrong (below support). That is a complete plan.',
    hint: 'Level, reaction, stop beyond the level.',
    chart: { t: 'sim', kinds: ['support-bounce'] },
  },
  {
    id: 'ss-into-resistance', level: 1, take: false,
    text: 'Price is back at a resistance that has rejected it twice, and the latest candle is already turning down. Buy here, hoping for a breakout?',
    explain: '<strong>Skip.</strong> Buying into resistance leaves almost no reward before the level, and the chart shows sellers defending it.',
    why: 'Longs just under resistance risk a full stop for a few cents of reward, and here the level is actively rejecting price. Wait for a breakout close, or look at the short side.',
    hint: 'How far is it to the level that keeps stopping price?',
    chart: { t: 'sim', kinds: ['resistance-reject'] },
  },
  {
    id: 'ss-loss-limit', level: 1, take: false,
    text: 'A clean bull flag breakout, the kind you like, but you already hit your daily loss limit.',
    explain: '<strong>Skip.</strong> The loss limit exists for exactly this moment.',
    why: 'The chart is fine; the day is over. A loss limit only protects you if it holds when a tempting setup appears.',
    hint: 'What does your plan say about today?',
    chart: { t: 'sim', kinds: ['bull-flag'] },
  },
  {
    id: 'ss-earnings', level: 1, take: false,
    text: 'A clean breakout, but the company reports earnings tonight and your plan says no new positions before earnings.',
    explain: '<strong>Skip.</strong> An earnings gap can jump straight over your stop; your plan rules it out.',
    why: 'Earnings can gap price far beyond your stop overnight, so the risk is no longer the risk you planned. Your own rule already answers this one.',
    hint: 'Can a stop protect you from an overnight gap?',
    chart: { t: 'sim', kinds: ['breakout-up'] },
  },
  {
    id: 'ss-chase', level: 1, take: false,
    text: 'The stock has rallied for days with no pullback. Buying now means a stop far below at the last swing low, with no level or trigger.',
    explain: '<strong>Skip.</strong> That is chasing: a big stop, no trigger and no location. Wait for a pullback or a base.',
    why: 'Strength alone is not a setup. Buying late in a run means a wide stop and poor reward-to-risk, just when a pullback is likely.',
    hint: 'Where would the stop go, and how far is it?',
    chart: { t: 'runaway', trend: 'up' },
  },
  {
    id: 'ss-revenge', level: 1, take: false,
    text: 'You just lost on this stock and want back in immediately on a weaker version of the same breakout.',
    explain: '<strong>Skip.</strong> “Getting it back” from one particular stock is revenge trading, not a setup.',
    why: 'The market doesn’t know you lost. A weaker setup taken to erase a loss is the emotion trading, not the plan.',
    hint: 'Would you take this setup if you hadn’t just lost?',
    chart: { t: 'sim', kinds: ['breakout-up'] },
  },
  {
    id: 'ss-double-bottom', level: 1, take: true,
    text: 'Double bottom: two matching lows, then a close above the high between them (the neckline). Stop below the middle of the pattern, measured target about 2R.',
    explain: '<strong>Take.</strong> A completed pattern, a trigger (the neckline close) and a stop that makes the measured move worth about 2R.',
    why: 'The pattern is complete, the trigger has fired and the stop is defined. That is a full plan.',
    hint: 'Has the pattern completed?',
    chart: { t: 'sim', kinds: ['double-bottom'] },
  },
  {
    id: 'ss-double-top', level: 1, take: true,
    text: 'Double top: two matching highs, then a close below the low between them. Short the close, stop above the middle of the pattern, measured target about 2R.',
    explain: '<strong>Take.</strong> A completed reversal pattern with a trigger, a stop and a reasonable target.',
    why: 'The neckline close is the trigger, the stop is defined and the measured move gives about 2R.',
    hint: 'Neckline, trigger, stop.',
    chart: { t: 'sim', kinds: ['double-top'] },
  },
  {
    id: 'ss-divergence-no-break', level: 2, take: false,
    text: 'Price makes a higher high while RSI makes a lower high (bearish divergence). Structure has not broken: no lower low yet. Short now?',
    explain: '<strong>Skip.</strong> Divergence is a warning, not a trigger. Wait for structure to break.',
    why: 'Divergence can last a long time while price keeps rising. Without a break in structure there is no trigger and no logical stop for the short.',
    hint: 'Has price actually made a lower low yet?',
    chart: { t: 'sim', kinds: ['bearish-divergence'], rsi: true },
  },
  {
    id: 'ss-bull-div-no-trigger', level: 2, take: false,
    text: 'Price makes a lower low while RSI makes a higher low (bullish divergence). Buy now, before any higher high, with the stop “somewhere below”?',
    explain: '<strong>Skip.</strong> Divergence plus a vague stop is not a plan. Wait for a trigger and define the stop.',
    why: 'The divergence is real, but “somewhere below” is not a stop and there is no trigger yet. Define both, or pass.',
    hint: 'Where exactly is the stop?',
    chart: { t: 'sim', kinds: ['bullish-divergence'], rsi: true },
  },
  {
    id: 'ss-fakeout-fade', level: 2, take: true,
    text: 'Price broke above resistance, then closed back below it within a few candles (a failed breakout). Short that close, stop above the failed high, target the range floor, 2.5R.',
    explain: '<strong>Take.</strong> Failed breakouts trap late buyers; the failed high gives a clear, close stop.',
    why: 'Fading a failed breakout is a defined setup: the close back inside is the trigger and the failed high is where the idea is wrong.',
    hint: 'Where are the trapped traders’ stops?',
    chart: { t: 'sim', kinds: ['fakeout-up'] },
  },
  {
    id: 'ss-golden-cross-late', level: 2, take: false,
    text: 'The 50-day average just crossed above the 200-day (a golden cross) after a long rally. No level and no trigger: buy only because of the cross?',
    explain: '<strong>Skip.</strong> Crosses lag price. On its own, a golden cross is a trend filter, not an entry.',
    why: 'By the time the averages cross, much of the move has often happened. Use the cross as context, then find a level and a trigger.',
    hint: 'What do moving average crosses lag?',
    chart: { t: 'sim', kinds: ['golden-cross'] },
  },
  {
    id: 'ss-counter-star', level: 2, take: false,
    text: 'Strong uptrend. A single shooting star prints at a new high, with no confirmation yet. Short it immediately, against the trend?',
    explain: '<strong>Skip.</strong> One unconfirmed candle against a strong trend is a guess. Wait for confirmation, or trade with the trend.',
    why: 'Shooting stars need confirmation (a close below the star’s low), and counter-trend trades deserve extra evidence, not less.',
    hint: 'Has anything confirmed the reversal?',
    chart: { t: 'sim', kinds: ['shooting-star'] },
  },
];

/** Uptrend (downtrend) then a short counter move ending in a candle pattern from candleScenario. */
function pullbackCandles(rng, { trend = 'up', pattern, after = 8 }) {
  const pre = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: 28, direction: trend, swings: 2, start: 100 }).candles;
  const sc = candleScenario(pattern, {
    seed: rng.int(1, 2 ** 31 - 1), leadIn: 6, after, start: pre[pre.length - 1].c, outcome: 'success',
  });
  const candles = [...pre, ...sc.candles].map((k, i) => ({ ...k, t: i }));
  return { candles, decisionIdx: pre.length + sc.end, patternStart: pre.length + sc.start };
}

/** The card's chart data: { candles, decisionIdx, setup?, lead?, rsi? } — never null. */
export function cardRound(card, rng) {
  const c = card.chart || { t: 'range' };
  const plus = c.plus || 0;
  if (c.t === 'sim') {
    const r = simRound(rng, { kinds: c.kinds, before: 60, after: 14, outcome: c.outcome || undefined })
      || simRound(rng.fork('retry'), { kinds: c.kinds, before: 50, after: 10, count: 600, outcome: c.outcome || undefined });
    if (r) {
      const candles = r.candles.map((k) => ({ ...k }));
      if (c.lowVolume) {
        const d = r.decisionIdx;
        const prev = candles.slice(Math.max(0, d - 20), d).map((k) => k.v).filter(Number.isFinite);
        if (prev.length) candles[d].v = Math.max(1, Math.round(Math.min(...prev) * 0.8));
      }
      return { candles, decisionIdx: Math.min(candles.length - 1, r.decisionIdx + plus), setup: r.setup, lead: r.lead, level: r.setup?.meta?.level };
    }
  }
  if (c.t === 'pullback') {
    const r = pullbackCandles(rng, { trend: c.trend, pattern: c.pattern });
    return { candles: r.candles, decisionIdx: Math.min(r.candles.length - 1, r.decisionIdx + plus), box: [r.patternStart, r.decisionIdx] };
  }
  if (c.t === 'runaway') {
    const candles = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: 40, direction: c.trend || 'up', swings: 1, start: 100, strength: 1.8 }).candles;
    return { candles, decisionIdx: candles.length - 1 };
  }
  // Range (also the fallback for a sim card that found nothing).
  const candles = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: 44, direction: 'range', swings: 3, start: 100 }).candles.map((k) => ({ ...k }));
  const hi = Math.max(...candles.map((k) => k.h));
  const lo = Math.min(...candles.map((k) => k.l));
  // End mid-range: pull the last few candles toward the middle.
  const mid = (hi + lo) / 2;
  const last = candles[candles.length - 1];
  const shift = mid - last.c;
  for (let i = candles.length - 4; i < candles.length; i++) {
    const w = (i - (candles.length - 5)) / 4;
    const k = candles[i];
    candles[i] = { ...k, o: k.o + shift * w, h: k.h + shift * w, l: k.l + shift * w, c: k.c + shift * w };
  }
  if (c.doji) {
    const p = candles[candles.length - 1].c;
    const R = (hi - lo) * 0.12;
    candles.push({ o: p, h: p + R, l: p - R, c: p + R * 0.03, v: candles[candles.length - 1].v, t: candles.length });
  }
  return { candles, decisionIdx: candles.length - 1, range: [lo, hi] };
}

export default {
  id: 'setup-swipe',
  mount(root, ctx) {
    const bank = new QuestionBank(CARDS, { id: 'setup-swipe' });
    let current = null;
    const game = new GameShell(root, ctx, {
      rounds: 7,
      timer: { seconds: 14, perRound: true },
      howTo: [
        'A setup appears with its trend, level, trigger and risk.',
        'Take it or skip it before the clock runs out.',
        'Discipline scores: skipping a weak setup is a win.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 55, direction: 'up', title: 'Setup Swipe', score: 610, streak: 5, round: '4/7' }),
      onStart(g, { rng }) {
        bank.reset(rng, g.store);
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry || !current) current = bank.next(difficulty);
        const q = current;
        const r = cardRound(q, rng);
        const host = h('div', { class: 'chart-frame' });
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 230, decimals: 2, yPad: 0.12, showVolume: !!q.chart?.lowVolume,
          ariaLabel: `Setup chart: ${q.text}`,
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        if (r.range) {
          chart.addHLine({ price: r.range[1], color: 'resistance', dashed: true, label: 'Range high' });
          chart.addHLine({ price: r.range[0], color: 'support', dashed: true, label: 'Range low' });
        }
        if (r.box) chart.addBox({ from: r.box[0], to: r.box[1], color: 'accent' });
        if (q.chart?.rsi) {
          const lead = Array.isArray(r.lead) ? r.lead : [];
          chart.addPane({
            id: 'rsi', title: 'RSI 14', height: 70, range: [0, 100],
            levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }],
            series: [{ values: rsi([...lead, ...r.candles].map((k) => k.c), 14).slice(lead.length), color: 'ma3' }],
          });
        }
        let answered = false;
        const finish = (take) => {
          if (answered) return;
          answered = true;
          const ok = take === q.take;
          trackAnswer(g.store, 'setup-swipe', q.id, ok);
          if (ok) g.correct(q.explain);
          else g.wrong(`<span class="game__why">${q.why}</span><br>${q.explain}`);
          if (r.candles.length > r.decisionIdx + 1) chart.reveal({ to: r.candles.length, interval: 45 });
          if (r.setup) {
            try { annotateSetup(r.setup, chart, r); } catch { /* */ }
          }
          verdictFlourish(stage, { ok, title: ok ? (take ? 'Taken' : 'Skipped') : 'Misread', detail: 'The chart now shows one sample of what followed: a good plan can still lose, and a bad one can still win.', scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };
        // The chart sits above the card (the card animates away once you answer) so the reveal
        // of what followed stays visible.
        const card = swipeCard({
          title: 'Setup card',
          body: q.text,
          takeLabel: 'Take',
          skipLabel: 'Skip',
          takeClass: 'btn--bull',
          skipClass: 'btn--ghost',
        });
        stage.append(host, bindSwipeCard(card, { onTake: () => finish(true), onSkip: () => finish(false) }));
        g.setHint(q.hint);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
