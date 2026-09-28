// Dashboard hub (#dashboard, aliased as #progress; #beginner / #advanced scroll here):
// 1) Account overview  2) Beginner + Advanced track panels (route + ladder)  3) Progress extras.
// Home keeps the compact curriculum cards that link here.
import { h, icon, starRow, meter, tierChip, fmt, toast } from '../core/ui.js';
import { LEVELS } from '../core/store.js';
import {
  LESSONS, GAMES, BADGES, STYLES, UNITS, stylesOf, hashFor, findEntry,
} from '../registry.js';
import { styleIcon } from '../core/game-kit.js';
import { trackPanels } from '../core/track-panel.js';
import * as access from '../core/access.js';
import { PLANS, FREE_IDS } from '../config.js';

function levelLabel(level) {
  if (level === 'advanced') return 'Advanced';
  if (level === 'beginner') return 'Beginner';
  if (level === 'free') return 'Free';
  return 'Guest';
}

function unitCompletion(store, unit) {
  const parts = [];
  if (unit.lesson) parts.push({ type: 'lesson', id: unit.lesson });
  for (const id of unit.games || []) parts.push({ type: 'game', id });
  let done = 0;
  for (const p of parts) {
    if (p.type === 'lesson') {
      if (store.isLessonDone(p.id)) done += 1;
    } else if ((store.state.games[p.id]?.stars || 0) >= 1) done += 1;
  }
  const total = parts.length || 1;
  return { done, total, pct: done / total };
}

function courseCompletion(store) {
  let done = 0;
  let total = 0;
  for (const u of UNITS) {
    const c = unitCompletion(store, u);
    done += c.done;
    total += c.total;
  }
  return { done, total: total || 1, pct: total ? done / total : 0 };
}

function accountOverview(store, snap) {
  const overall = courseCompletion(store);
  const lv = store.level();
  const beginner = store.tierProgress('beginner');
  const advanced = store.tierProgress('advanced');
  const signedIn = !!snap.user;
  const level = snap.level;
  const enforcing = snap.enforcing;
  const plan = level && PLANS[level];

  let statusLine;
  if (!enforcing) {
    statusLine = 'Local preview — access checks are open on this host.';
  } else if (!signedIn) {
    statusLine = 'Browsing as a guest. Curriculum cards below are visible; open any locked lesson to see the paywall teaser.';
  } else if (level === 'advanced') {
    statusLine = 'Advanced plan active — full curriculum, Library, Playbook and Glossary unlocked.';
  } else if (level === 'beginner') {
    statusLine = 'Beginner plan active — Beginner track unlocked. Upgrade for Advanced plus full tools.';
  } else {
    statusLine = 'Signed in on the free tier. Free unit modules stay open after sign-in; subscribe for the full tracks and tools.';
  }

  return h('section', {
    class: 'card card--raised dash-account',
    'aria-labelledby': 'dash-account-h',
    id: 'dash-account',
  },
    h('div', { class: 'dash-account__head row row--between' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Account'),
        h('h2', { id: 'dash-account-h' }, signedIn ? (snap.user.email || 'Member') : 'Welcome, guest')),
      h('span', { class: ['chip', level === 'advanced' && 'chip--bull', level === 'beginner' && 'chip--accent'] },
        levelLabel(level))),
    h('p', { class: 'muted dash-account__status' }, statusLine),
    h('div', { class: 'dash-account__highlights' },
      h('div', { class: 'dash-account__stat' },
        h('span', { class: 'stat__label' }, 'Course'),
        h('span', { class: 'stat__value mono' }, `${Math.round(overall.pct * 100)}%`),
        h('span', { class: 'faint' }, `${overall.done}/${overall.total} items`)),
      h('div', { class: 'dash-account__stat' },
        h('span', { class: 'stat__label' }, 'Level'),
        h('span', { class: 'stat__value' }, lv.title),
        h('span', { class: 'faint mono' }, `${fmt(lv.xp)} XP`)),
      h('div', { class: 'dash-account__stat' },
        h('span', { class: 'stat__label' }, 'Beginner'),
        h('span', { class: 'stat__value mono' }, `${Math.round((beginner.pct || 0) * 100)}%`),
        meter(beginner.pct || 0, { size: 'sm', label: 'Beginner completion' })),
      h('div', { class: 'dash-account__stat' },
        h('span', { class: 'stat__label' }, 'Advanced'),
        h('span', { class: 'stat__value mono' }, `${Math.round((advanced.pct || 0) * 100)}%`),
        meter(advanced.pct || 0, { size: 'sm', label: 'Advanced completion' })),
    ),
    h('div', { class: 'row dash-account__actions' },
      signedIn
        ? [
          level !== 'advanced'
            ? h('a', { class: 'btn btn--primary', href: '#paywall' },
              icon('lock', { size: 16 }),
              level === 'beginner' ? 'Upgrade to Advanced' : 'View plans')
            : h('a', { class: 'btn btn--ghost', href: '#account' }, 'Manage account'),
          h('a', { class: 'btn btn--ghost', href: '#account' }, 'Account'),
        ]
        : [
          h('a', { class: 'btn btn--primary', href: '#account.signup' }, icon('lock', { size: 16 }), 'Sign in / create account'),
          h('a', { class: 'btn btn--ghost', href: '#paywall' }, 'See plans'),
        ],
      h('a', { class: 'btn btn--ghost', href: '#g.daily-challenge' }, icon('flame', { size: 16 }), 'Daily Challenge'),
    ),
    signedIn && level === 'free'
      ? h('p', { class: 'faint dash-account__free' },
        'Free after sign-in: ',
        FREE_IDS.map((id, i) => {
          const e = findEntry(id);
          if (!e) return null;
          return [i ? ', ' : '', h('a', { href: `#${hashFor(id)}` }, e.title)];
        }))
      : null,
    plan ? h('p', { class: 'faint' }, `${plan.name} · $${plan.price}/mo`) : null,
  );
}

function levelCard(store) {
  const lv = store.level();
  const ladder = h('ol', { class: 'level-ladder' },
    LEVELS.map((L, i) => {
      const state = i < lv.index ? 'is-passed' : i === lv.index ? 'is-current' : '';
      return h('li', { class: ['level-ladder__item', state] },
        h('span', { class: 'level-ladder__dot', 'aria-hidden': 'true' }, i < lv.index ? icon('check', { size: 12 }) : null),
        h('span', { class: 'level-ladder__name' }, h('span', { class: 'mono faint' }, `${i + 1}`), L.title),
        h('span', { class: 'level-ladder__xp mono' }, `${fmt(L.min)} XP`));
    }));
  return h('section', { class: 'level-card card card--raised', 'aria-labelledby': 'lvl-h' },
    h('div', { class: 'level-card__main' },
      h('p', { class: 'eyebrow' }, `Level ${lv.number} of ${LEVELS.length}`),
      h('h2', { id: 'lvl-h', class: 'level-card__title' }, lv.title),
      h('p', { class: 'level-card__xp' }, h('span', { class: 'mono' }, fmt(lv.xp)), h('span', { class: 'faint' }, ' XP total')),
      meter(lv.progress, { size: 'lg', label: 'Progress to next level' }),
      h('p', { class: 'muted level-card__next' },
        lv.next != null
          ? [h('strong', { class: 'mono' }, fmt(lv.next - lv.xp)), ` XP to `, h('strong', null, lv.nextTitle)]
          : 'Top level reached. The market still has lessons — keep your streaks alive.'),
      h('p', { class: 'faint level-card__how' }, 'Earn XP by finishing lessons (+50 the first time) and games (up to 90 per run, based on your score and stars).')),
    h('div', { class: 'level-card__ladder' }, h('p', { class: 'eyebrow' }, 'Level ladder'), ladder));
}

function statsRow(store) {
  const s = store.state;
  const lessonsDone = LESSONS.filter((l) => s.lessons[l.id]?.done).length;
  const played = GAMES.filter((g) => s.games[g.id]?.plays).length;
  const stars = GAMES.reduce((a, g) => a + (s.games[g.id]?.stars || 0), 0);
  const cell = (label, value, sub) => h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), h('span', { class: 'stat__value' }, value), sub ? h('span', { class: 'faint stat__sub' }, sub) : null);
  const daily = store.dailyStatus ? store.dailyStatus() : { streak: 0, best: 0, done: false };
  return h('div', { class: 'stats-row card' },
    cell('Lessons', `${lessonsDone}/${LESSONS.length}`, 'completed'),
    cell('Games', `${played}/${GAMES.length}`, 'played'),
    cell('Stars', `${stars}/${GAMES.length * 3}`, 'collected'),
    cell('Badges', `${s.badges.length}/${BADGES.length}`, 'earned'),
    cell('Best streak', String(s.bestStreak || 0), 'in a row'),
    h('a', { class: ['stat stat--link', daily.done && 'is-done'], href: '#g.daily-challenge' },
      h('span', { class: 'stat__label' }, 'Daily streak'),
      h('span', { class: 'stat__value stat__value--daily' }, icon('flame', { size: 18 }), String(daily.streak || 0)),
      h('span', { class: 'faint stat__sub' }, daily.done ? `done today · best ${daily.best || 0}` : `best ${daily.best || 0} · play today`)));
}

function badgesGrid(store) {
  const earned = new Set(store.state.badges);
  const sorted = [...BADGES].sort((a, b) => Number(earned.has(b.id)) - Number(earned.has(a.id)));
  return h('ul', { class: 'badge-grid' },
    sorted.map((b) => {
      const has = earned.has(b.id);
      const when = store.state.badgeDates?.[b.id];
      return h('li', { class: ['badge-card', has ? 'is-earned' : 'is-locked'] },
        h('span', { class: 'badge-card__icon', 'aria-hidden': 'true' }, icon(has ? b.icon : 'lock', { size: has ? 22 : 18 })),
        h('span', { class: 'badge-card__text' },
          h('strong', null, b.title),
          h('small', null, b.description),
          has && when ? h('small', { class: 'badge-card__date mono' }, new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) : null),
        h('span', { class: 'visually-hidden' }, has ? '(earned)' : '(locked)'));
    }));
}

function styleCell(store, g, style) {
  if (!stylesOf(g).includes(style)) return h('td', { class: 'num mono faint style-col' }, h('span', { 'aria-label': 'Not offered' }, '·'));
  const st = store.styleStats ? store.styleStats(g.id, style) : null;
  if (!st?.plays) return h('td', { class: 'num mono faint style-col' }, '—');
  if (style === 'survival') {
    return h('td', { class: 'num mono style-col', title: `Best score ${fmt(st.best)}` },
      h('span', { class: 'style-best' }, `${st.rounds ?? 0}`, h('small', null, ' rnds')));
  }
  return h('td', { class: 'num mono style-col' }, fmt(st.best));
}

function gamesTable(store) {
  const rows = GAMES.map((g) => {
    const s = store.state.games[g.id];
    return h('tr', null,
      h('th', { scope: 'row' }, h('a', { href: `#g.${g.id}`, class: 'table-link' }, g.title)),
      h('td', { class: 'hide-sm' }, tierChip(g.tier, { small: true })),
      ...STYLES.map((st) => styleCell(store, g, st.id)),
      h('td', null, starRow(s?.stars || 0, { size: 14 })),
      h('td', { class: 'num mono hide-sm' }, s?.plays ? String(s.plays) : '0'),
      h('td', { class: 'cell-action' }, h('a', { class: 'btn btn--sm btn--ghost', href: `#g.${g.id}`, 'aria-label': `Play ${g.title}` }, icon('play', { size: 14 }), h('span', { class: 'hide-sm' }, s?.plays ? 'Again' : 'Play'))));
  });
  return h('div', { class: 'table-scroll card card--flush' },
    h('table', { class: 'data-table games-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Game'),
        h('th', { scope: 'col', class: 'hide-sm' }, 'Track'),
        ...STYLES.map((st) => h('th', { scope: 'col', class: 'num style-col' },
          h('span', { class: 'style-head', title: st.id === 'survival' ? `${st.label}: best rounds survived` : `${st.label}: best score` },
            styleIcon(st.id, { size: 13 }), h('span', { class: 'style-head__label' }, st.label)))),
        h('th', { scope: 'col' }, 'Stars'),
        h('th', { scope: 'col', class: 'num hide-sm' }, 'Plays'),
        h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Action')))),
      h('tbody', null, rows)));
}

function resetZone(store, rerender) {
  const confirmBox = h('div', { class: 'reset__confirm', hidden: true, role: 'alertdialog', 'aria-labelledby': 'reset-q', 'aria-describedby': 'reset-d' });
  const openBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'reset', on: { click: () => {
    confirmBox.hidden = false;
    openBtn.hidden = true;
    confirmBox.querySelector('[data-action="cancel"]').focus();
  } } }, icon('restart'), 'Reset progress…');
  confirmBox.append(
    h('p', { id: 'reset-q' }, h('strong', null, 'Erase all progress on this device?')),
    h('p', { id: 'reset-d', class: 'muted' }, 'XP, levels, badges, lesson completions and best scores will be wiped. Your sound and theme settings stay. This cannot be undone.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn--bear', 'data-action': 'confirm-reset', on: { click: () => {
        store.reset();
        toast('Progress reset. Fresh chart, fresh start.', { type: 'info' });
        rerender();
      } } }, 'Yes, erase everything'),
      h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'cancel', on: { click: () => {
        confirmBox.hidden = true;
        openBtn.hidden = false;
        openBtn.focus();
      } } }, 'Cancel')));
  return h('section', { class: 'reset card', 'aria-labelledby': 'reset-h' },
    h('div', null,
      h('h2', { id: 'reset-h', class: 't-18' }, 'Start over'),
      h('p', { class: 'muted' }, 'Progress is saved in this browser only. Reset it to replay everything from zero.')),
    openBtn,
    confirmBox);
}

function scrollToSection(section) {
  if (!section) return;
  const id = section === 'beginner' || section === 'advanced' ? `dash-${section}` : section;
  const el = document.getElementById(id);
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    el.scrollIntoView();
  }
}

export default {
  id: 'dashboard',
  mount(root, ctx) {
    const { store } = ctx;
    try {
      store.award?.('dashboard-visit', { silent: true });
    } catch { /* badge may not exist yet */ }

    const render = () => {
      const snap = access.getAccess();
      root.replaceChildren(
        h('div', { class: 'container progress-page dashboard-hub' },
          h('header', { class: 'page-head' },
            h('p', { class: 'eyebrow eyebrow--accent' }, 'Dashboard'),
            h('h1', null, 'Your school hub'),
            h('p', { class: 'lead' },
              'Account status, the full Beginner and Advanced tracks (route map + unit ladder), and your progress. Locked lessons stay visible as teasers — subscribe to open them.')),
          accountOverview(store, snap),
          h('section', {
            class: 'section tracks dash-curriculum-section',
            'aria-labelledby': 'dash-curr-h',
            id: 'dash-curriculum',
          },
            h('div', { class: 'section-head' },
              h('div', null,
                h('p', { class: 'eyebrow' }, 'The curriculum'),
                h('h2', { id: 'dash-curr-h' }, 'Beginner & Advanced tracks')),
              h('p', { class: 'muted' },
                'Route map and unit ladder for each track. Home still shows the compact card list; locked items open the paywall until you are signed in with the right plan.')),
            trackPanels(store, { idPrefix: 'dash-' })),
          levelCard(store),
          statsRow(store),
          h('section', { class: 'section section--tight', 'aria-labelledby': 'badges-h' },
            h('div', { class: 'section-head' },
              h('div', null, h('p', { class: 'eyebrow' }, `${store.state.badges.length} of ${BADGES.length} earned`), h('h2', { id: 'badges-h' }, 'Badges'))),
            badgesGrid(store)),
          h('section', { class: 'section section--tight', 'aria-labelledby': 'games-h' },
            h('div', { class: 'section-head' },
              h('div', null, h('p', { class: 'eyebrow' }, 'Best runs per style'), h('h2', { id: 'games-h' }, 'Games')),
              h('p', { class: 'muted' }, 'Best score in Practice and Arcade, and the most rounds survived in Survival.')),
            gamesTable(store)),
          resetZone(store, () => {
            render();
            root.querySelector('h1')?.focus?.();
          }),
          h('p', { class: 'faint dash-disclaimer' }, 'Educational simulations only — not financial advice.')));

      const section = ctx.route?.section;
      if (section === 'beginner' || section === 'advanced') {
        try { store.setLastTier?.(section); } catch { /* ignore */ }
      }
      if (section) {
        requestAnimationFrame(() => scrollToSection(section));
      }
    };

    render();
    let queued = 0;
    const onChange = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (root.isConnected && !root.contains(document.activeElement)) render();
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
