// Tier page: header with a rising "route" chart of the units, then a ladder of units,
// each with its lesson and game(s).
import { h, svg, icon, starRow, meter, tierChip, fmt } from '../core/ui.js';
import { TIERS, findEntry, findTier, unitsOf, learningPath, hashFor } from '../registry.js';

const KIND_LABEL = { quiz: 'Quiz', draw: 'Draw', predict: 'Predict', simulation: 'Simulation', calc: 'Calculate' };

function itemDone(store, item) {
  return item.type === 'lesson' ? store.isLessonDone(item.id) : (store.gameStats(item.id)?.stars || 0) >= 1;
}

function unitDone(store, u) {
  return (!u.lesson || store.isLessonDone(u.lesson)) && u.games.every((g) => (store.gameStats(g)?.stars || 0) >= 1);
}

/** Rising zig-zag of swing points (one per unit): lows and highs both climb, like an uptrend. */
function routeChart(units, doneFlags, currentIdx) {
  const n = units.length;
  const W = 520;
  const H = 200;
  const padX = 26;
  const padY = 26;
  const pts = units.map((u, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const base = 0.08 + t * 0.84; // climbing baseline
    const swing = i === n - 1 ? 0.08 : i % 2 === 0 ? -0.07 : 0.07; // alternate lows / highs
    const y = Math.max(0, Math.min(1, base + swing));
    return [padX + t * (W - padX * 2), H - padY - y * (H - padY * 2)];
  });
  const grid = [];
  for (let g = 1; g < 4; g++) {
    const y = padY / 2 + (g * (H - padY)) / 4;
    grid.push(svg('line', { x1: 0, x2: W, y1: y, y2: y, class: 'route__grid' }));
  }
  const segs = [];
  for (let i = 0; i < n - 1; i++) {
    const cls = doneFlags[i] && doneFlags[i + 1] ? 'route__seg is-done' : i + 1 === currentIdx && doneFlags[i] ? 'route__seg is-active' : 'route__seg';
    segs.push(svg('line', { x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], class: cls }));
  }
  const nodes = pts.map(([x, y], i) => {
    const cls = doneFlags[i] ? 'route__node is-done' : i === currentIdx ? 'route__node is-current' : 'route__node';
    return svg('g', { class: cls, transform: `translate(${x} ${y})` },
      i === currentIdx ? svg('circle', { r: 17, class: 'route__pulse' }) : null,
      svg('circle', { r: 12, class: 'route__dot' }),
      svg('text', { y: 4, 'text-anchor': 'middle' }, String(i + 1)));
  });
  const done = doneFlags.filter(Boolean).length;
  return svg('svg', { class: 'route', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Route map: ${done} of ${n} units complete` },
    ...grid, ...segs, ...nodes);
}

/** Vertical zig-zag connector between ladder nodes (a price squiggle turned upright). */
function squiggle(done) {
  const pts = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) pts.push(`${i === 0 || i === steps ? 10 : i % 2 ? 4 : 16},${(i / steps) * 100}`);
  return svg('svg', { class: ['ladder__squiggle', done && 'is-done'], viewBox: '0 0 20 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('polyline', { points: pts.join(' '), 'vector-effect': 'non-scaling-stroke' }));
}

function itemButton(store, type, id) {
  const e = findEntry(id);
  if (!e) return null;
  if (type === 'lesson') {
    const done = store.isLessonDone(id);
    const st = store.getLessonStep(id);
    const started = !done && (st.max || 0) > 0;
    return h('a', { class: ['item-btn', 'item-btn--lesson', done && 'is-done'], href: `#l.${id}` },
      h('span', { class: 'item-btn__icon', 'aria-hidden': 'true' }, icon('book', { size: 20 })),
      h('span', { class: 'item-btn__text' },
        h('span', { class: 'item-btn__kind' }, `Lesson · ${e.minutes} min`),
        h('strong', { class: 'item-btn__title' }, e.title),
        h('span', { class: 'item-btn__blurb' }, e.blurb)),
      h('span', { class: 'item-btn__status' },
        done
          ? h('span', { class: 'chip chip--bull' }, icon('check', { size: 13 }), 'Done')
          : h('span', { class: 'item-btn__go' }, started ? 'Resume' : 'Start', icon('arrow-right', { size: 16 }))));
  }
  const s = store.gameStats(id);
  return h('a', { class: ['item-btn', 'item-btn--game', s?.plays && 'is-played'], href: `#g.${id}` },
    h('span', { class: 'item-btn__icon', 'aria-hidden': 'true' }, icon('gamepad', { size: 20 })),
    h('span', { class: 'item-btn__text' },
      h('span', { class: 'item-btn__kind' }, `Game · ${KIND_LABEL[e.kind] || 'Play'} · ${e.minutes} min`, e.tier === 'both' ? ' · both tracks' : ''),
      h('strong', { class: 'item-btn__title' }, e.title),
      h('span', { class: 'item-btn__blurb' }, e.blurb)),
    h('span', { class: 'item-btn__status' },
      s?.plays
        ? h('span', { class: 'item-btn__score' }, starRow(s.stars || 0, { size: 15 }), h('small', { class: 'mono faint' }, `best ${fmt(s.best)}`))
        : h('span', { class: 'item-btn__go' }, 'Play', icon('arrow-right', { size: 16 }))));
}

export default {
  id: 'track',
  mount(root, ctx) {
    const { store } = ctx;
    const tier = ctx.entry || findTier(ctx.route?.tier) || TIERS[0];
    store.setLastTier(tier.id);
    const units = unitsOf(tier.id);
    const path = learningPath(tier.id);
    const prog = store.tierProgress(tier.id);
    const doneFlags = units.map((u) => unitDone(store, u));
    const currentIdx = units.findIndex((u) => !unitDone(store, u));
    const nextItem = path.find((p) => !itemDone(store, p));
    const nextEntry = nextItem ? findEntry(nextItem.id) : null;
    const other = TIERS.find((t) => t.id !== tier.id);
    const tierNo = TIERS.indexOf(tier) + 1;

    const lessonsDone = prog.lessonsDone;
    const gamesTotal = path.filter((p) => p.type === 'game').length;
    const gamesDone = path.filter((p) => p.type === 'game' && itemDone(store, p)).length;

    const header = h('section', { class: 'track-hero' },
      h('div', { class: 'container' },
        h('a', { class: 'link-btn', href: '#home' }, icon('arrow-left', { size: 16 }), 'Home'),
        h('div', { class: 'track-hero__grid' },
          h('div', { class: 'track-hero__copy' },
            h('p', { class: 'eyebrow eyebrow--accent' }, `Track ${tierNo} of ${TIERS.length} · ${units.length} units`),
            h('h1', { class: 'track-hero__title' }, tier.title, h('span', { class: 'track-hero__sub' }, tier.subtitle)),
            h('p', { class: 'lead track-hero__blurb' }, tier.blurb),
            h('div', { class: 'track-hero__progress' },
              h('div', { class: 'row row--between track-hero__progress-head' },
                h('strong', null, prog.done === prog.total ? 'Track complete' : `${Math.round(prog.pct * 100)}% complete`),
                h('span', { class: 'mono faint' }, `${lessonsDone}/${prog.lessonsTotal} lessons · ${gamesDone}/${gamesTotal} games`)),
              meter(prog.pct, { size: 'lg', label: `${tier.title} track progress` })),
            h('div', { class: 'row track-hero__ctas' },
              nextEntry
                ? h('a', { class: 'btn btn--primary btn--lg', href: `#${hashFor(nextEntry.id)}` },
                  h('span', null, prog.done ? 'Continue: ' : 'Start: ', nextEntry.title), icon('arrow-right'))
                : h('a', { class: 'btn btn--primary btn--lg', href: other ? `#${other.id}` : '#progress' },
                  other ? `On to ${other.title}` : 'See your progress', icon('arrow-right')),
              other ? h('a', { class: 'btn btn--ghost', href: `#${other.id}` }, `${other.title} track`) : null)),
          h('figure', { class: 'track-hero__route' },
            routeChart(units, doneFlags, currentIdx),
            h('figcaption', { class: 'faint' }, 'Each unit is a swing on the way up: higher lows, higher highs.')))));

    const ladder = h('ol', { class: 'ladder' },
      units.map((u, i) => {
        const done = doneFlags[i];
        const current = i === currentIdx;
        const items = [];
        if (u.lesson) items.push(itemButton(store, 'lesson', u.lesson));
        for (const g of u.games) items.push(itemButton(store, 'game', g));
        return h('li', { class: ['ladder__unit', done && 'is-done', current && 'is-current'] },
          h('div', { class: 'ladder__rail', 'aria-hidden': 'true' },
            h('span', { class: 'ladder__node mono' }, done ? icon('check', { size: 16 }) : String(i + 1).padStart(2, '0')),
            i < units.length - 1 ? squiggle(done) : null),
          h('div', { class: 'ladder__body' },
            h('div', { class: 'ladder__head' },
              h('p', { class: 'eyebrow' }, `Unit ${i + 1}`, current ? h('span', { class: 'chip chip--accent chip--sm ladder__here' }, 'You are here') : null),
              h('h2', { class: 'ladder__title' }, u.title)),
            h('div', { class: 'ladder__items' }, items)));
      }));

    root.append(h('div', { class: 'track' },
      header,
      h('section', { class: 'container section', 'aria-label': `${tier.title} units` }, ladder),
      other ? h('section', { class: 'container section--tight' },
        h('a', { class: 'track-next card card--link', href: `#${other.id}` },
          h('span', null,
            h('span', { class: 'eyebrow' }, tier.id === 'beginner' ? 'When you are ready' : 'Need a refresher?'),
            h('strong', { class: 'track-next__title' }, `${other.title} — ${other.subtitle}`),
            h('span', { class: 'muted' }, other.blurb)),
          tierChip(other.id),
          icon('arrow-right', { size: 22 }))) : null));
  },
};
