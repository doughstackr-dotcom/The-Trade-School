// Shared Beginner / Advanced curriculum cards (Home + Dashboard).
// Cards are always visible; locked units route to the paywall teaser when enforcing.
import { h, icon, starRow, meter, tierChip } from './ui.js';
import { TIERS, unitsOf, findEntry, pathFor } from '../registry.js';
import * as access from './access.js';

function unitStatus(store, unit) {
  const bits = [];
  if (unit.lesson) {
    bits.push(store.isLessonDone(unit.lesson)
      ? h('span', { class: 'unit-row__check', title: 'Lesson complete' }, icon('check', { size: 14, label: 'Lesson complete' }))
      : h('span', { class: 'unit-row__check is-empty', title: 'Lesson not done', 'aria-label': 'Lesson not done' }));
  }
  const best = Math.max(0, ...unit.games.map((g) => store.gameStats(g)?.stars || 0));
  bits.push(starRow(best, { size: 13 }));
  return h('span', { class: 'unit-row__status' }, bits);
}

/** True when the current session may launch this lesson/game (respects FREE_IDS + plans). */
export function canLaunch(entry) {
  if (!entry) return false;
  if (!access.isEnforcing()) return true;
  return access.canOpen(entry, { kind: entry.type, id: entry.id });
}

function unitTarget(unit) {
  if (unit.lesson) {
    const e = findEntry(unit.lesson);
    if (e) return e;
  }
  for (const id of unit.games || []) {
    const e = findEntry(id);
    if (e) return e;
  }
  return null;
}

/**
 * One tier's curriculum card (matches Home's track cards).
 * @param {{ cta?: 'dashboard' | 'section' | false, sectionId?: string }} [opts]
 */
export function trackCard(store, tier, opts = {}) {
  const p = store.tierProgress(tier.id);
  const units = unitsOf(tier.id);
  const cta = opts.cta === undefined ? 'dashboard' : opts.cta;
  let ctaNode = null;
  if (cta === 'dashboard') {
    ctaNode = h('a', { class: 'btn track-card__cta', href: `/${tier.id}` },
      `Open ${tier.title} on Dashboard`, icon('arrow-right'));
  } else if (cta === 'section') {
    ctaNode = h('a', { class: 'btn track-card__cta', href: `/${tier.id}` },
      `Jump to ${tier.title}`, icon('arrow-right'));
  }

  return h('article', {
    class: `track-card track-card--${tier.id}`,
    id: opts.sectionId || undefined,
  },
    h('header', { class: 'track-card__head' },
      h('div', { class: 'row row--between' },
        tierChip(tier.id),
        h('span', { class: 'track-card__count mono' }, `${p.done}/${p.total}`)),
      h('h3', { class: 'track-card__title' }, tier.title, h('span', { class: 'track-card__sub' }, ` — ${tier.subtitle}`)),
      h('p', { class: 'muted track-card__blurb' }, tier.blurb),
      meter(p.pct, { label: `${tier.title} track progress` })),
    h('ol', { class: 'track-card__units' },
      units.map((u, i) => {
        const target = unitTarget(u);
        const open = target ? canLaunch(target) : false;
        const href = target ? pathFor(target.id) : '/paywall';
        const lockNeed = target ? access.lockLabel(target) : 'Paid plan';
        return h('li', null,
          h('a', {
            class: ['unit-row', !open && 'is-locked'],
            href,
            'aria-label': open
              ? u.title
              : `${u.title} (locked — ${lockNeed || 'sign in'})`,
            title: open ? u.title : `Locked — ${lockNeed || 'sign in or subscribe to open'}`,
          },
            h('span', { class: 'unit-row__n mono' }, String(i + 1).padStart(2, '0')),
            h('span', { class: 'unit-row__title' }, u.title),
            open
              ? unitStatus(store, u)
              : h('span', { class: 'unit-row__status unit-row__lock' },
                icon('lock', { size: 14 }),
                h('span', { class: 'faint' }, lockNeed || 'Members'))));
      })),
    ctaNode);
}

/**
 * Beginner + Advanced curriculum grid (same markup Home uses).
 * @param {{ cta?: 'dashboard' | 'section' | false, idPrefix?: string }} [opts]
 */
export function curriculumTracks(store, opts = {}) {
  const prefix = opts.idPrefix || '';
  return h('div', { class: 'tracks__grid' },
    TIERS.map((t) => trackCard(store, t, {
      cta: opts.cta,
      sectionId: prefix ? `${prefix}${t.id}` : undefined,
    })));
}

/**
 * Full curriculum section with heading — used on Dashboard (and optionally Home).
 */
export function curriculumSection(store, {
  cta = 'section',
  idPrefix = 'dash-',
  eyebrow = 'The curriculum',
  title = 'Beginner & Advanced lessons',
  blurb = 'Same tracks as Home. Cards are always visible; locked lessons open the paywall until you sign in and subscribe.',
  headingId = 'curriculum-h',
} = {}) {
  return h('section', {
    class: 'container section tracks',
    'aria-labelledby': headingId,
  },
    h('div', { class: 'section-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, eyebrow),
        h('h2', { id: headingId }, title)),
      h('p', { class: 'muted' }, blurb)),
    curriculumTracks(store, { cta, idPrefix }));
}

export default { trackCard, curriculumTracks, curriculumSection, canLaunch };
