// Fib Sniper: Bullseye (v2 of Fib Sniper) — place the retracement, hit the ring.
// Practice keeps the classic study quiz. Arcade and Survival hide the line and make you
// PLACE it: click the chart (or type the price) where the called-for retracement sits.
// Precision rings: within 2% of the impulse = 100 PERFECT, 5% = 80, 10% = 60.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, floatText } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

const RATIOS = [
  { id: '236', r: 0.236, label: '23.6%' },
  { id: '382', r: 0.382, label: '38.2%' },
  { id: '500', r: 0.5, label: '50%' },
  { id: '618', r: 0.618, label: '61.8%' },
  { id: '786', r: 0.786, label: '78.6%' },
];

function build(rng, difficulty) {
  const direction = difficulty < 0.25 || rng.chance(0.5) ? 'up' : 'down';
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(85 - 10 * difficulty), direction, swings: 3 });
  const c = ts.candles;
  // Pick a completed impulse with enough room for the following bars.
  const firstType = direction === 'up' ? 'low' : 'high';
  const secondType = direction === 'up' ? 'high' : 'low';
  const legs = ts.swings.filter((s, i) => s.type === firstType && ts.swings[i + 1]?.type === secondType && ts.swings[i + 1].idx <= c.length - 16);
  const first = rng.pick(legs);
  const second = ts.swings[ts.swings.indexOf(first) + 1];
  const choices = difficulty < 0.3 ? RATIOS.slice(1, 4) : difficulty < 0.65 ? RATIOS.slice(0, 4) : RATIOS;
  const pick = rng.pick(choices);
  const level = second.price - (second.price - first.price) * pick.r;
  const decisionIdx = Math.min(c.length - 8, second.idx + 8 + Math.round(10 * (1 - difficulty)));
  return { candles: c, first, second, pick, level, decisionIdx, choices, direction };
}

export default {
  id: 'fib-sniper',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 17, direction: 'up', title: 'Fib Sniper', score: 200, streak: 2, round: '2/3' }),
      rounds: 7,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'The start and end of an impulse are marked on the chart.',
        'Arcade: place the called-for retracement yourself — click the chart at the price, or type it. Precision rings score you.',
        'Later rounds call for shallower or deeper levels on up and down impulses.',
      ],
      onRound(g, { rng, stage, difficulty, style }) {
        const r = build(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(
          h('p', { class: 'quiz__q' }, `${r.direction === 'up' ? 'Low → high' : 'High → low'} impulse: where does the ${style === 'practice' ? 'dashed' : r.pick.label} retracement${style === 'practice' ? ' sit' : ' sit? Place it'}?`),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 260, yPad: 0.16, ariaLabel: 'Impulse with Fibonacci retracement level',
        });
        chart.addSegment({ a: { idx: r.first.idx, price: r.first.price }, b: { idx: r.second.idx, price: r.second.price }, color: r.direction === 'up' ? 'bull' : 'bear', arrow: true, label: 'Impulse' });
        chart.addMarker({ idx: r.first.idx, position: r.direction === 'up' ? 'below' : 'above', shape: 'dot', color: 'accent' });
        chart.addMarker({ idx: r.second.idx, position: r.direction === 'up' ? 'above' : 'below', shape: 'dot', color: 'accent' });

        const revealAll = () => {
          for (const x of r.choices) {
            const px = r.second.price - (r.second.price - r.first.price) * x.r;
            chart.addHLine({ price: px, color: x.id === r.pick.id ? 'accent' : 'info', dashed: true, label: x.label });
          }
          chart.reveal({ to: r.candles.length, interval: 40 });
        };

        // ------------------------------------------------ practice: the classic quiz
        if (style === 'practice') {
          chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Fib?' });
          g.setHint('Measure from the impulse end back toward its start. Deeper retracements are farther from the end.');
          const quiz = g.ask({
            options: rng.shuffle(r.choices.map((x) => ({ label: x.label, value: x.id }))),
            answer: r.pick.id,
            explain: `<strong>${r.pick.label}</strong> at ${r.level.toFixed(2)} (impulse size ${Math.abs(r.second.price - r.first.price).toFixed(2)}). A Fib level alone is not a trade signal.`,
            onAnswer: (ok) => {
              revealAll();
              verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
            },
          });
          stage.append(quiz);
          return () => chart.destroy();
        }

        // ------------------------------------------------ arcade / survival: place it
        const impulse = Math.abs(r.second.price - r.first.price) || 1;
        const dec = r.candles[0] && r.candles[0].c > 1000 ? 0 : 2;
        host.classList.add('is-placing');
        let placed = null;
        let settled = false;

        const priceOut = h('span', { class: 'place-current mono' }, '—');
        const lockBtn = h('button', { type: 'button', class: 'btn btn--sm btn--primary', disabled: '' }, 'Lock it in');

        const place = (price) => {
          if (settled || placed != null || !Number.isFinite(price)) return;
          placed = price;
          host.classList.remove('is-placing');
          chart.addHLine({ price, color: 'arcade', dashed: true, label: 'Your call' });
          sfx.coin();
          priceOut.textContent = price.toFixed(dec);
          lockBtn.disabled = false;
          lockBtn.focus({ preventScroll: true });
        };

        const settle = () => {
          if (settled || placed == null) return;
          settled = true;
          const err = Math.abs(placed - r.level) / impulse;
          const ring = err <= 0.02 ? 3 : err <= 0.05 ? 2 : err <= 0.10 ? 1 : 0;
          const points = [0, 60, 80, 100][ring];
          const label = ['MISS', 'GLANCING', 'GREAT', 'BULLSEYE'][ring];
          const explain = `<strong>${r.pick.label}</strong> at ${r.level.toFixed(dec)} — you placed ${placed.toFixed(dec)} (${(err * 100).toFixed(1)}% of the impulse off). ${['No ring this time.', 'Glancing hit.', 'Sharp placement.', 'Dead centre.']} A Fib level alone is not a trade signal.`;
          revealAll();
          if (ring > 0) {
            floatText(label, { at: host, tone: ring === 3 ? 'bull' : 'accent' });
            if (ring === 3) sfx.powerup();
            g.correct(explain, { points });
          } else {
            g.wrong(explain);
          }
          verdictFlourish(stage, { ok: ring > 0, title: ring === 3 ? 'Bullseye!' : ring > 0 ? label.toLowerCase() : 'Off the mark', scoreDelta: points });
          g.nextButton();
        };

        host.addEventListener('pointerdown', (e) => {
          if (settled || placed != null) return;
          const rect = host.getBoundingClientRect();
          const price = chart.yToPrice(e.clientY - rect.top);
          place(price);
        });
        lockBtn.addEventListener('click', settle);

        // Keyboard path: type the price and place.
        const input = h('input', {
          class: 'mono place-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
          'aria-label': `Price of the ${r.pick.label} retracement`,
          placeholder: `price for ${r.pick.label}`,
        });
        const placeBar = h('div', { class: 'place-bar' },
          h('span', { class: 'arcade-label' }, `Place the ${r.pick.label} line`),
          input,
          h('button', { type: 'button', class: 'btn btn--sm btn--arcade', on: { click: () => place(parseFloat(String(input.value).replace(/,/g, '.'))) } }, 'Set line'),
          h('span', { class: 'place-current-wrap arcade-label' }, 'Placed:', priceOut),
          lockBtn);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            place(parseFloat(String(input.value).replace(/,/g, '.')));
          }
        });
        stage.append(placeBar);
        g.setHint('Measure from the impulse end back toward its start; the ratio times the impulse size is the distance.');

        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
