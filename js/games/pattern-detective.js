// Pattern Detective — identify chart patterns and estimate measured-move direction.
import { GameShell, explainChoice, trackAnswer } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { CHART_PATTERNS } from '../core/patterns.js';

const EASY = ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'];
const HARD = ['head-and-shoulders', 'inverse-head-and-shoulders', 'ascending-triangle', 'descending-triangle', 'rising-wedge', 'falling-wedge'];

function nameOf(kind) {
  return CHART_PATTERNS[kind]?.name || String(kind).replace(/-/g, ' ');
}

// Lookalike chart patterns: why the pick is not the pattern on the chart. Keyed 'answer|pick'.
const PAIRS = {
  'double-top|head-and-shoulders': 'Head and shoulders needs three peaks with the middle one (the head) clearly highest. Here there are two peaks at about the same height: a double top.',
  'head-and-shoulders|double-top': 'A double top has two peaks at about the same height. Here the middle of three peaks stands clearly above the other two: head and shoulders.',
  'double-bottom|inverse-head-and-shoulders': 'An inverse head and shoulders needs three troughs with the middle one lowest. Here there are two troughs at about the same depth: a double bottom.',
  'inverse-head-and-shoulders|double-bottom': 'A double bottom has two troughs at about the same depth. Here the middle of three troughs dips clearly below the other two: inverse head and shoulders.',
  'double-top|double-bottom': 'A double bottom is a “W” of two matching lows that breaks UP through the high between them. This is an “M” of two matching highs, breaking down: a double top.',
  'double-bottom|double-top': 'A double top is an “M” of two matching highs that breaks DOWN. This is a “W” of two matching lows, breaking up through the high between them: a double bottom.',
  'bull-flag|bear-flag': 'A bear flag hangs under a sharp DROP and drifts up. Here the pole is a sharp rally and the flag drifts sideways or down: a bull flag.',
  'bear-flag|bull-flag': 'A bull flag sits on a sharp RALLY and drifts down. Here the pole is a sharp drop and the flag drifts sideways or up: a bear flag.',
  'bull-flag|rising-wedge': 'A rising wedge is a slow climb between two converging rising lines, usually at the end of a move. A bull flag is a short, orderly pause after a sharp pole.',
  'bear-flag|falling-wedge': 'A falling wedge is a slow decline between two converging falling lines. A bear flag is a short, orderly bounce after a sharp drop (the pole).',
};

function chartWhy(answer, pick) {
  if (!pick || pick === answer) return '';
  if (PAIRS[`${answer}|${pick}`]) return PAIRS[`${answer}|${pick}`];
  const p = CHART_PATTERNS[pick];
  const a = CHART_PATTERNS[answer];
  if (!p) return '';
  let why = `${p.name}: ${p.summary}`;
  if (a && p.bias !== a.bias && a.bias !== 'neutral' && p.bias !== 'neutral') why += ` That is a ${p.bias} pattern; the one on the chart is ${a.bias}.`;
  return why;
}

export default {
  id: 'pattern-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 91, direction: 'up', title: 'pattern-detective', score: 640, streak: 5, round: '2/8' }),
      rounds: 7,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'A classic chart pattern is forming into the freeze.',
        'Name it — then we reveal the break and measured-move idea.',
        'Harder rounds mix lookalikes (wedges vs flags, H&S vs double top).',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const pool = difficulty < 0.35 ? EASY : difficulty < 0.7 ? [...EASY, ...HARD.slice(0, 3)] : [...EASY, ...HARD];
        const q = { kinds: pool, before: Math.round(80 - 20 * difficulty), after: 20 };
        const real = await g.realRound(q);
        const r = real || simRound(rng, q) || simRound(rng.fork('retry'), { ...q, kinds: EASY });
        if (!r) throw new Error('no chart-pattern round could be generated');
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Which chart pattern is this?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 350, showVolume: difficulty < 0.55, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart pattern mystery; breakout future hidden',
        });
        const distractors = rng.shuffle(pool.filter((k) => k !== kind)).slice(0, 3);
        g.setHint('Find the pole or the twin swings first, then the boundary that must break.');
        g.ask({
          options: rng.shuffle([kind, ...distractors].map((k) => ({ label: nameOf(k), value: k }))),
          answer: kind,
          explain: explainChoice(
            `<strong>${nameOf(kind)}</strong>. Sample outcome: ${r.outcome?.result || 'n/a'} (${r.outcome?.r ?? '?'} ATR). Measured targets are guidelines.`,
            (pick) => chartWhy(kind, pick),
          ),
          onAnswer: (ok) => {
            trackAnswer(g.store, 'chart-pattern', kind, ok);
            chart.reveal({ to: r.candles.length, interval: 35 });
            try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
