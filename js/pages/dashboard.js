// Dashboard (#dashboard): curriculum map, games, progress summary and feature CTAs.
import { h, icon, starRow, meter, tierChip, fmt } from '../core/ui.js';
import {
  TIERS, LESSONS, GAMES, BADGES, unitsOf, findEntry, hashFor,
} from '../registry.js';

function progressSummary(store) {
  const lv = store.level();
  const s = store.state;
  const lessonsDone = LESSONS.filter((l) => s.lessons[l.id]?.done).length;
  const played = GAMES.filter((g) => s.games[g.id]?.plays).length;
  const daily = store.dailyStatus ? store.dailyStatus() : { streak: 0, best: 0 };
  return h('section', { class: 'dash-summary card card--raised', 'aria-labelledby': 'dash-sum-h' },
    h('div', { class: 'dash-summary__main' },
      h('p', { class: 'eyebrow' }, 'Your progress'),
      h('h2', { id: 'dash-sum-h' }, `Level ${lv.number} · ${lv.title}`),
      h('p', { class: 'dash-summary__xp' }, h('span', { class: 'mono' }, fmt(lv.xp)), ' XP',
        lv.next != null ? h('span', { class: 'faint' }, ` · ${fmt(lv.next - lv.xp)} to ${lv.nextTitle}`) : null),
      meter(lv.progress, { size: 'lg', label: 'Progress to next level' })),
    h('ul', { class: 'dash-summary__stats', 'aria-label': 'Stats' },
      h('li', null, h('strong', { class: 'mono' }, `${lessonsDone}/${LESSONS.length}`), h('span', { class: 'faint' }, 'Lessons')),
      h('li', null, h('strong', { class: 'mono' }, `${played}/${GAMES.length}`), h('span', { class: 'faint' }, 'Games')),
      h('li', null, h('strong', { class: 'mono' }, `${s.badges.length}/${BADGES.length}`), h('span', { class: 'faint' }, 'Badges')),
      h('li', null, h('strong', { class: 'mono' }, String(daily.streak || 0)), h('span', { class: 'faint' }, 'Daily streak')),
      h('li', null, h('strong', { class: 'mono' }, String(s.bestStreak || 0)), h('span', { class: 'faint' }, 'Best run streak')),
    ),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn--primary', href: '#beginner' }, 'Start free unit', icon('arrow-right', { size: 16 })),
      h('a', { class: 'btn btn--ghost', href: '#progress' }, 'Full progress'),
      h('a', { class: 'btn btn--ghost', href: '#account' }, 'Account'),
    ),
  );
}

function topicChips(topics) {
  if (!topics?.length) return null;
  return h('ul', { class: 'dash-chips', 'aria-label': 'Topics' },
    topics.slice(0, 5).map((t) => h('li', { class: 'chip chip--sm chip--outline' }, t)));
}

function unitBlock(unit, store) {
  const lesson = unit.lesson ? findEntry(unit.lesson) : null;
  const games = (unit.games || []).map((id) => findEntry(id)).filter(Boolean);
  const done = lesson && store.isLessonDone(lesson.id);
  return h('article', { class: ['dash-unit', 'card', done && 'is-done'] },
    h('header', { class: 'dash-unit__head' },
      h('h3', { class: 'dash-unit__title' }, unit.title),
      done ? h('span', { class: 'chip chip--bull chip--sm' }, icon('check', { size: 12 }), ' Done') : null),
    lesson ? h('a', {
      class: 'dash-item',
      href: `#${hashFor(lesson.id)}`,
      'aria-label': `${lesson.title}, ${lesson.minutes} minutes${done ? ', completed' : ''}`,
    },
      h('span', { class: 'dash-item__kind faint' }, 'Lesson'),
      h('span', { class: 'dash-item__title' }, lesson.title),
      h('span', { class: 'dash-item__meta mono faint' }, `${lesson.minutes} min`),
      topicChips(lesson.topics),
    ) : null,
    games.length ? h('ul', { class: 'dash-unit__games' },
      games.map((g) => {
        const st = store.gameStats(g.id);
        return h('li', null,
          h('a', {
            class: 'dash-item dash-item--game',
            href: `#${hashFor(g.id)}`,
            'aria-label': `${g.title}${st?.plays ? `, best ${st.best}` : ''}`,
          },
            h('span', { class: 'dash-item__kind faint' }, 'Game'),
            h('span', { class: 'dash-item__title' }, g.title),
            st?.plays
              ? h('span', { class: 'dash-item__score' }, starRow(st.stars || 0, { size: 12 }), h('span', { class: 'mono faint' }, fmt(st.best)))
              : h('span', { class: 'chip chip--sm chip--outline' }, 'Play'),
            g.skills?.length ? topicChips(g.skills) : null,
          ));
      })) : null,
  );
}

function features() {
  const items = [
    { href: '#g.what-next', icon: 'gamepad', title: 'Practice · Arcade · Survival', blurb: 'Every game lets you pick a play style: learn, chase stars, or survive rising difficulty.' },
    { href: '#g.volume-verdict', icon: 'chart', title: 'Textbook vs real market', blurb: 'Clean generated setups to learn the rules; real charts hide the ticker until you answer.' },
    { href: '#playbook', icon: 'flag', title: 'Setup Playbook', blurb: 'Rule-based checklists with entry, stop and target for the patterns you study.' },
    { href: '#live', icon: 'bolt', title: 'Live Market Lab', blurb: 'A live chart with indicator toggles and a plain-English read of structure.' },
  ];
  return h('section', { class: 'dash-features', 'aria-labelledby': 'dash-feat-h' },
    h('h2', { id: 'dash-feat-h' }, 'Feature highlights'),
    h('ul', { class: 'dash-feature-grid' },
      items.map((it) => h('li', null,
        h('a', { class: 'dash-feature card', href: it.href },
          h('span', { class: 'dash-feature__icon', 'aria-hidden': 'true' }, icon(it.icon, { size: 22 })),
          h('strong', null, it.title),
          h('p', { class: 'muted' }, it.blurb),
          h('span', { class: 'dash-feature__go' }, 'Open', icon('arrow-right', { size: 14 })),
        )))));
}

function ctaTracks() {
  return h('section', { class: 'dash-cta card' },
    h('h2', null, 'Pick a track'),
    h('p', { class: 'muted' }, 'Free tier opens Markets & Orders plus Candlestick anatomy. Subscribe for the full Beginner or Advanced curriculum.'),
    h('div', { class: 'dash-cta__row' },
      TIERS.map((t) => h('a', { class: ['btn', t.id === 'beginner' ? 'btn--primary' : 'btn--ghost', 'btn--lg'], href: `#${t.id}` },
        tierChip(t.id), ` ${t.title}: ${t.subtitle}`, icon('arrow-right'))),
      h('a', { class: 'btn btn--ghost', href: '#g.daily-challenge' }, icon('flame', { size: 16 }), 'Daily Challenge'),
    ),
  );
}

export default {
  mount(root, ctx) {
    const { store } = ctx;
    try {
      store.award?.('dashboard-visit', { silent: true });
    } catch { /* badge may not exist yet */ }

    const tiers = TIERS.map((tier) => {
      const units = unitsOf(tier.id);
      return h('section', { class: 'dash-tier', 'aria-labelledby': `dash-tier-${tier.id}` },
        h('header', { class: 'dash-tier__head' },
          h('h2', { id: `dash-tier-${tier.id}` }, tierChip(tier.id), ' ', tier.title),
          h('p', { class: 'muted' }, tier.blurb || tier.subtitle),
          h('a', { class: 'link-btn', href: `#${tier.id}` }, `Open ${tier.title} track`, icon('arrow-right', { size: 14 }))),
        h('div', { class: 'dash-units' }, units.map((u) => unitBlock(u, store))),
      );
    });

    // Games index (all, with skills / best)
    const gamesPanel = h('section', { class: 'dash-games', 'aria-labelledby': 'dash-games-h' },
      h('h2', { id: 'dash-games-h' }, 'All games'),
      h('ul', { class: 'dash-game-grid' },
        GAMES.map((g) => {
          const st = store.gameStats(g.id);
          return h('li', null,
            h('a', { class: 'dash-game card', href: `#${hashFor(g.id)}`, 'aria-label': g.title },
              h('div', { class: 'dash-game__top' },
                tierChip(g.tier, { small: true }),
                h('span', { class: 'chip chip--sm chip--outline' }, g.kind || 'game')),
              h('strong', null, g.title),
              h('p', { class: 'muted dash-game__blurb' }, g.blurb),
              topicChips(g.skills),
              h('div', { class: 'dash-game__foot' },
                st?.plays
                  ? [starRow(st.stars || 0, { size: 14 }), h('span', { class: 'mono faint' }, `Best ${fmt(st.best)}`)]
                  : h('span', { class: 'faint' }, `${g.minutes} min · not played yet`),
              ),
            ));
        })),
    );

    root.append(
      h('div', { class: 'container dashboard' },
        h('header', { class: 'dash-hero' },
          h('p', { class: 'eyebrow' }, 'Dashboard'),
          h('h1', null, 'Your Trade School map'),
          h('p', { class: 'lead' }, 'Lessons by unit, every game with skills and scores, and shortcuts into Practice, the Playbook and the Live Lab.'),
        ),
        progressSummary(store),
        features(),
        ctaTracks(),
        ...tiers,
        gamesPanel,
        h('p', { class: 'faint dash-disclaimer' }, 'Educational simulations only — not financial advice.'),
      ),
    );

    return undefined;
  },
};
