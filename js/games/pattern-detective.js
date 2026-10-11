// Case Files (v2 of Pattern Detective) — every chart is a case; work it before you call it.
// Practice keeps the classic study quiz. Arcade and Survival open a CASE FILE: three sealed
// clues are on the table and each one you open costs 10 points of the round's payout —
// the family, the tape and the boundary. Late rounds are BOSS CASES (H&S lookalikes).
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { CHART_PATTERNS, chartScenario } from '../core/patterns.js';

const EASY = ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'];
// Scanner-detectable chart kinds only (js/core/scanner.js SETUP_KINDS) — the pool is also
// the distractor source, so every id here must exist in SETUP_KINDS.
const HARD = ['head-and-shoulders', 'inverse-head-and-shoulders'];
const TEXTBOOK = ['ascending-triangle', 'descending-triangle', 'rising-wedge', 'falling-wedge', 'triple-top', 'triple-bottom', 'bull-pennant', 'bear-pennant'];

const FAMILY = {
  reversal: ['double-top', 'double-bottom', 'head-and-shoulders', 'inverse-head-and-shoulders', 'triple-top', 'triple-bottom'],
  continuation: ['bull-flag', 'bear-flag', 'bull-pennant', 'bear-pennant'],
  bilateral: ['ascending-triangle', 'descending-triangle', 'rising-wedge', 'falling-wedge'],
};

function nameOf(kind) {
  return CHART_PATTERNS[kind]?.name || kind.replace(/-/g, ' ');
}

function familyOf(kind) {
  for (const [fam, ids] of Object.entries(FAMILY)) if (ids.includes(kind)) return fam;
  return 'chart';
}

/** Honest clues read from the visible candles — never the answer itself. */
function buildClues(r, kind, decimals = 2) {
  const vis = r.candles.slice(0, r.decisionIdx + 1);
  const withVol = vis.filter((c) => Number.isFinite(c.v) && c.v > 0).length > vis.length * 0.6;
  let tape = 'Volume data is thin on this chart — judge price structure alone.';
  if (withVol) {
    const recent = vis.slice(-8).reduce((s, c) => s + (c.v || 0), 0) / 8;
    const prior = vis.slice(-28, -8).reduce((s, c) => s + (c.v || 0), 0) / Math.max(1, vis.slice(-28, -8).length);
    tape = recent > prior * 1.25
      ? 'The tape: participation is EXPANDING into the freeze — buyers or sellers are committing.'
      : recent < prior * 0.8
        ? 'The tape: participation is DRYING UP into the freeze — the push is running on fumes.'
        : 'The tape: volume is unremarkable into the freeze — no conviction clue here.';
  }
  const win = vis.slice(-24);
  const hi = Math.max(...win.map((c) => c.h));
  const lo = Math.min(...win.map((c) => c.l));
  const pos = (vis[vis.length - 1].c - lo) / Math.max(1e-9, hi - lo);
  const boundary = pos > 0.78
    ? `The boundary: price is pressing the CEILING of the recent zone (${hi.toFixed(decimals)}).`
    : pos < 0.22
      ? `The boundary: price is pressing the FLOOR of the recent zone (${lo.toFixed(decimals)}).`
      : 'The boundary: price sits mid-zone — the edges, not the middle, decide this case.';
  const fam = familyOf(kind);
  const file = `The file: this suspect belongs to the ${fam} family.`;
  return [
    { title: 'The tape', text: tape },
    { title: 'The boundary', text: boundary },
    { title: 'The file', text: file },
  ];
}

export default {
  id: 'pattern-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 91, direction: 'up', title: 'Case Files', score: 200, streak: 2, round: '2/3' }),
      rounds: 7,
      timer: { seconds: 32, perRound: true },
      howTo: [
        'A classic chart pattern is forming into the freeze — your case.',
        'Arcade: three sealed clues sit on the table. Each one you open costs 10 points; work the case cheap if you can.',
        'Name the pattern to close the case. Boss cases bring the H&S lookalikes.',
      ],
      async onRound(g, { rng, stage, difficulty, style }) {
        const scannerPool = difficulty < 0.3 ? EASY : [...EASY, ...HARD];
        const pool = difficulty < 0.45 ? scannerPool : [...scannerPool, ...TEXTBOOK.slice(0, difficulty < 0.7 ? 4 : TEXTBOOK.length)];
        const q = { kinds: scannerPool, before: Math.round(80 - 20 * difficulty), after: 20 };
        const real = await g.realRound(q);
        let r = real;
        if (!r && g.source !== 'real' && difficulty >= 0.45 && rng.chance(0.6)) {
          const id = rng.pick(pool.filter((k) => TEXTBOOK.includes(k)));
          const sc = chartScenario(id, { seed: rng.int(1, 1e9), count: Math.round(100 - 12 * difficulty), after: 20 });
          r = { candles: sc.candles, decisionIdx: sc.breakoutIdx, setup: { kind: id }, pattern: sc };
        }
        // The scanner is stochastic; retry its detectable kinds before skipping a round.
        for (let i = 0; !r && i < 7; i++) r = simRound(rng, q);
        if (!r) throw new Error('simRound found no setup after retries');
        const kind = r.setup?.kind || rng.pick(pool);
        const boss = style !== 'practice' && difficulty >= 0.6;
        const host = h('div', { class: 'chart-frame' });
        stage.append(
          h('div', { class: 'case-head' },
            h('span', { class: ['chip', 'chip--sm', boss ? 'chip--bear case-head__boss' : 'chip--accent'] }, boss ? 'Boss case' : 'Case open'),
            h('span', { class: 'arcade-label' }, `Case #${g.round} · name the pattern`)),
          h('p', { class: 'quiz__q' }, 'Which pattern formed before the latest break?'),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 255, showVolume: difficulty < 0.55, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart pattern mystery; breakout future hidden',
        });

        // The clue table: sealed chips, each opened one costs 10 points of the payout.
        let opened = 0;
        if (style !== 'practice') {
          const clues = buildClues(r, kind, r.decimals ?? 2);
          const clueList = h('ul', { class: 'clue-reveals', 'aria-live': 'polite' });
          const openClue = (i, btn) => {
            if (btn.classList.contains('is-open')) return;
            btn.classList.add('is-open');
            btn.setAttribute('aria-pressed', 'true');
            opened += 1;
            sfx.click();
            const row = h('li', { class: 'clue-reveal' },
              h('span', { class: 'clue-reveal__title arcade-label' }, clues[i].title),
              h('span', { class: 'clue-reveal__text' }, clues[i].text));
            clueList.append(row);
          };
          const clueHost = h('div', { class: 'clue-table' },
            h('span', { class: 'arcade-label clue-table__label' }, 'Evidence — each clue opened costs 10 pts'),
            h('div', { class: 'clue-chips', role: 'group', 'aria-label': 'Sealed clues' },
              clues.map((c, i) => h('button', {
                type: 'button',
                class: 'clue-chip',
                'aria-pressed': 'false',
                on: { click: (e) => openClue(i, e.currentTarget) },
              }, `Clue ${i + 1}: ${c.title}`))),
            clueList);
          stage.insertBefore(clueHost, host);
        }

        const distractors = rng.shuffle(pool.filter((k) => k !== kind)).slice(0, 3);
        g.setHint('Find the pole or the twin swings first, then the boundary that must break.');
        const quiz = g.ask({
          options: rng.shuffle([kind, ...distractors].map((k) => ({ label: nameOf(k), value: k }))),
          answer: kind,
          explain: `<strong>${nameOf(kind)}</strong>. ${r.outcome ? `Sample outcome: ${r.outcome.result || 'n/a'} (${r.outcome.r ?? '?'} ATR).` : 'This is a generated pattern example.'} Measured targets are guidelines.`,
          onAnswer: (ok) => {
            if (ok && opened > 0) g.award(-10 * opened, { reason: opened === 1 ? 'clue used' : `${opened} clues used` });
            chart.reveal({ to: r.candles.length, interval: 35 });
            if (r.pattern) {
              if (Number.isFinite(r.pattern.level)) chart.addHLine({ price: r.pattern.level, color: 'accent', dashed: true, label: 'Break line' });
              for (const p of r.pattern.keyPoints.filter((p) => p.idx <= r.decisionIdx)) chart.addMarker({ idx: p.idx, position: 'above', shape: 'dot', color: 'info', text: p.label });
            } else try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? (boss ? 'Boss case closed' : 'Case closed') : 'Case stays open', scoreDelta: ok ? Math.max(40, 100 - 10 * opened) : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
