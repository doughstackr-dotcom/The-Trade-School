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
  { key: 'shooting-star', label: 'Shooting star', face: () => sampleCandle('star', { width: 48, height: 72 }) },
  { key: 'marubozu', label: 'Bullish marubozu', face: () => sampleCandle('marubozu', { width: 48, height: 72 }) },
  { key: 'uptrend', label: 'Uptrend', face: () => miniChart(tinySeries(11, 'up', 18), { width: 96, height: 64, ariaLabel: 'Uptrend thumb' }) },
  { key: 'downtrend', label: 'Downtrend', face: () => miniChart(tinySeries(22, 'down', 18), { width: 96, height: 64, ariaLabel: 'Downtrend thumb' }) },
];

export default {
  id: 'chart-match',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 5,
      timer: { seconds: 65, perRound: true },
      howTo: [
        'Flip two cards and pair each chart or candle with its concept name.',
        'A wrong pair adds a miss; efficient clears earn more points.',
        'Clear the board before the clock runs out.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 77, direction: 'up', title: 'Chart Match', score: 180, streak: 2, round: '2/3' }),
      onRound(g, { rng, stage, difficulty }) {
        const n = difficulty < 0.25 ? 3 : difficulty < 0.5 ? 4 : difficulty < 0.8 ? 6 : 8;
        const pick = rng.shuffle(PAIRS.slice()).slice(0, n);
        const faces = rng.shuffle(pick.flatMap((p) => [
          { key: p.key, label: p.label, node: p.face },
          { key: p.key, label: p.label, node: () => h('strong', { class: 'memory-card__label' }, p.label) },
        ]));
        const tally = h('p', { class: 'mono', role: 'status' }, `0/${n} pairs · 0 misses`);
        stage.append(h('p', { class: 'quiz__q' }, `Match ${n} chart clues with their names.`), tally);
        let done = false;
        let matched = 0;
        let misses = 0;
        const board = memoryBoard({
          faces,
          columns: n <= 3 ? 3 : 4,
          onMatch: () => {
            matched += 1;
            tally.textContent = `${matched}/${n} pairs · ${misses} misses`;
          },
          onMismatch: () => {
            misses += 1;
            tally.textContent = `${matched}/${n} pairs · ${misses} misses`;
          },
          onDone: () => {
            if (done) return;
            done = true;
            const points = Math.max(40, 120 - misses * 12);
            g.correct(`Board cleared with ${misses} ${misses === 1 ? 'miss' : 'misses'}.`, { points });
            verdictFlourish(stage, { ok: true, title: 'Board cleared', detail: `All ${n} pairs matched with ${misses} misses.`, scoreDelta: points });
            g.nextButton();
          },
        });
        stage.append(board);
        g.setHint('Read the shape or direction first, then remember where its word card appeared.');
        return () => board.remove();
      },
    });
    return () => game.destroy();
  },
};
