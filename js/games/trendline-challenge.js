// Trendline Challenge — is the line intact, broken, or not yet valid?
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function build(rng, difficulty) {
  const direction = rng.pick(['up', 'down']);
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(80 - 10 * difficulty), direction, swings: 4 });
  const c = ts.candles;
  const i1 = 10, i2 = 35;
  const p1 = direction === 'up' ? c[i1].l : c[i1].h;
  const p2 = direction === 'up' ? c[i2].l : c[i2].h;
  const decisionIdx = Math.min(c.length - 8, 55 + rng.int(0, 10));
  // Project line to decision
  const slope = (p2 - p1) / (i2 - i1);
  const lineAt = p1 + slope * (decisionIdx - i1);
  const px = c[decisionIdx].c;
  const broken = direction === 'up' ? px < lineAt * (1 - 0.002) : px > lineAt * (1 + 0.002);
  const touches = 2; // candidate
  const answer = broken ? 'broken' : touches < 3 && difficulty > 0.5 && rng.chance(0.35) ? 'candidate' : 'intact';
  return { candles: c, i1, i2, p1, p2, decisionIdx, answer, direction };
}

export default {
  id: 'trendline-challenge',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 63, direction: 'up', title: 'trendline-challenge', score: 460, streak: 3, round: '2/8' }),
      rounds: 7,
      timer: { seconds: 26, perRound: true },
      howTo: [
        'A trend line is drawn through swing points.',
        'Is it intact, broken on a closing basis, or still only a 2-point candidate?',
        'Prefer closes beyond the line over single wicks.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const r = build(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Status of the drawn trend line at the freeze?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, yPad: 0.14, ariaLabel: 'Chart with trend line',
        });
        chart.addSegment({
          a: { idx: r.i1, price: r.p1 },
          b: { idx: r.decisionIdx, price: r.p1 + ((r.p2 - r.p1) / (r.i2 - r.i1)) * (r.decisionIdx - r.i1) },
          color: 'accent',
          label: 'Line',
        });
        g.setHint('Two points = candidate. Close beyond = break warning.');
        g.ask({
          options: [
            { label: 'Intact / respected', value: 'intact' },
            { label: 'Broken (close beyond)', value: 'broken' },
            { label: 'Candidate only (needs 3rd touch)', value: 'candidate' },
          ],
          answer: r.answer,
          explain: `<strong>${r.answer}</strong> on this ${r.direction}trend line. Re-validate after new swings.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
