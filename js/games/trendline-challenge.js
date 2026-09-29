// Trendline Challenge — is the line intact, broken, or not yet valid?
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { atr } from '../core/indicators.js';

// The line joins two consecutive swing lows (swing highs in a downtrend) and the answer comes from
// its geometry up to the freeze: any close beyond it → broken; a third touch → intact; else a
// 2-point candidate. Freezes where a close or a low sits only just at the line are skipped.
function lineRound(rng, difficulty) {
  const direction = rng.pick(['up', 'down']);
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(80 - 10 * difficulty), direction, swings: 4 });
  const c = ts.candles;
  const up = direction === 'up';
  const A = atr(c, 14);
  const lastIdx = c.length - 8;
  const piv = ts.swings.filter((s) => s.type === (up ? 'low' : 'high'));
  const out = [];
  for (let k = 0; k + 1 < piv.length; k++) {
    const { idx: i1, price: p1 } = piv[k];
    const { idx: i2, price: p2 } = piv[k + 1];
    const lineAt = (i) => p1 + ((p2 - p1) / (i2 - i1)) * (i - i1);
    const unit = (i) => A[i] || c[i].h - c[i].l;
    const past = (i) => (up ? lineAt(i) - c[i].c : c[i].c - lineAt(i)) / unit(i); // close beyond, in ATRs
    // A valid line: no close beyond it between its own anchors.
    let valid = true;
    for (let i = i1 + 1; i < i2; i++) if (past(i) > 0) valid = false;
    if (!valid) continue;
    let touches = 2;
    let touchIdx = i2;
    let away = false;
    let clear = true;
    for (let i = i2 + 1; i <= lastIdx; i++) {
      const p = past(i);
      if (p > 0.15) {
        // Broken on a closing basis: freeze on the break or a few candles after it.
        const decisionIdx = Math.min(lastIdx, i + rng.int(0, 4));
        if (decisionIdx >= 40) out.push({ candles: c, i1, i2, p1, p2, decisionIdx, answer: 'broken', direction, touches });
        break;
      }
      if (p > -0.05) clear = false;
      const gap = (up ? c[i].l - lineAt(i) : lineAt(i) - c[i].h) / unit(i); // extreme vs line, in ATRs
      if (gap > 1) away = true;
      if (away && gap <= 0.35) {
        touches += 1;
        touchIdx = i;
        away = false;
      } else if (away && gap < 0.75) clear = false;
      if (!clear) break;
      if (i < Math.max(40, i2 + 6) || i < touchIdx + 2) continue;
      out.push({ candles: c, i1, i2, p1, p2, decisionIdx: i, answer: touches >= 3 ? 'intact' : 'candidate', direction, touches });
    }
  }
  return out;
}

function build(rng, difficulty) {
  const want = rng.pick(difficulty > 0.5 ? ['intact', 'broken', 'candidate'] : ['intact', 'broken']);
  let any = null;
  for (let t = 0; t < 120; t++) {
    const rounds = lineRound(rng, difficulty).filter((x) => difficulty > 0.5 || x.answer !== 'candidate');
    const hits = rounds.filter((x) => x.answer === want);
    if (hits.length) return rng.pick(hits);
    any = any || (rounds.length ? rng.pick(rounds) : null);
  }
  return any;
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
          explain: `<strong>${r.answer}</strong> on this ${r.direction}trend line (${r.touches} touches). Re-validate after new swings.`,
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
