// Candle Builder — read OHLC geometry with labelled candle + chart.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { candleSVG } from '../core/chart.js';
import { candleScenario } from '../core/patterns.js';
import { gameplayPreview, decisionChart, verdictFlourish } from '../core/game-ui.js';

function roundFromDifficulty(rng, difficulty) {
  const ids = difficulty < 0.4 ? ['hammer', 'doji', 'shooting-star'] : ['hammer', 'doji', 'shooting-star', 'bullish-engulfing', 'bearish-engulfing', 'hanging-man'];
  const id = rng.pick(ids);
  const sc = candleScenario(id, { seed: rng.int(1, 1e9), leadIn: Math.round(18 - 6 * difficulty), after: 4 });
  const c = sc.candles[sc.start];
  const body = Math.abs(c.c - c.o);
  const upper = c.h - Math.max(c.o, c.c);
  const lower = Math.min(c.o, c.c) - c.l;
  const range = c.h - c.l;
  const bull = c.c >= c.o;
  const measure = (q, value, formula, hint) => ({
    q,
    answer: +value.toFixed(2),
    options: () => {
      const correct = +value.toFixed(2);
      const opts = new Set([correct]);
      for (const candidate of [body, upper, lower, range, value + 0.25, value + 0.50, value - 0.25, value + 1]) {
        if (opts.size >= 4) break;
        const rounded = +Math.max(0, candidate).toFixed(2);
        if (rounded !== correct) opts.add(rounded);
      }
      return [...opts].map((v) => ({ label: v.toFixed(2), value: v }));
    },
    explain: `${formula} = <strong>${value.toFixed(2)}</strong>.`,
    hint,
  });
  const types = [
    measure('How long is the upper wick?', upper, 'High − higher of open/close', 'Top of body is the higher of open and close.'),
    {
      q: 'Is this candle bullish or bearish?',
      answer: bull ? 'bull' : 'bear',
      options: () => [{ label: 'Bullish (close ≥ open)', value: 'bull' }, { label: 'Bearish (close < open)', value: 'bear' }],
      explain: bull ? '<strong>Bullish</strong>: close at or above open.' : '<strong>Bearish</strong>: close below open.',
      hint: 'Compare close to open — colour is just a convention.',
    },
    {
      q: 'Which is longer on this candle?',
      answer: lower > upper * 1.2 ? 'lower' : upper > lower * 1.2 ? 'upper' : 'similar',
      options: () => [
        { label: 'Lower wick', value: 'lower' },
        { label: 'Upper wick', value: 'upper' },
        { label: 'Roughly similar', value: 'similar' },
      ],
      explain: `Lower ${lower.toFixed(2)} vs upper ${upper.toFixed(2)} (body ${body.toFixed(2)}).`,
      hint: 'Wicks are rejected extremes beyond the body.',
    },
  ];
  if (difficulty > 0.25) {
    types.push(measure('How long is the lower wick?', lower, 'Lower of open/close − low', 'Bottom of body is the lower of open and close.'));
    types.push(measure('How tall is the real body?', body, '|close − open|', 'Ignore both wicks; compare only the open and close.'));
  }
  if (difficulty > 0.6) types.push(measure('What is the full high-to-low range?', range, 'High − low', 'Measure from the very tip of the upper wick to the bottom of the lower wick.'));
  const t = rng.pick(types);
  return { sc, c, t, bull };
}

export default {
  id: 'candle-builder',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 8,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'Study the marked candle’s open, high, low and close.',
        'Answer the geometry question (wick length, direction, etc.).',
        'Build the habit of reading numbers, not just colours.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 12, direction: 'up', title: 'Candle Builder', score: 180, streak: 2, round: '2/3' }),
      onRound(g, { rng, stage, difficulty }) {
        const { sc, c, t, bull } = roundFromDifficulty(rng, difficulty);
        const pill = h('div', { class: 'row row--sm', style: { gap: '0.4rem', marginBottom: '0.5rem', flexWrap: 'wrap' } },
          h('span', { class: 'game-preview__pill' }, h('small', null, 'O'), h('strong', { class: 'mono' }, c.o.toFixed(2))),
          h('span', { class: 'game-preview__pill' }, h('small', null, 'H'), h('strong', { class: 'mono' }, c.h.toFixed(2))),
          h('span', { class: 'game-preview__pill' }, h('small', null, 'L'), h('strong', { class: 'mono' }, c.l.toFixed(2))),
          h('span', { class: 'game-preview__pill' }, h('small', null, 'C'), h('strong', { class: 'mono' }, c.c.toFixed(2))),
          // The Bull/Bear chip would print the answer on the "bullish or bearish?" question.
          t.answer === 'bull' || t.answer === 'bear' ? null
            : h('span', { class: ['game-preview__chip', bull ? 'game-preview__chip--bull' : 'game-preview__chip--bear'] }, bull ? 'Bull' : 'Bear'),
        );
        const hero = candleSVG(c, { width: 52, height: 96, labels: true, prices: true, ariaLabel: 'Focus candle' });
        const dc = decisionChart(stage, {
          candles: sc.candles,
          visible: sc.end + 1,
          slots: sc.candles.length,
          height: 220,
          yPad: 0.16,
          question: t.q,
          before: h('div', { class: 'row', style: { alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' } }, hero, pill),
          ariaLabel: 'Chart with a highlighted candle to measure',
        });
        dc.chart.addBox({ from: sc.start, to: sc.end, color: 'accent', label: 'Focus' });
        g.setHint(t.hint);
        const quiz = g.ask({
          options: rng.shuffle(t.options()),
          answer: t.answer,
          explain: t.explain,
          onAnswer: (ok) => {
            dc.reveal();
            verdictFlourish(stage, { ok, title: ok ? 'Geometry locked' : 'Recheck OHLC', detail: t.explain.replace(/<[^>]+>/g, ' '), scoreDelta: ok ? 100 : 0 });
          },
        });
        dc.wrap.insertBefore(quiz, dc.host);
        return () => dc.destroy();
      },
    });
    return () => game.destroy();
  },
};
