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
  [0, "Your watchlist is quiet for an hour. A stranger posts a 'sure thing' ticker. What now?", ["Stay with your watchlist and rules", "Copy the trade at normal size", "Buy a little without a stop", "Increase size to make the wait worthwhile"], "<strong>Stay with your plan.</strong> A tip is not a tested setup.", "Can you name the entry, stop, and reason?", 16],
  [0, "You missed the entry on a clean setup. Price has already moved far from your planned stop.", ["Let it go and wait for a new entry", "Chase it at market", "Move the stop to preserve the same share size", "Enter and decide the stop later"], "<strong>Let it go.</strong> The original reward-to-risk no longer applies.", "Is this still the entry your plan defined?", 18],
  [0, "A trade closes at your target. A friend says you sold too early because price kept climbing.", ["Record the planned win and move on", "Jump back in without a setup", "Double the next trade", "Delete the target rule"], "<strong>Record the planned win.</strong> Following a valid exit is a process win.", "Judge the decision with information available at the time.", 12],
  [0, "You have not traded today because no setup meets your checklist.", ["Finish flat and keep the checklist", "Force a small trade for practice", "Trade a random market", "Loosen the checklist for the last hour"], "<strong>Finish flat.</strong> No trade is a valid decision.", "Does your plan require a daily trade?", 14],
  [1, "After a loss, you notice yourself clicking through charts faster than usual.", ["Pause, breathe, and check the next setup against the plan", "Trade quickly to regain confidence", "Increase size on the next chart", "Skip the stop to avoid another loss"], "<strong>Pause.</strong> A short reset helps keep the next decision deliberate.", "What changed: the setup or your pace?", 20],
  [1, "A setup meets most of your checklist but misses the required volume confirmation.", ["Wait for confirmation or skip", "Take it because it looks close", "Double size to offset uncertainty", "Ignore volume only today"], "<strong>Wait or skip.</strong> A missing required condition means the plan is not complete.", "What does the written checklist require?", 18],
  [1, "You are up for the week, so a colleague suggests risking 3% instead of your 1% limit.", ["Keep the written 1% limit", "Risk 3% while ahead", "Use no stop because profits cushion it", "Risk 5% on the best-looking chart"], "<strong>Keep the limit.</strong> A winning week does not change the pre-set risk rule.", "Would you make this sizing change after a loss?", 24],
  [1, "A planned trade loses, but your journal shows the setup and execution were correct.", ["Keep the rules and review a larger sample", "Change the whole strategy immediately", "Take the opposite side next time", "Remove the stop on future trades"], "<strong>Review a larger sample.</strong> One outcome cannot validate or invalidate a strategy.", "Separate process from a single outcome.", 18],
  [1, "A winning position nears its target. You feel tempted to move the target farther without a rule.", ["Follow the exit plan", "Move the target because it feels strong", "Remove the target and stop", "Add more size just before the target"], "<strong>Follow the exit plan.</strong> Change the plan through review, not mid-trade emotion.", "What exit did you write before entry?", 16],
  [1, "Your daily loss is at the stated limit. A perfect-looking setup appears five minutes later.", ["Stop for the day as planned", "Take it at half size", "Trade it in a different account", "Increase size because the setup is strong"], "<strong>Stop for the day.</strong> The loss limit is a rule, not a suggestion.", "Does a new setup erase the daily limit?", 25],
  [2, "Three losses followed one another. You want to change your system during the session.", ["Stop and review the journal after the session", "Change entry and stop rules immediately", "Double size to test the new rule", "Trade a different asset without a plan"], "<strong>Review after the session.</strong> Diagnose the sample when you are calm.", "Is this a tested change or a reaction?", 28],
  [2, "You are holding two correlated positions that together exceed your portfolio risk cap.", ["Reduce total exposure to the cap", "Treat them as unrelated", "Move both stops farther away", "Add a third correlated trade"], "<strong>Reduce exposure.</strong> Correlated positions can concentrate one underlying bet.", "Think about the total risk of the book.", 28],
  [2, "Your strategy has a losing month but your execution stayed consistent. What should the review focus on?", ["Sample size, conditions, and adherence to the rules", "A single missed winner", "How to recover it tomorrow", "Which influencer to copy"], "<strong>Review the evidence.</strong> Separate market conditions and strategy results from execution errors.", "Which measurements can support a change?", 22],
  [2, "Your stop was hit after a sudden gap. You feel an urge to enter the opposite direction at once.", ["Pause and require a fresh setup", "Reverse immediately at double size", "Trade without a stop", "Keep submitting orders until one wins"], "<strong>Require a fresh setup.</strong> A painful exit is not an entry signal in the other direction.", "What setup exists now?", 30],
  [2, "Your rules allow one exception, but you find yourself calling every weak trade that exception.", ["Write a precise exception rule and review past uses", "Keep the exception undefined", "Increase the exception size", "Stop recording exception trades"], "<strong>Make the rule measurable.</strong> Vague exceptions can hide repeated process errors.", "Could another trader apply your exception consistently?", 24],
  [2, "A large winner has you imagining that the next trade cannot lose.", ["Reset to normal risk and evaluate the next setup", "Increase size for the streak", "Remove the next stop", "Trade until the feeling fades"], "<strong>Reset to normal risk.</strong> A win does not change the risk of the next trade.", "Each trade has its own uncertainty.", 20],
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
    let slips = 0;
    const game = new GameShell(root, ctx, {
      rounds: 7,
      howTo: [
        'A trading day unfolds, one decision at a time.',
        'Choose what a disciplined trader would do.',
        'Watch the tilt meter — bad choices heat it up.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 19, direction: 'down', title: 'Tilt Control', score: 100, streak: 1, round: '2/3' }),
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
        tilt = 20;
        slips = 0;
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
            if (!ok) slips += 1;
            meter.setAttribute('aria-valuenow', String(tilt));
            meter.querySelector('.game-meter__fill').style.transform = `scaleX(${tilt / 100})`;
            meter.querySelector('.game-meter__fill').style.background = tilt > 60 ? 'var(--bear)' : 'var(--accent)';
            meter.querySelector('.game-meter__label').textContent = `Tilt ${tilt}%`;
            verdictFlourish(stage, {
              ok,
              title: ok ? 'Composure held' : 'Tilt rising',
              detail: `Tilt now ${tilt}%. ${ok ? 'Process over impulse.' : 'Breathe — reset to the plan.'}`,
              scoreDelta: ok ? 100 : 0,
            });
          },
        });
      },
      onEnd() {
        return h('p', { class: 'callout' }, `Session debrief: ${slips} rule ${slips === 1 ? 'slip' : 'slips'} · final tilt ${tilt}%.`);
      },
    });
    return () => game.destroy();
  },
};
