// Timeframe Stack — align higher-timeframe bias with a lower-timeframe decision.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries, aggregate } from '../core/data.js';

function build(rng, difficulty) {
  const bias = rng.pick(['up', 'down']);
  const state = rng.pick(difficulty < 0.25 ? ['continuation', 'pullback'] : ['continuation', 'pullback', 'chop']);
  const base = trendSeries({ seed: rng.int(1, 1e9), count: 144, direction: bias, swings: 4 }).candles;
  const ltfDir = state === 'chop' ? 'range' : state === 'pullback' ? (bias === 'up' ? 'down' : 'up') : bias;
  const raw = trendSeries({ seed: rng.int(1, 1e9), count: 32, direction: ltfDir, swings: 2 }).candles;
  const last = base[base.length - 1].c;
  const baseMove = Math.abs(last - base[0].o);
  const rawRange = Math.max(...raw.map((c) => c.h)) - Math.min(...raw.map((c) => c.l));
  const k = (baseMove * (state === 'pullback' ? 0.22 : 0.16)) / (rawRange || 1);
  const at = (p) => last + (p - raw[0].o) * k;
  const tail = raw.map((c, i) => ({ ...c, t: base.length + i, o: at(c.o), h: at(c.h), l: at(c.l), c: at(c.c) }));
  // Both views now come from one tape: four lower-timeframe bars form each higher-timeframe bar.
  const tape = [...base, ...tail];
  const htf = aggregate(tape, 4, { partial: false });
  const ltf = tape.slice(-58);
  const answer = state === 'chop' ? 'wait' : state === 'pullback'
    ? (bias === 'up' ? 'long-pullback' : 'short-pullback')
    : (bias === 'up' ? 'long-cont' : 'short-cont');
  return { htf, ltf, bias, answer, pullback: state === 'pullback', state };
}

export default {
  id: 'timeframe-stack',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 39, direction: 'up', title: 'timeframe-stack', score: 100, streak: 1, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 35, perRound: true },
      howTo: [
        'The two charts are the same market at different timeframes.',
        'Read the higher timeframe bias, then classify the lower timeframe move.',
        'A pullback is a plan to watch for confirmation, not an automatic entry.',
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
          h('p', { class: 'quiz__q' }, `HTF bias is ${r.bias === 'up' ? 'bullish' : 'bearish'}. Which plan fits the lower timeframe?`),
          row,
        );
        const c1 = new CandleChart(left, { candles: r.htf, height: 175, yPad: 0.12, ariaLabel: 'Higher timeframe chart from the same market tape' });
        const c2 = new CandleChart(right, { candles: r.ltf, height: 175, yPad: 0.12, ariaLabel: 'Lower timeframe chart from the same market tape' });
        g.setHint('A countertrend move can be a pullback setup; wait for a trigger before entering. Sideways chop without a trigger means wait.');
        const quiz = g.ask({
          options: rng.shuffle([
            { label: 'Plan long on a confirmed pullback', value: 'long-pullback' },
            { label: 'Plan short on a confirmed pullback', value: 'short-pullback' },
            { label: 'With-trend continuation long', value: 'long-cont' },
            { label: 'With-trend continuation short', value: 'short-cont' },
            { label: 'Wait — conflict / no trigger', value: 'wait' },
          ]),
          answer: r.answer,
          explain: r.pullback
              ? `<strong>Watch the pullback with the ${r.bias === 'up' ? 'bullish' : 'bearish'} HTF bias.</strong> Wait for a lower-timeframe trigger before entering.`
            : r.answer === 'wait'
              ? '<strong>Wait.</strong> The LTF is chopping sideways — no pullback and no trigger yet, so there is nothing to act on.'
              : `<strong>With-trend continuation ${r.bias === 'up' ? 'long' : 'short'}</strong>. Both timeframes point the same way; still define an entry and stop.`,
          onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Stacked well' : 'Re-check HTF vs LTF', scoreDelta: ok ? 100 : 0 }),
        });
        stage.insertBefore(quiz, row);
        return () => { c1.destroy(); c2.destroy(); };
      },
    });
    return () => game.destroy();
  },
};
