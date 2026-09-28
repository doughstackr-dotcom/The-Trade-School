// Games arcade (#games) — same tile grid as the home arcade, with paywall teasers.
// Paid-gated page; exactly one FREE_IDS game stays playable for free members.
import { h, icon } from '../core/ui.js';
import {
  GAMES, STYLES, findEntry, hashFor, ARCADE_FILTERS,
} from '../registry.js';
import { FREE_IDS, PLANS } from '../config.js';
import * as access from '../core/access.js';
import { arcadeTile, gamePreview } from './home.js';

const FREE_GAME_ID = FREE_IDS.find((id) => findEntry(id)?.type === 'game') || 'daily-challenge';
const FEATURE = 'trade-simulator';

function isFreeGame(g) {
  return g.id === FREE_GAME_ID || FREE_IDS.includes(g.id);
}

function gameOpen(g) {
  if (!access.isEnforcing()) return true;
  return access.canOpen(g, { kind: 'game', id: g.id });
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

    // Same ordering as home: feature tile last so it never strands a lone card.
    const ordered = [
      ...GAMES.filter((g) => g.id !== FEATURE),
      ...GAMES.filter((g) => g.id === FEATURE),
    ];

    const arcadeGrid = h('div', {
      class: 'arcade__grid',
      id: 'games-hub-grid',
      role: 'list',
      'aria-label': 'All games',
    });
    const emptyNote = h('p', { class: 'faint arcade__empty', hidden: true }, 'No games of this kind yet.');
    const filterBtns = [];
    const counts = Object.fromEntries(
      ARCADE_FILTERS.map((f) => [f.id, f.kinds ? GAMES.filter((g) => f.kinds.includes(g.kind)).length : GAMES.length]),
    );
    const filterRow = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter games by kind' },
      ARCADE_FILTERS.filter((f) => counts[f.id] > 0).map((f) => {
        const b = h('button', {
          type: 'button', class: 'filter-chip', 'aria-pressed': String(f.id === 'all'),
          'aria-controls': 'games-hub-grid', 'data-filter': f.id,
          on: { click: () => applyFilter(f.id) },
        }, h('span', null, f.label), h('span', { class: 'filter-chip__n mono' }, String(counts[f.id])));
        filterBtns.push(b);
        return b;
      }));

    const tiles = [];
    const arts = [];
    for (const g of ordered) {
      const free = isFreeGame(g);
      const open = gameOpen(g);
      const locked = paidHub && !free && !open;
      const href = locked
        ? (access.getAccess().user ? '#paywall' : '#account.signup')
        : `#${hashFor(g.id)}`;
      const { tile, art } = arcadeTile(store, g, {
        feature: g.id === FEATURE,
        locked,
        free: paidHub && free,
        href,
      });
      tile.setAttribute('role', 'listitem');
      arcadeGrid.append(tile);
      tiles.push(tile);
      arts.push(art);
    }

    function applyFilter(id) {
      const f = ARCADE_FILTERS.find((x) => x.id === id) || ARCADE_FILTERS[0];
      filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f.id)));
      let shown = 0;
      for (const t of tiles) {
        const on = !f.kinds || f.kinds.includes(t.dataset.kind);
        t.hidden = !on;
        if (on) shown++;
      }
      arcadeGrid.dataset.filter = f.id;
      emptyNote.hidden = shown > 0;
    }

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
        h('section', { class: 'section arcade', 'aria-labelledby': 'games-hub-h' },
          h('div', { class: 'section-head' },
            h('div', null,
              h('p', { class: 'eyebrow' }, `${GAMES.length} games`),
              h('h2', { id: 'games-hub-h' }, paidHub ? 'Free + locked arcade' : 'All games')),
            h('p', { class: 'muted' },
              'Styles: ',
              STYLES.map((s, i) => [i ? ' · ' : '', s.label]))),
          filterRow,
          arcadeGrid,
          emptyNote),
        h('p', { class: 'faint games-hub__disclaimer' },
          'Educational simulations only — not financial advice.')));

    let dead = false;
    Promise.allSettled([import('../core/chart.js'), import('../core/patterns.js')]).then(([chartRes, patRes]) => {
      if (dead) return;
      const chartMod = chartRes.status === 'fulfilled' ? chartRes.value : null;
      const pat = patRes.status === 'fulfilled' ? patRes.value : null;
      if (!chartMod) {
        console.error('[games] chart engine failed to load:', chartRes.reason);
        return;
      }
      let compact = false;
      try {
        compact = matchMedia('(max-width: 559.98px)').matches;
      } catch {
        /* old browsers */
      }
      ordered.forEach((g, i) => {
        try {
          const size = g.id === FEATURE
            ? { width: 640, height: 220 }
            : compact ? { width: 150, height: 140 } : undefined;
          arts[i].append(gamePreview(g.id, 1000 + i * 7919, chartMod, pat, size));
        } catch (err) {
          console.error(`[games] preview for ${g.id} failed:`, err);
        }
      });
    });

    return () => { dead = true; };
  },
};
