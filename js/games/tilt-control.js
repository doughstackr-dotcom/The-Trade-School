// Tilt Control — discipline scenarios with a live tilt meter and candle backdrop.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { gameplayPreview, tinySeries, verdictFlourish } from '../core/game-ui.js';

const BANK = [
  [0, "9:45. Your first trade hits its stop: −1R, exactly as planned. What now?", ["Log it and wait for the next valid setup", "Re-enter immediately, bigger", "Switch markets to win it back", "Quit trading for good"], "<strong>Log it and wait.</strong> A planned loss is a cost of doing business.", "Was anything wrong with the trade itself?", 10],
  [0, "A stock you don't follow is up 40% today and everyone is talking about it. Your plan doesn't cover it.", ["Skip it: not in the plan", "Buy now before it's too late", "Buy with the whole account", "Short it because it's up a lot"], "<strong>Skip it.</strong> Fear of missing out is not a setup.", "What does your plan say?", 15],
  [1, "Your trade sits at −0.8R, close to the stop. You feel it is about to turn.", ["Leave the stop where it is", "Move the stop further away", "Remove the stop", "Add to the position"], "<strong>Leave it.</strong> Moving a stop turns a small planned loss into a large unplanned one.", "The stop was set when you were calm.", 20],
  [1, "You are up +3R, above your daily target. A mediocre setup appears.", ["Skip it and protect the day", "Take it at double size", "Take it because you're on fire", "Lower your standards today"], "<strong>Skip it.</strong> Overconfidence after wins is tilt too.", "Would you take this setup on a normal day?", 18],
  [1, "Two planned losses in a row. Your daily limit is 3R and you are at −2R.", ["A+ setups only at normal size, or stop", "Double size to recover", "Trade everything that moves", "Ignore the limit today"], "<strong>Tighten up or stop.</strong> One more loss ends the day by design.", "How much room is left before the limit?", 25],
  [2, "A winner is at +1.8R with the target at 2R. Price stalls. Your plan: trail the stop to breakeven at +1.5R.", ["Follow the plan: stop to breakeven", "Close now out of fear", "Move the target to 5R", "Remove the stop to give it room"], "<strong>Follow the plan.</strong> The rule already protects the trade.", "What did you decide before you entered?", 12],
  [2, "End of day: you made money but broke two rules. How do you grade it?", ["A poor day: process beats outcome", "A great day: money is money", "It doesn't matter", "Stop journaling, it's working"], "<strong>A poor day.</strong> Rule-breaking that pays is the most dangerous kind.", "Would you want to repeat how you traded?", 30],
];
const CORRECT = BANK.map(() => 0);

function pickQuestion(deck, used, difficulty) {
  if (used.size >= deck.length) used.clear();
  const target = Math.round(difficulty * 2);
  const open = deck.filter((i) => !used.has(i));
  const best = open.find((i) => BANK[i][0] === target) ?? open.find((i) => Math.abs(BANK[i][0] - target) === 1) ?? open[0];
  used.add(best);
  return best;
}

export default {
  id: 'tilt-control',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    let tilt = 20;
    const game = new GameShell(root, ctx, {
      rounds: 7,
      howTo: [
        'A trading day unfolds, one decision at a time.',
        'Choose what a disciplined trader would do.',
        'Watch the tilt meter — bad choices heat it up.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 19, direction: 'down', title: 'Tilt Control', score: 290, streak: 1, round: '2/7' }),
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
        tilt = 20;
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        const meter = h('div', { class: 'game-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(tilt), 'aria-label': 'Tilt level' },
          h('span', { class: 'game-meter__track' }, h('span', { class: 'game-meter__fill', style: { transform: `scaleX(${tilt / 100})`, background: tilt > 60 ? 'var(--bear)' : 'var(--accent)' } })),
          h('span', { class: 'game-meter__label mono' }, `Tilt ${tilt}%`),
        );
        const backdrop = miniChart(tinySeries(40 + current, tilt > 50 ? 'down' : 'up', 30), { width: 420, height: 160, yPad: 0.1, showAxis: true, ariaLabel: 'Session backdrop chart' });
        stage.append(
          h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '0.5rem' } }, meter),
          h('div', { class: 'swipe-card__chart', style: { marginBottom: '0.6rem' } }, backdrop),
        );
        g.ask({
          question: q[1],
          options: rng.shuffle(q[2].map((label, i) => ({ label, value: i }))),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
          onAnswer: (ok) => {
            tilt = Math.max(0, Math.min(100, tilt + (ok ? -8 : q[5])));
            verdictFlourish(stage, {
              ok,
              title: ok ? 'Composure held' : 'Tilt rising',
              detail: `Tilt now ${tilt}%. ${ok ? 'Process over impulse.' : 'Breathe — reset to the plan.'}`,
              scoreDelta: ok ? 100 : 0,
            });
          },
        });
      },
    });
    return () => game.destroy();
  },
};
