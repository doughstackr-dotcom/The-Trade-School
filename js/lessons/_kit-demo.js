// Developer preview of the LessonShell media helpers (ARCHITECTURE §12.5): figure, takeaway,
// storyStep, realExampleStep, checklistStep and compareStep. Routable at /lessons/_kit-demo through
// registry DEV_ENTRIES (not part of the curriculum); renders only on localhost.
import { LessonShell, storyStep, realExampleStep, checklistStep, compareStep, figure, takeaway, textbookExample } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { candleScenario, chartScenario } from '../core/patterns.js';

function isLocal() {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  } catch {
    return false;
  }
}

/** Hammer at the end of a decline, with a confirmation candle and follow-through. */
function hammerStory(rng) {
  const sc = candleScenario('hammer', { seed: rng.int(1, 1e9), leadIn: 26, after: 8 });
  const { candles } = sc;
  const hi = candles[sc.end];
  const conf = candles[sc.end + 1];
  const stop = +(hi.l - (hi.h - hi.l) * 0.15).toFixed(2);
  const entry = conf.c;
  const target = +(entry + 2 * (entry - stop)).toFixed(2);
  return {
    candles,
    indicators: { volume: false },
    frames: [
      { to: sc.start, caption: 'Price has been falling: lower highs and lower lows. Sellers are in control.', focus: [Math.max(0, sc.start - 14), sc.start] },
      {
        to: sc.end + 1,
        caption: 'A hammer prints: a long lower wick, a small body near the top. Buyers rejected the lows.',
        overlays: [{ type: 'box', from: sc.start, to: sc.end, color: 'bull', label: 'Hammer' }],
      },
      {
        to: sc.end + 2,
        caption: 'Confirmation: the next candle closes above the hammer high. Entry, with the stop under the wick.',
        overlays: [
          { type: 'marker', idx: sc.end + 1, position: 'below', shape: 'arrow', text: 'Entry', color: 'accent' },
          { type: 'hline', price: stop, color: 'bear', label: 'Stop' },
          { type: 'hline', price: target, color: 'bull', label: 'Target 2R' },
        ],
      },
      { to: candles.length, caption: 'Follow-through. It does not always work, which is why the stop is placed before the entry.' },
    ],
  };
}

/**
 * A ChartStory built from a setup's meta (ARCHITECTURE §12.10 builder notes): the textbook bull
 * flag carries poleStart / poleTop / upper / lower / target, so every frame uses exact coordinates.
 */
function flagStory(rng) {
  const ex = textbookExample(['bull-flag'], rng);
  const m = ex.setup.meta;
  const d = ex.decisionIdx; // the breakout candle
  const line = (l) => ({ type: 'segment', a: { idx: l.x1, price: l.y1 }, b: { idx: l.x2, price: l.y2 }, color: 'accent', dashed: true });
  const stop = Math.min(...ex.candles.slice(m.poleTop.idx, d).map((k) => k.l));
  return {
    candles: ex.candles,
    indicators: { volume: true },
    frames: [
      { to: m.poleStart.idx + 1, caption: 'A quiet market. Nothing to do yet.' },
      {
        to: m.poleTop.idx + 1,
        title: 'The pole.',
        caption: 'A fast, one-way rally on rising volume.',
        overlays: [{ type: 'segment', a: m.poleStart, b: m.poleTop, color: 'bull', arrow: true, label: 'Pole' }],
        focus: [m.poleStart.idx, m.poleTop.idx],
      },
      {
        to: d,
        title: 'The flag.',
        caption: 'A small, gentle drift against the pole on shrinking volume: buyers resting, not leaving.',
        overlays: [line(m.upper), line(m.lower)],
        focus: [m.poleTop.idx, d - 1],
        zoom: true,
      },
      {
        to: d + 1,
        title: 'Breakout.',
        caption: 'The first close above the upper line is the entry; the stop goes under the flag low.',
        overlays: [
          { type: 'marker', idx: d, position: 'above', text: 'Entry', color: 'accent' },
          { type: 'hline', price: stop, color: 'bear', label: 'Stop' },
        ],
      },
      {
        to: ex.candles.length,
        caption: 'The measured-move target: the pole’s height added to the breakout. Not every flag gets there.',
        overlays: [{ type: 'hline', price: m.target, color: 'bull', label: 'Target' }],
      },
    ],
  };
}

export default {
  id: '_kit-demo',
  mount(root, ctx) {
    if (!isLocal()) {
      root.append(h('div', { class: 'container' },
        h('div', { class: 'route-error card' },
          h('p', { class: 'eyebrow' }, 'Developer preview'),
          h('h1', { class: 'route-error__title' }, 'Not available here'),
          h('p', { class: 'muted' }, 'This page only renders on a local development server.'))));
      return undefined;
    }
    const shell = new LessonShell(root, ctx, {
      intro: 'A tour of the lesson media helpers: figures with captions, key takeaways, animated chart stories, real examples with a textbook fallback, an interactive setup checklist and a side-by-side comparison.',
      steps: [
        {
          title: 'Figures and takeaways',
          render(el) {
            const sc = candleScenario('hammer', { seed: 7, leadIn: 18, after: 4 });
            el.append(
              h('p', null, 'Diagrams sit in a figure with a numbered caption. Charts drawn with miniChart() or CandleChart go inside it unchanged.'),
              figure(
                miniChart(sc.candles, {
                  width: 640, height: 220, yPad: 0.16,
                  overlays: [
                    { type: 'box', from: sc.start, to: sc.end, color: 'bull', label: 'Hammer' },
                    { type: 'hline', price: sc.confirm, color: 'accent', dashed: true, label: 'Confirm' },
                  ],
                  ariaLabel: 'A hammer candle after a decline, with its confirmation level',
                }),
                'A hammer after a decline. It only becomes a signal once a later candle closes above the <strong>confirmation</strong> line.',
                { label: 'Figure 1' }),
              takeaway([
                'Context first: a hammer means something only after a decline.',
                'Wait for confirmation: a close above the hammer’s high.',
                'Put the stop under the wick before you enter.',
              ]),
            );
          },
        },
        storyStep({
          title: 'storyStep: a hammer, step by step',
          text: 'The story plays frame by frame. Use the controls to pause, step or scrub.',
          story: hammerStory,
        }),
        storyStep({
          title: 'storyStep from a setup: a bull flag',
          text: 'Built from a setup’s meta: every line and marker sits on the exact candles the rule looked at.',
          story: flagStory,
        }),
        realExampleStep({
          title: 'realExampleStep: the real thing',
          text: 'A real hammer or bullish engulfing pattern from the market-data sample. When real data is unavailable, a textbook example is shown and clearly labelled.',
          kinds: ['hammer', 'bullish-engulfing'],
          intervals: ['1d', '1w'],
          caption: 'Real examples are messier than textbook ones. Look for the same rules, not the same picture.',
        }),
        checklistStep({
          title: 'checklistStep: is this a valid hammer?',
          text: 'Tick each rule. The chart marks what the rule looks at.',
          example: (rng) => {
            const sc = candleScenario('hammer', { seed: rng.int(1, 1e9), leadIn: 22, after: 4 });
            return { candles: sc.candles, visible: sc.end + 1, sc };
          },
          items: [
            {
              label: 'It comes after a decline',
              detail: 'Lower highs and lower lows into the candle.',
              overlay: (chart, ex) => chart.addSegment({
                a: { idx: 0, price: ex.candles[0].h }, b: { idx: ex.sc.start, price: ex.candles[ex.sc.start].l },
                color: 'bear', arrow: true, dashed: true, label: 'Decline',
              }),
            },
            {
              label: 'Lower wick at least twice the body',
              detail: 'Buyers pushed price back up from the lows.',
              overlay: (chart, ex) => chart.addMarker({ idx: ex.sc.start, position: 'below', shape: 'ring', text: 'Long wick', color: 'bull' }),
            },
            {
              label: 'Little or no upper wick',
              detail: 'The close sits near the high of the candle.',
              overlay: (chart, ex) => chart.addBox({ from: ex.sc.start, to: ex.sc.end, color: 'bull', label: 'Hammer' }),
            },
            {
              label: 'A later candle closes above its high',
              detail: 'Confirmation: buyers followed through.',
              overlay: (chart, ex) => {
                chart.setVisible(ex.sc.end + 2);
                chart.addHLine({ price: ex.sc.confirm, color: 'accent', dashed: true, label: 'Confirm' });
              },
            },
          ],
        }),
        compareStep({
          title: 'compareStep: breakout or fakeout?',
          text: 'Same pattern, same seed, two outcomes. What differs is what happened at the breakout.',
          left: {
            title: 'Confirmed breakout',
            verdict: 'good',
            volume: true,
            example: () => {
              const sc = chartScenario('ascending-triangle', { seed: 11, count: 96, after: 18, outcome: 'success' });
              return { candles: sc.candles, overlays: [{ type: 'hline', price: sc.level, color: 'resistance', dashed: true }, { type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' }] };
            },
            points: ['Closes clearly above the line', 'Breakout volume well above average', 'The retest holds'],
          },
          right: {
            title: 'Fakeout',
            verdict: 'bad',
            volume: true,
            example: () => {
              const sc = chartScenario('ascending-triangle', { seed: 11, count: 96, after: 18, outcome: 'fail' });
              return { candles: sc.candles, overlays: [{ type: 'hline', price: sc.level, color: 'resistance', dashed: true }, { type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' }] };
            },
            points: ['Only just pokes above the line', 'Thin volume on the break', 'Closes back inside: trapped buyers'],
          },
        }),
        {
          title: 'Quick check',
          render(el) {
            el.append(h('div', { class: 'callout callout--tip' }, icon('info'), h('p', null, 'Every helper step keeps working inside the normal lesson flow, including quick checks.')));
          },
          quiz: {
            question: 'A breakout closes above resistance on the lowest volume of the month. Which read is best?',
            options: [
              { label: 'Treat it with suspicion: wait for confirmation', value: 0 },
              { label: 'Buy immediately with a large size', value: 1 },
              { label: 'Ignore volume — only the close matters', value: 2 },
            ],
            answer: 0,
            explain: '<strong>Wait.</strong> Thin volume means few buyers joined the break, so it has a higher chance of failing.',
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
