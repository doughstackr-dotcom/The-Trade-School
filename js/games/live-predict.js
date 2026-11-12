// Oracle Arena (v2 of Live Predict) — lock your prediction and defend it.
// Practice keeps the classic quiz. Arcade and Survival give you STREAK ARMOR: begin
// with one shield, earn another at a 3-call streak (two max). Armor holds a wrong call —
// it scores partial credit and your streak lives to fight again. The live-market
// plumbing is unchanged: real charts when available, textbook fallback.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, icon, sfx, floatText } from '../core/ui.js';
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

function armorIcons(n) {
  return h('span', { class: 'arena-armor__icons', role: 'img', 'aria-label': `${n} armor ${n === 1 ? 'shield' : 'shields'}` },
    [0, 1].map((i) => icon('shield', { size: 15, class: i < n ? 'armor-on' : 'armor-off' })));
}

export default {
  id: 'live-predict',
  mount(root, ctx) {
    // Streak armor lives for the whole run; refreshed in onStart.
    const armorEl = h('span', { class: 'arena-armor', title: 'Streak armor holds one wrong call' });

    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 74, direction: 'down', title: 'Oracle Arena', score: 200, streak: 2, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'A real-market chart freezes before the next stretch of candles.',
        'Arcade: predict up, down or range — streak armor (start with one shield, earn a second at a 3-streak) holds one wrong call for partial credit without breaking your streak.',
        'The exact window and the symbol are revealed after you commit — outcomes are noisy.',
      ],
      onStart(g, { style }) {
        g._armor = style === 'practice' ? 0 : 1;
        armorEl.replaceChildren(h('span', { class: 'arcade-label' }, 'Armor'), armorIcons(g._armor));
        if (style !== 'practice' && !armorEl.isConnected) g.hudExtra.append(armorEl);
        armorEl.hidden = style === 'practice';
      },
      async onRound(g, { rng, stage, difficulty, style }) {
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
        stage.append(h('p', { class: 'quiz__q' }, `Lock your prediction — next ${ahead} candles: up, down or inside the ±${edge}% range?`), host);
        const chart = new CandleChart(host, {
          candles: shownCandles, visible: r.decisionIdx + 1, slots: shownCandles.length,
          height: 255, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Live predict chart; future hidden',
        });
        const entry = r.candles[r.decisionIdx].c;
        chart.addHLine({ price: entry * (1 + result.tolerance), color: 'info', dashed: true, label: 'Upper range edge' });
        chart.addHLine({ price: entry * (1 - result.tolerance), color: 'info', dashed: true, label: 'Lower range edge' });
        g.setHint('Use structure at the freeze — do not invent a story from one wick.');

        const explain = `This window closed <strong>${result.chg >= 0 ? '+' : ''}${(result.chg * 100).toFixed(2)}%</strong> from the freeze; ${answer} means ${answer === 'range' ? `inside ±${edge}%` : `beyond the ${edge}% range edge`}. One sample path does not prove a strategy.`;
        const doReveal = (ok) => {
          chart.reveal({ to: shownCandles.length, interval: 40 });
          chart.addMarker({ idx: shownCandles.length - 1, position: result.chg >= 0 ? 'above' : 'below', shape: 'dot', color: ok ? 'bull' : 'accent', text: `${result.chg >= 0 ? '+' : ''}${(result.chg * 100).toFixed(1)}%` });
        };

        // ------------------------------------------------ practice: the classic quiz
        if (style === 'practice') {
          const quiz = g.ask({
            options: [
              { label: 'Up', value: 'up' },
              { label: 'Down', value: 'down' },
              { label: 'Range', value: 'range' },
            ],
            answer,
            explain,
            onAnswer: (ok) => {
              doReveal(ok);
              verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
            },
          });
          stage.append(quiz);
          return () => chart.destroy();
        }

        // ------------------------------------------------ arcade / survival: defend the streak
        let answered = false;
        const finish = (value) => {
          if (answered) return;
          answered = true;
          const ok = value === answer;
          if (ok) {
            g.correct(explain);
            if (g.streak === 3 && g._armor < 2) {
              g._armor += 1;
              floatText('ARMOR +1', { at: armorEl.isConnected ? armorEl : host, tone: 'accent' });
              sfx.powerup();
              armorEl.replaceChildren(h('span', { class: 'arcade-label' }, 'Armor'), armorIcons(g._armor));
            }
            doReveal(true);
            verdictFlourish(stage, { ok: true, title: 'Prediction held', scoreDelta: 100 });
          } else if (g._armor > 0) {
            g._armor -= 1;
            floatText('ARMOR HELD', { at: host, tone: 'accent' });
            sfx.badge();
            g.award(30, { reason: 'armor held the call' });
            armorEl.replaceChildren(h('span', { class: 'arcade-label' }, 'Armor'), armorIcons(g._armor));
            doReveal(false);
            verdictFlourish(stage, { ok: false, title: 'Armor held the miss', detail: `Wrong call — but the shield took it. ${g._armor} left. Streak intact.`, scoreDelta: 30 });
          } else {
            g.wrong(explain);
            doReveal(false);
            verdictFlourish(stage, { ok: false, title: 'Prediction missed', scoreDelta: 0 });
          }
          g.nextButton();
        };

        const onKey = (e) => {
          if (answered || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (e.key === '1') finish('up');
          else if (e.key === '2') finish('down');
          else if (e.key === '3') finish('range');
        };
        document.addEventListener('keydown', onKey);

        const buttons = h('div', { class: 'rush-actions option-grid', role: 'group', 'aria-label': 'Lock your prediction' },
          [
            { label: 'Up', value: 'up', key: '1', cls: 'rush-option--bullish' },
            { label: 'Down', value: 'down', key: '2', cls: 'rush-option--bearish' },
            { label: 'Range', value: 'range', key: '3', cls: '' },
          ].map((o) => h('button', {
            type: 'button',
            class: ['option', 'rush-option', o.cls],
            on: { click: () => finish(o.value) },
          },
            h('span', { class: 'option__key', 'aria-hidden': 'true' }, o.key),
            h('span', { class: 'option__label' }, o.label),
            h('span', { class: 'option__mark', 'aria-hidden': 'true' }))));
        stage.append(buttons);

        return () => {
          document.removeEventListener('keydown', onKey);
          chart.destroy();
        };
      },
    });
    return () => game.destroy();
  },
};
