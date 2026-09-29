// Timeframe Stack — align higher-timeframe bias with a lower-timeframe decision.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function build(rng, difficulty) {
  const bias = rng.pick(['up', 'down']);
  const htf = trendSeries({ seed: rng.int(1, 1e9), count: 60, direction: bias, swings: 3 });
  // LTF is noisier path in same direction, sometimes a counter pullback at the end, sometimes a
  // sideways chop with no trigger (wait)
  const pullback = rng.chance(0.45 + 0.2 * difficulty);
  const chop = !pullback && rng.chance(0.4);
  const ltfDir = chop ? 'range' : pullback ? (bias === 'up' ? 'down' : 'up') : bias;
  const raw = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(70 - 10 * difficulty), direction: ltfDir, swings: 4 }).candles;
  // Same market: the LTF picks up from the HTF's last close, sized to half of the last HTF leg
  // (so a pullback retraces it without breaking the last HTF swing).
  const last = htf.candles[htf.candles.length - 1].c;
  const lastSwing = htf.swings[htf.swings.length - 1].price;
  const k = (0.5 * Math.abs(last - lastSwing)) / (Math.max(...raw.map((c) => c.h)) - Math.min(...raw.map((c) => c.l)) || 1);
  const at = (p) => last + (p - raw[0].o) * k;
  const ltf = raw.map((c) => ({ ...c, o: at(c.o), h: at(c.h), l: at(c.l), c: at(c.c) }));
  const best = pullback
    ? (bias === 'up' ? 'long-pullback' : 'short-pullback')
    : 'wait';
  // If LTF agrees with bias and not a pullback setup, take with trend
  const answer = pullback || chop ? best : (bias === 'up' ? 'long-cont' : 'short-cont');
  return { htf: htf.candles, ltf, bias, answer, pullback, lastSwing };
}

export default {
  id: 'timeframe-stack',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 39, direction: 'up', title: 'timeframe-stack', score: 350, streak: 1, round: '2/8' }),
      rounds: 6,
      timer: { seconds: 35, perRound: true },
      howTo: [
        'Left: higher timeframe bias. Right: lower timeframe trigger zone.',
        'Choose: with-trend continuation, buy/sell the pullback, or wait.',
        'When HTF and LTF conflict without a clear pullback plan — wait.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const r = build(rng, difficulty);
        const row = h('div', { class: 'chart-compare' });
        const left = h('div', { class: 'chart-frame' });
        const right = h('div', { class: 'chart-frame' });
        row.append(
          h('div', null, h('p', { class: 'eyebrow' }, 'Higher TF'), left),
          h('div', null, h('p', { class: 'eyebrow' }, 'Lower TF'), right),
        );
        stage.append(
          h('p', { class: 'quiz__q' }, `HTF bias looks ${r.bias === 'up' ? 'bullish' : 'bearish'}. What is the disciplined plan?`),
          row,
        );
        const c1 = new CandleChart(left, { candles: r.htf, height: 260, yPad: 0.12, ariaLabel: 'Higher timeframe chart' });
        const c2 = new CandleChart(right, { candles: r.ltf, height: 260, yPad: 0.12, ariaLabel: 'Lower timeframe chart' });
        g.setHint('Pullbacks against HTF bias are often buys/sells with the larger trend — if your plan defines them.');
        g.ask({
          options: rng.shuffle([
            { label: 'Long pullback (HTF up)', value: 'long-pullback' },
            { label: 'Short pullback (HTF down)', value: 'short-pullback' },
            { label: 'With-trend continuation long', value: 'long-cont' },
            { label: 'With-trend continuation short', value: 'short-cont' },
            { label: 'Wait — conflict / no trigger', value: 'wait' },
          ]),
          answer: r.answer,
          explain: r.pullback
            ? `<strong>Trade the pullback with HTF bias (${r.bias})</strong>. Counter-trend LTF movement inside an HTF trend is often a location, not a new thesis.`
            : r.answer === 'wait'
              ? '<strong>Wait.</strong> The LTF is chopping sideways — no pullback and no trigger yet, so there is nothing to act on.'
              : `<strong>With-trend continuation ${r.bias === 'up' ? 'long' : 'short'}</strong>. LTF already agrees with HTF — trade with it rather than inventing a fade.`,
          onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Stacked well' : 'Re-check HTF vs LTF', scoreDelta: ok ? 100 : 0 }),
        });
        return () => { c1.destroy(); c2.destroy(); };
      },
    });
    return () => game.destroy();
  },
};
