// psychology — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
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
  {
    title: 'Emotions are part of the market',
    render(el) {
      el.append(
        h('p', null, 'Fear, greed, FOMO and ego show up on every desk. A written plan (risk %, max daily loss, setup checklist) is a pre-commitment against future you.'),
        takeaway(['Grade process, not just P&amp;L.', 'Daily loss limits exist to stop tilt spirals.', 'Skipping a non-setup is a winning behaviour.']),
      );
    },
  },
  storyStep({ title: 'After a planned loss', story: psychStory }),
  {
    title: 'Build a one-page plan',
    render(el) {
      el.append(
        h('ul', { class: 'lesson-list' },
          h('li', null, 'Markets and sessions you trade'),
          h('li', null, 'Setups you are allowed to take (with checklist)'),
          h('li', null, 'Risk per trade and max daily loss'),
          h('li', null, 'When you stop (hit limit, tilt signs, news)'),
        ),
        takeaway(['If it is not in the plan, it is an experiment — label it so.', 'Review weekly; update deliberately, not mid-trade.']),
      );
    },
  },
  {
    title: 'Quick check',
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
  {
    title: 'Caveats',
    render(el) {
      el.append(
        h('div', { class: 'callout callout--tip' }, icon('info'),
          h('p', null, 'This is education, not therapy. If trading harms your wellbeing, stop and seek appropriate help.')),
        takeaway(['Drill scenarios in Tilt Control.', 'Protect the account so you can keep learning.']),
      );
    },
  },
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
