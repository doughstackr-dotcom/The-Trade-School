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
import { CARDS } from './banks/setup-swipe-cards.js';

// Re-exported for tests and callers that predate the shared bank module.
export { CARDS };

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
