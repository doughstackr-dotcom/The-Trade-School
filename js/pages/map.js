// World map (#map — v2 campaign hub; #dashboard/#progress/#beginner/#advanced land here).
// The curriculum as a game trail: one winding neon path per track, unit nodes along it
// (sequential unlock: a unit opens when the one before it is complete — the Games hub
// stays free-play, so nothing is ever truly out of reach), capstone units staged as
// BOSS nodes. Below the trails: the records sections shared with the old dashboard.
import { h, svg, icon, starRow, meter, sfx } from '../core/ui.js';
import { TIERS, unitsOf, hashFor, findEntry, BADGES } from '../registry.js';
import { itemButton } from '../core/track-panel.js';
import { accountOverview, statsRow, levelCard, badgesGrid, gamesTable, resetZone } from './progress.js';
import * as access from '../core/access.js';

/** A unit is cleared when its lesson is done and every game has at least one star. */
function unitDone(store, u) {
  return (!u.lesson || store.isLessonDone(u.lesson)) && u.games.every((g) => (store.state.games[g]?.stars || 0) >= 1);
}

/** Unit stars 0–3, using the same thresholds as the game shell. */
function unitStars(store, u) {
  const games = u.games || [];
  if (!games.length) return 0;
  const total = games.reduce((a, g) => a + Math.min(3, store.state.games[g]?.stars || 0), 0);
  const ratio = total / (games.length * 3);
  return ratio >= 0.9 ? 3 : ratio >= 0.65 ? 2 : ratio >= 0.35 ? 1 : 0;
}

/** Campaign order: unit i opens when unit i−1 is cleared (unit 1 is always open). */
function unitUnlocked(i, doneFlags) {
  return i === 0 || doneFlags[i - 1];
}

/** The next incomplete playable item inside the first open, unfinished unit. */
function nextPlayable(store, units, doneFlags) {
  for (let i = 0; i < units.length; i++) {
    if (!unitUnlocked(i, doneFlags) || doneFlags[i]) continue;
    const u = units[i];
    if (u.lesson && !store.isLessonDone(u.lesson)) return { type: 'lesson', id: u.lesson };
    const game = u.games.find((g) => (store.state.games[g]?.stars || 0) < 1);
    if (game) return { type: 'game', id: game };
  }
  return null;
}

/**
 * Draws the winding path behind the node column: a dim dashed "locked" polyline through
 * every node centre plus a bright "cleared" overlay up to the frontier. Measured from
 * the live DOM so it survives any layout; redrawn on resize and on panel toggles.
 */
function drawPath(trailWrap, svgEl, doneFlags, nodes) {
  if (!trailWrap || !svgEl || nodes.length < 2) return;
  const box = trailWrap.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return;
  const pts = nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
  });
  const W = Math.max(1, Math.round(box.width));
  const H = Math.max(1, Math.round(box.height));
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const seg = (i) => {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const my = (py + y) / 2;
    return `C ${px.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  const pathThrough = (count) => pts.slice(0, count)
    .map(([x, y], i) => (i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : seg(i))).join(' ');
  const dim = svgEl.querySelector('.trail__path-dim');
  const done = svgEl.querySelector('.trail__path-done');
  if (dim) dim.setAttribute('d', pathThrough(pts.length));
  // Cleared overlay runs through the last cleared node plus the frontier node ahead of it.
  const frontier = Math.min(pts.length, doneFlags.lastIndexOf(true) + 2);
  if (done) done.setAttribute('d', frontier > 1 ? pathThrough(frontier) : '');
}

function unitPanel(store, u, locked, prevTitle) {
  const items = [];
  if (u.lesson) items.push(itemButton(store, 'lesson', u.lesson));
  for (const g of u.games) items.push(itemButton(store, 'game', g));
  return h('div', { class: 'trail-panel', role: 'group', 'aria-label': `Unit: ${u.title}` },
    locked
      ? h('p', { class: 'trail-panel__lock' },
          icon('lock', { size: 16 }),
          h('span', null, `Locked — clear “${prevTitle}” to open this unit. Everything stays free-play from the Games hub.`))
      : null,
    h('div', { class: 'trail-panel__items' }, items));
}

/** One track's world: header card + trail. Returns { el, redraw, disconnect }. */
function trailSection(store, tier, tierNo, expanded) {
  const units = unitsOf(tier.id);
  const prog = store.tierProgress(tier.id);
  const doneFlags = units.map((u) => unitDone(store, u));
  const currentIdx = doneFlags.findIndex((d) => !d);
  const next = nextPlayable(store, units, doneFlags);
  const nextEntry = next ? findEntry(next.id) : null;
  const cleared = doneFlags.filter(Boolean).length;

  const nodeRefs = [];

  const rows = units.map((u, i) => {
    const boss = i === units.length - 1;
    const done = doneFlags[i];
    const unlocked = unitUnlocked(i, doneFlags);
    const current = unlocked && !done && currentIdx === i;
    const stars = unitStars(store, u);

    const panelHost = h('div', { class: 'trail__panel-host', id: `${u.id}-panel`, hidden: true });
    const node = h('button', {
      type: 'button',
      class: [
        'trail__node-btn',
        boss && 'is-boss',
        done && 'is-done',
        current && 'is-current',
        !unlocked && 'is-locked',
      ],
      'aria-expanded': 'false',
      'aria-controls': `${u.id}-panel`,
      'aria-label': [
        boss ? `Boss unit: ${u.title}` : `Unit ${i + 1}: ${u.title}`,
        done ? `cleared, ${stars} of 3 stars` : unlocked ? 'ready to play' : 'locked',
      ].join(', '),
      on: { click: () => {
        const open = panelHost.hidden;
        panelHost.hidden = !open;
        if (open) expanded.add(u.id); else expanded.delete(u.id);
        node.setAttribute('aria-expanded', String(open));
        node.classList.toggle('is-open', open);
        row.classList.toggle('is-open', open);
        panelHost.replaceChildren(open ? unitPanel(store, u, !unlocked, units[i - 1]?.title) : null);
        if (open) sfx.whoosh();
        requestAnimationFrame(() => redraw());
      } },
    },
      h('span', { class: 'trail__node-face', 'aria-hidden': 'true' },
        !unlocked ? icon('lock', { size: 22 })
          : done ? icon(boss ? 'crown' : 'check', { size: boss ? 28 : 20 })
            : boss ? icon('crown', { size: 28 })
              : h('span', { class: 'trail__node-num font-arcade' }, String(i + 1).padStart(2, '0'))),
      boss ? h('span', { class: 'trail__boss-tag arcade-label', 'aria-hidden': 'true' }, 'Boss') : null,
      done && stars > 0 ? h('span', { class: 'trail__node-stars', 'aria-hidden': 'true' }, starRow(stars, { size: 11, label: false })) : null);
    nodeRefs.push(node);

    const label = h('p', { class: 'trail__node-label' },
      h('strong', null, u.title),
      done ? h('span', { class: 'faint' }, ' · cleared') : !unlocked ? h('span', { class: 'faint' }, ' · locked') : null);

    const row = h('li', { class: ['trail__row', boss && 'is-boss', done && 'is-done'] },
      h('div', { class: 'trail__node-col' }, node, label),
      panelHost);
    return row;
  });

  const svgEl = svg('svg', { class: 'trail__path', 'aria-hidden': 'true' },
    svg('path', { class: 'trail__path-dim' }),
    svg('path', { class: 'trail__path-done' }));
  const trailWrap = h('div', { class: 'trail__wrap' }, svgEl, h('ol', { class: 'trail', 'aria-label': `${tier.title} trail` }, rows));

  function redraw() {
    drawPath(trailWrap, svgEl, doneFlags, nodeRefs);
  }
  // Units open before a re-render re-open with their panels populated.
  for (let i = 0; i < units.length; i++) {
    if (expanded.has(units[i].id)) {
      const row = rows[i];
      const panelHost = row.querySelector('.trail__panel-host');
      const node = nodeRefs[i];
      panelHost.hidden = false;
      node.setAttribute('aria-expanded', 'true');
      node.classList.add('is-open');
      row.classList.add('is-open');
      panelHost.replaceChildren(unitPanel(store, units[i], !unitUnlocked(i, doneFlags), units[i - 1]?.title));
    }
  }

  let ro = null;
  let onResize = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => redraw());
    ro.observe(trailWrap);
  } else {
    onResize = () => redraw();
    window.addEventListener('resize', onResize);
  }

  const el = h('section', {
    class: `map-track map-track--${tier.id}`,
    'aria-labelledby': `map-${tier.id}-h`,
    id: `map-${tier.id}`,
  },
    h('div', { class: 'map-track__head card' },
      h('div', { class: 'map-track__copy' },
        h('p', { class: 'eyebrow eyebrow--accent' }, `World ${tierNo} · ${units.length} units · ${cleared} cleared`),
        h('h2', { id: `map-${tier.id}-h`, class: 'map-track__title' }, tier.title,
          h('span', { class: 'map-track__sub' }, tier.subtitle)),
        h('p', { class: 'muted' }, tier.blurb)),
      h('div', { class: 'map-track__side' },
        meter(prog.pct, { size: 'lg', label: `${tier.title} progress` }),
        h('p', { class: 'faint map-track__pct mono' }, `${Math.round(prog.pct * 100)}% · ${prog.done}/${prog.total} steps`),
        nextEntry
          ? h('a', { class: 'btn btn--primary btn--arcade', href: `#${hashFor(nextEntry.id)}` },
              icon('play', { size: 16 }), `Continue: ${nextEntry.title}`)
          : h('a', { class: 'btn btn--primary btn--arcade', href: '#g.daily-challenge' },
              icon('flame', { size: 16 }), 'Cleared — Daily Challenge'))),
    trailWrap);

  requestAnimationFrame(() => redraw());
  return {
    el,
    redraw,
    disconnect() {
      ro?.disconnect();
      if (onResize) window.removeEventListener('resize', onResize);
    },
  };
}

export default {
  id: 'map',
  mount(root, ctx) {
    const { store } = ctx;
    try {
      store.award?.('dashboard-visit', { silent: true });
    } catch { /* badge may not exist */ }
    const expanded = new Set();
    // Fill the right side of the map on arrival with the unit the learner should play next.
    const firstOpenUnit = TIERS.flatMap((t) => unitsOf(t.id)).find((u) => !unitDone(store, u));
    if (firstOpenUnit) expanded.add(firstOpenUnit.id);
    let live = []; // active trail observers from the latest render

    const render = () => {
      for (const t of live) t.disconnect();
      live = [];
      const snap = access.getAccess();
      const tracks = TIERS.map((t, i) => trailSection(store, t, i + 1, expanded));
      live = tracks;

      root.replaceChildren(
        h('div', { class: 'container map-page' },
          h('header', { class: 'page-head' },
            h('p', { class: 'eyebrow eyebrow--accent' }, 'World map'),
            h('h1', { class: 'neon-title' }, 'Choose your next market'),
            h('p', { class: 'lead' },
              'Two worlds, one winding trail each. Clear a unit to open the next; the capstones are boss stages. Off the trail, the Games hub stays free-play and your records live below.')),
          accountOverview(store, snap),
          tracks[0]?.el,
          tracks[1]?.el,
          levelCard(store),
          statsRow(store),
          h('section', { class: 'section section--tight', 'aria-labelledby': 'badges-h' },
            h('div', { class: 'section-head' },
              h('div', null, h('p', { class: 'eyebrow' }, `${store.state.badges.length} of ${BADGES.length} earned`), h('h2', { id: 'badges-h' }, 'Badges'))),
            badgesGrid(store)),
          h('section', { class: 'section section--tight', 'aria-labelledby': 'games-h' },
            h('div', { class: 'section-head' },
              h('div', null, h('p', { class: 'eyebrow' }, 'Best runs per style'), h('h2', { id: 'games-h' }, 'Games')),
              h('p', { class: 'muted' }, 'Free-play records for every game — Practice and Arcade bests, Survival rounds.')),
            gamesTable(store)),
          resetZone(store, () => render()),
          h('p', { class: 'faint map-disclaimer' }, 'Educational simulations only — not financial advice.')));

      const section = ctx.route?.section;
      if (section === 'beginner' || section === 'advanced') {
        try { store.setLastTier?.(section); } catch { /* ignore */ }
        requestAnimationFrame(() => {
          const target = document.getElementById(`map-${section}`);
          if (target) {
            try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            catch { target.scrollIntoView(); }
          }
        });
      }
      requestAnimationFrame(() => tracks.forEach((t) => t.redraw()));
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
      for (const t of live) t.disconnect();
      live = [];
      store.off('change', onChange);
      unsubAccess?.();
      if (queued) cancelAnimationFrame(queued);
    };
  },
};
