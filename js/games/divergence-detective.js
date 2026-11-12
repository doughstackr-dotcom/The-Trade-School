// Signal Chaser (v2 of Divergence Detective) — catch the signal before it fades.
// Practice keeps the classic study quiz. Arcade and Survival stream the chart candle by
// candle past the latest swing: read price vs momentum and call it before the signal
// window closes — dawdle and the read is gone.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, reducedMotion } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound, outcomeOf } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { rsi, swings, atr } from '../core/indicators.js';

// Scanner setup kinds (js/core/scanner.js SETUP_KINDS): the two RSI divergences.
const KINDS = ['bearish-divergence', 'bullish-divergence'];
const LABELS = { 'bear-div': 'Bearish divergence', 'bull-div': 'Bullish divergence', confirm: 'Confirmation / no clear divergence' };

// A confirmation round from a trend-up / trend-down round: the latest swing high (low) is a new
// extreme and RSI 14 confirms it (the mirror of the scanner's divergence rule). Frozen 3 candles
// after that swing, like the divergence rounds. null when the chart does not show a clear case.
function confirmation(r) {
  if (!r || !/^trend-/.test(r.setup?.kind || '')) return null;
  const lead = r.lead || [];
  const all = [...lead, ...r.candles];
  const up = r.setup.kind === 'trend-up';
  const R = rsi(all.map((c) => c.c), 14);
  const A = atr(all, 14);
  const sw = swings(all.slice(0, lead.length + r.decisionIdx + 1)).filter((x) => x.type === (up ? 'high' : 'low') && x.idx >= lead.length);
  const b = sw[sw.length - 1];
  const a = sw.filter((x) => b && b.idx - x.idx >= 5 && b.idx - x.idx <= 40).reduce((m, x) => (!m || (up ? x.price > m.price : x.price < m.price) ? x : m), null);
  if (!a || !Number.isFinite(A[b.idx])) return null;
  const osc = (i) => (up ? Math.max : Math.min)(...R.slice(Math.max(0, i - 2), i + 3).filter(Number.isFinite));
  if (!Number.isFinite(osc(a.idx)) || !Number.isFinite(osc(b.idx))) return null;
  const priceOk = up ? b.price >= a.price + 0.25 * A[b.idx] : b.price <= a.price - 0.25 * A[b.idx];
  const oscOk = up ? osc(b.idx) >= osc(a.idx) + 4 : osc(b.idx) <= osc(a.idx) - 4;
  if (!priceOk || !oscOk) return null;
  const at = (x) => ({ idx: x.idx - lead.length, price: x.price, rsi: osc(x.idx) });
  const decisionIdx = b.idx - lead.length + 3;
  return { ...r, decisionIdx, outcome: outcomeOf(r.candles, decisionIdx, { bars: 16, direction: up ? 'bullish' : 'bearish' }), confirm: { up, a: at(a), b: at(b) } };
}

export default {
  id: 'divergence-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 28, direction: 'down', title: 'Signal Chaser', score: 200, streak: 2, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'Price swings vs momentum: does the oscillator confirm the new high/low?',
        'Arcade: the chart streams past the swing — call it before the signal window closes.',
        'Divergence can persist — grade the read, then manage risk.',
      ],
      async onRound(g, { rng, stage, difficulty, style }) {
        const q = { kinds: KINDS, before: Math.round(90 - 15 * difficulty), after: 16 };
        let r = null;
        if (rng.chance(difficulty < 0.4 ? 0.25 : 0.4)) {
          // Confirmation round: price makes a new swing extreme and RSI confirms it.
          const cq = { ...q, kinds: ['trend-up', 'trend-down'] };
          const realTrend = await g.realRound(cq);
          r = confirmation(realTrend);
          for (let t = 0; !r && !realTrend && t < 7; t++) r = confirmation(simRound(rng, cq));
        }
        if (!r) r = await g.realRound(q);
        // simRound is stochastic (random markets × limited tries) and can return null —
        // retry with fresh rng draws, then show a skip card instead of a broken round.
        for (let i = 0; !r && i < 6; i++) r = simRound(rng, q);
        if (!r) {
          stage.append(h('p', { class: 'muted' }, 'Could not build a chart for this round.'));
          g.nextButton();
          return undefined;
        }
        const k = r.setup?.kind || '';
        let answer = 'confirm';
        if (r.confirm) answer = 'confirm';
        else if (k === 'bearish-divergence') answer = 'bear-div';
        else if (k === 'bullish-divergence') answer = 'bull-div';
        const swingA = r.confirm?.a || r.setup?.meta?.a;
        const swingB = r.confirm?.b || r.setup?.meta?.b;
        const swingRead = swingA && swingB && Number.isFinite(swingA.price) && Number.isFinite(swingB.price) && Number.isFinite(swingA.rsi) && Number.isFinite(swingB.rsi)
          ? `Price ${swingA.price.toFixed(r.decimals ?? 2)} → ${swingB.price.toFixed(r.decimals ?? 2)}; RSI ${swingA.rsi.toFixed(1)} → ${swingB.rsi.toFixed(1)}.`
          : '';
        const host = h('div', { class: 'chart-frame' });
        const lead = r.lead || [];
        const full = r.decisionIdx + 1;

        // The chase: stream from the first annotated swing; the call must land inside the window.
        const chasing = style !== 'practice' && Number.isFinite(swingA?.idx);
        const startN = chasing ? Math.max(6, Math.min(full, swingA.idx - 5)) : full;

        stage.append(h('p', { class: 'quiz__q' }, chasing ? 'Chase the signal — call it before the window closes.' : 'Price vs momentum at the latest swing — what do you see?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: startN, slots: r.candles.length,
          height: 195, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart for divergence reading',
        });
        // Momentum pane (RSI 14, warmed up on the lead candles); annotateSetup reuses the 'rsi' id.
        chart.addPane({ id: 'rsi', title: 'RSI 14', height: 60, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: rsi([...lead, ...r.candles].map((c) => c.c), 14).slice(lead.length), color: 'ma3' }] });

        let fadeTimer = null;
        if (chasing) {
          if (reducedMotion()) {
            // Window shortened, no streaming.
            fadeTimer = setTimeout(() => expire(), 6000);
          } else {
            chart.reveal({ to: full, interval: Math.max(70, Math.round(140 - 60 * difficulty)) });
            sfx.whoosh();
            // Signal window: the stream end plus a short grace period.
            const grace = Math.round(3200 - 1400 * difficulty);
            fadeTimer = setTimeout(() => expire(), (full - startN) * Math.max(70, Math.round(140 - 60 * difficulty)) + grace);
          }
        }

        let answered = false;
        function expire() {
          if (answered) return;
          finish('expired');
        }

        const finish = (value) => {
          if (answered) return;
          answered = true;
          if (fadeTimer) clearTimeout(fadeTimer);
          if (value === 'expired') {
            g.wrong('<strong>Signal faded.</strong> The window closed before the call — a read you cannot state in time is a read you cannot trade.');
            chart.reveal({ to: r.candles.length, interval: 40 });
            annotate();
            verdictFlourish(stage, { ok: false, title: 'Signal faded', detail: `It was: ${LABELS[answer]}.`, scoreDelta: 0 });
            g.nextButton();
            return;
          }
          const ok = value === answer;
          const explain = `<strong>${LABELS[answer]}</strong>. ${swingRead} ${r.confirm ? 'Momentum confirms the new price extreme.' : 'Price and momentum move in opposite directions at the swing.'} Sample follow-through: ${r.outcome?.result || 'n/a'}.`;
          if (ok) g.correct(explain);
          else g.wrong(explain);
          chart.reveal({ to: r.candles.length, interval: 40 });
          annotate();
          verdictFlourish(stage, { ok, title: ok ? 'Signal caught' : 'Compare the swings', detail: swingRead, scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };

        function annotate() {
          if (r.confirm) {
            const { up, a, b } = r.confirm;
            const label = up ? 'Higher high' : 'Lower low';
            chart.addSegment({ a: { idx: a.idx, price: a.price }, b: { idx: b.idx, price: b.price }, color: up ? 'bull' : 'bear', width: 2, label });
            chart.addSegment({ pane: 'rsi', a: { idx: a.idx, price: a.rsi }, b: { idx: b.idx, price: b.rsi }, color: up ? 'bull' : 'bear', width: 2, label });
          } else {
            try { annotateSetup(r.setup, chart, r); } catch { /* */ }
          }
        }

        g.setHint('Bearish div: higher high in price, lower high in momentum. Bullish: lower low in price, higher low in momentum.');

        // ------------------------------------------------ practice: the classic quiz
        if (style === 'practice') {
          const quiz = g.ask({
            options: [
              { label: 'Bearish divergence', value: 'bear-div' },
              { label: 'Bullish divergence', value: 'bull-div' },
              { label: 'Confirmation / no clear divergence', value: 'confirm' },
            ],
            answer,
            explain: `<strong>${LABELS[answer]}</strong>. ${swingRead} ${r.confirm ? 'Momentum confirms the new price extreme.' : 'Price and momentum move in opposite directions at the swing.'} Sample follow-through: ${r.outcome?.result || 'n/a'}.`,
            onAnswer: (ok) => {
              chart.reveal({ to: r.candles.length, interval: 40 });
              annotate();
              verdictFlourish(stage, { ok, title: ok ? 'Momentum read' : 'Compare the swings', detail: swingRead, scoreDelta: ok ? 100 : 0 });
            },
          });
          stage.append(quiz);
          return () => chart.destroy();
        }

        // ------------------------------------------------ arcade / survival: the chase
        const onKey = (e) => {
          if (answered || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (e.key === '1') finish('bear-div');
          else if (e.key === '2') finish('bull-div');
          else if (e.key === '3') finish('confirm');
        };
        document.addEventListener('keydown', onKey);

        const buttons = h('div', { class: 'rush-actions option-grid', role: 'group', 'aria-label': 'Call the signal' },
          [
            { label: 'Bearish divergence', value: 'bear-div', key: '1' },
            { label: 'Bullish divergence', value: 'bull-div', key: '2' },
            { label: 'Confirmation / no div', value: 'confirm', key: '3' },
          ].map((o) => h('button', {
            type: 'button',
            class: 'option rush-option',
            on: { click: () => finish(o.value) },
          },
            h('span', { class: 'option__key', 'aria-hidden': 'true' }, o.key),
            h('span', { class: 'option__label' }, o.label),
            h('span', { class: 'option__mark', 'aria-hidden': 'true' }))));
        stage.append(buttons);

        return () => {
          if (fadeTimer) clearTimeout(fadeTimer);
          document.removeEventListener('keydown', onKey);
          chart.destroy();
        };
      },
    });
    return () => game.destroy();
  },
};
