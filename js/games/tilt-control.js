// Tilt Control — discipline scenarios with a live tilt meter and candle backdrop.
import { GameShell, QuestionBank, bankOptions, explainChoice, trackAnswer } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { gameplayPreview, tinySeries, verdictFlourish } from '../core/game-ui.js';
import { QUESTIONS } from './banks/tilt-control-questions.js';

// Re-exported for tests and callers that predate the shared bank module.
export { QUESTIONS };

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
