// Timeframe Tower (v2 of Timeframe Stack) — stack three reads into one plan.
// Practice keeps the classic study quiz (bias given, one question). Arcade and Survival
// build the tower block by block: (1) read the HTF lean yourself, (2) classify the LTF
// move, (3) call the plan. Every block you stack correctly holds points; a wrong block
// cracks the tower and the round pays out only what already stands.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, floatText } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries, aggregate } from '../core/data.js';

function build(rng, difficulty) {
  const bias = rng.pick(['up', 'down']);
  const state = rng.pick(difficulty < 0.25 ? ['continuation', 'pullback'] : ['continuation', 'pullback', 'chop']);
  const base = trendSeries({ seed: rng.int(1, 1e9), count: 144, direction: bias, swings: 4 }).candles;
  const ltfDir = state === 'chop' ? 'range' : state === 'pullback' ? (bias === 'up' ? 'down' : 'up') : bias;
  const raw = trendSeries({ seed: rng.int(1, 1e9), count: 32, direction: ltfDir, swings: 2 }).candles;
  const last = base[base.length - 1].c;
  const baseMove = Math.abs(last - base[0].o);
  const rawRange = Math.max(...raw.map((c) => c.h)) - Math.min(...raw.map((c) => c.l));
  const k = (baseMove * (state === 'pullback' ? 0.22 : 0.16)) / (rawRange || 1);
  const at = (p) => last + (p - raw[0].o) * k;
  const tail = raw.map((c, i) => ({ ...c, t: base.length + i, o: at(c.o), h: at(c.h), l: at(c.l), c: at(c.c) }));
  // Both views now come from one tape: four lower-timeframe bars form each higher-timeframe bar.
  const tape = [...base, ...tail];
  const htf = aggregate(tape, 4, { partial: false });
  const ltf = tape.slice(-58);
  const answer = state === 'chop' ? 'wait' : state === 'pullback'
    ? (bias === 'up' ? 'long-pullback' : 'short-pullback')
    : (bias === 'up' ? 'long-cont' : 'short-cont');
  const ltfState = state === 'chop' ? 'chop' : state === 'pullback' ? 'counter' : 'with';
  return { htf, ltf, bias, answer, ltfState, pullback: state === 'pullback', state };
}

const BLOCKS = [
  { id: 'lean', label: 'Block 1 · HTF lean', question: 'Read the higher timeframe: which way does it lean?', points: 30 },
  { id: 'move', label: 'Block 2 · LTF move', question: 'Classify the lower-timeframe move.', points: 30 },
  { id: 'plan', label: 'Block 3 · The plan', question: 'Call the plan that fits both timeframes.', points: 40 },
];

export default {
  id: 'timeframe-stack',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 39, direction: 'up', title: 'Timeframe Tower', score: 100, streak: 1, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 38, perRound: true },
      howTo: [
        'The two charts are the same market at different timeframes.',
        'Arcade: stack the tower — read the HTF lean, classify the LTF move, then call the plan. Wrong blocks crack the tower; standing blocks still pay.',
        'A pullback is a plan to watch for confirmation, not an automatic entry.',
      ],
      onRound(g, { rng, stage, difficulty, style }) {
        const r = build(rng, difficulty);
        const row = h('div', { class: 'chart-compare' });
        const left = h('div', { class: 'chart-frame' });
        const right = h('div', { class: 'chart-frame' });
        row.append(
          h('div', null, h('p', { class: 'eyebrow' }, 'Higher TF'), left),
          h('div', null, h('p', { class: 'eyebrow' }, 'Lower TF'), right),
        );
        const c1 = new CandleChart(left, { candles: r.htf, height: 175, yPad: 0.12, ariaLabel: 'Higher timeframe chart from the same market tape' });
        const c2 = new CandleChart(right, { candles: r.ltf, height: 175, yPad: 0.12, ariaLabel: 'Lower timeframe chart from the same market tape' });

        // ------------------------------------------------ practice: the classic quiz
        if (style === 'practice') {
          stage.append(
            h('p', { class: 'quiz__q' }, `HTF bias is ${r.bias === 'up' ? 'bullish' : 'bearish'}. Which plan fits the lower timeframe?`),
            row,
          );
          g.setHint('A countertrend move can be a pullback setup; wait for a trigger before entering. Sideways chop without a trigger means wait.');
          const quiz = g.ask({
            options: rng.shuffle([
              { label: 'Plan long on a confirmed pullback', value: 'long-pullback' },
              { label: 'Plan short on a confirmed pullback', value: 'short-pullback' },
              { label: 'With-trend continuation long', value: 'long-cont' },
              { label: 'With-trend continuation short', value: 'short-cont' },
              { label: 'Wait — conflict / no trigger', value: 'wait' },
            ]),
            answer: r.answer,
            explain: r.pullback
              ? `<strong>Watch the pullback with the ${r.bias === 'up' ? 'bullish' : 'bearish'} HTF bias.</strong> Wait for a lower-timeframe trigger before entering.`
              : r.answer === 'wait'
                ? '<strong>Wait.</strong> The LTF is chopping sideways — no pullback and no trigger yet, so there is nothing to act on.'
                : `<strong>With-trend continuation ${r.bias === 'up' ? 'long' : 'short'}</strong>. Both timeframes point the same way; still define an entry and stop.`,
            onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Stacked well' : 'Re-check HTF vs LTF', scoreDelta: ok ? 100 : 0 }),
          });
          stage.append(quiz);
          return () => { c1.destroy(); c2.destroy(); };
        }

        // ------------------------------------------------ arcade / survival: build the tower
        const towerSlots = [0, 1, 2].map((i) => h('div', { class: ['tower-block', `tower-block--${i}`], 'data-block': i },
          h('span', { class: 'tower-block__label arcade-label' }, BLOCKS[i].label.replace(/^Block \d+ · /, ''))));
        const tower = h('div', { class: 'tower', role: 'img', 'aria-label': 'Tower: no blocks stacked yet' }, towerSlots);
        const question = h('p', { class: 'quiz__q' });
        stage.append(tower, question, row);

        let block = 0;
        let held = 0;
        let answered = false;

        const ANSWERS = [
          { lean: r.bias === 'up' ? 'bull' : 'bear' },
          { move: r.ltfState },
          { plan: r.answer },
        ];
        const OPTIONS = [
          [
            { label: 'Bullish — higher highs and lows', value: 'bull', key: '1' },
            { label: 'Bearish — lower highs and lows', value: 'bear', key: '2' },
          ],
          [
            { label: 'With-trend push', value: 'with', key: '1' },
            { label: 'Countertrend pullback', value: 'counter', key: '2' },
            { label: 'Sideways chop', value: 'chop', key: '3' },
          ],
          [
            { label: 'Plan long on a confirmed pullback', value: 'long-pullback', key: '1' },
            { label: 'Plan short on a confirmed pullback', value: 'short-pullback', key: '2' },
            { label: 'With-trend continuation long', value: 'long-cont', key: '3' },
            { label: 'With-trend continuation short', value: 'short-cont', key: '4' },
            { label: 'Wait — conflict / no trigger', value: 'wait', key: '5' },
          ],
        ];

        const explainFor = () => r.pullback
          ? `<strong>Watch the pullback with the ${r.bias === 'up' ? 'bullish' : 'bearish'} HTF bias.</strong> Wait for a lower-timeframe trigger before entering.`
          : r.answer === 'wait'
            ? '<strong>Wait.</strong> The LTF is chopping sideways — no pullback and no trigger yet, so there is nothing to act on.'
            : `<strong>With-trend continuation ${r.bias === 'up' ? 'long' : 'short'}</strong>. Both timeframes point the same way; still define an entry and stop.`;

        const answerBlock = (value) => {
          if (answered) return;
          const key = ['lean', 'move', 'plan'][block];
          const ok = value === ANSWERS[block][key];
          if (!ok) {
            towerSlots[block].classList.add('is-cracked');
            tower.setAttribute('aria-label', `Tower cracked at block ${block + 1}`);
            sfx.wrong();
            const explain = `<strong>Block ${block + 1} cracked.</strong> ${explainFor()} Points held: ${held}.`;
            g.wrong(explain);
            if (held > 0) g.award(held, { reason: 'blocks held' });
            verdictFlourish(stage, { ok: false, title: 'Tower cracked', detail: explain.replace(/<[^>]+>/g, ' '), scoreDelta: held });
            answered = true;
            buttonsHost.replaceChildren();
            g.nextButton();
            return;
          }
          towerSlots[block].classList.add('is-stacked');
          held += BLOCKS[block].points;
          floatText(`+${BLOCKS[block].points}`, { at: towerSlots[block], tone: 'bull' });
          sfx.correct();
          tower.setAttribute('aria-label', `Tower: ${block + 1} blocks stacked, ${held} points held`);
          block += 1;
          if (block < 3) renderBlock();
          else {
            const explain = explainFor();
            g.correct(`${explain} Full tower — all three blocks hold.`);
            sfx.win();
            verdictFlourish(stage, { ok: true, title: 'Tower stacked', detail: explain.replace(/<[^>]+>/g, ' '), scoreDelta: 100 });
            answered = true;
            buttonsHost.replaceChildren();
            g.nextButton();
          }
        };

        const onKey = (e) => {
          if (answered || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          const idx = Number(e.key) - 1;
          const opts = OPTIONS[block];
          if (Number.isInteger(idx) && idx >= 0 && idx < opts.length) answerBlock(opts[idx].value);
        };
        document.addEventListener('keydown', onKey);

        const buttonsHost = h('div', { class: 'option-grid tower-options' });
        function renderBlock() {
          question.textContent = BLOCKS[block].question;
          buttonsHost.replaceChildren(...OPTIONS[block].map((o) => h('button', {
            type: 'button',
            class: 'option rush-option',
            on: { click: () => answerBlock(o.value) },
          },
            h('span', { class: 'option__key', 'aria-hidden': 'true' }, o.key),
            h('span', { class: 'option__label' }, o.label),
            h('span', { class: 'option__mark', 'aria-hidden': 'true' }))));
        }
        renderBlock();
        stage.append(buttonsHost);
        g.setHint('Read the HTF first: its swings set the bias. Then ask whether the LTF pushes with it, pulls against it, or chops.');

        return () => {
          document.removeEventListener('keydown', onKey);
          c1.destroy();
          c2.destroy();
        };
      },
    });
    return () => game.destroy();
  },
};
