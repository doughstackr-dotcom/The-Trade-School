// Chart Match — flip cards to pair candle shapes and chart facts.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { gameplayPreview, memoryBoard, sampleCandle, tinySeries, verdictFlourish } from '../core/game-ui.js';

const PAIRS = [
  { key: 'bull', label: 'Bullish candle', face: () => sampleCandle('bull', { width: 48, height: 72 }) },
  { key: 'bear', label: 'Bearish candle', face: () => sampleCandle('bear', { width: 48, height: 72 }) },
  { key: 'doji', label: 'Doji', face: () => sampleCandle('doji', { width: 48, height: 72 }) },
  { key: 'hammer', label: 'Hammer', face: () => sampleCandle('hammer', { width: 48, height: 72 }) },
  { key: 'uptrend', label: 'Uptrend', face: () => miniChart(tinySeries(11, 'up', 18), { width: 96, height: 64, ariaLabel: 'Uptrend thumb' }) },
  { key: 'downtrend', label: 'Downtrend', face: () => miniChart(tinySeries(22, 'down', 18), { width: 96, height: 64, ariaLabel: 'Downtrend thumb' }) },
];

export default {
  id: 'chart-match',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 5,
      timer: { seconds: 45, perRound: true },
      howTo: [
        'Flip two cards at a time to find matching chart concepts.',
        'Candle colours follow the theme: green bullish, red bearish.',
        'Clear the board before the clock runs out.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 77, direction: 'up', title: 'Chart Match', score: 380, streak: 2, round: '1/5' }),
      onRound(g, { rng, stage, difficulty }) {
        const n = difficulty < 0.35 ? 3 : difficulty < 0.7 ? 4 : 6;
        const pick = rng.shuffle(PAIRS.slice()).slice(0, n);
        const faces = rng.shuffle(pick.flatMap((p) => [
          { key: p.key, label: p.label, node: p.face },
          { key: p.key, label: p.label, node: p.face },
        ]));
        stage.append(h('p', { class: 'quiz__q' }, `Match ${n} pairs — candles and trend thumbs.`));
        let done = false;
        const board = memoryBoard({
          faces,
          columns: n <= 3 ? 3 : 4,
          onDone: () => {
            if (done) return;
            done = true;
            g.correct('Board cleared — sharp reading.');
            verdictFlourish(stage, { ok: true, title: 'Board cleared', detail: 'Every pair matched.', scoreDelta: 100 });
            g.nextButton();
          },
        });
        stage.append(board);
        g.setHint('Remember positions: green = bullish, red = bearish.');
        return () => board.remove();
      },
    });
    return () => game.destroy();
  },
};
