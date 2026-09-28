// Shared Setup Playbook data — setups, difficulty meta, and guide sections.
// Pure module (no DOM) so pages and tests can import it without pulling UI.

export const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', blurb: 'High-clarity candle reversals at levels — clean single-idea scalps.' },
  { id: 'medium', label: 'Medium', blurb: 'Weaker candles that need confirmation, plus straightforward chart continuations.' },
  { id: 'hard', label: 'Hard', blurb: 'Trap / fade trades and multi-leg or confluence setups.' },
];

// id = scanner setup kind where one exists (§12.4), so real examples can be looked up by id.
// Candle pattern ids must exist in CANDLE_PATTERNS / candleScenario.
export const SETUPS = [
  // —— Easy: simple, high-clarity candle reversals at levels ——
  {
    id: 'hammer', name: 'Hammer at support', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'hammer', fib: true,
    summary: 'After a decline, a candle with a long lower wick closes near its high at a support zone — classic long scalp trigger.',
    rules: [
      'A clear decline into the candle',
      'Lower wick at least 2× the body, little or no upper wick',
      'At or near a support zone or Fib golden pocket',
      'Next candle closes above the hammer high',
    ],
    entry: 'Buy on the close of the confirmation candle (or a tick above the hammer high).',
    stop: 'Just below the hammer’s low — tight for scalps.',
    target: '1.5–2R or the next micro resistance.',
  },
  {
    id: 'shooting-star', name: 'Shooting star scalp', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'shooting-star', fib: true,
    summary: 'After a short-term rally, a small body with a long upper wick rejects the high — fade with a stop above the wick.',
    rules: [
      'Prior up-push into resistance or Fib of the last decline',
      'Upper wick ≥ 2× body, little lower wick',
      'Next candle closes below the star’s body (ideally below its low)',
      'Skip if higher-timeframe trend is violently bullish',
    ],
    entry: 'Sell the confirmation close below the star.',
    stop: 'A few ticks above the upper wick.',
    target: '1.5–2R or next micro support.',
  },
  {
    id: 'bullish-engulfing', name: 'Bullish engulfing', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'bullish-engulfing', fib: true,
    summary: 'A bullish body completely engulfs the previous bearish body after a pullback — strong scalp long when it prints at a level.',
    rules: [
      'A downtrend or a pullback in an uptrend',
      'The green body engulfs the prior red body',
      'Forms at a level (support, MA, Fib 50–61.8%, trend line)',
      'Above-average volume on the engulfing candle',
    ],
    entry: 'Buy above the engulfing candle’s high (or on its close for aggressive scalps).',
    stop: 'Below the engulfing candle’s low.',
    target: '1.5–2R or the prior swing high.',
  },
  {
    id: 'bearish-engulfing', name: 'Bearish engulfing', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'bearish-engulfing', fib: true,
    summary: 'A bearish body engulfs the prior bullish body after a rally — short scalp with stop above the pattern high.',
    rules: [
      'Uptrend or bounce into resistance',
      'Red body fully engulfs the prior green body',
      'At resistance / Fib / session high',
      'Prefer expanding volume on the engulfing bar',
    ],
    entry: 'Sell below the engulfing low (or on the close).',
    stop: 'Above the engulfing high.',
    target: '1.5–2R or prior micro swing low.',
  },
  {
    id: 'dragonfly-doji', name: 'Dragonfly doji scalp', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'dragonfly-doji', fib: true,
    summary: 'Long lower wick, open/high/close near the top after a dip — buyers absorbed the sell. Scalp the reclaim.',
    rules: [
      'Short-term decline or flush into support / Fib 50–61.8%',
      'Open, high and close clustered at the top of a long lower wick',
      'Next candle closes above the dragonfly high',
      'Volume on the reclaim is not thinner than the flush',
    ],
    entry: 'Buy the close above the dragonfly high (or a 1-tick break).',
    stop: 'Just below the long wick low.',
    target: '1.5–2R or prior micro swing high.',
  },
  {
    id: 'gravestone-doji', name: 'Gravestone doji scalp', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'gravestone-doji', fib: true,
    summary: 'Long upper wick with open/low/close at the bottom after a pop — sellers rejected the high. Scalp the failure.',
    rules: [
      'Short-term rally into resistance / Fib retracement of the last drop',
      'Open, low and close clustered at the bottom of a long upper wick',
      'Next candle closes below the gravestone low',
      'Avoid if a strong trend day is still expanding higher',
    ],
    entry: 'Sell the close below the gravestone low.',
    stop: 'Just above the upper wick high.',
    target: '1.5–2R or prior micro swing low.',
  },
  {
    id: 'piercing-line', name: 'Piercing line reclaim', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'piercing-line', fib: true,
    summary: 'After a selloff, a green candle opens below the prior low and closes deep into the prior red body — buyers reclaiming control at a level.',
    rules: [
      'Clear short-term decline into support or a Fib pocket',
      'Second candle opens below (or near) the first candle’s low',
      'Closes above the midpoint of the prior red body',
      'Prefer a level touch; skip mid-range piercings',
    ],
    entry: 'Buy the close of the piercing candle (or a tick above its high).',
    stop: 'Just below the piercing candle’s low.',
    target: '1.5–2R or the prior swing high.',
  },
  {
    id: 'dark-cloud-cover', name: 'Dark cloud cover', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'dark-cloud-cover', fib: true,
    summary: 'After a rally, a red candle opens above the prior high and closes deep into the prior green body — sellers slamming the door at resistance.',
    rules: [
      'Short-term rally into resistance / session high / Fib',
      'Second candle gaps or opens above the prior high',
      'Closes below the midpoint of the prior green body',
      'Skip if the higher timeframe is in a violent squeeze higher',
    ],
    entry: 'Sell the close of the dark-cloud candle (or a tick below its low).',
    stop: 'Just above the pattern high.',
    target: '1.5–2R or the prior micro swing low.',
  },
  {
    id: 'tweezer-bottom', name: 'Tweezer bottom', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'tweezer-bottom', fib: true,
    summary: 'Two consecutive candles share nearly the same low at support — a double tap that often marks a short-term floor.',
    rules: [
      'Decline into a clear support or Fib zone',
      'Two consecutive lows within a tight tolerance',
      'Second candle closes stronger (ideally green)',
      'Next candle closes above the pattern high',
    ],
    entry: 'Buy the confirmation close above the tweezer high.',
    stop: 'A few ticks below the shared low.',
    target: '1.5–2R or next micro resistance.',
  },

  // —— Medium: weaker / confirmation-needed candles + straightforward chart continuation ——
  {
    id: 'doji', name: 'Doji pause (scalp)', tier: 'beginner', difficulty: 'medium', bias: 'neutral', kind: 'candle',
    pattern: 'doji', fib: true,
    summary: 'On a short timeframe, a doji at a micro level flags indecision — trade only the break of its range with a tight stop.',
    rules: [
      'Clear prior push into a level (VWAP, prior high/low, or session open)',
      'Doji body ≤ ~8% of its range',
      'Wait for the next candle to close beyond the doji high (long) or low (short)',
      'Skip if the doji is mid-range with no level',
    ],
    entry: 'Buy/sell the confirmation close beyond the doji extreme.',
    stop: 'A few ticks beyond the opposite wick — scalp-tight.',
    target: '1–1.5R or the next micro swing; take profit quick.',
  },
  {
    id: 'inverted-hammer', name: 'Inverted hammer scalp', tier: 'beginner', difficulty: 'medium', bias: 'bullish', kind: 'candle',
    pattern: 'inverted-hammer',
    summary: 'After a dip, a long upper wick with a small body near the low shows buyers probing — weaker than a hammer; demand confirmation.',
    rules: [
      'Short-term decline into a level',
      'Long upper wick, small body near the low',
      'Next candle closes above the inverted hammer high',
      'Prefer confluence with support or VWAP',
    ],
    entry: 'Buy only after a close above the pattern high.',
    stop: 'Below the pattern low.',
    target: '1–2R; take profit at the first micro resistance.',
  },
  {
    id: 'bullish-harami', name: 'Bullish harami scalp', tier: 'beginner', difficulty: 'medium', bias: 'bullish', kind: 'candle',
    pattern: 'bullish-harami',
    summary: 'A small green body inside a large red body after a selloff — momentum stall. Scalp only with a break of the mother candle.',
    rules: [
      'Clear short-term decline',
      'Small green body inside the prior long red body',
      'Wait for a close above the mother candle’s open',
      'Stop stays below the pattern low',
    ],
    entry: 'Buy the close above the first candle’s open.',
    stop: 'Below the pattern low (tight).',
    target: '1–2R; harami is weaker — bank quick.',
  },
  {
    id: 'bearish-harami', name: 'Bearish harami scalp', tier: 'beginner', difficulty: 'medium', bias: 'bearish', kind: 'candle',
    pattern: 'bearish-harami',
    summary: 'A small red body inside a large green body after a rally — stall warning. Short the break of the mother candle.',
    rules: [
      'Clear short-term rally',
      'Small red body inside the prior long green body',
      'Wait for a close below the mother candle’s open',
      'Stop above the pattern high',
    ],
    entry: 'Sell the close below the first candle’s open.',
    stop: 'Above the pattern high.',
    target: '1–2R; take profit at the first micro support.',
  },
  {
    id: 'bull-flag', name: 'Bull flag', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'bull-flag',
    summary: 'A sharp rally (the pole) followed by a tight, gently falling consolidation on shrinking volume.',
    rules: ['A strong pole on heavy volume', 'A shallow, orderly pullback', 'Volume dries up in the flag', 'Close above the flag’s upper line'],
    entry: 'Buy the close above the flag.', stop: 'Below the flag’s low.', target: 'The pole’s height projected from the breakout.',
  },
  {
    id: 'double-bottom', name: 'Double bottom', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'double-bottom',
    summary: 'Two lows at about the same price, then a close above the peak between them (the neckline).',
    rules: ['A prior downtrend', 'Two lows within about 1–2%', 'Second low on lighter volume', 'Close above the neckline'],
    entry: 'Buy the neckline break or its retest.', stop: 'Below the second low.', target: 'The pattern height projected from the neckline.',
  },
  {
    id: 'breakout-up', name: 'Breakout and retest', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'ascending-triangle',
    summary: 'Price closes above a well-tested resistance on strong volume, then retests it as support.',
    rules: ['Resistance tested at least twice', 'Decisive close above it', 'Breakout volume well above average', 'Pullback holds the old resistance'],
    entry: 'Buy the retest once it holds (or the breakout close for an aggressive entry).', stop: 'Below the retest low.', target: 'The measured move: the pattern height projected from the breakout.',
  },
  {
    id: 'morning-star', name: 'Morning star reversal', tier: 'beginner', difficulty: 'medium', bias: 'bullish', kind: 'candle',
    pattern: 'morning-star', fib: true,
    summary: 'Three-candle bottom: long red, small indecision, then a strong green that closes well into the first body — classic reclaim after a flush.',
    rules: [
      'Clear decline into support or a Fib pocket',
      'Middle candle is a small body / doji (gap preferred)',
      'Third candle closes above the midpoint of the first red body',
      'Volume expands on the third candle',
    ],
    entry: 'Buy the close of the third candle (or a tick above its high).',
    stop: 'Below the low of the three-candle pattern.',
    target: '2R or the prior swing high; trail if momentum continues.',
  },
  {
    id: 'evening-star', name: 'Evening star top', tier: 'beginner', difficulty: 'medium', bias: 'bearish', kind: 'candle',
    pattern: 'evening-star', fib: true,
    summary: 'Three-candle top: long green, small indecision, then a strong red closing deep into the first body — momentum rolling over at resistance.',
    rules: [
      'Rally into resistance / Fib / session high',
      'Middle candle is a small body / doji',
      'Third candle closes below the midpoint of the first green body',
      'Prefer expanding volume on the third candle',
    ],
    entry: 'Sell the close of the third candle (or a tick below its low).',
    stop: 'Above the high of the three-candle pattern.',
    target: '2R or the prior swing low.',
  },
  {
    id: 'bear-flag', name: 'Bear flag', tier: 'advanced', difficulty: 'medium', bias: 'bearish', kind: 'chart',
    pattern: 'bear-flag',
    summary: 'A sharp selloff (the pole) followed by a tight, gently rising consolidation — continuation short when the flag breaks lower.',
    rules: [
      'A strong downside pole on heavy volume',
      'Shallow, orderly bounce on shrinking volume',
      'Flag stays well below the pole high',
      'Close below the flag’s lower line',
    ],
    entry: 'Sell the close below the flag.',
    stop: 'Above the flag’s high.',
    target: 'The pole’s height projected down from the breakdown.',
  },
  {
    id: 'double-top', name: 'Double top short', tier: 'advanced', difficulty: 'medium', bias: 'bearish', kind: 'chart',
    pattern: 'double-top',
    summary: 'Two failed tests of the same high, then a close below the trough between them — classic distribution short.',
    rules: [
      'Prior uptrend into the pattern',
      'Two highs within about 1–2%',
      'Second high on lighter volume',
      'Close below the neckline (the trough between highs)',
    ],
    entry: 'Sell the neckline break or its retest from below.',
    stop: 'Above the second high.',
    target: 'Pattern height projected down from the neckline.',
  },
  {
    id: 'falling-wedge', name: 'Falling wedge breakout', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'falling-wedge',
    summary: 'Lower highs and lower lows that converge — selling pressure is fading. Long the break of the upper wedge line.',
    rules: [
      'Both trend lines slope down and converge',
      'Volume contracts into the apex',
      'Decisive close above the upper wedge line',
      'Prefer confluence with support / Fib of the prior decline',
    ],
    entry: 'Buy the close above the upper wedge line (or the retest).',
    stop: 'Below the most recent swing low inside the wedge.',
    target: 'The start of the wedge or the measured height of the pattern.',
  },

  // —— Hard: trap / fade and multi-leg / confluence ——
  {
    id: 'fakeout-up', name: 'Failed breakout (fade)', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'chart',
    pattern: 'ascending-triangle', outcome: 'fail',
    summary: 'Price pokes above resistance on thin volume and closes back inside: the breakout buyers are trapped.',
    rules: ['An obvious level with stops above it', 'The break comes on weak volume', 'A close back inside the range', 'No follow-through on the next candle'],
    entry: 'Sell the close back inside the range.', stop: 'Above the fakeout high.', target: 'The other side of the range.',
  },
  {
    id: 'head-and-shoulders', name: 'Head and shoulders', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'chart',
    pattern: 'head-and-shoulders',
    summary: 'Three-push top: left shoulder, higher head, lower right shoulder — short the neckline break when volume confirms the fail.',
    rules: [
      'Prior uptrend into the pattern',
      'Head clearly higher than both shoulders',
      'Right shoulder fails to reclaim the head high',
      'Close below the neckline with expanding volume',
    ],
    entry: 'Sell the neckline break or its retest from below.',
    stop: 'Above the right shoulder high (or the head for wider risk).',
    target: 'Pattern height (head to neckline) projected down from the break.',
  },
  {
    id: 'rising-wedge', name: 'Rising wedge fade', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'chart',
    pattern: 'rising-wedge',
    summary: 'Higher highs and higher lows that converge — momentum is fading. Fade the breakdown when support of the wedge gives way.',
    rules: [
      'Both trend lines slope up and converge',
      'Volume contracts into the apex',
      'A decisive close below the lower wedge line',
      'Prefer confluence with resistance / Fib of the prior swing',
    ],
    entry: 'Sell the close below the lower wedge line (or the retest).',
    stop: 'Above the most recent swing high inside the wedge.',
    target: 'The start of the wedge or the measured height of the pattern.',
  },
  {
    id: 'inverse-head-shoulders', name: 'Inverse head & shoulders', tier: 'advanced', difficulty: 'hard', bias: 'bullish', kind: 'chart',
    pattern: 'inverse-head-and-shoulders',
    summary: 'Three-push bottom: left shoulder, lower head, higher right shoulder — long the neckline break when buyers reclaim structure.',
    rules: [
      'Prior downtrend into the pattern',
      'Head clearly lower than both shoulders',
      'Right shoulder holds above the head low',
      'Close above the neckline with expanding volume',
    ],
    entry: 'Buy the neckline break or its retest from above.',
    stop: 'Below the right shoulder low (or the head for wider risk).',
    target: 'Pattern height (head to neckline) projected up from the break.',
  },
  {
    id: 'cup-and-handle', name: 'Cup and handle', tier: 'advanced', difficulty: 'hard', bias: 'bullish', kind: 'chart',
    pattern: 'cup-and-handle',
    summary: 'Rounded base (the cup) then a shallow pullback (the handle) under resistance — breakout long when the handle resolves higher.',
    rules: [
      'Cup is rounded, not a V — time matters',
      'Handle is shallow (ideally ≤ 1/3 of the cup depth)',
      'Volume dries in the handle, expands on the break',
      'Close above the rim / handle high',
    ],
    entry: 'Buy the close above the handle high (or the retest of the rim).',
    stop: 'Below the handle low.',
    target: 'Cup depth projected from the breakout.',
  },
  {
    id: 'three-black-crows', name: 'Three black crows', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'candle',
    pattern: 'three-black-crows',
    summary: 'Three strong consecutive red candles, each closing near its low — distribution after a rally. Harder because you enter late; size down.',
    rules: [
      'Prior rally or extended uptrend into the pattern',
      'Three consecutive long red bodies with small lower wicks',
      'Each open inside (or near) the prior body',
      'Prefer confluence with a broken support or MA',
    ],
    entry: 'Sell a close below the third crow’s low (or on a weak bounce into the open of crow 3).',
    stop: 'Above the high of the three-candle cluster.',
    target: '2R or the next major support; trail if momentum persists.',
  },
  {
    id: 'symmetrical-triangle', name: 'Symmetrical triangle', tier: 'advanced', difficulty: 'hard', bias: 'neutral', kind: 'chart',
    pattern: 'symmetrical-triangle',
    summary: 'Converging highs and lows with no clear slope bias — trade only the decisive break, and be ready to flip if it fails.',
    rules: [
      'At least two touches on each boundary',
      'Volume contracts into the apex',
      'Decisive close beyond a boundary with expanding volume',
      'Have a flip plan if price closes back inside',
    ],
    entry: 'Buy/sell the close beyond the broken line (or the first retest that holds).',
    stop: 'Back inside the triangle, beyond the opposite boundary’s most recent touch.',
    target: 'The height of the triangle at its widest, projected from the break.',
  },
  {
    id: 'hanging-man', name: 'Hanging man fade', tier: 'beginner', difficulty: 'hard', bias: 'bearish', kind: 'candle',
    pattern: 'hanging-man', fib: true,
    summary: 'Hammer shape after an advance — selling showed up inside the candle. Context-sensitive: only fade with confirmation and a clear level above.',
    rules: [
      'Clear short-term rally into resistance / Fib',
      'Long lower wick, small body near the high (hammer shape)',
      'Next candle closes below the hanging-man low',
      'Skip if the broader trend is still expanding higher on volume',
    ],
    entry: 'Sell the confirmation close below the pattern low.',
    stop: 'Just above the pattern high.',
    target: '1.5–2R or prior micro swing low.',
  },
  {
    id: 'fakeout-down', name: 'Failed breakdown (fade)', tier: 'advanced', difficulty: 'hard', bias: 'bullish', kind: 'chart',
    pattern: 'descending-triangle', outcome: 'fail',
    summary: 'Price pokes below support on thin volume and closes back inside — shorts are trapped. Fade the reclaim.',
    rules: [
      'An obvious support with stops below it',
      'The break comes on weak volume',
      'A close back above the broken level',
      'No follow-through on the next candle lower',
    ],
    entry: 'Buy the close back inside the range.',
    stop: 'Below the fakeout low.',
    target: 'The other side of the range (or prior swing high).',
  },
];

/** Risk management rules — educational, not financial advice. */
export const RISK_RULES = [
  {
    id: 'risk-per-trade',
    title: 'Risk a fixed fraction per trade',
    body: 'Decide the maximum you are willing to lose on one idea before you enter (many learners practice with 0.25–1% of account risk). Size the position from the stop distance — never from how “sure” the setup feels.',
  },
  {
    id: 'predefine-r',
    title: 'Define R before you click',
    body: 'R is the dollar distance from entry to stop. Write entry, stop and at least one target in R terms first. If you cannot state all three, you do not have a trade yet.',
  },
  {
    id: 'asymmetric-payoff',
    title: 'Prefer asymmetric payoff',
    body: 'Scalps often aim for 1.5–2R; swing setups may stretch further. Skipping sub-1R ideas keeps a string of small wins from being erased by one normal loss.',
  },
  {
    id: 'daily-cap',
    title: 'Use a daily loss cap',
    body: 'Pick a hard stop for the session (for example −2R or −3R). Hitting it means you are done for the day — reviewing charts is fine; putting on new risk is not.',
  },
  {
    id: 'one-thesis',
    title: 'One thesis at a time',
    body: 'Correlated positions are the same bet wearing different tickers. If three longs all need the same index bounce, treat them as one risk unit.',
  },
  {
    id: 'no-move-stop',
    title: 'Do not move stops against yourself',
    body: 'Widening a stop because “it might come back” turns a planned loss into an unplanned one. Exits can tighten in profit; they should not loosen in pain.',
  },
];

/** Entry / exit frameworks used across the playbook. */
export const ENTRY_EXIT_FRAMEWORKS = [
  {
    id: 'confirm-close',
    title: 'Confirmation close',
    when: 'Best for Easy candle reversals at levels.',
    entry: 'Wait for the next candle to close beyond the pattern extreme (hammer high, engulfing high/low, etc.).',
    stop: 'Beyond the pattern’s invalidation wick — usually the pattern low (longs) or high (shorts).',
    exit: 'Scale at 1R; trail or bank the rest at 1.5–2R or the next micro level.',
  },
  {
    id: 'break-retest',
    title: 'Break and retest',
    when: 'Best for Medium chart continuations (flags, triangles, necklines).',
    entry: 'Prefer the first pullback that holds the broken level as support/resistance; aggressive traders may take the breakout close.',
    stop: 'Beyond the retest extreme (or the pattern boundary if entering on the break).',
    exit: 'Measured move (pole/pattern height) first; leave a runner only if volume and structure agree.',
  },
  {
    id: 'fade-trap',
    title: 'Fade the trap',
    when: 'Best for Hard failed breakouts / breakdowns.',
    entry: 'Enter only on the close back inside the range — not on the poke itself.',
    stop: 'Beyond the fakeout extreme (the wick that trapped breakout traders).',
    exit: 'Target the opposite side of the range; do not assume a trend reversal without structure.',
  },
  {
    id: 'time-stop',
    title: 'Time stop',
    when: 'Useful when a scalp goes nowhere.',
    entry: 'Same as your primary framework.',
    stop: 'If price has not reached +1R (or your first scale) within N bars of your timeframe, flatten — the edge was immediacy.',
    exit: 'Treat “no follow-through” as information; journal it as a scratch, not a moral failure.',
  },
];

/** Pre-trade and post-trade checklist items. */
export const TRADE_CHECKLISTS = {
  pre: {
    title: 'Pre-trade checklist',
    blurb: 'Run this before every order. A missing box means wait — or pass.',
    items: [
      'Higher-timeframe bias agrees (or I am explicitly fading it with a Hard setup).',
      'The setup’s full rule list is met — not “close enough.”',
      'Entry, stop and target are written; R is calculated; size fits my risk cap.',
      'No news / session open / thin liquidity that makes the stop meaningless.',
      'I am inside my daily loss cap and not chasing after a tilt trade.',
      'Screenshot or note ready so I can review later without rewriting history.',
    ],
  },
  post: {
    title: 'Post-trade checklist',
    blurb: 'Close the loop while the tape is still fresh. Two minutes beats a vague memory.',
    items: [
      'Did I follow the plan (entry, stop, target), or did I improvise?',
      'Was the setup grade Easy / Medium / Hard correctly tagged for difficulty?',
      'What did volume and follow-through do after entry?',
      'Emotional note: calm / rushed / revenge? One word is enough.',
      'Screenshot annotated: why valid, why invalid, what I would repeat.',
      'Update the daily R tally; stop if the cap is hit.',
    ],
  },
};

/** Short educational scenario walkthroughs that point at playbook setups. */
export const SCENARIOS = [
  {
    id: 'scenario-flush-hammer',
    title: 'Morning flush into support',
    difficulty: 'easy',
    setupId: 'hammer',
    steps: [
      'Index opens soft; your name sells into a well-tested overnight low / Fib 61.8%.',
      'A hammer prints with a long lower wick; volume on the flush is heavy, reclaim volume is not dead.',
      'Next 5-minute candle closes above the hammer high — checklist complete.',
      'Long with stop under the wick, first scale at 1.5R into VWAP.',
    ],
    lesson: 'Easy setups win by being obvious. If you need to squint at the wick ratio, it is not a hammer trade.',
  },
  {
    id: 'scenario-flag-trend',
    title: 'Trend-day bull flag',
    difficulty: 'medium',
    setupId: 'bull-flag',
    steps: [
      'A news catalyst drives a clean pole on expanding volume.',
      'Price digests in a shallow, downward-sloping flag while volume contracts.',
      'A close above the flag’s upper line triggers the continuation long.',
      'Stop under the flag low; target ≈ pole height; trail if the trend day keeps printing higher lows.',
    ],
    lesson: 'Medium continuations need an honest pole. A lazy drift higher is not a pole — skip the “flag.”',
  },
  {
    id: 'scenario-fakeout-fade',
    title: 'Lunchtime fakeout fade',
    difficulty: 'hard',
    setupId: 'fakeout-up',
    steps: [
      'A well-watched pre-market high has stops parked just above it.',
      'Price spikes through on thin volume, then the candle closes back inside the range.',
      'No follow-through on the next bar — trapped longs start dumping.',
      'Short the reclaim close; stop above the fakeout wick; target the opposite side of the range.',
    ],
    lesson: 'Hard fades punish impatience. Entering on the poke (before the close back inside) is a different, worse trade.',
  },
  {
    id: 'scenario-star-reversal',
    title: 'Three-candle morning star',
    difficulty: 'medium',
    setupId: 'morning-star',
    steps: [
      'Selloff into a daily support zone prints a long red candle.',
      'Next bar is a small-bodied pause (doji / spinning top) near the lows.',
      'Third candle surges green and closes above the midpoint of candle one.',
      'Long on that close; stop under the pattern low; manage toward the prior swing.',
    ],
    lesson: 'Multi-candle reversals are Medium because you must wait for candle three — acting on the doji alone is gambling.',
  },
];

export function difficultyMeta(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[0];
}

export function setupById(id) {
  return SETUPS.find((s) => s.id === id) || null;
}

export function setupsByDifficulty(difficultyId) {
  return SETUPS.filter((s) => s.difficulty === difficultyId);
}
