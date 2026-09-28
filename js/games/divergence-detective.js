// Divergence Detective — spot bullish / bearish RSI divergence vs confirmation.
// Divergence rounds are the scanner's RSI 14 divergences ('bullish-divergence' /
// 'bearish-divergence'); confirmation rounds are confirmed trends ('trend-up' / 'trend-down')
// whose last two swing highs (lows) are matched by a higher (lower) RSI reading.
import { GameShell, explainChoice, trackAnswer } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { rsi } from '../core/indicators.js';

export const DIVERGENCE_KINDS = ['bullish-divergence', 'bearish-divergence'];
export const CONFIRM_KINDS = ['trend-up', 'trend-down'];
/** Minimum RSI gain (points) between the two swings for a round to count as confirmation. */
const CONFIRM_MIN = 2;

const LABEL = { 'bear-div': 'Bearish divergence', 'bull-div': 'Bullish divergence', confirm: 'Confirmation (no divergence)' };

/** RSI 14 over the round's candles, warmed up on its lead candles. */
export function roundRsi(r) {
  const lead = Array.isArray(r?.lead) ? r.lead : [];
  return rsi([...lead, ...r.candles].map((k) => k.c), 14).slice(lead.length);
}

/**
 * For a trend round: the last two swing highs (uptrend) or lows (downtrend) with their RSI, and
 * whether RSI confirms them by at least CONFIRM_MIN points. → { a, b, confirms } | null
 */
export function confirmationOf(r) {
  const k = r?.setup?.kind;
  if (k !== 'trend-up' && k !== 'trend-down') return null;
  const up = k === 'trend-up';
  const sw = (r.setup.meta?.swings || []).filter((p) => p.type === (up ? 'high' : 'low')).slice(-2);
  if (sw.length < 2) return null;
  const R = roundRsi(r);
  const [a, b] = sw.map((p) => ({ idx: p.idx, price: p.price, rsi: R[p.idx] }));
  if (!Number.isFinite(a.rsi) || !Number.isFinite(b.rsi)) return null;
  const d = b.rsi - a.rsi;
  return { a, b, up, confirms: up ? d >= CONFIRM_MIN : d <= -CONFIRM_MIN };
}

/** Answer id for a round: 'bear-div' | 'bull-div' | 'confirm'. */
export function answerFor(r) {
  const k = r?.setup?.kind || '';
  if (k === 'bearish-divergence') return 'bear-div';
  if (k === 'bullish-divergence') return 'bull-div';
  return 'confirm';
}

/** Textbook round: a divergence, or (wantConfirm) a trend whose RSI genuinely confirms. Never null. */
export function textbookRound(rng, { wantConfirm = false, before = 80, after = 16 } = {}) {
  if (wantConfirm) {
    for (let t = 0; t < 6; t++) {
      const r = simRound(rng.fork(`confirm-${t}`), { kinds: CONFIRM_KINDS, before, after });
      const c = r && confirmationOf(r);
      if (c?.confirms) return { ...r, confirm: c };
    }
  }
  const r = simRound(rng.fork('div'), { kinds: DIVERGENCE_KINDS, before, after })
    || simRound(rng.fork('div-2'), { kinds: DIVERGENCE_KINDS, before, after: 10, count: 600 });
  if (!r) throw new Error('no divergence round could be generated');
  return r;
}

function whyWrong(answer, pick) {
  if (answer === 'confirm') {
    return 'RSI made a new extreme together with price (a higher high with the higher high, or a lower low with the lower low), so momentum agrees with price. Divergence needs the oscillator to FAIL to confirm the new price extreme; a high or low RSI reading on its own is not divergence.';
  }
  if (pick === 'confirm') {
    return answer === 'bear-div'
      ? 'Price made a higher high, but RSI made a lower high. That disagreement is the divergence; confirmation would need RSI to make a higher high too.'
      : 'Price made a lower low, but RSI made a higher low. That disagreement is the divergence; confirmation would need RSI to make a lower low too.';
  }
  return answer === 'bull-div'
    ? 'Bearish divergence forms at swing highs (price higher high, RSI lower high). This one is at the lows: price made a lower low while RSI made a higher low, so it is bullish.'
    : 'Bullish divergence forms at swing lows (price lower low, RSI higher low). This one is at the highs: price made a higher high while RSI made a lower high, so it is bearish.';
}

export default {
  id: 'divergence-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 28, direction: 'down', title: 'divergence-detective', score: 410, streak: 2, round: '2/8' }),
      rounds: 6,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'Compare the last two price swings with RSI 14 in the pane below the chart.',
        'Call bearish divergence, bullish divergence, or confirmation (RSI agrees with price).',
        'Divergence is a warning, not a trigger: it can persist, so grade the read, then manage risk.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const before = Math.round(90 - 15 * difficulty);
        const wantConfirm = rng.chance(0.3);
        let r = null;
        const real = await g.realRound({ kinds: wantConfirm ? CONFIRM_KINDS : DIVERGENCE_KINDS, before, after: 16 });
        if (real) {
          if (!wantConfirm) r = real;
          else {
            const c = confirmationOf(real);
            if (c?.confirms) r = { ...real, confirm: c };
          }
        }
        if (!r) r = textbookRound(rng, { wantConfirm, before, after: 16 });
        const answer = answerFor(r);

        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Price vs RSI at the latest swing: what do you see?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Price chart with RSI 14 below it, for a divergence reading. Future hidden.',
        });
        chart.addPane({
          id: 'rsi', title: 'RSI 14', height: 90, range: [0, 100],
          levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }],
          series: [{ values: roundRsi(r), color: 'ma3' }],
        });
        g.setHint('Find the last two swing highs (or lows) in price, then read RSI at the same candles. Bearish: price higher high, RSI lower high. Bullish: price lower low, RSI higher low.');
        const name = r.setup?.meta?.name || (r.setup?.kind === 'trend-up' ? 'Uptrend' : r.setup?.kind === 'trend-down' ? 'Downtrend' : 'setup');
        const detail = answer === 'confirm' && r.confirm
          ? ` RSI ${Math.round(r.confirm.a.rsi)} → ${Math.round(r.confirm.b.rsi)} across the two ${r.confirm.up ? 'highs' : 'lows'}.`
          : Number.isFinite(r.setup?.meta?.a?.rsi) && Number.isFinite(r.setup?.meta?.b?.rsi)
            ? ` RSI ${Math.round(r.setup.meta.a.rsi)} → ${Math.round(r.setup.meta.b.rsi)} across the two swings.`
            : '';
        g.ask({
          options: [
            { label: LABEL['bear-div'], value: 'bear-div' },
            { label: LABEL['bull-div'], value: 'bull-div' },
            { label: LABEL.confirm, value: 'confirm' },
          ],
          answer,
          explain: explainChoice(
            `<strong>${LABEL[answer]}</strong> (${name}).${detail} What followed in this sample: ${r.outcome?.result || 'n/a'}.`,
            (pick) => whyWrong(answer, pick),
          ),
          onAnswer: (ok) => {
            trackAnswer(g.store, 'divergence', answer, ok);
            chart.reveal({ to: r.candles.length, interval: 40 });
            if (answer === 'confirm' && r.confirm) {
              const { a, b, up } = r.confirm;
              const label = up ? 'Higher high' : 'Lower low';
              chart.addSegment({ a, b, color: up ? 'bull' : 'bear', width: 2, label });
              chart.addSegment({ pane: 'rsi', a: { idx: a.idx, price: a.rsi }, b: { idx: b.idx, price: b.rsi }, color: up ? 'bull' : 'bear', width: 2, label });
            } else {
              try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
