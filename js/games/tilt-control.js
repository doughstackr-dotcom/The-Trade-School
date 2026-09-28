// Tilt Control — discipline scenarios with a live tilt meter and candle backdrop.
import { GameShell, QuestionBank, bankOptions, explainChoice, trackAnswer } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { gameplayPreview, tinySeries, verdictFlourish } from '../core/game-ui.js';

// { id, level 0–2, q, a (the disciplined choice), wrong: { option: why it is tilt }, explain,
//   hint, heat (tilt added by a wrong answer) }
export const QUESTIONS = [
  {
    id: 'tc-planned-loss', level: 0, heat: 10,
    q: '9:45. Your first trade hits its stop: −1R, exactly as planned. What now?',
    a: 'Log it and wait for the next valid setup',
    wrong: {
      'Re-enter immediately, bigger': 'That is revenge trading: bigger size to “win it back” turns one planned loss into an unplanned one.',
      'Switch markets to win it back': 'Chasing a new market you have not prepared for, to erase a loss, is the loss talking.',
      'Quit trading for good': 'One planned loss is the system working. A −1R you accepted in advance is not a reason to quit.',
    },
    explain: '<strong>Log it and wait.</strong> A planned loss is a cost of doing business.',
    hint: 'Was anything wrong with the trade itself?',
  },
  {
    id: 'tc-fomo-mover', level: 0, heat: 15,
    q: 'A stock you don’t follow is up 40% today and everyone is talking about it. Your plan doesn’t cover it.',
    a: 'Skip it: it is not in the plan',
    wrong: {
      'Buy now before it’s too late': 'That is fear of missing out. There is no level, no stop and no edge you have tested, only a crowd.',
      'Buy with the whole account': 'FOMO plus oversizing: one bad reversal could do serious damage to the account.',
      'Short it because it’s up a lot': '“Too high” is not a setup. Shorting a strong move with no plan is as impulsive as chasing it.',
    },
    explain: '<strong>Skip it.</strong> Fear of missing out is not a setup.',
    hint: 'What does your plan say?',
  },
  {
    id: 'tc-hot-tip', level: 0, heat: 12,
    q: 'A stranger in a chat room posts a “guaranteed 10× move” and urges everyone to buy now.',
    a: 'Ignore it: “guaranteed” is a red flag',
    wrong: {
      'Buy a small amount just in case': 'Small or not, it is still a trade with no plan, driven by a stranger’s urgency. That urgency is how pump-and-dump schemes work.',
      'Buy big: 10× is worth the risk': 'Nothing in markets is guaranteed. Oversizing on an anonymous tip is gambling.',
      'Ask for more tips from the same person': 'Doubling down on an unverified source makes the problem worse.',
    },
    explain: '<strong>Ignore it.</strong> Real edges are never guaranteed, and pressure to act “now” is a classic sign of a pump.',
    hint: 'Who benefits if you buy?',
  },
  {
    id: 'tc-journal-loss', level: 0, heat: 10,
    q: 'After a losing week you are tempted to skip your journal: it is depressing to read.',
    a: 'Journal it anyway: losing weeks carry the most lessons',
    wrong: {
      'Skip it this week and start fresh': 'Skipping the review is how the same mistake repeats. The data you avoid is the data you need.',
      'Delete the losing trades from the log': 'A log without the losses cannot tell you what is actually working.',
      'Only journal the winners from now on': 'A winners-only log flatters you and hides the leaks.',
    },
    explain: '<strong>Journal it.</strong> Was it bad trades or normal variance? Only the log can tell you.',
    hint: 'How will you know what went wrong?',
  },
  {
    id: 'tc-social-comparison', level: 0, heat: 12,
    q: 'A friend posts a screenshot of a huge win. You suddenly feel behind.',
    a: 'Stick to your plan and your own position size',
    wrong: {
      'Copy their trade right away': 'You would be entering late, with their idea and none of their plan, stop or size.',
      'Double your size to catch up': 'Sizing up out of envy is tilt. Your risk per trade should not depend on someone else’s screenshot.',
      'Loosen your rules for a week': 'Rules exist for exactly these moments, when emotion wants to take over.',
    },
    explain: '<strong>Stay in your lane.</strong> A single screenshot shows one win, not the losses, the risk taken or the account size.',
    hint: 'Does their win change your edge?',
  },
  {
    id: 'tc-move-stop', level: 1, heat: 20,
    q: 'Your trade sits at −0.8R, close to the stop. You feel it is about to turn.',
    a: 'Leave the stop where it is',
    wrong: {
      'Move the stop further away': 'That turns a small planned loss into a larger unplanned one. The stop was set when you were calm.',
      'Remove the stop': 'Without a stop the loss has no limit. “About to turn” is a hope, not a plan.',
      'Add to the position': 'Adding to a loser increases the risk on a trade that is already not working.',
    },
    explain: '<strong>Leave it.</strong> Moving a stop turns a small planned loss into a large unplanned one.',
    hint: 'The stop was set when you were calm.',
  },
  {
    id: 'tc-after-target', level: 1, heat: 18,
    q: 'You are up +3R, above your daily target. A mediocre setup appears.',
    a: 'Skip it and protect the day',
    wrong: {
      'Take it at double size': 'Sizing up because you are ahead is overconfidence: you would risk the day’s gains on a mediocre setup.',
      'Take it because you’re on fire': 'Feeling hot does not change the setup. Mediocre is still mediocre.',
      'Lower your standards today': 'Your standards are what produced the +3R. Dropping them now is tilt in a good mood.',
    },
    explain: '<strong>Skip it.</strong> Overconfidence after wins is tilt too.',
    hint: 'Would you take this setup on a normal day?',
  },
  {
    id: 'tc-near-limit', level: 1, heat: 25,
    q: 'Two planned losses in a row. Your daily loss limit is 3R and you are at −2R.',
    a: 'A+ setups only at normal size, or stop for the day',
    wrong: {
      'Double size to recover': 'At double size one more loss takes you to −4R, past the limit. That is exactly what the limit is there to prevent.',
      'Trade everything that moves': 'Overtrading after losses lowers the quality of each trade just when you can least afford it.',
      'Ignore the limit today': 'A limit that is ignored on bad days is not a limit.',
    },
    explain: '<strong>Tighten up or stop.</strong> One more loss ends the day by design.',
    hint: 'How much room is left before the limit?',
  },
  {
    id: 'tc-revenge', level: 1, heat: 22,
    q: 'A trade stops out and you are angry the market “took” your money. The next setup is marginal.',
    a: 'Take a short break; only A-grade setups at normal size',
    wrong: {
      'Take it at double size to make it back': 'That is revenge trading: bigger size on a weaker setup, driven by anger.',
      'Take every setup until you are green': 'Needing to be green today pushes you into trades you would normally skip.',
      'Move your stops wider so it can’t happen again': 'Wider stops without smaller size mean bigger losses. The stop did its job.',
    },
    explain: '<strong>Break, then only the best setups.</strong> Anger is a signal to step back, not to press.',
    hint: 'Is this setup good, or do you just want your money back?',
  },
  {
    id: 'tc-missed-entry', level: 1, heat: 15,
    q: 'Your setup triggered while you were away. Price is now 3R past your planned entry.',
    a: 'Let it go; wait for a new setup or a planned pullback entry',
    wrong: {
      'Chase it at market': 'Entering now means the same stop is 3R further away, or a new stop with no logic. The reward-to-risk you planned is gone.',
      'Enter with no stop': 'Chasing without a stop has unlimited downside.',
      'Short it because it has gone “too far”': 'Fading a move just because you missed it is FOMO in reverse.',
    },
    explain: '<strong>Let it go.</strong> There is always another trade; there is not always another account.',
    hint: 'What happened to your reward-to-risk?',
  },
  {
    id: 'tc-average-down', level: 1, heat: 22,
    q: 'Your long is at −0.7R. You want to buy more to lower your average price, but the plan says nothing about adding.',
    a: 'Don’t add: stick to the planned risk',
    wrong: {
      'Add, it’s cheaper now': 'Adding to a losing trade increases your size exactly when the market is proving you wrong.',
      'Add and move the stop lower': 'Now you have more size AND a bigger stop: the loss could be several times what you planned.',
      'Add with the rest of the account': 'That puts the whole account on one trade that is currently losing.',
    },
    explain: '<strong>Don’t add.</strong> Averaging down multiplies the risk of a losing idea.',
    hint: 'Is the trade proving you right or wrong?',
  },
  {
    id: 'tc-winning-streak', level: 1, heat: 16,
    q: 'Five winners in a row. You feel unbeatable.',
    a: 'Keep the same size and the same rules',
    wrong: {
      'Triple your size': 'Tripling size right after a hot streak exposes you to the normal losing streak that will come.',
      'Skip stops, you are reading it perfectly': 'Five wins say little about the next trade. No stop means no limit on the next loss.',
      'Loosen your setup criteria': 'Your criteria produced the streak. Loosening them trades your edge for excitement.',
    },
    explain: '<strong>Same size, same rules.</strong> Streaks are normal variance, in both directions.',
    hint: 'Does a streak change your edge?',
  },
  {
    id: 'tc-tired', level: 1, heat: 14,
    q: 'You slept four hours, feel foggy and the market is about to open.',
    a: 'Sit out today or trade clearly smaller',
    wrong: {
      'Trade normally, it’ll be fine': 'Fatigue slows decisions and weakens discipline. Pretending it doesn’t is how rules get broken.',
      'Trade more to make the day worthwhile': 'More trades with less focus means more mistakes.',
      'Use a bigger size to make it quick': 'Bigger size magnifies the mistakes a tired trader is more likely to make.',
    },
    explain: '<strong>Protect yourself.</strong> Your state is part of your edge; a missed day costs nothing.',
    hint: 'Are you at your best?',
  },
  {
    id: 'tc-trail-plan', level: 2, heat: 12,
    q: 'A winner is at +1.8R with the target at 2R. Price stalls. Your plan: trail the stop to breakeven at +1.5R.',
    a: 'Follow the plan: stop to breakeven',
    wrong: {
      'Close now out of fear': 'The plan already protects the trade. Exiting on a stall cuts winners short, which hurts expectancy over time.',
      'Move the target to 5R': 'Moving the target on hope changes the trade you planned. Greed is tilt too.',
      'Remove the stop to give it room': 'That gives back the protection the plan just earned you.',
    },
    explain: '<strong>Follow the plan.</strong> The rule already protects the trade.',
    hint: 'What did you decide before you entered?',
  },
  {
    id: 'tc-early-breakeven', level: 2, heat: 14,
    q: 'Your plan moves the stop to breakeven at +1R. At +0.4R you get nervous and want to move it now.',
    a: 'Leave the stop until +1R, as planned',
    wrong: {
      'Move it to breakeven now': 'A stop that tight usually gets hit by normal noise, turning would-be winners into scratches. That is a plan change made from fear.',
      'Close the trade now': 'Nothing has gone wrong; the trade is in profit. Fear is not an exit signal.',
      'Remove the stop and just watch it': 'Removing protection because you are nervous makes no sense: it adds risk.',
    },
    explain: '<strong>Leave it.</strong> Breakeven stops belong where the plan puts them, not where your nerves do.',
    hint: 'Why is the breakeven rule at +1R and not earlier?',
  },
  {
    id: 'tc-limit-hit-perfect', level: 2, heat: 25,
    q: 'You hit your daily loss limit at 11:00. At 13:00 a perfect setup appears.',
    a: 'Stay out: the limit is the limit',
    wrong: {
      'Take it, it’s perfect': 'Every setup looks perfect when you want your money back. The limit exists for exactly this moment.',
      'Take it at half size': 'Half size is still trading past the limit. The rule is about stopping, not shrinking.',
      'Take it and reset the limit tomorrow': 'A limit you can argue your way around protects nothing.',
    },
    explain: '<strong>Stay out.</strong> Markets will be there tomorrow; the rule only works if it is absolute.',
    hint: 'What is the loss limit for?',
  },
  {
    id: 'tc-small-sample', level: 2, heat: 20,
    q: 'Ten trades into a system that tested positive over hundreds of trades, you are at −2R.',
    a: 'Keep executing and review: ten trades is a small sample',
    wrong: {
      'Abandon it for a new system': 'Ten trades are far too few to judge an edge. Switching now resets you to zero data.',
      'Double size to recover faster': 'Doubling size during a drawdown increases risk exactly when you are least sure of yourself.',
      'Stop using stops until it recovers': 'Removing stops risks a large loss that no normal losing streak would cause.',
    },
    explain: '<strong>Stay the course, keep reviewing.</strong> Drawdowns are part of any edge; check you followed the rules, not just the P&L.',
    hint: 'How many trades does it take to judge an edge?',
  },
  {
    id: 'tc-grade-the-day', level: 2, heat: 30,
    q: 'End of day: you made money but broke two rules. How do you grade it?',
    a: 'A poor day: process beats outcome',
    wrong: {
      'A great day: money is money': 'Rewarding rule-breaking that happened to pay teaches you to repeat it, until it doesn’t pay.',
      'It doesn’t matter': 'It matters a lot: it is how bad habits sneak in.',
      'Stop journaling, it’s working': 'The journal is what catches the rule breaks before they cost you.',
    },
    explain: '<strong>A poor day.</strong> Rule-breaking that pays is the most dangerous kind.',
    hint: 'Would you want to repeat how you traded?',
  },
];

export default {
  id: 'tilt-control',
  mount(root, ctx) {
    const bank = new QuestionBank(QUESTIONS, { id: 'tilt-control' });
    let current = null;
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
        bank.reset(rng, g.store);
        tilt = 20;
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry || !current) current = bank.next(difficulty);
        const q = current;
        const meter = h('div', { class: 'game-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(tilt), 'aria-label': 'Tilt level' },
          h('span', { class: 'game-meter__track' }, h('span', { class: 'game-meter__fill', style: { transform: `scaleX(${tilt / 100})`, background: tilt > 60 ? 'var(--bear)' : 'var(--accent)' } })),
          h('span', { class: 'game-meter__label mono' }, `Tilt ${tilt}%`),
        );
        const backdrop = miniChart(tinySeries(40 + QUESTIONS.indexOf(q), tilt > 50 ? 'down' : 'up', 30), { width: 420, height: 160, yPad: 0.1, showAxis: true, ariaLabel: 'Session backdrop chart' });
        stage.append(
          h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '0.5rem' } }, meter),
          h('div', { class: 'swipe-card__chart', style: { marginBottom: '0.6rem' } }, backdrop),
        );
        g.ask({
          question: q.q,
          options: bankOptions(q, rng),
          answer: q.a,
          explain: explainChoice(q.explain, q.wrong),
          hint: q.hint,
          onAnswer: (ok) => {
            trackAnswer(g.store, 'tilt-control', q.id, ok);
            tilt = Math.max(0, Math.min(100, tilt + (ok ? -8 : q.heat)));
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
