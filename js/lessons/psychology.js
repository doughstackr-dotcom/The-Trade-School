// psychology — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';


function psychStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 70, direction: 'down', swings: 3 });
  const c = ts.candles;
  return {
    candles: c,
    frames: [
      { to: 25, caption: 'First planned stop-out. This is a cost of doing business — not a personal insult.' },
      { to: 45, title: 'Tilt risk.', caption: 'The urge: double size to “win it back”. That is revenge trading.',
        overlays: [{ type: 'marker', idx: 40, position: 'above', text: 'Urge', color: 'bear' }] },
      { to: c.length, caption: 'Process win: journal the loss, wait for the next A+ setup at normal size — or stop for the day.' },
    ],
  };
}

const steps = [
  compareStep({
    title: 'Emotions are part of the market',
    text: () => h('p', null, 'Fear, greed, FOMO and ego show up on every desk. A written plan (risk %, max daily loss, setup checklist) is a pre-commitment against future you.'),
    left: {
      title: 'Planned pullback',
      verdict: 'good',
      tag: 'Process',
      example: () => {
        const ts = trendSeries({ seed: 4, count: 64, direction: 'up', swings: 3 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 48, position: 'below', text: 'Wait', color: 'accent' },
            { type: 'marker', idx: 55, position: 'below', text: 'A+ entry', color: 'bull' },
          ],
        };
      },
      points: ['Wait for the checklist setup', 'Normal size, predefined stop', 'Skipping a non-setup is a win'],
    },
    right: {
      title: 'FOMO chase',
      verdict: 'bad',
      tag: 'Tilt bait',
      example: () => {
        const ts = trendSeries({ seed: 4, count: 64, direction: 'up', swings: 3 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 50, position: 'above', text: 'Chase high', color: 'bear' },
            { type: 'marker', idx: 58, position: 'below', text: 'Gave back', color: 'bear' },
          ],
        };
      },
      points: ['Bought the spike on emotion', 'No plan for stop or size', 'Ego tries to “not miss it”'],
    },
    after: () => takeaway(['Grade process, not just P&amp;L.', 'Daily loss limits exist to stop tilt spirals.', 'Skipping a non-setup is a winning behaviour.']),
  }),
  storyStep({ title: 'After a planned loss', story: psychStory }),
  {
    title: 'Build a one-page plan',
    render(el) {
      const ts = trendSeries({ seed: 9, count: 60, direction: 'up', swings: 2 });
      el.append(
        h('ul', { class: 'lesson-list' },
          h('li', null, 'Markets and sessions you trade'),
          h('li', null, 'Setups you are allowed to take (with checklist)'),
          h('li', null, 'Risk per trade and max daily loss'),
          h('li', null, 'When you stop (hit limit, tilt signs, news)'),
        ),
        figure(
          miniChart(ts.candles, {
            width: 640, height: 180, yPad: 0.12,
            ariaLabel: 'Only A-plus setups from the written plan',
            overlays: [
              { type: 'box', from: 20, to: 28, color: 'accent', label: 'Allowed setup' },
              { type: 'marker', idx: 42, position: 'above', text: 'Not in plan', color: 'bear' },
              { type: 'marker', idx: 55, position: 'below', text: 'A+ only', color: 'bull' },
            ],
          }),
          'If it is not in the plan, it is an experiment — label it so. Review weekly; update deliberately, not mid-trade.',
          { label: 'Figure' },
        ),
        takeaway(['If it is not in the plan, it is an experiment — label it so.', 'Review weekly; update deliberately, not mid-trade.']),
      );
    },
  },
  {
    title: 'Quick check',
    render(el) {
      const ts = trendSeries({ seed: 13, count: 50, direction: 'down', swings: 2 });
      el.append(
        figure(
          miniChart(ts.candles, {
            width: 640, height: 180, yPad: 0.14,
            ariaLabel: 'Daily loss limit at minus 2R of 3R',
            overlays: [
              { type: 'marker', idx: 18, position: 'above', text: '−1R', color: 'bear' },
              { type: 'marker', idx: 32, position: 'above', text: '−2R', color: 'bear' },
              { type: 'hline', price: ts.candles[32].c, color: 'accent', dashed: true, label: '1R left' },
              { type: 'marker', idx: 45, position: 'below', text: 'A+ only / stop', color: 'bull' },
            ],
          }),
          'Daily limit 3R, already −2R → one more full loss ends the day by design.',
          { label: 'Figure' },
        ),
      );
    },
    quiz: {
      question: 'Two planned losses; daily limit 3R; you are at −2R. Next?',
      options: [
        { label: 'A+ setups only at normal size — or stop', value: 0 },
        { label: 'Double size to recover', value: 1 },
        { label: 'Trade everything that moves', value: 2 },
        { label: 'Ignore the limit today', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Tighten or stop.</strong> One more full loss ends the day by design.',
    },
  },
  compareStep({
    title: 'Caveats',
    text: () => [
      h('div', { class: 'callout callout--tip' }, icon('info'),
        h('p', null, 'This is education, not therapy. If trading harms your wellbeing, stop and seek appropriate help.')),
      h('p', null, 'Protect the account so you can keep learning — tilt spirals end careers faster than bad setups.'),
    ],
    left: {
      title: 'Respect the stop',
      verdict: 'good',
      tag: 'Process',
      example: () => {
        const ts = trendSeries({ seed: 6, count: 55, direction: 'down', swings: 2 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 22, position: 'above', text: 'Planned −1R', color: 'accent' },
            { type: 'marker', idx: 40, position: 'below', text: 'Journal → next A+', color: 'bull' },
          ],
        };
      },
      points: ['Loss taken as designed', 'Size stays normal', 'Drill scenarios in Tilt Control'],
    },
    right: {
      title: 'Revenge spiral',
      verdict: 'bad',
      tag: 'Tilt',
      example: () => {
        const ts = trendSeries({ seed: 6, count: 55, direction: 'down', swings: 3 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 18, position: 'above', text: '−1R', color: 'bear' },
            { type: 'marker', idx: 30, position: 'above', text: '2× size', color: 'bear' },
            { type: 'marker', idx: 48, position: 'above', text: '−4R day', color: 'bear' },
          ],
        };
      },
      points: ['Doubled size to “win it back”', 'Daily limit ignored', 'Account damage compounds'],
    },
    after: () => takeaway(['Drill scenarios in Tilt Control.', 'Protect the account so you can keep learning.']),
  }),
];


export default {
  id: 'psychology',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Tilt, FOMO, revenge trading and process: building a plan you can follow when emotions spike.',
      steps,
    });
    return () => shell.destroy();
  },
};
