// Risk Manager — position sizing, R-multiples, expectancy and portfolio heat.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish, sampleCandle, tinySeries } from '../core/game-ui.js';
import { miniChart } from '../core/chart.js';
import { h } from '../core/ui.js';

function scenario(rng, difficulty) {
  const account = rng.pick([10000, 20000, 25000, 50000, 100000]);
  const riskPct = difficulty < 0.4 ? 1 : difficulty < 0.7 ? rng.pick([0.5, 1, 1.5]) : rng.pick([0.5, 1, 2]);
  const entry = +(rng.float(20, 400)).toFixed(2);
  const riskPerShare = +(rng.float(0.5, Math.max(1, entry * 0.04))).toFixed(2);
  const stop = +(entry - riskPerShare).toFixed(2);
  const risk$ = account * (riskPct / 100);
  const shares = Math.max(1, Math.floor(risk$ / riskPerShare));
  const targetR = rng.pick([2, 2.5, 3]);
  const target = +(entry + riskPerShare * targetR).toFixed(2);
  const openR = difficulty > 0.55 ? rng.pick([0, 0.5, 1, 1.5, 2]) : rng.pick([0, 0.5]);
  const dailyLimitR = 3;
  return { account, riskPct, entry, stop, riskPerShare, risk$, shares, targetR, target, openR, dailyLimitR };
}

export default {
  id: 'risk-manager',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 59, direction: 'up', title: 'risk-manager', score: 300, streak: 1, round: '2/8' }),
      rounds: 8,
      timer: { seconds: 40, perRound: true },
      howTo: [
        'Work sizing, reward-to-risk, expectancy and daily heat.',
        'A correct skip when heat is full is a winning play.',
        'Numbers change every round — do the math, do not memorize.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const s = scenario(rng, difficulty);
        stage.append(
          h('div', { class: 'row row--sm', style: { gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' } },
            sampleCandle('bull', { width: 28, height: 42 }),
            miniChart(tinySeries(rng.int(1, 80), 'up', 16), { width: 140, height: 48, ariaLabel: 'Risk session thumb' }),
          ),
          h('div', { class: 'callout callout--tip risk-hud', role: 'status' },
            h('p', null,
              h('strong', null, 'Desk blotter: '),
              `Account $${s.account.toLocaleString()} · plan risk ${s.riskPct}% · open heat ${s.openR}R / ${s.dailyLimitR}R`,
            )),
        );
        const roll = rng.float();
        if (roll < 0.34) {
          const correct = s.shares;
          const opts = new Set([correct]);
          while (opts.size < 4) opts.add(Math.max(1, correct + rng.int(-50, 50)));
          g.setHint('Dollars at risk ÷ dollars risked per share.');
          g.ask({
            question: `Entry ${s.entry}, stop ${s.stop}. Shares for ${s.riskPct}% risk?`,
            options: rng.shuffle([...opts].map((n) => ({ label: `${n} shares`, value: n }))),
            answer: correct,
            explain: `$${s.risk$.toFixed(0)} ÷ ${s.riskPerShare} ≈ <strong>${correct} shares</strong>.`,
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Sized right' : 'Recheck sizing', scoreDelta: ok ? 100 : 0 }),
          });
        } else if (roll < 0.62) {
          g.setHint('(Target − entry) ÷ (entry − stop).');
          g.ask({
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
          g.setHint('p(win)×avgWin − p(loss)×avgLoss.');
          g.ask({
            question: 'Win rate 40%, avg win 2R, avg loss 1R. Expectancy per trade?',
            options: rng.shuffle([
              { label: '+0.2R', value: 0.2 },
              { label: '−0.2R', value: -0.2 },
              { label: '+0.8R', value: 0.8 },
              { label: '0R', value: 0 },
            ]),
            answer: 0.2,
            explain: '0.4×2 − 0.6×1 = <strong>+0.2R</strong>.',
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Expectancy ok' : 'Recheck math', scoreDelta: ok ? 100 : 0 }),
          });
        } else {
          const ok = s.openR + 1 <= s.dailyLimitR;
          g.setHint('Sum open R; stay inside the daily cap.');
          g.ask({
            question: `Open heat ${s.openR}R, daily cap ${s.dailyLimitR}R. Take a new 1R risk trade?`,
            options: [
              { label: 'Yes — still inside the cap', value: 'yes' },
              { label: 'No — would exceed daily heat', value: 'no' },
            ],
            answer: ok ? 'yes' : 'no',
            explain: ok
              ? `${s.openR} + 1 ≤ ${s.dailyLimitR} — allowed at plan size.`
              : `${s.openR} + 1 > ${s.dailyLimitR} — skip or reduce. Protect the book.`,
            onAnswer: (ok2) => verdictFlourish(stage, { ok: ok2, title: ok2 ? 'Heat checked' : 'Protect the book', scoreDelta: ok2 ? 100 : 0 }),
          });
        }
      },
    });
    return () => game.destroy();
  },
};
