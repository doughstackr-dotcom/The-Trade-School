// Trend Rush (v2 of Trend Spotter) — call the structure while the chart is still printing.
// Practice keeps the classic study flow. Arcade and Survival stream candles in: call
// bullish / bearish / range early for bigger points — the clock is the chart itself.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, reducedMotion } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function textbook(rng, difficulty) {
  const direction = rng.pick(difficulty < 0.35 ? ['up', 'down'] : ['up', 'down', 'range']);
  const ts = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: Math.round(70 - 10 * difficulty), direction, swings: 3 + Math.floor(difficulty * 2) });
  const decisionIdx = ts.candles.length - 1 - Math.round(8 + 6 * difficulty);
  return { candles: ts.candles, decisionIdx, direction: direction === 'up' ? 'bullish' : direction === 'down' ? 'bearish' : 'range', swings: ts.swings };
}

export default {
  id: 'trend-spotter',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 44, direction: 'up', title: 'Trend Rush', score: 180, streak: 2, round: '2/3' }),
      rounds: 7,
      timer: { seconds: 26, perRound: true },
      howTo: [
        'Read swing structure: higher highs/lows, lower highs/lows, or chop.',
        'Arcade: candles print one by one — call it early for up to 100 points. The last candle pays only 40.',
        'Harder rounds start later, print faster and swing noisier.',
      ],
      async onRound(g, { rng, stage, difficulty, style }) {
        const real = await g.realRound({
          kinds: difficulty < 0.5 ? ['trend-up', 'trend-down'] : ['trend-up', 'trend-down', 'range'],
          before: Math.round(65 - 20 * difficulty),
          after: 12,
        });
        let r;
        if (real) {
          const k = real.setup?.kind || '';
          r = {
            candles: real.candles,
            decisionIdx: real.decisionIdx,
            direction: k.includes('up') || real.setup?.direction === 'bullish' ? 'bullish'
              : k.includes('down') || real.setup?.direction === 'bearish' ? 'bearish' : 'range',
            decimals: real.decimals,
            outcome: real.outcome,
            swings: (real.setup?.meta?.swings || []).map((p) => ({ ...p, idx: p.idx - (real.lead?.length || 0) })),
            bounds: k === 'range' ? [real.setup?.meta?.bottom, real.setup?.meta?.top] : null,
          };
        } else r = textbook(rng, difficulty);
        const rushing = style !== 'practice';
        const full = r.decisionIdx + 1;
        const startN = rushing ? Math.max(16, full - (42 - Math.round(20 * difficulty))) : full;
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, rushing ? 'Call the structure — early calls pay more.' : 'What is the dominant structure?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: startN, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Price chart printing candle by candle; call the trend.',
        });

        // Rush HUD: how much of the window has printed and what an on-the-money call pays now.
        const window = Math.max(1, full - startN);
        const payoutEl = h('span', { class: 'rush__payout mono' }, '100');
        const countEl = h('span', { class: 'rush__count mono' }, `${startN}`);
        const rushHud = h('div', { class: 'rush-hud', role: 'status', 'aria-label': 'Candles printed and current payout' },
          h('span', { class: 'rush__cell' }, h('span', { class: 'arcade-label' }, 'Printed'), countEl),
          h('span', { class: 'rush__cell' }, h('span', { class: 'arcade-label' }, 'Call now pays'), payoutEl));
        if (rushing) stage.insertBefore(rushHud, host);

        let shown = startN;
        let tick = null;
        const payoutAt = (n) => Math.round(40 + 60 * Math.max(0, 1 - (n - startN) / window));
        if (rushing) {
          if (reducedMotion()) {
            // No streaming under reduced motion: treat the call as made at the window midpoint.
            shown = startN + Math.round(window / 2);
            countEl.textContent = String(shown);
            payoutEl.textContent = String(payoutAt(shown));
          } else {
            const interval = Math.max(70, Math.round(160 - 70 * difficulty));
            chart.reveal({ to: full, interval });
            sfx.whoosh();
            tick = setInterval(() => {
              shown = Math.min(full, shown + 1);
              countEl.textContent = String(shown);
              payoutEl.textContent = String(payoutAt(shown));
              if (shown % 5 === 0) sfx.tick();
              if (shown >= full) clearInterval(tick);
            }, interval);
          }
        }

        g.setHint('Mark the last two or three swing highs and lows in your head.');
        let answered = false;
        const finish = (value) => {
          if (answered) return;
          answered = true;
          if (tick) clearInterval(tick);
          const ok = value === r.direction;
          const detail = r.direction === 'bullish' ? 'Higher highs and higher lows are the checkpoints.'
            : r.direction === 'bearish' ? 'Lower highs and lower lows are the checkpoints.'
              : 'Repeated highs and lows inside the same band define the range.';
          const explain = `<strong>${r.direction}</strong> structure at the freeze. ${rushing ? `Called with ${shown} of ${full} candles — ${payoutAt(shown)} points. ` : ''}Always re-check after new swings print.`;
          if (ok) g.correct(explain, { points: payoutAt(shown) });
          else g.wrong(explain);
          chart.reveal({ to: r.candles.length, interval: 40 });
          for (const p of (r.swings || []).filter((p) => p.idx >= 0 && p.idx <= r.decisionIdx).slice(-4)) {
            chart.addMarker({ idx: p.idx, position: p.type === 'high' ? 'above' : 'below', shape: 'dot', color: 'accent' });
          }
          if (r.bounds?.every(Number.isFinite)) {
            chart.addHLine({ price: r.bounds[0], color: 'accent', dashed: true, label: 'Range floor' });
            chart.addHLine({ price: r.bounds[1], color: 'accent', dashed: true, label: 'Range ceiling' });
          }
          verdictFlourish(stage, { ok, title: ok ? (rushing && shown < startN + window * 0.5 ? 'Lightning call' : 'Structure spotted') : 'Recheck the swings', detail, scoreDelta: ok ? payoutAt(shown) : 0 });
          g.nextButton();
        };

        // 1–9 keyboard support mirrors the quiz widget (the shell handles Enter → Next).
        const onKey = (e) => {
          if (answered || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (e.key === '1') finish('bullish');
          else if (e.key === '2') finish('bearish');
          else if (e.key === '3') finish('range');
        };
        document.addEventListener('keydown', onKey);

        const buttons = h('div', { class: 'rush-actions option-grid', role: 'group', 'aria-label': 'Call the structure' },
          [
            { label: 'Bullish (HH / HL)', value: 'bullish', key: '1', cls: 'btn--bull' },
            { label: 'Bearish (LH / LL)', value: 'bearish', key: '2', cls: 'btn--bear' },
            { label: 'Range / unclear', value: 'range', key: '3', cls: '' },
          ].map((o) => h('button', {
            type: 'button',
            class: ['option', 'rush-option', o.cls && `rush-option--${o.value}`],
            on: { click: () => finish(o.value) },
          },
            h('span', { class: 'option__key', 'aria-hidden': 'true' }, o.key),
            h('span', { class: 'option__label' }, o.label),
            h('span', { class: 'option__mark', 'aria-hidden': 'true' }))));
        stage.append(buttons);

        return () => {
          if (tick) clearInterval(tick);
          document.removeEventListener('keydown', onKey);
          chart.destroy();
        };
      },
    });
    return () => game.destroy();
  },
};
