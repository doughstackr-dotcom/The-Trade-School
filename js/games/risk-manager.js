// Risk Manager — position sizing, R-multiples, expectancy and portfolio heat.
// Portfolio heat = the total R at risk across all open positions; the heat limit caps it.
import { GameShell, explainChoice } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { h } from '../core/ui.js';

const round2 = (x) => Math.round(x * 100) / 100;
const fmtR = (x) => {
  const v = round2(x);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}R`;
};
const money = (x) => {
  const v = round2(x);
  const cents = Number.isInteger(v) ? 0 : 2;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: cents, maximumFractionDigits: cents })}`;
};

export function scenario(rng, difficulty) {
  const account = rng.pick([10000, 20000, 25000, 50000, 100000]);
  const riskPct = difficulty < 0.4 ? 1 : difficulty < 0.7 ? rng.pick([0.5, 1, 1.5]) : rng.pick([0.5, 1, 2]);
  const entry = +(rng.float(20, 400)).toFixed(2);
  const riskPerShare = +(rng.float(0.5, Math.max(1, entry * 0.04))).toFixed(2);
  const stop = +(entry - riskPerShare).toFixed(2);
  const risk$ = account * (riskPct / 100);
  const shares = Math.max(1, Math.floor(risk$ / riskPerShare));
  const targetR = rng.pick(difficulty < 0.4 ? [2, 3] : [1.5, 2, 2.5, 3, 4]);
  const target = +(entry + riskPerShare * targetR).toFixed(2);
  // Open heat is drawn around the limit so both "take it" and "skip it" come up.
  const heatLimitR = rng.pick([3, 4, 5]);
  const newR = rng.pick([0.5, 1]);
  const openR = Math.max(0, heatLimitR - newR + rng.pick([-1, -0.5, 0, 0.5, 1]));
  return { account, riskPct, entry, stop, riskPerShare, risk$, shares, targetR, target, openR, heatLimitR, newR };
}

/** Keeps the first 4 options with distinct values ≥ min (the first is the answer). */
function distinct(list, min = -Infinity) {
  const out = [];
  const seen = new Set();
  for (const o of list) {
    if (out.length >= 4) break;
    if (!Number.isFinite(o.value) || o.value < min || seen.has(o.value)) continue;
    seen.add(o.value);
    out.push(o);
  }
  return out;
}

/**
 * Share-count options: the answer plus common sizing mistakes, each with why it is wrong.
 * → [{ value, why }] — the first is correct (why null); 4 distinct values ≥ 1.
 */
export function shareOptions(s, rng) {
  const exact = s.risk$ / s.riskPerShare;
  const correct = s.shares;
  const up = Math.ceil(exact) > correct ? Math.ceil(exact) : correct + 1;
  const mistakes = rng.shuffle([
    { value: Math.floor(s.risk$ / s.entry), why: `That divides the ${money(s.risk$)} risk by the entry PRICE. Size comes from the distance to the stop: ${money(s.risk$)} ÷ ${money(s.riskPerShare)} per share.` },
    { value: Math.floor((s.risk$ * 10) / s.riskPerShare), why: `That risks ${s.riskPct * 10}% of the account, ten times the plan: ${s.riskPct}% of ${money(s.account)} is ${money(s.risk$)}, not ${money(s.risk$ * 10)}.` },
    { value: Math.floor(s.risk$ / 10 / s.riskPerShare), why: `That risks only ${round2(s.riskPct / 10)}% of the account: ${s.riskPct}% of ${money(s.account)} is ${money(s.risk$)}, not ${money(s.risk$ / 10)}.` },
    { value: Math.floor(s.account / s.entry), why: 'That is how many shares the whole account can BUY, not how many you can afford to LOSE on. Size = dollars at risk ÷ risk per share.' },
  ]);
  const extra = [2, 3, 4, 5].map((k) => ({ value: correct * k, why: `That risks ${k}× the plan’s ${money(s.risk$)}. ${money(s.risk$)} ÷ ${money(s.riskPerShare)} = ${exact.toFixed(2)}, rounded down.` }));
  return distinct([
    { value: correct, why: null },
    { value: up, why: `${money(s.risk$)} ÷ ${money(s.riskPerShare)} = ${exact.toFixed(2)}. ${up} shares would risk ${money(up * s.riskPerShare)}, more than the plan allows: always round DOWN.` },
    ...mistakes,
    ...extra,
  ], 1);
}

/** Expectancy question with a random win rate and average win (losses are 1R). */
export function expectancyQuestion(rng) {
  const p = rng.pick([30, 35, 40, 45, 50, 55, 60]) / 100;
  const W = rng.pick([1, 1.5, 2, 2.5, 3]);
  const answer = round2(p * W - (1 - p));
  const lossPct = Math.round((1 - p) * 100);
  const opts = distinct([
    { value: answer, why: null },
    ...rng.shuffle([
      { value: round2(p * W), why: `That forgets the losing trades: they happen ${lossPct}% of the time and cost 1R each.` },
      { value: round2(p * W - p), why: `That applies the ${Math.round(p * 100)}% win rate to the losses too. Losses happen ${lossPct}% of the time.` },
      { value: round2(W - 1), why: 'That ignores how often you win: the size of a win means little without the win rate.' },
    ]),
    { value: round2((1 - p) * W - p), why: 'That swaps the win rate and the loss rate.' },
    { value: round2(-answer), why: 'Right numbers, wrong sign: wins add to expectancy, losses subtract.' },
    { value: round2(answer + 0.5), why: 'Recompute: win rate × average win, minus loss rate × average loss.' },
    { value: round2(answer - 0.5), why: 'Recompute: win rate × average win, minus loss rate × average loss.' },
    { value: round2(answer + 0.25), why: 'Recompute: win rate × average win, minus loss rate × average loss.' },
    { value: round2(answer - 0.25), why: 'Recompute: win rate × average win, minus loss rate × average loss.' },
    { value: round2(answer + 1), why: 'Recompute: win rate × average win, minus loss rate × average loss.' },
    { value: round2(answer - 1), why: 'Recompute: win rate × average win, minus loss rate × average loss.' },
  ]);
  return { p, W, answer, opts };
}

/** Reward-to-risk options: the answer and common slips (inverted, measured from the stop). */
export function rrOptions(s, rng) {
  const t = s.targetR;
  const other = rng.pick([1, 1.5, 2, 2.5, 3, 4, 5].filter((x) => x !== t && x !== t + 1));
  return [
    { value: `${t} : 1`, why: null },
    { value: `1 : ${t}`, why: 'That is upside down: reward (target − entry) goes first, risk (entry − stop) second.' },
    { value: `${t + 1} : 1`, why: `That measures the reward from the stop instead of the entry. Reward = ${s.target} − ${s.entry}.` },
    { value: `${other} : 1`, why: `Recompute: (${s.target} − ${s.entry}) ÷ (${s.entry} − ${s.stop}).` },
  ];
}

const whyOf = (opts) => Object.fromEntries(opts.filter((o) => o.why).map((o) => [o.value, o.why]));

export default {
  id: 'risk-manager',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 59, direction: 'up', title: 'risk-manager', score: 300, streak: 1, round: '2/8' }),
      rounds: 8,
      timer: { seconds: 40, perRound: true },
      howTo: [
        'Work sizing, reward-to-risk, expectancy and portfolio heat (the total R at risk across open trades).',
        'A correct skip when a new trade would break the heat limit is a winning play.',
        'Numbers change every round — do the math, do not memorize.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const s = scenario(rng, difficulty);
        const span = Math.max(s.riskPerShare * (s.targetR + 2), s.entry * 0.04);
        const candles = trendSeries({
          seed: rng.int(1, 1e9), count: 30, direction: 'up', swings: 2, start: s.stop + span * 0.3,
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
        stage.append(
          h('div', { class: 'daily-chart', style: { marginBottom: '0.55rem' } }, riskChart),
          h('div', { class: 'callout callout--tip risk-hud', role: 'status' },
            h('p', null,
              h('strong', null, 'Desk blotter: '),
              `Account $${s.account.toLocaleString('en-US')} · plan risk ${s.riskPct}% per trade · portfolio heat ${s.openR}R open / ${s.heatLimitR}R limit`,
            )),
        );
        const roll = rng.float();
        if (roll < 0.34) {
          const opts = shareOptions(s, rng);
          const exact = s.risk$ / s.riskPerShare;
          g.setHint('Dollars at risk ÷ dollars risked per share, then round down.');
          g.ask({
            question: `Entry ${s.entry}, stop ${s.stop}. Shares for ${s.riskPct}% risk?`,
            options: rng.shuffle(opts.map((o) => ({ label: `${o.value} shares`, value: o.value }))),
            answer: s.shares,
            explain: explainChoice(
              `${s.riskPct}% of ${money(s.account)} = ${money(s.risk$)} at risk. ${money(s.risk$)} ÷ ${money(s.riskPerShare)} per share = ${exact.toFixed(2)}, rounded down to <strong>${s.shares} shares</strong> (${money(s.shares * s.riskPerShare)} at risk).`,
              whyOf(opts),
            ),
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Sized right' : 'Recheck sizing', scoreDelta: ok ? 100 : 0 }),
          });
        } else if (roll < 0.62) {
          const opts = rrOptions(s, rng);
          const reward = round2(s.target - s.entry);
          g.setHint('(Target − entry) ÷ (entry − stop).');
          g.ask({
            question: `Entry ${s.entry}, stop ${s.stop}, target ${s.target}. Reward-to-risk?`,
            options: rng.shuffle(opts.map((o) => ({ label: o.value, value: o.value }))),
            answer: opts[0].value,
            explain: explainChoice(
              `Reward ${reward} ÷ risk ${s.riskPerShare} = <strong>${s.targetR} : 1</strong>: ${s.targetR}R of reward for each 1R risked.`,
              whyOf(opts),
            ),
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'R locked' : 'Recheck R', scoreDelta: ok ? 100 : 0 }),
          });
        } else if (roll < 0.82) {
          const ex = expectancyQuestion(rng);
          g.setHint('Win rate × average win − loss rate × average loss.');
          g.ask({
            question: `Win rate ${Math.round(ex.p * 100)}%, average win ${ex.W}R, average loss 1R. Expectancy per trade?`,
            options: rng.shuffle(ex.opts.map((o) => ({ label: fmtR(o.value), value: o.value }))),
            answer: ex.answer,
            explain: explainChoice(
              `${ex.p.toFixed(2)} × ${ex.W}R − ${(1 - ex.p).toFixed(2)} × 1R = <strong>${fmtR(ex.answer)}</strong> per trade, on average over many trades${ex.answer <= 0 ? ': no edge, however good a single win feels' : ''}.`,
              whyOf(ex.opts),
            ),
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Expectancy ok' : 'Recheck math', scoreDelta: ok ? 100 : 0 }),
          });
        } else {
          const after = round2(s.openR + s.newR);
          const allowed = after <= s.heatLimitR;
          g.setHint('Add the new trade’s risk to the R already open and compare with the portfolio heat limit.');
          g.ask({
            question: `Open positions already risk ${s.openR}R in total and your portfolio heat limit is ${s.heatLimitR}R. Take a new trade risking ${s.newR}R?`,
            options: [
              { label: 'Yes: still within the heat limit', value: 'yes' },
              { label: 'No: it would exceed the heat limit', value: 'no' },
            ],
            answer: allowed ? 'yes' : 'no',
            explain: explainChoice(
              allowed
                ? `${s.openR}R + ${s.newR}R = ${after}R, within the ${s.heatLimitR}R limit: <strong>allowed</strong> at plan size.`
                : `${s.openR}R + ${s.newR}R = ${after}R, above the ${s.heatLimitR}R limit: <strong>skip it</strong>, or wait until open risk comes down (a stop moved to breakeven, a position closed).`,
              allowed
                ? { no: `The limit caps total open risk, and ${after}R does not exceed ${s.heatLimitR}R. Skipping is never a disaster, but the plan allows this one.` }
                : { yes: `The heat limit caps the risk of ALL open positions together. Adding ${s.newR}R takes you to ${after}R, above the ${s.heatLimitR}R limit.` },
            ),
            onAnswer: (ok2) => verdictFlourish(stage, { ok: ok2, title: ok2 ? 'Heat checked' : 'Protect the book', scoreDelta: ok2 ? 100 : 0 }),
          });
        }
      },
    });
    return () => game.destroy();
  },
};
