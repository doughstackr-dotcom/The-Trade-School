// Volume Verdict Live (v2 of Volume Verdict) — the volume call with skin in the game.
// Practice keeps the classic study flow. Arcade and Survival add the conviction wager:
// stake credits on your read before you call Confirm or Trap — wins bank the stake,
// misses burn it. The stake pays bonus points on a correct call; a miss just hurts.
import { GameShell } from '../core/game-kit.js';
import { chartScenario } from '../core/patterns.js';
import { gameplayPreview, decisionChart, swipeCard, verdictFlourish } from '../core/game-ui.js';
import { h, sfx } from '../core/ui.js';
import { Wager } from '../core/arcade.js';

const TEXTBOOK_PATTERNS = ['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag'];
const STAKES = [10, 25, 50];

function textbookRound(rng, difficulty) {
  const trap = rng.chance(0.5);
  const id = rng.pick(difficulty < 0.5 ? TEXTBOOK_PATTERNS.slice(0, 4) : TEXTBOOK_PATTERNS);
  const sc = chartScenario(id, { seed: rng.int(1, 2 ** 31 - 1), count: 96, after: 16, outcome: trap ? 'fail' : 'success' });
  const vol = breakVolume({ candles: sc.candles, decisionIdx: sc.breakoutIdx });
  return { candles: sc.candles, decisionIdx: sc.breakoutIdx, level: sc.level, trap, ratio: vol.ratio, fakeout: trap, followed: !trap, direction: sc.direction, name: sc.name };
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
        'Arcade: stake credits on your read, then call Confirm or Trap. Strong volume supports a break; thin volume warns it may fail.',
        'Near-average or missing volume is inconclusive — those rounds skip the wager.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 88, direction: 'up', title: 'Volume Verdict Live', score: 180, streak: 2, round: '2/3', showVolume: true }),
      async onRound(g, { rng, stage, difficulty, style }) {
        // Real rounds are graded on the volume the player is asked to read, not on what price did
        // next (the scanner's breakout / fakeout rules ignore volume). A few charts are drawn to
        // find a clear read (≥ 1.2× or < 0.85× its average) on a Confirm or Trap side picked at
        // random; mixed and no-volume rounds remain valid but require an explicit third verdict.
        const wantTrap = rng.chance(0.5);
        let pick = null;
        for (let t = 0; t < 6; t++) {
          const cand = await g.realRound({
            kinds: ['breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'],
            intervals: ['1d', '1w'],
            before: 60,
            after: 14,
          });
          if (!cand) {
            pick = null;
            break;
          }
          const v = breakVolume(cand);
          const clear = v.ratio != null && (v.ratio >= 1.2 || v.ratio < 0.85);
          const score = !clear ? (v.ratio != null ? 1 : 0) : (v.ratio < 0.85) === wantTrap ? 3 : 2;
          if (!pick || score > pick.score) pick = { real: cand, vol: v, score };
          if (score === 3) break;
        }
        const { real = null, vol = null } = pick || {};
        // The search may inspect later candidates; keep the shell's source tied to the chart shown.
        if (real) g.real = real;
        const kind = real?.setup?.kind || '';
        const r = real
          ? {
            candles: real.candles,
            decisionIdx: vol.breakIdx,
            level: real.setup?.meta?.level,
            trap: vol.ratio != null ? vol.ratio < 0.85 : /^fakeout/.test(kind),
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
          height: 240,
          showVolume: true,
          decimals: r.decimals ?? 2,
          question: q,
          ariaLabel: 'Breakout chart with volume. Future hidden.',
        });
        if (Number.isFinite(r.level)) dc.chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        dc.chart.addMarker({ idx: r.decisionIdx, position: r.direction < 0 ? 'below' : 'above', shape: 'dot', color: 'accent' });
        const mixed = r.ratio != null && r.ratio >= 0.85 && r.ratio < 1.2;
        const unavailable = r.ratio == null;
        const verdict = unavailable ? 'missing' : mixed ? 'mixed' : r.trap ? 'trap' : 'confirm';

        // The wager bank lives in the HUD for the whole run (Practice never sees it).
        const wagering = style !== 'practice' && !mixed && !unavailable;
        if (wagering && !g._volumeWager) {
          g._volumeWager = new Wager({ bank: 300, label: 'Credits' });
          g.hudExtra.append(g._volumeWager.el);
        }
        const wager = wagering ? g._volumeWager : null;
        let stake = wager ? STAKES[0] : 0;

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
            explain = `<strong>${r.trap ? 'Trap' : 'Confirmed'}.</strong> The break came on ${r.ratio.toFixed(1)}× its 10-bar average volume (${r.trap ? 'below' : 'above'}-average participation)`
              + (agrees ? ` and ${next}.` : `, yet ${next}: volume tilts the odds, it does not decide them.`);
          }
          if (ok) {
            g.correct(explain);
            if (wager && stake > 0) {
              g.award(stake, { reason: 'conviction', bonus: true });
              wager.stake(stake);
              wager.settle(true);
            }
          } else {
            g.wrong(explain);
            if (wager && stake > 0) {
              wager.stake(stake);
              wager.settle(false);
              wager.add(-stake); // the burn: misses cost the bank
              sfx.wrong();
            }
          }
          dc.reveal();
          verdictFlourish(stage, { ok, title: ok ? 'Volume read' : 'Missed the tape', detail: explain.replace(/<[^>]+>/g, ' '), scoreDelta: ok ? 100 + (wager && stake > 0 ? stake : 0) : 0 });
          g.nextButton();
        };

        if (mixed || unavailable) {
          const quiz = g.ask({
            options: [
              { label: 'Confirm: volume expanded', value: 'confirm' },
              { label: 'Trap warning: volume dried up', value: 'trap' },
              { label: 'Inconclusive / no usable volume', value: verdict },
            ],
            answer: verdict,
            reveal: false,
            explain: unavailable
              ? '<strong>No usable volume.</strong> This chart cannot support a volume verdict; judge the break with price structure instead.'
              : `<strong>Inconclusive.</strong> Breakout volume was ${r.ratio.toFixed(1)}× the ten-bar average, too close to normal to call strong or weak.`,
            onAnswer: (ok) => {
              dc.reveal();
              verdictFlourish(stage, { ok, title: ok ? 'Measured call' : 'Avoid forcing a verdict', scoreDelta: ok ? 100 : 0 });
            },
          });
          dc.wrap.insertBefore(quiz, dc.host);
        } else {
          const chips = wager ? h('div', { class: 'stake-chips', role: 'radiogroup', 'aria-label': 'Stake on this call' },
            h('span', { class: 'arcade-label stake-chips__label' }, 'Stake'),
            STAKES.map((v, i) => h('button', {
              type: 'button',
              class: ['stake-chip', 'mono', i === 0 && 'is-on'],
              role: 'radio',
              'aria-checked': String(i === 0),
              on: { click: (e) => {
                stake = v;
                chips.querySelectorAll('.stake-chip').forEach((c) => {
                  c.classList.toggle('is-on', c === e.currentTarget);
                  c.setAttribute('aria-checked', String(c === e.currentTarget));
                });
                sfx.coin();
              } },
            }, String(v)))) : null;
          const card = swipeCard({
            title: 'Volume call',
            body: wager ? 'Pick your stake, then make the call.' : 'Strong participation = Confirm. Thin poke = Trap.',
            takeLabel: 'Confirm',
            skipLabel: 'Trap',
            takeClass: 'btn--bull',
            skipClass: 'btn--bear',
            onTake: () => finish(false),
            onSkip: () => finish(true),
          });
          if (chips) dc.wrap.insertBefore(chips, dc.host);
          dc.wrap.insertBefore(card, dc.host);
        }
        g.setHint('Compare the breakout candle’s volume with the ten bars before it. Near-average or missing data calls for restraint.');
        return () => dc.destroy();
      },
    });
    return () => game.destroy();
  },
};
