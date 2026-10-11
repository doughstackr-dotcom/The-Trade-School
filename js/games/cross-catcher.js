// Cross Catch (v2 of Cross Catcher) — catch the cross the moment it prints.
// Practice keeps the classic study quiz. Arcade and Survival stream the chart: hit
// CATCH within three candles of a fresh golden/death cross — the exact bar pays most.
// No cross coming? Call NO CROSS and let it ride.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, floatText, reducedMotion } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma } from '../core/indicators.js';

function textbook(rng) {
  const direction = rng.pick(['up', 'down']);
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 140, direction, swings: 3 });
  const decisionIdx = ts.candles.length - 15;
  return {
    candles: ts.candles,
    decisionIdx,
    lead: [],
    decimals: 2,
  };
}

/** All fast/slow crossings in [from, to]: [{ idx, kind: 'golden'|'death' }]. */
function crossingsIn(fast, slow, from, to) {
  const out = [];
  for (let i = Math.max(1, from); i <= to; i++) {
    if (!Number.isFinite(fast[i - 1]) || !Number.isFinite(slow[i - 1]) || !Number.isFinite(fast[i]) || !Number.isFinite(slow[i])) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) out.push({ idx: i, kind: 'golden' });
    if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) out.push({ idx: i, kind: 'death' });
  }
  return out;
}

function crossStatus(fast, slow, end) {
  const found = crossingsIn(fast, slow, end - 2, end);
  return found.length ? found[found.length - 1].kind : (fast[end] > slow[end] ? 'fast-above' : 'fast-below');
}

export default {
  id: 'cross-catcher',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 71, direction: 'up', title: 'Cross Catch', score: 180, streak: 2, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 26, perRound: true },
      howTo: [
        'Fast and slow moving averages print candle by candle.',
        'Arcade: hit CATCH within three candles of a fresh cross — the exact bar pays 100. No cross coming? Call NO CROSS.',
        'An MA cross confirms past momentum; it cannot predict the next bar.',
      ],
      async onRound(g, { rng, stage, difficulty, style }) {
        // Scanner kinds (js/core/scanner.js SETUP_KINDS); the MAs are drawn from the round data.
        const real = await g.realRound({
          kinds: difficulty < 0.5 ? ['trend-up', 'trend-down'] : ['trend-up', 'trend-down', 'golden-cross', 'death-cross'],
          before: 120,
          after: 15,
        });
        const r = real || textbook(rng);
        const lead = r.lead || [];
        const prices = [...lead, ...r.candles].map((c) => c.c);
        const slowPeriod = r.setup?.meta?.slowPeriod && prices.length >= r.setup.meta.slowPeriod
          ? r.setup.meta.slowPeriod : difficulty > 0.6 ? 30 : 20;
        const fastPeriod = slowPeriod > 30 ? r.setup?.meta?.fastPeriod || 50 : 10;
        const slow = sma(prices, slowPeriod).slice(lead.length);
        const fast = sma(prices, fastPeriod).slice(lead.length);
        const d = r.decisionIdx;
        const host = h('div', { class: 'chart-frame' });

        // ------------------------------------------------ practice: the classic quiz
        if (style === 'practice') {
          const chart = new CandleChart(host, {
            candles: r.candles, visible: d + 1, slots: r.candles.length,
            height: 250, decimals: r.decimals ?? 2, yPad: 0.12,
            ariaLabel: 'Price with moving average context',
          });
          chart.addSeries({ values: slow, color: 'accent', label: `Slow ${slowPeriod}` });
          chart.addSeries({ values: fast, color: 'info', label: `Fast ${fastPeriod}` });
          const advanced = difficulty > 0.45 && Number.isFinite(fast[d]) && Number.isFinite(slow[d]);
          const answer = advanced ? crossStatus(fast, slow, d) : r.candles[d].c >= slow[d] ? 'above' : 'below';
          stage.append(h('p', { class: 'quiz__q' }, advanced
            ? `What did the fast ${fastPeriod}-bar MA do relative to the slow ${slowPeriod}-bar MA?`
            : 'Where is price relative to the moving average?'), host);
          g.setHint(advanced ? 'A cross needs the fast line to change sides within the last three candles. Otherwise call its current side.'
            : 'Compare the last close to the moving-average line.');
          const quiz = g.ask({
            options: advanced ? [
              { label: 'Bullish cross: fast moved above', value: 'golden' },
              { label: 'Bearish cross: fast moved below', value: 'death' },
              { label: 'No new cross: fast still above', value: 'fast-above' },
              { label: 'No new cross: fast still below', value: 'fast-below' },
            ] : [
              { label: 'Price above MA (bullish filter)', value: 'above' },
              { label: 'Price below MA (bearish filter)', value: 'below' },
            ],
            answer,
            explain: advanced
              ? `<strong>${answer.replace('-', ' ')}</strong>. Fast ${fast[d].toFixed(2)}, slow ${slow[d].toFixed(2)} at the freeze. An MA cross confirms past momentum; it cannot predict the next bar.`
              : `<strong>Price ${answer} MA</strong> at the freeze. Filters lag; combine with structure.`,
            onAnswer: (ok) => {
              chart.reveal({ to: r.candles.length, interval: 40 });
              verdictFlourish(stage, { ok, title: ok ? 'Cross caught' : 'Recheck the lines', scoreDelta: ok ? 100 : 0 });
            },
          });
          stage.append(quiz);
          return () => chart.destroy();
        }

        // ------------------------------------------------ arcade / survival: the catch
        const len = r.candles.length;
        const streamEnd = Math.min(len - 1, d + 6);
        const back = 10 + Math.round(8 * difficulty);
        const startN = Math.max(fastPeriod + 1, d - back);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: startN + 1, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Price with fast and slow moving averages printing live',
        });
        chart.addSeries({ values: slow, color: 'accent', label: `Slow ${slowPeriod}` });
        chart.addSeries({ values: fast, color: 'info', label: `Fast ${fastPeriod}` });
        const crossList = crossingsIn(fast, slow, startN + 1, streamEnd);
        const target = crossList.length ? crossList[crossList.length - 1] : null;
        stage.append(h('p', { class: 'quiz__q' }, 'Watch the averages. Catch a fresh cross — or call NO CROSS.'), host);

        let shown = startN;
        let tick = null;
        if (!reducedMotion()) {
          chart.reveal({ to: streamEnd + 1, interval: Math.max(80, Math.round(150 - 60 * difficulty)) });
          sfx.whoosh();
          tick = setInterval(() => {
            shown = Math.min(streamEnd, shown + 1);
            if (shown >= streamEnd) clearInterval(tick);
          }, Math.max(80, Math.round(150 - 60 * difficulty)));
        } else {
          shown = streamEnd; // reduced motion: whole window printed, judge the freeze
        }

        const recentCross = () => crossingsIn(fast, slow, shown - 2, shown)[0] || null;

        let answered = false;
        const settle = (ok, points, title, explain) => {
          if (answered) return;
          answered = true;
          if (tick) clearInterval(tick);
          if (target) {
            chart.addBox({ from: Math.max(0, target.idx - 2), to: target.idx, color: target.kind === 'golden' ? 'bull' : 'bear', label: target.kind === 'golden' ? 'Golden cross' : 'Death cross' });
          }
          chart.reveal({ to: len, interval: 40 });
          if (ok) g.correct(explain, { points });
          else g.wrong(explain);
          verdictFlourish(stage, { ok, title, scoreDelta: ok ? points : 0 });
          g.nextButton();
        };

        const onCatch = () => {
          if (answered) return;
          const c = recentCross();
          if (!c) {
            settle(false, 0, 'No cross there',
              `<strong>No fresh cross.</strong> The fast line had not changed sides in the last three candles. Patience — only a completed cross counts.`);
            return;
          }
          const age = shown - c.idx;
          const points = age === 0 ? 100 : age === 1 ? 80 : 60;
          const label = age === 0 ? 'PERFECT!' : age === 1 ? 'GREAT' : 'CAUGHT';
          floatText(label, { at: host, tone: age === 0 ? 'bull' : 'accent' });
          if (age === 0) sfx.powerup();
          const kindText = c.kind === 'golden' ? 'golden cross (fast moved above)' : 'death cross (fast moved below)';
          settle(true, points, age === 0 ? 'Perfect catch' : age === 1 ? 'Sharp catch' : 'Caught it late',
            `<strong>${kindText}</strong> on candle ${c.idx + 1}${age > 0 ? ` — caught ${age} bar${age > 1 ? 's' : ''} later for ${points} points` : ' — caught on the exact bar for 100 points'}. Crosses confirm past momentum; they cannot predict the next bar.`);
        };

        const onNoCross = () => {
          if (answered) return;
          if (target) {
            settle(false, 0, 'A cross was coming',
              `<strong>There was a cross.</strong> A ${target.kind === 'golden' ? 'golden' : 'death'} cross printed on candle ${target.idx + 1} — boxed on the reveal. Let the lines finish their argument before you call it.`);
          } else {
            settle(true, 100, 'Read it right',
              `<strong>No new cross.</strong> The fast average stayed on its side of the slow one for the whole window. Fast ${Number.isFinite(fast[streamEnd]) ? fast[streamEnd].toFixed(2) : '—'}, slow ${Number.isFinite(slow[streamEnd]) ? slow[streamEnd].toFixed(2) : '—'} at the freeze.`);
          }
        };

        const onKey = (e) => {
          if (answered || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (e.key === '1') onCatch();
          else if (e.key === '2') onNoCross();
        };
        document.addEventListener('keydown', onKey);

        const actions = h('div', { class: 'rush-actions option-grid catch-actions', role: 'group', 'aria-label': 'Catch the cross' },
          h('button', {
            type: 'button',
            class: 'option catch-btn',
            on: { click: onCatch },
          },
            h('span', { class: 'option__key', 'aria-hidden': 'true' }, '1'),
            h('span', { class: 'option__label' }, 'CATCH — a cross just printed'),
            h('span', { class: 'option__mark', 'aria-hidden': 'true' })),
          h('button', {
            type: 'button',
            class: 'option catch-btn catch-btn--pass',
            on: { click: onNoCross },
          },
            h('span', { class: 'option__key', 'aria-hidden': 'true' }, '2'),
            h('span', { class: 'option__label' }, 'NO CROSS — none is coming'),
            h('span', { class: 'option__mark', 'aria-hidden': 'true' })));
        stage.append(actions);
        g.setHint('A cross needs the fast line to move through the slow one. Only the last three candles count.');

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
