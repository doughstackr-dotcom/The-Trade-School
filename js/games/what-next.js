// The Oracle (v2 of What Happens Next?) — a boss battle of reads.
// Practice keeps the classic quiz. Arcade and Survival fight THE ORACLE: her conviction
// bar drops on correct calls and HEALS on misses; phase 2 shortens your look, and in
// phase 3 she whispers plausible nonsense — trust the chart, not the voice. Beat her
// conviction to zero by the final round to knock her out.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, floatText } from '../core/ui.js';
import { sleep } from '../core/anim.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { BossBar } from '../core/arcade.js';

const WHISPERS = [
  'The whisper says: “This one always reverses.”',
  'The whisper says: “You missed the last two — swing bigger.”',
  'The whisper says: “The pattern is obvious; answer fast.”',
  'The whisper says: “Volume does not matter here.”',
  'The whisper says: “Trust the hunch you cannot explain.”',
  'The whisper says: “The last candle tells you everything.”',
];

export default {
  id: 'what-next',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 82, direction: 'down', title: 'The Oracle', score: 180, streak: 2, round: '2/3' }),
      rounds: 8,
      timer: { seconds: 30, perRound: true },
      modes: [
        { id: 'beginner', label: 'Beginner', description: 'Call the direction: up, down or sideways.' },
        { id: 'advanced', label: 'Advanced', description: 'Trade decision: long, short or wait.', requires: 'advanced' },
      ],
      howTo: [
        'The chart freezes at a decision point — the Oracle holds the future.',
        'Arcade: correct calls drain her conviction bar, misses heal it. Phase 2 shortens your look; phase 3 brings her whispers. She lies — read the chart.',
        'Knock her conviction to zero by the final round to defeat her.',
      ],
      onStart(g, { style }) {
        if (style === 'practice') {
          g._oracle = null;
          return;
        }
        // Conviction equals the run's round count: a perfect read knocks her out on the last card.
        g._oracle = new BossBar({ name: 'The Oracle', hp: Math.max(1, g.rounds || 8), phases: [0.62, 0.3] });
      },
      async onRound(g, { rng, stage, difficulty, mode, style }) {
        const kinds = difficulty < 0.4
          ? ['bull-flag', 'bear-flag', 'hammer', 'shooting-star']
          : ['bull-flag', 'bear-flag', 'double-top', 'double-bottom', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down', 'range'];
        const q = { kinds, before: Math.round(70 - 15 * difficulty), after: 18 };
        const real = await g.realRound(q);
        let r = real || simRound(rng, q);
        for (let i = 0; !r && i < 6; i++) r = simRound(rng, q);
        if (!r) throw new Error('No suitable forecast setup found');
        const dir = r.setup?.direction === 'bearish' ? 'down' : r.setup?.direction === 'bullish' ? 'up' : 'sideways';
        const host = h('div', { class: 'chart-frame' });
        const advanced = mode === 'advanced';
        const boss = style !== 'practice' ? g._oracle : null;
        const phase = boss ? boss.phase : 1;
        const freeze = r.candles[r.decisionIdx].c;
        const future = r.candles.at(-1).c;
        const move = ((future / freeze - 1) * 100).toFixed(1);
        const sample = `The sample path moved ${Number(move) >= 0 ? '+' : ''}${move}% after the freeze.`;

        if (boss) stage.append(boss.el);
        if (phase >= 3) {
          stage.append(h('p', { class: 'oracle-whisper', role: 'note' },
            h('span', { class: 'oracle-whisper__icon', 'aria-hidden': 'true' }, '❦'),
            rng.pick(WHISPERS), ' (She lies.)'));
        }

        const reveal = (ok) => {
          chart.addHLine({ price: freeze, color: 'accent', dashed: true, label: 'Freeze' });
          chart.reveal({ to: r.candles.length, interval: 40 });
          try { annotateSetup(r.setup, chart, r); } catch { /* optional annotation */ }
          if (boss && !boss.dead) {
            if (ok) {
              const dmg = phase >= 3 ? 2 : 1;
              const before = boss.hp;
              boss.damage(dmg);
              if (boss.hp <= 0 && before > 0) {
                boss.ko();
                floatText('K.O.', { at: boss.el, tone: 'bull' });
                g.award(60, { reason: 'Oracle knocked out', bonus: true });
              }
            } else if (boss.hp < boss.max) {
              boss.heal(1);
              floatText('+1 conviction', { at: boss.el, tone: 'bear' });
            }
          }
          verdictFlourish(stage, { ok, title: ok ? 'Forecast locked' : 'Review the setup', detail: sample, scoreDelta: ok ? 100 : 0 });
        };
        stage.append(
          h('p', { class: 'quiz__q' }, advanced
            ? 'Trade decision at the freeze (plan a stop either way)?'
            : 'Most likely path from here?'),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Frozen decision chart',
        });

        // Phase 2+: the Oracle shortens your look — flash, then dim (shorter than Pattern Blitz).
        if (boss && phase >= 2) {
          const flashMs = phase >= 3 ? 900 : 1500;
          const fill = h('span', { class: 'blitz-bar__fill' });
          const flash = h('div', { class: 'blitz-flash', role: 'status', 'aria-label': `The Oracle hides the chart — ${(flashMs / 1000).toFixed(1)} seconds` },
            h('span', { class: 'blitz-flash__label arcade-label' }, 'The Oracle looks away'),
            h('span', { class: 'blitz-bar', 'aria-hidden': 'true' }, fill));
          host.append(flash);
          fill.style.transform = 'scaleX(1)';
          fill.style.transition = `transform ${flashMs}ms linear`;
          requestAnimationFrame(() => { fill.style.transform = 'scaleX(0)'; });
          sfx.tick();
          await sleep(flashMs);
          flash.remove();
          host.classList.add('is-blitz-dim');
          sfx.coin();
        }

        g.setHint(advanced
          ? 'If confluence is weak or fakeout risk is high, waiting is a valid trade.'
          : 'Trend + level + trigger agree → lean that way; otherwise sideways/unclear.');
        const wrapUp = (ok) => {
          host.classList.remove('is-blitz-dim');
          reveal(ok);
        };
        if (advanced) {
          const ans = /^fakeout/.test(r.setup?.kind || '') ? 'wait'
            : dir === 'up' ? 'long' : dir === 'down' ? 'short' : 'wait';
          const quiz = g.ask({
            options: [
              { label: 'Long', value: 'long' },
              { label: 'Short', value: 'short' },
              { label: 'Wait', value: 'wait' },
            ],
            answer: ans,
            explain: `<strong>${ans}</strong> · ${r.setup?.meta?.name || r.setup?.kind || 'setup'}. This is a plan based on evidence, not a guarantee.`,
            onAnswer: (ok) => wrapUp(ok),
          });
          stage.append(quiz);
        } else {
          const quiz = g.ask({
            options: [
              { label: 'Up', value: 'up' },
              { label: 'Down', value: 'down' },
              { label: 'Sideways / unclear', value: 'sideways' },
            ],
            answer: dir,
            explain: `Lean <strong>${dir}</strong> from ${r.setup?.meta?.name || r.setup?.kind || 'structure'}. Not a guarantee.`,
            onAnswer: (ok) => wrapUp(ok),
          });
          stage.append(quiz);
        }
        return () => chart.destroy();
      },
      onEnd(g) {
        const boss = g._oracle;
        if (!boss) return null;
        if (boss.dead) return h('p', { class: 'callout oracle-verdict oracle-verdict--ko' }, 'The Oracle is out of conviction — knocked clean off her stool. The chart does not lie; you read it anyway.');
        return h('p', { class: 'callout oracle-verdict' }, `The Oracle survived with ${boss.hp} conviction left. Every miss healed her — bring a cleaner read next time.`);
      },
    });
    return () => game.destroy();
  },
};
