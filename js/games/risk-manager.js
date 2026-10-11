// Risk Manager — position sizing, R-multiples, expectancy and portfolio heat.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { h } from '../core/ui.js';

function scenario(rng, difficulty) {
  const account = rng.pick([10000, 20000, 25000, 50000, 100000]);
  const riskPct = difficulty < 0.4 ? 1 : difficulty < 0.7 ? rng.pick([0.5, 1, 1.5]) : rng.pick([0.5, 1, 2]);
  const entry = +(rng.float(20, 400)).toFixed(2);
  // Avoid asking for more shares than a cash account can afford at the planned risk.
  const minRiskPerShare = Math.max(0.5, Math.ceil(entry * riskPct) / 100);
  const riskPerShare = +(rng.float(minRiskPerShare, Math.max(1, entry * 0.07)).toFixed(2));
  const stop = +(entry - riskPerShare).toFixed(2);
  const risk$ = account * (riskPct / 100);
  const shares = Math.max(1, Math.min(Math.floor(risk$ / riskPerShare), Math.floor(account / entry)));
  const targetR = rng.pick([2, 2.5, 3]);
  const target = +(entry + riskPerShare * targetR).toFixed(2);
  const openR = difficulty > 0.55 ? rng.pick([0, 0.5, 1, 1.5, 2, 2.5, 3]) : rng.pick([0, 0.5, 1, 2.5]);
  const dailyLimitR = 3;
  return { account, riskPct, entry, stop, riskPerShare, risk$, shares, targetR, target, openR, dailyLimitR };
}

function signedR(value) {
  return `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}R`;
}

export default {
  id: 'risk-manager',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 59, direction: 'up', title: 'risk-manager', score: 100, streak: 1, round: '2/3' }),
      rounds: 8,
      timer: { seconds: 40, perRound: true },
      howTo: [
        'Work sizing, reward-to-risk, expectancy and daily heat.',
        'A correct skip when heat is full is a winning play.',
        'Numbers change every round — do the math, do not memorize.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const s = scenario(rng, difficulty);
        const span = Math.max(s.riskPerShare * (s.targetR + 2), s.entry * 0.04);
        const candles = trendSeries({
          seed: rng.int(1, 1e9), count: 30, direction: 'up', swings: 2, start: 100,
        }).candles.map((k) => {
          // Keep action near the trade levels so entry/stop/target read clearly
          const mid = (s.stop + s.target) / 2;
          const scale = span / 8;
          return {
            ...k,
            o: mid + (k.o - 100) * scale * 0.15,
            h: mid + (k.h - 100) * scale * 0.15,
            l: mid + (k.l - 100) * scale * 0.15,
            c: mid + (k.c - 100) * scale * 0.15,
          };
        });
        const riskChart = miniChart(candles, {
          width: 420, height: 200, yPad: 0.14, showAxis: true,
          overlays: [
            { type: 'hline', price: s.target, color: 'bull', label: `Target ${s.target}`, width: 1.5 },
            { type: 'hline', price: s.entry, color: 'accent', label: `Entry ${s.entry}`, width: 1.75 },
            { type: 'hline', price: s.stop, color: 'bear', label: `Stop ${s.stop}`, width: 1.5 },
            { type: 'zone', from: s.stop, to: s.entry, color: 'bear', label: '1R risk' },
            { type: 'zone', from: s.entry, to: s.target, color: 'bull', label: `${s.targetR}R` },
          ],
          ariaLabel: 'Risk manager trade levels chart',
        });
        const chartWrap = h('div', { class: 'daily-chart', style: { marginBottom: '0.55rem' } }, riskChart);
        stage.append(
          h('div', { class: 'callout callout--tip risk-hud', role: 'status' },
            h('p', null,
              h('strong', null, 'Desk blotter: '),
              `Account $${s.account.toLocaleString()} · plan risk ${s.riskPct}% · open heat ${s.openR}R / ${s.dailyLimitR}R`,
            )),
          chartWrap,
        );
        const ask = (opts) => {
          const quiz = g.ask(opts);
          stage.insertBefore(quiz, chartWrap);
        };
        const roll = rng.float();
        if (roll < 0.34) {
          const correct = s.shares;
          const opts = new Set([correct]);
          while (opts.size < 4) opts.add(Math.max(1, correct + rng.int(-50, 50)));
          g.setHint('Dollars at risk ÷ dollars risked per share.');
          ask({
            question: `Entry ${s.entry}, stop ${s.stop}. Shares for ${s.riskPct}% risk?`,
            options: rng.shuffle([...opts].map((n) => ({ label: `${n} shares`, value: n }))),
            answer: correct,
            explain: `$${s.risk$.toFixed(0)} ÷ ${s.riskPerShare} ≈ <strong>${correct} shares</strong>.`,
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Sized right' : 'Recheck sizing', scoreDelta: ok ? 100 : 0 }),
          });
        } else if (roll < 0.62) {
          g.setHint('(Target − entry) ÷ (entry − stop).');
          ask({
            question: `Entry ${s.entry}, stop ${s.stop}, target ${s.target}. Reward-to-risk?`,
            options: rng.shuffle([
              { label: `${s.targetR} : 1`, value: s.targetR },
              { label: '1 : 1', value: 1 },
              { label: '4 : 1', value: 4 },
              { label: '0.5 : 1', value: 0.5 },
            ]),
            answer: s.targetR,
            explain: `≈ <strong>${s.targetR}R</strong> of reward per 1R risked.`,
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'R locked' : 'Recheck R', scoreDelta: ok ? 100 : 0 }),
          });
        } else if (roll < 0.82) {
          const winRate = rng.pick(difficulty < 0.4 ? [0.4, 0.5] : [0.35, 0.4, 0.45, 0.5, 0.55, 0.6]);
          const avgWin = rng.pick(difficulty < 0.4 ? [2, 2.5] : [1.5, 2, 2.5, 3]);
          const expectancy = Number((winRate * avgWin - (1 - winRate)).toFixed(2));
          const distractors = [expectancy, expectancy + 0.5, expectancy - 0.5, expectancy + 1].map((n) => Number(n.toFixed(2)));
          g.setHint('p(win) × average win − p(loss) × average loss. A positive outcome on one trade does not prove positive expectancy.');
          ask({
            question: `Win rate ${winRate * 100}%, average win ${avgWin}R, average loss 1R. Expectancy per trade?`,
            options: rng.shuffle(distractors.map((value) => ({ label: signedR(value), value }))),
            answer: expectancy,
            explain: `${winRate} × ${avgWin} − ${Number((1 - winRate).toFixed(2))} × 1 = <strong>${signedR(expectancy)}</strong> per trade.`,
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Expectancy ok' : 'Recheck math', scoreDelta: ok ? 100 : 0 }),
          });
        } else {
          const proposedR = rng.pick(difficulty < 0.55 ? [1] : [0.5, 1, 1.5, 2]);
          const ok = s.openR + proposedR <= s.dailyLimitR;
          g.setHint('Sum open R; stay inside the daily cap.');
          ask({
            question: `Open heat ${s.openR}R, daily cap ${s.dailyLimitR}R. Can the desk add ${proposedR}R risk?`,
            options: [
              { label: 'Yes — still inside the cap', value: 'yes' },
              { label: 'No — would exceed the cap', value: 'no' },
            ],
            answer: ok ? 'yes' : 'no',
            explain: ok
              ? `${s.openR} + ${proposedR} ≤ ${s.dailyLimitR} — allowed at plan size.`
              : `${s.openR} + ${proposedR} > ${s.dailyLimitR} — skip or reduce. Protect the book.`,
            onAnswer: (ok2) => verdictFlourish(stage, { ok: ok2, title: ok2 ? 'Heat checked' : 'Protect the book', scoreDelta: ok2 ? 100 : 0 }),
          });
        }
      },
    });
    return () => game.destroy();
  },
};
