// Setup Swipe — Take or Skip with a candle thumb on each card.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { gameplayPreview, swipeCard, verdictFlourish } from '../core/game-ui.js';

const BANK = [
  [0, "Uptrend. Price pulls back to rising support and prints a bullish engulfing candle. Stop below the low, target 2.5R.", 1, "<strong>Take.</strong> Trend, level and trigger agree, the stop is defined and the reward is well above the risk.", "Count the reasons: trend, level, trigger, reward-to-risk.", 'up'],
  [0, "No clear trend. Price sits in the middle of a range. No trigger candle.", 0, "<strong>Skip.</strong> Mid-range with no trigger is a coin flip with a spread attached.", "Where is the level? Where is the trigger?", 'down'],
  [1, "Breakout above resistance on the lowest volume of the month. The stop would be three times wider than usual.", 0, "<strong>Skip.</strong> Weak volume and poor risk: this is how fakeouts look.", "Check the volume and the size of the stop.", 'up'],
  [1, "After a downtrend, a hammer at a support zone, confirmed by the next close above its high. Stop under the wick, target 2R.", 1, "<strong>Take.</strong> Context, level, pattern and confirmation are all there, with a clear stop.", "Was the pattern confirmed?", 'up'],
  [1, "A setup you like, but you already hit your daily loss limit.", 0, "<strong>Skip.</strong> The loss limit exists for exactly this moment.", "What does your plan say about today?", 'down'],
  [2, "Strong uptrend. RSI shows bearish divergence, but market structure has not broken. Short?", 0, "<strong>Skip.</strong> Divergence is a warning, not a trigger. Wait for structure to break.", "Has price actually made a lower low yet?", 'up'],
  [2, "Downtrend. A rally reaches the 61.8% retracement, right at old support-turned-resistance. A shooting star closes there. Stop above its high, 3R to the prior low. Short?", 1, "<strong>Take.</strong> Trend, Fibonacci level, role reversal and a trigger line up, with 3R of reward.", "How many independent reasons agree?", 'down'],
  [0, "A downtrend pulls back to resistance. A bearish engulfing candle closes below the prior low. Stop above the swing high; target at the prior low offers 2.3R.", 1, "<strong>Take.</strong> Trend, resistance and a bearish trigger align, with a defined stop and 2.3R available.", "The short has trend, location, trigger and enough reward.", 'down'],
  [0, "Price touches support for the second time, then prints a hammer. The next candle closes above the hammer high. Stop below the wick; target at range resistance offers 2R.", 1, "<strong>Take.</strong> The second support reaction and confirmation provide a trigger; the stop and 2R target are defined.", "A hammer needs context and confirmation.", 'up'],
  [0, "A moving average points upward, so you want to buy immediately. Price is in the middle of a range and there is no entry trigger or stop level.", 0, "<strong>Skip.</strong> A sloping average alone does not define an entry, invalidation point or reward.", "Where exactly would the idea be wrong?", 'up'],
  [0, "Price wicks above a well-tested resistance line but closes back below it. There is no retest. Buy the apparent breakout?", 0, "<strong>Skip.</strong> A wick poke is not a confirmed break; wait for a close and a defensible plan.", "A break should close beyond the level.", 'up'],
  [0, "At range support, buyers defend twice. A bullish engulfing candle closes above the prior candle, and the stop below support leaves 2.2R to range resistance.", 1, "<strong>Take.</strong> Repeated support, a bullish trigger, a defined stop and room to the next level make a complete plan.", "Check the next opposing level before entering.", 'up'],
  [0, "A major data release is due in one minute. Your stop would be inside the normal release spread, and you have no plan for slippage.", 0, "<strong>Skip.</strong> An ordinary stop may slip through a fast release; the risk is not controlled.", "Can the planned stop actually contain the risk?", 'down'],
  [1, "Resistance breaks on twice its recent volume. Price retests the old line from above and closes higher. Stop under the retest; measured target offers 2.4R.", 1, "<strong>Take.</strong> Close, volume and retest support the break, while the stop and 2.4R target define the trade.", "The retest is the trigger, not just the first wick through resistance.", 'up'],
  [1, "After five strong green candles, price is far above support. The nearest logical stop is four times your normal size, and the next resistance offers only 0.8R.", 0, "<strong>Skip.</strong> Chasing leaves a wide stop and less potential reward than risk.", "Compare distance to a sound stop with room to the next level.", 'up'],
  [1, "A downtrend rallies into prior support, now resistance. A bearish rejection candle closes below the zone; stop above it, target at the last low offers 2.1R.", 1, "<strong>Take.</strong> The former support is acting as resistance and the bearish trigger fits the trend; risk is defined.", "Look for a level that changed roles and a confirmed rejection.", 'down'],
  [1, "A double bottom closes through its neckline on above-average volume. The retest holds and a new bullish candle closes higher. Stop below retest; target offers 2R.", 1, "<strong>Take.</strong> The neckline break and held retest provide confirmation, a stop and 2R of room.", "A retest that holds is more useful than a wick through a neckline.", 'up'],
  [1, "Price breaks support, then retests it from below. The retest candle closes back above the level on heavy buying. Sell the breakdown?", 0, "<strong>Skip.</strong> The close back above support undermines the short thesis; wait for a fresh bearish trigger.", "Did the broken level really hold as resistance?", 'down'],
  [1, "Your stop would sit inside a crowded price zone, while the next opposing level is only one stop-distance away. A candle pattern looks attractive.", 0, "<strong>Skip.</strong> A good-looking pattern cannot fix a poor stop and 1R of room.", "Risk and reward matter even when the candle looks right.", 'up'],
  [2, "A flag forms after an uptrend. Price closes above its boundary on expanding volume, then holds a pullback. Stop under the flag; target offers 2.5R.", 1, "<strong>Take.</strong> Trend, consolidation, confirmed break, retest and 2.5R fit a complete continuation plan.", "The break and pullback both need to support the long idea.", 'up'],
  [2, "Four indicators agree on a long, but they all measure the same momentum. The target is 0.7R away and the stop is just beyond the last low.", 0, "<strong>Skip.</strong> Correlated indicators are not independent confirmation, and the target offers less than the risk.", "Count independent evidence and compare target with stop distance.", 'up'],
  [2, "A downtrend seems exhausted. Price makes a higher low, breaks the last lower high, and retests it as support. Stop below that higher low; target offers 2.8R.", 1, "<strong>Take.</strong> Structure has actually shifted, the retest is a trigger, and the stop and 2.8R target are defined.", "A reversal needs a structural break, not just exhaustion.", 'up'],
  [2, "A double top is forming, but the second peak is still rising and price has not closed below the neckline. Short now with a stop inside the pattern?", 0, "<strong>Skip.</strong> The pattern is unconfirmed and the stop is inside normal noise; wait for a neckline break or rejection.", "Has the actual trigger happened yet?", 'down'],
  [2, "Price sweeps above resistance, then closes decisively back below it. A retest from below fails; stop above the sweep high, target at range support offers 2.2R.", 1, "<strong>Take.</strong> The failed breakout and rejected retest form a short trigger with invalidation and 2.2R of room.", "The failed retest confirms the trap more than the wick alone.", 'down'],
];

function riskTicket(rng) {
  const long = rng.chance(0.5);
  const entry = 100 + rng.int(-20, 20);
  const risk = rng.pick([1, 1.25, 1.5, 2]);
  const multiple = rng.chance(0.5) ? rng.pick([2, 2.4, 2.8, 3.2]) : rng.pick([0.8, 1.2, 1.6]);
  const stop = entry + (long ? -risk : risk);
  const target = entry + (long ? risk * multiple : -risk * multiple);
  const direction = long ? 'long' : 'short';
  const take = multiple >= 2;
  return [
    1,
    `A confirmed ${direction} pullback has trend, level and trigger aligned. Entry ${entry.toFixed(2)}, stop ${stop.toFixed(2)}, target ${target.toFixed(2)}. Your plan requires at least 2R. Take or skip?`,
    take ? 1 : 0,
    `<strong>${take ? 'Take' : 'Skip'}.</strong> Risk is ${risk.toFixed(2)} points and reward is ${(risk * multiple).toFixed(2)} points, or ${multiple.toFixed(1)}R. ${take ? 'It meets the 2R plan.' : 'It falls short of the 2R plan.'}`,
    'Reward-to-risk = distance from entry to target ÷ distance from entry to stop.',
    long ? 'up' : 'down',
  ];
}

function pickQuestion(deck, used, difficulty) {
  if (used.size >= deck.length) used.clear();
  const target = Math.round(difficulty * 2);
  const open = deck.filter((i) => !used.has(i));
  const best = open.find((i) => BANK[i][0] === target) ?? open.find((i) => Math.abs(BANK[i][0] - target) === 1) ?? open[0];
  used.add(best);
  return best;
}

export default {
  id: 'setup-swipe',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    let ticket = null;
    const game = new GameShell(root, ctx, {
      rounds: 7,
      timer: { seconds: 14, perRound: true },
      howTo: [
        'A setup brief shows its trend, level, trigger and risk. Some briefs ask you to calculate reward-to-risk.',
        'Take it or skip it before the clock runs out.',
        'Discipline scores: skipping a weak setup is a win.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 55, direction: 'up', title: 'Setup Swipe', score: 180, streak: 2, round: '2/3' }),
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry) {
          current = difficulty > 0.15 && rng.chance(0.28) ? -1 : pickQuestion(deck, used, difficulty);
          ticket = current === -1 ? riskTicket(rng) : null;
        }
        const q = current === -1 ? ticket : BANK[current];
        const brief = h('div', { class: 'row row--sm', style: { padding: '0.65rem', flexWrap: 'wrap' } },
          h('span', { class: 'game-preview__pill' }, 'Trend'),
          h('span', { class: 'game-preview__pill' }, 'Level'),
          h('span', { class: 'game-preview__pill' }, 'Trigger'),
          h('span', { class: 'game-preview__pill' }, 'Risk'));
        let answered = false;
        const finish = (take) => {
          if (answered) return;
          answered = true;
          const ok = (take ? 1 : 0) === q[2];
          if (ok) g.correct(q[3]);
          else g.wrong(q[3]);
          verdictFlourish(stage, { ok, title: ok ? (take ? 'Taken' : 'Skipped') : 'Misread', detail: q[3].replace(/<[^>]+>/g, ' ').slice(0, 140), scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };
        stage.append(swipeCard({
          chartNode: brief,
          title: current === -1 ? 'Risk ticket' : 'Setup card',
          body: q[1],
          takeLabel: 'Take',
          skipLabel: 'Skip',
          takeClass: 'btn--bull',
          skipClass: 'btn--ghost',
          onTake: () => finish(true),
          onSkip: () => finish(false),
        }));
        g.setHint(q[4]);
      },
    });
    return () => game.destroy();
  },
};
