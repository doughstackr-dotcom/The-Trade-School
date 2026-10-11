// Ranks (#ranks): opt-in leaderboards + the weekly event cabinet.
// Boards are strictly opt-in (handle, never email); offline or opted-out visitors see
// the weekly event plus their own personal bests, and the enable flow.
import { h, icon, starRow, fmt, toast, sfx } from '../core/ui.js';
import { GAMES, findEntry, hashFor } from '../registry.js';
import * as access from '../core/access.js';
import { fetchBoard, setCompetitive, competitiveOn, weeklyEventGame, isoWeek } from '../core/leaderboard.js';

function enablePanel(store, rerender) {
  const input = h('input', {
    class: 'mono ranks-handle-input',
    type: 'text',
    maxlength: 24,
    autocomplete: 'off',
    placeholder: 'your handle',
    'aria-label': 'Leaderboard handle',
    value: store.getSetting('handle') || '',
  });
  const status = h('p', { class: 'muted ranks-enable__note', 'aria-live': 'polite' },
    'Pick the name the boards will show. Your email is never displayed.');
  const btn = h('button', {
    type: 'button',
    class: 'btn btn--primary btn--arcade',
    on: { click: async () => {
      btn.disabled = true;
      const res = await setCompetitive(store, true, input.value);
      btn.disabled = false;
      if (res.ok) {
        sfx.coin();
        toast('Competitive mode on. Finish a run to plant your flag.', { type: 'badge' });
        rerender();
      } else {
        sfx.wrong();
        status.textContent = res.error || 'Could not enable — try again.';
      }
    } },
  }, 'Enable Competitive mode');
  return h('section', { class: 'card ranks-enable', 'aria-labelledby': 'ranks-enable-h' },
    h('h2', { id: 'ranks-enable-h', class: 't-22' }, 'Join the boards'),
    h('p', { class: 'muted' },
      'Leaderboards are opt-in. Enable Competitive mode to submit your best runs (', icon('flame', { size: 14 }), ' badges and XP never depend on it). You can switch it off any time.'),
    h('div', { class: 'row ranks-enable__row' }, input, btn),
    status);
}

function boardRow(row, rank) {
  return h('li', { class: ['board-row', row.you && 'is-you'] },
    h('span', { class: 'board-row__rank mono' }, String(rank)),
    h('span', { class: 'board-row__handle' }, row.handle, row.you ? h('span', { class: 'chip chip--sm chip--accent board-row__you' }, 'You') : null),
    h('span', { class: 'board-row__stars' }, starRow(row.stars || 0, { size: 11, label: false })),
    h('span', { class: 'board-row__score mono' }, fmt(row.score)));
}

export default {
  id: 'ranks',
  mount(root, ctx) {
    const { store } = ctx;
    const event = weeklyEventGame();
    const eventEntry = findEntry(event);

    const render = () => {
      const snap = access.getAccess();
      const on = competitiveOn(store);
      const boardHost = h('div', { class: 'board', 'aria-live': 'polite' });
      const gameSel = h('select', {
        class: 'ranks-game-select',
        'aria-label': 'Choose a game board',
        on: { change: () => drawBoard() },
      }, GAMES.map((g) => h('option', { value: g.id, selected: g.id === event ? 'selected' : null }, g.title)));

      async function drawBoard() {
        const scope = scopeSel.value;
        boardHost.replaceChildren(h('p', { class: 'faint' }, 'Pulling the board…'));
        const data = await fetchBoard({ game: gameSel.value, style: 'arcade', scope });
        if (!data || !data.rows?.length) {
          boardHost.replaceChildren(h('p', { class: 'faint board-empty' },
            on ? 'No scores here yet — finish a run to plant the first flag.'
              : 'Nobody has planted a flag here yet. Enable Competitive mode to be first.'));
          return;
        }
        boardHost.replaceChildren(h('ol', { class: 'board-rows' }, data.rows.map((r, i) => boardRow(r, r.rank ?? i + 1))));
      }

      const scopeSel = h('select', { class: 'ranks-scope-select', 'aria-label': 'Board scope', on: { change: () => drawBoard() } },
        h('option', { value: 'all' }, 'All-time'),
        h('option', { value: 'week', selected: 'selected' }, 'This week'));

      // Personal bests: always visible, signed in or not.
      const bests = GAMES.map((g) => ({ g, s: store.styleStats?.(g.id, 'arcade') || store.state.games[g.id] }))
        .filter(({ s }) => s?.best > 0)
        .sort((a, b) => (b.s.best ?? 0) - (a.s.best ?? 0))
        .slice(0, 5);

      root.replaceChildren(
        h('div', { class: 'container ranks-page' },
          h('header', { class: 'page-head' },
            h('p', { class: 'eyebrow eyebrow--accent' }, 'Ranks'),
            h('h1', { class: 'neon-title neon-title--arcade' }, 'The boards'),
            h('p', { class: 'lead' },
              'Weekly and all-time bests for every game. Opt-in only: boards show handles, never emails, and nothing submits until you say so.')),
          eventEntry ? h('section', { class: 'card neon-frame--arcade ranks-event', 'aria-labelledby': 'ranks-event-h' },
            h('div', null,
              h('p', { class: 'eyebrow' }, `Week ${isoWeek()} event · resets Monday 00:00 UTC`),
              h('h2', { id: 'ranks-event-h', class: 't-22 ranks-event__title' }, `${eventEntry.title} marathon`),
              h('p', { class: 'muted' }, 'One game, one week, one board. The week’s best run takes the crown until the reset.')),
            h('a', { class: 'btn btn--primary btn--arcade', href: `#${hashFor(eventEntry.id)}` },
              icon('play', { size: 16 }), `Play ${eventEntry.title}`)) : null,
          on ? h('section', { class: 'card ranks-live', 'aria-label': 'Your competitive status' },
            h('div', { class: 'row row--between' },
              h('div', null,
                h('p', { class: 'arcade-label' }, 'Competitive mode'),
                h('p', null, h('strong', { class: 'font-arcade ranks-live__handle' }, store.getSetting('handle') || snap.user?.email?.split('@')[0] || 'trader'))),
              h('button', {
                type: 'button',
                class: 'btn btn--sm',
                on: { click: async () => {
                  await setCompetitive(store, false);
                  toast('Competitive mode off. Your planted flags stay on the boards.', { type: 'info' });
                  rerender();
                } },
              }, 'Turn off'))) : enablePanel(store, () => rerender()),
          h('section', { class: 'ranks-board-section', 'aria-labelledby': 'ranks-board-h' },
            h('div', { class: 'section-head' },
              h('div', null, h('p', { class: 'eyebrow' }, 'Arcade bests'), h('h2', { id: 'ranks-board-h' }, 'Boards')),
              h('div', { class: 'row ranks-controls' }, gameSel, scopeSel)),
            boardHost),
          bests.length ? h('section', { class: 'section section--tight', 'aria-labelledby': 'ranks-mine-h' },
            h('div', { class: 'section-head' },
              h('div', null, h('p', { class: 'eyebrow' }, 'On this device'), h('h2', { id: 'ranks-mine-h' }, 'Your bests'))),
            h('ol', { class: 'board-rows board-rows--mine' }, bests.map(({ g, s }, i) => boardRow({
              handle: g.title,
              score: s.best,
              stars: s.stars || 0,
              you: true,
            }, i + 1)))) : null,
          h('p', { class: 'faint ranks-footnote' }, 'Educational simulations only — not financial advice.')));
      drawBoard();
    };

    const rerender = () => render();
    render();
    let queued = 0;
    const onChange = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (root.isConnected) render();
      });
    };
    store.on('change', onChange);
    const unsubAccess = access.onChange(() => onChange());
    access.ready.then(() => onChange()).catch(() => {});
    return () => {
      store.off('change', onChange);
      unsubAccess?.();
      if (queued) cancelAnimationFrame(queued);
    };
  },
};
