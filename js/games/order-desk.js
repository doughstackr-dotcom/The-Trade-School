// Order Desk — pick fills on a live bid/ask ladder + classic order-type rounds.
import { GameShell, QuestionBank, bankOptions, explainChoice, trackAnswer } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { gameplayPreview, orderLadder, verdictFlourish, sampleCandle } from '../core/game-ui.js';
import { QUESTIONS } from './banks/order-desk-questions.js';

// Re-exported for tests and callers that predate the shared bank module.
export { QUESTIONS };

export default {
  id: 'order-desk',
  mount(root, ctx) {
    const bank = new QuestionBank(QUESTIONS, { id: 'order-desk' });
    let current = null;
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'A client order arrives with the current bid and ask.',
        'Pick the order type, or tap the right rung on the live ladder.',
        'Survival: three lives, and the orders get trickier.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 101, direction: 'up', title: 'Order Desk', score: 540, streak: 4, round: '3/6' }),
      onStart(g, { rng }) {
        bank.reset(rng, g.store);
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry || !current) current = bank.next(difficulty);
        const q = current;
        // Ladder round: market buy → pick the ask; market sell → pick the bid
        if (q.ladder || (difficulty > 0.55 && rng.chance(0.45))) {
          const mid = +(90 + rng.float(0, 40)).toFixed(2);
          const tick = 0.25;
          const want = rng.chance(0.5) ? 'ask' : 'bid';
          stage.append(
            h('p', { class: 'quiz__q' }, want === 'ask'
              ? `Market BUY at mid ${mid.toFixed(2)}. Tap the ask you would lift.`
              : `Market SELL at mid ${mid.toFixed(2)}. Tap the bid you would hit.`),
            h('div', { class: 'row row--sm', style: { marginBottom: '0.5rem' } }, sampleCandle(want === 'ask' ? 'bull' : 'bear', { width: 56, height: 88 })),
          );
          let picked = null;
          const ladder = orderLadder({
            mid, tick, levels: 5 + Math.round(difficulty * 2), seed: rng.int(1, 1e9),
            onPick: (row) => { picked = row; },
          });
          // Bind the rungs with real listeners (orderLadder passes lowercase `onclick`, which h()
          // does not bind); idempotent if its own handler also fires.
          for (const btn of ladder.querySelectorAll('.order-desk__row')) {
            btn.addEventListener('click', () => {
              ladder.querySelectorAll('.is-picked').forEach((n) => n.classList.remove('is-picked'));
              btn.classList.add('is-picked');
              picked = {
                side: btn.classList.contains('order-desk__row--ask') ? 'ask' : 'bid',
                price: parseFloat(btn.querySelector('.order-desk__price')?.textContent || 'NaN'),
              };
            });
          }
          stage.append(ladder);
          g.setHint(want === 'ask' ? 'Market buys take liquidity from sellers: the best (lowest) ask fills first.' : 'Market sells take liquidity from buyers: the best (highest) bid fills first.');
          const explain = want === 'ask'
            ? `<strong>Lift the best ask (${(mid + tick).toFixed(2)}).</strong> Market buys pay the lowest offer first.`
            : `<strong>Hit the best bid (${(mid - tick).toFixed(2)}).</strong> Market sells take the highest bid first.`;
          const confirm = h('button', {
            type: 'button', class: 'btn btn--primary btn--lg',
            onClick: () => {
              if (confirm.disabled) return;
              confirm.disabled = true;
              // A market order fills at the best price on its side first: the lowest ask / highest bid.
              const best = +(want === 'ask' ? mid + tick : mid - tick).toFixed(2);
              const sideOk = !!picked && picked.side === want && Math.abs(picked.price - best) < tick / 2;
              let why = '';
              if (!sideOk && picked) {
                if (picked.side !== want) {
                  why = want === 'ask'
                    ? 'You tapped the BID side: that is where a market SELL fills. A market buy lifts the best (lowest) ask.'
                    : 'You tapped the ASK side: that is where a market BUY fills. A market sell hits the best (highest) bid.';
                } else {
                  why = want === 'ask'
                    ? `Right side, wrong rung: a market buy fills at the BEST ask first, the lowest one (${best.toFixed(2)}). Higher asks only fill once the size at better prices is used up.`
                    : `Right side, wrong rung: a market sell fills at the BEST bid first, the highest one (${best.toFixed(2)}). Lower bids only fill once the size at better prices is used up.`;
                }
              }
              if (sideOk) g.correct(explain);
              else g.wrong(why ? `<span class="game__why">${why}</span><br>${explain}` : explain);
              verdictFlourish(stage, {
                ok: sideOk,
                title: sideOk ? 'Filled' : 'Missed the book',
                detail: picked ? `You tapped ${picked.side.toUpperCase()} ${picked.price.toFixed(2)}.` : 'No rung selected — tap a bid or ask first.',
                scoreDelta: sideOk ? 100 : 0,
              });
              g.nextButton();
            },
          }, 'Confirm fill');
          stage.append(h('div', { class: 'row', style: { marginTop: '0.6rem' } }, confirm));
          return;
        }
        g.ask({
          question: q.q,
          options: bankOptions(q, rng),
          answer: q.a,
          explain: explainChoice(q.explain, q.wrong),
          hint: q.hint,
          onAnswer: (ok) => {
            trackAnswer(g.store, 'order-desk', q.id, ok);
            verdictFlourish(stage, { ok, title: ok ? 'Desk cleared' : 'Recheck the book', detail: q.explain.replace(/<[^>]+>/g, ' ').slice(0, 120) });
          },
        });
      },
    });
    return () => game.destroy();
  },
};
