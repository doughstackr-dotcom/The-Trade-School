// Games arcade (#games) — all skill games in one hub.
// Paid-gated page with teasers; exactly one FREE_IDS game stays playable for free members.
import { h, icon, tierChip, starRow, fmt } from '../core/ui.js';
import {
  GAMES, STYLES, findKind, findStyle, stylesOf, hashFor, findEntry,
} from '../registry.js';
import { FREE_IDS, PLANS } from '../config.js';
import * as access from '../core/access.js';
import { styleIcon } from '../core/game-kit.js';

const FREE_GAME_ID = FREE_IDS.find((id) => findEntry(id)?.type === 'game') || 'daily-challenge';

function kindLabel(g) {
  return findKind(g.kind)?.label || g.kind || 'Play';
}

function isFreeGame(g) {
  return g.id === FREE_GAME_ID || FREE_IDS.includes(g.id);
}

function gameOpen(g) {
  if (!access.isEnforcing()) return true;
  return access.canOpen(g, { kind: 'game', id: g.id });
}

function gameCard(store, g, { paidHub }) {
  const free = isFreeGame(g);
  const open = gameOpen(g);
  const stats = store.gameStats?.(g.id) || store.state.games[g.id] || null;
  const stars = stats?.stars || 0;
  const plays = stats?.plays || 0;
  const locked = paidHub && !free && !open;
  const href = locked
    ? (access.getAccess().user ? '#paywall' : '#account.signup')
    : `#${hashFor(g.id)}`;

  const styleIcons = stylesOf(g).map((id) => {
    const st = findStyle(id);
    return h('span', {
      class: `style-icons__i style-icons__i--${id}`,
      title: st?.label || id,
      'aria-hidden': 'true',
    }, styleIcon(id, { size: 12 }));
  });

  return h('a', {
    class: [
      'games-hub-card', 'card', 'card--link',
      free && 'games-hub-card--free',
      locked && 'games-hub-card--locked',
    ],
    href,
    'aria-label': locked
      ? `${g.title} (locked — subscribe to play)`
      : `${g.title}${free ? ' — free to play' : ''}`,
  },
    h('div', { class: 'games-hub-card__top row row--sm' },
      free
        ? h('span', { class: 'chip chip--sm chip--accent' }, icon('spark', { size: 12 }), 'Free')
        : null,
      tierChip(g.tier, { small: true }),
      h('span', { class: 'chip chip--sm chip--outline' }, kindLabel(g)),
      h('span', { class: 'chip chip--sm chip--outline mono' }, `${g.minutes} min`)),
    h('h2', { class: 'games-hub-card__title' }, g.title),
    h('p', { class: 'games-hub-card__blurb muted' }, g.blurb),
    h('div', { class: 'games-hub-card__meta row row--sm' },
      h('span', { class: 'style-icons', 'aria-label': 'Play styles' }, styleIcons),
      plays
        ? h('span', { class: 'games-hub-card__score' }, starRow(stars, { size: 14 }), h('small', { class: 'mono faint' }, `${fmt(stats.best || 0)}`))
        : h('span', { class: 'faint' }, 'Not played yet')),
    h('span', { class: 'games-hub-card__go' },
      locked
        ? [icon('lock', { size: 16 }), ' Unlock with a plan']
        : [free && !access.hasPaidAccess() && access.isEnforcing() ? 'Play free' : (plays ? 'Play again' : 'Play'), icon('arrow-right', { size: 16 })]));
}

export default {
  id: 'games',
  mount(root, ctx) {
    const { store } = ctx;
    const freeEntry = findEntry(FREE_GAME_ID);
    const enforcing = access.isEnforcing();
    const paid = access.hasPaidAccess();
    const paidHub = enforcing && !paid;
    const snap = access.getAccess();
    const price = PLANS.beginner?.price ?? 19.99;

    const banner = paidHub
      ? h('section', {
        class: 'teaser-banner card card--raised',
        role: 'region',
        'aria-label': 'Games preview — one free game, rest with a plan',
      },
        h('div', { class: 'teaser-banner__copy' },
          h('p', { class: 'eyebrow' }, 'Games'),
          h('h2', { class: 'teaser-banner__title' }, 'One free game · the arcade unlocks with a plan'),
          h('p', { class: 'muted' },
            freeEntry
              ? [
                h('strong', null, freeEntry.title),
                ' is free for signed-in members. Every other game needs Beginner ($',
                String(price),
                '/mo) or Advanced.',
              ]
              : `Subscribe to unlock the full arcade (Beginner $${price}/mo or Advanced).`)),
        h('div', { class: 'teaser-banner__actions row' },
          snap.user
            ? h('a', { class: 'btn btn--primary', href: '#paywall' }, icon('lock', { size: 16 }), 'View plans')
            : h('a', { class: 'btn btn--primary', href: '#account.signup' }, icon('lock', { size: 16 }), 'Sign in to play free'),
          h('a', { class: 'btn btn--ghost', href: '#dashboard' }, 'Dashboard'),
          freeEntry
            ? h('a', { class: 'btn btn--ghost', href: `#${hashFor(FREE_GAME_ID)}` }, icon('flame', { size: 16 }), `Open ${freeEntry.title}`)
            : null))
      : null;

    const freeFirst = [...GAMES].sort((a, b) => {
      const af = isFreeGame(a) ? 0 : 1;
      const bf = isFreeGame(b) ? 0 : 1;
      return af - bf || a.title.localeCompare(b.title);
    });

    const grid = h('div', {
      class: 'games-hub__grid',
      role: 'list',
      'aria-label': 'All games',
    }, freeFirst.map((g) => h('div', { role: 'listitem' }, gameCard(store, g, { paidHub }))));

    root.replaceChildren(
      h('div', { class: 'container games-hub' },
        h('header', { class: 'page-head' },
          h('p', { class: 'eyebrow eyebrow--accent' }, 'Arcade'),
          h('h1', null, 'Games'),
          h('p', { class: 'lead' },
            paidHub
              ? 'Browse every skill game. Play the free Daily Challenge; unlock the rest with a membership.'
              : 'Practice, Arcade and Survival across the curriculum — pick a game and play.')),
        banner,
        h('section', { class: 'section', 'aria-labelledby': 'games-hub-h' },
          h('div', { class: 'section-head' },
            h('div', null,
              h('p', { class: 'eyebrow' }, `${GAMES.length} games`),
              h('h2', { id: 'games-hub-h' }, paidHub ? 'Free + locked arcade' : 'All games')),
            h('p', { class: 'muted' },
              'Styles: ',
              STYLES.map((s, i) => [i ? ' · ' : '', s.label]))),
          grid),
        h('p', { class: 'faint games-hub__disclaimer' },
          'Educational simulations only — not financial advice.')));

    return () => {};
  },
};
