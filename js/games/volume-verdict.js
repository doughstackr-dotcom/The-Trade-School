// Volume Verdict — Confirm or Trap with swipe + volume chart.
import { GameShell } from '../core/game-kit.js';
import { chartScenario } from '../core/patterns.js';
import { gameplayPreview, decisionChart, swipeCard, verdictFlourish } from '../core/game-ui.js';

const TEXTBOOK_PATTERNS = ['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag'];

function textbookRound(rng, difficulty) {
  const trap = rng.chance(0.5);
  const id = rng.pick(difficulty < 0.5 ? TEXTBOOK_PATTERNS.slice(0, 4) : TEXTBOOK_PATTERNS);
  const sc = chartScenario(id, { seed: rng.int(1, 2 ** 31 - 1), count: 96, after: 16, outcome: trap ? 'fail' : 'success' });
  return { candles: sc.candles, decisionIdx: sc.breakoutIdx, level: sc.level, trap, direction: sc.direction, name: sc.name };
}

// Real round → { breakIdx, ratio }: the break candle and its volume ÷ the average of the 10
// candles before it (the hint's comparison). ratio is null when the market has no volume (spot FX).
function breakVolume(real) {
  const meta = real.setup?.meta || {};
  const breakIdx = /^fakeout/.test(real.setup?.kind || '') && Number.isFinite(meta.breakoutIdx) ? meta.breakoutIdx : real.decisionIdx;
  const all = [...(real.lead || []), ...real.candles];
  const i = all.length - real.candles.length + breakIdx;
  const prev = all.slice(Math.max(0, i - 10), i);
  const avg = prev.reduce((s, k) => s + (k.v || 0), 0) / (prev.length || 1);
  return { breakIdx, ratio: avg > 0 ? (all[i].v || 0) / avg : null };
}

export default {
  id: 'volume-verdict',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'Price has just broken a level. Check the volume under the breakout candle.',
        'Confirms: strong volume behind the move. Trap: thin volume, likely to fail.',
        'Swipe Confirm or Trap, then watch the reveal.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 88, direction: 'up', title: 'Volume Verdict', score: 470, streak: 3, round: '2/6', showVolume: true }),
      async onRound(g, { rng, stage, difficulty }) {
        // Real rounds are graded on the volume the player is asked to read, not on what price did
        // next (the scanner's breakout / fakeout rules ignore volume). Unclear reads — no volume,
        // or a break candle between 0.85× and 1.2× its average — are redrawn a few times.
        let real = null;
        let vol = null;
        let best = null;
        for (let t = 0; t < 4; t++) {
          real = await g.realRound({
            kinds: ['breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'],
            intervals: ['1d', '1w'],
            before: 60,
            after: 14,
          });
          if (!real) break;
          vol = breakVolume(real);
          if (vol.ratio != null && !best) best = { real, vol };
          if (vol.ratio != null && (vol.ratio >= 1.2 || vol.ratio < 0.85)) break;
        }
        if (real && vol.ratio == null && best) ({ real, vol } = best);
        const kind = real?.setup?.kind || '';
        const r = real
          ? {
            candles: real.candles,
            decisionIdx: vol.breakIdx,
            level: real.setup?.meta?.level,
            trap: vol.ratio != null ? vol.ratio < 1 : /^fakeout/.test(kind),
            ratio: vol.ratio,
            fakeout: /^fakeout/.test(kind),
            followed: real.outcome?.result === 'followed',
            direction: /-down$/.test(kind) ? -1 : 1,
            decimals: real.decimals,
          }
          : textbookRound(rng, difficulty);
        const q = `Price just broke ${r.direction < 0 ? 'down through support' : 'up through resistance'}. Does volume confirm?`;
        const dc = decisionChart(stage, {
          candles: r.candles,
          visible: r.decisionIdx + 1,
          slots: r.candles.length,
          height: 340,
          showVolume: true,
          decimals: r.decimals ?? 2,
          question: q,
          ariaLabel: 'Breakout chart with volume. Future hidden.',
        });
        if (Number.isFinite(r.level)) dc.chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        dc.chart.addMarker({ idx: r.decisionIdx, position: r.direction < 0 ? 'below' : 'above', shape: 'dot', color: 'accent' });
        let answered = false;
        const finish = (sayTrap) => {
          if (answered) return;
          answered = true;
          const ok = sayTrap === r.trap;
          let explain = r.trap
            ? '<strong>Trap.</strong> The break came on weak participation and price fell back inside the range.'
            : '<strong>Confirmed.</strong> Volume expanded on the break and price followed through.';
          if (r.ratio != null) {
            // Real chart: say what the volume and the follow-through actually were.
            const next = r.fakeout ? 'price fell back inside the range' : r.followed ? 'price followed through' : 'price did not follow through';
            const agrees = r.trap ? !r.followed || r.fakeout : r.followed && !r.fakeout;
            explain = `<strong>${r.trap ? 'Trap' : 'Confirmed'}.</strong> The break came on ${r.ratio.toFixed(1)}× its 10-bar average volume (${r.trap ? 'thin' : 'strong'} participation)`
              + (agrees ? ` and ${next}.` : `, yet ${next}: volume tilts the odds, it does not decide them.`);
          } else if (r.fakeout != null) {
            explain = `<strong>${r.trap ? 'Trap' : 'Confirmed'}.</strong> This market reports no volume, so this one is graded on what price did next.`;
          }
          if (ok) g.correct(explain);
          else g.wrong(explain);
          dc.reveal();
          verdictFlourish(stage, { ok, title: ok ? 'Volume read' : 'Missed the tape', detail: explain.replace(/<[^>]+>/g, ' '), scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };
        stage.append(swipeCard({
          title: 'Volume call',
          body: 'Strong participation = Confirm. Thin poke = Trap.',
          takeLabel: 'Confirm',
          skipLabel: 'Trap',
          takeClass: 'btn--bull',
          skipClass: 'btn--bear',
          onTake: () => finish(false),
          onSkip: () => finish(true),
        }));
        g.setHint('Compare the breakout candle’s volume bar with the ten bars before it.');
        return () => dc.destroy();
      },
    });
    return () => game.destroy();
  },
};
