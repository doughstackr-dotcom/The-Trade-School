// Live Predict — call the next move on a real (or textbook) chart; reveal the market after.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function textbookRound(rng, difficulty, ahead) {
  const direction = rng.pick(difficulty < 0.4 ? ['up', 'down'] : ['up', 'down', 'range']);
  const ts = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: 72 + ahead, direction, swings: 4 });
  const decisionIdx = ts.candles.length - 1 - ahead;
  return { candles: ts.candles, decisionIdx, direction };
}

function outcomeOf(candles, from, to) {
  const a = candles[from].c;
  const b = candles[Math.min(to, candles.length - 1)].c;
  const chg = (b - a) / a;
  const recent = candles.slice(Math.max(0, from - 13), from + 1);
  const avgRange = recent.reduce((sum, c) => sum + (c.h - c.l), 0) / recent.length;
  const tolerance = Number(Math.max(0.003, (avgRange / a) * Math.sqrt(to - from) * 0.35).toFixed(4));
  const direction = Math.abs(chg) <= tolerance ? 'range' : chg > 0 ? 'up' : 'down';
  return { direction, chg, tolerance, close: b };
}

export default {
  id: 'live-predict',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 74, direction: 'down', title: 'live-predict', score: 200, streak: 2, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'A real-market chart freezes before the next stretch of candles.',
        'Predict up, down or range over a hidden window with a visible range boundary.',
        'We reveal exactly that window and the symbol after you commit — outcomes are noisy.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const ahead = difficulty < 0.35 ? 6 : difficulty < 0.7 ? 10 : 14;
        const real = await g.realRound({
          kinds: ['trend-up', 'trend-down', 'range', 'breakout-up', 'breakout-down'],
          intervals: ['1h', '1d'],
          before: Math.round(60 - 10 * difficulty),
          after: ahead + 4,
        });
        const r = real
          ? { candles: real.candles, decisionIdx: real.decisionIdx, decimals: real.decimals }
          : textbookRound(rng, difficulty, ahead);
        const result = outcomeOf(r.candles, r.decisionIdx, r.decisionIdx + ahead);
        const answer = result.direction;
        const edge = (result.tolerance * 100).toFixed(2);
        const shownCandles = r.candles.slice(0, r.decisionIdx + ahead + 1);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, `Next ${ahead} candles — up, down or inside the ±${edge}% range?`), host);
        const chart = new CandleChart(host, {
          candles: shownCandles, visible: r.decisionIdx + 1, slots: shownCandles.length,
          height: 255, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Live predict chart; future hidden',
        });
        const entry = r.candles[r.decisionIdx].c;
        chart.addHLine({ price: entry * (1 + result.tolerance), color: 'info', dashed: true, label: 'Upper range edge' });
        chart.addHLine({ price: entry * (1 - result.tolerance), color: 'info', dashed: true, label: 'Lower range edge' });
        g.setHint('Use structure at the freeze — do not invent a story from one wick.');
        const quiz = g.ask({
          options: [
            { label: 'Up', value: 'up' },
            { label: 'Down', value: 'down' },
            { label: 'Range', value: 'range' },
          ],
          answer,
          explain: `This window closed <strong>${result.chg >= 0 ? '+' : ''}${(result.chg * 100).toFixed(2)}%</strong> from the freeze; ${answer} means ${answer === 'range' ? `inside ±${edge}%` : `beyond the ${edge}% range edge`}. One sample path does not prove a strategy.`,
          onAnswer: (ok) => {
            chart.reveal({ to: shownCandles.length, interval: 40 });
            chart.addMarker({ idx: shownCandles.length - 1, position: result.chg >= 0 ? 'above' : 'below', shape: 'dot', color: ok ? 'bull' : 'accent', text: `${result.chg >= 0 ? '+' : ''}${(result.chg * 100).toFixed(1)}%` });
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
