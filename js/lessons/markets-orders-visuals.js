// Lightweight SVG/DOM visuals for Markets, Orders & the Spread (no extra libs).
import { h, svg, reducedMotion } from '../core/ui.js';
import { raf, cancelRaf, tween, sleep } from '../core/anim.js';

const NS = { xmlns: 'http://www.w3.org/2000/svg' };

function money(n, d = 2) {
  return Number(n).toFixed(d);
}

/** Animated order book: bids stack left/bottom, asks right/top, mid updates. */
export function orderBookVisual({ bid = 100.0, ask = 100.12, levels = 5 } = {}) {
  const wrap = h('div', {
    class: 'ob-visual',
    role: 'img',
    'aria-label': `Order book. Best bid ${money(bid)}, best ask ${money(ask)}.`,
  });
  const midEl = h('div', { class: 'ob-visual__mid mono' }, `Spread ${money(ask - bid)}`);
  const bidCol = h('div', { class: 'ob-visual__col ob-visual__col--bid', 'aria-hidden': 'true' });
  const askCol = h('div', { class: 'ob-visual__col ob-visual__col--ask', 'aria-hidden': 'true' });
  const labels = h('div', { class: 'ob-visual__labels' },
    h('span', { class: 'ob-visual__tag ob-visual__tag--bid' }, 'Bids (buyers)'),
    h('span', { class: 'ob-visual__tag ob-visual__tag--ask' }, 'Asks (sellers)'));

  const rows = [];
  for (let i = 0; i < levels; i++) {
    const size = 40 + (levels - i) * 18 + (i % 2) * 8;
    const b = h('div', { class: 'ob-row ob-row--bid', style: { '--w': '0%' } },
      h('span', { class: 'ob-row__bar' }),
      h('span', { class: 'ob-row__px mono' }, money(bid - i * 0.02)),
      h('span', { class: 'ob-row__sz mono' }, String(size + i * 5)));
    const a = h('div', { class: 'ob-row ob-row--ask', style: { '--w': '0%' } },
      h('span', { class: 'ob-row__bar' }),
      h('span', { class: 'ob-row__px mono' }, money(ask + i * 0.02)),
      h('span', { class: 'ob-row__sz mono' }, String(size - 4 + i * 3)));
    bidCol.append(b);
    askCol.prepend(a);
    rows.push({ el: b, w: 35 + (levels - i) * 12 }, { el: a, w: 32 + (levels - i) * 11 });
  }

  wrap.append(labels, h('div', { class: 'ob-visual__book' }, bidCol, midEl, askCol));

  let stopped = false;
  let pulseId = null;
  const play = async () => {
    for (const r of rows) {
      if (stopped) return;
      await tween({
        from: 0, to: r.w, duration: reducedMotion() ? 0 : 420,
        onUpdate: (v) => { r.el.style.setProperty('--w', `${v}%`); },
      });
      await sleep(reducedMotion() ? 0 : 60);
    }
    if (stopped || reducedMotion()) return;
    let t = 0;
    const pulse = () => {
      if (stopped) return;
      t += 1;
      const wobble = 1 + Math.sin(t / 18) * 0.04;
      midEl.textContent = `Spread ${money((ask - bid) * wobble)}`;
      pulseId = raf(pulse);
    };
    pulseId = raf(pulse);
  };
  play();

  return {
    el: wrap,
    destroy() {
      stopped = true;
      cancelRaf(pulseId);
    },
  };
}

/** Bid–ask spread that narrows and widens with a live readout. */
export function spreadVisual({ mid = 100, tight = 0.04, wide = 0.28 } = {}) {
  const W = 320;
  const H = 110;
  const y = 55;
  const bidLine = svg('line', { class: 'spread-vis__bid', x1: 24, y1: y, x2: 24, y2: y, 'stroke-width': 3 });
  const askLine = svg('line', { class: 'spread-vis__ask', x1: 24, y1: y, x2: 24, y2: y, 'stroke-width': 3 });
  const gap = svg('rect', { class: 'spread-vis__gap', x: 24, y: y - 18, width: 0, height: 36, rx: 4 });
  const midDot = svg('circle', { class: 'spread-vis__mid', cx: W / 2, cy: y, r: 5 });
  const label = h('p', { class: 'spread-vis__readout mono', 'aria-live': 'polite' }, '');
  const caption = h('p', { class: 'faint spread-vis__cap' }, 'Watch the gap: liquid names stay tight; news and thin books widen it.');

  const picture = svg('svg', {
    ...NS, class: 'spread-vis__svg', viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
    role: 'img', 'aria-label': 'Bid ask spread animation',
  },
    svg('line', { class: 'spread-vis__axis', x1: 24, y1: y, x2: W - 24, y2: y }),
    gap, bidLine, askLine, midDot,
    svg('text', { class: 'spread-vis__tag', x: 28, y: 22 }, 'Bid'),
    svg('text', { class: 'spread-vis__tag spread-vis__tag--ask', x: W - 28, y: 22, 'text-anchor': 'end' }, 'Ask'),
  );

  const el = h('div', { class: 'spread-vis' }, picture, label, caption);
  let stopped = false;
  let handle = null;

  const paint = (spread) => {
    const half = (spread / wide) * ((W - 48) / 2) * 0.85;
    const cx = W / 2;
    const bx = cx - half;
    const ax = cx + half;
    bidLine.setAttribute('x1', bx);
    bidLine.setAttribute('x2', bx);
    bidLine.setAttribute('y1', y - 22);
    bidLine.setAttribute('y2', y + 22);
    askLine.setAttribute('x1', ax);
    askLine.setAttribute('x2', ax);
    askLine.setAttribute('y1', y - 22);
    askLine.setAttribute('y2', y + 22);
    gap.setAttribute('x', bx);
    gap.setAttribute('width', Math.max(0, ax - bx));
    midDot.setAttribute('cx', cx);
    const bid = mid - spread / 2;
    const ask = mid + spread / 2;
    label.textContent = `Bid ${money(bid)} · Ask ${money(ask)} · Spread ${money(spread)} (${((spread / mid) * 100).toFixed(2)}%)`;
  };

  const loop = async () => {
    const frames = [tight, tight * 1.6, wide * 0.7, wide, tight * 1.2, tight];
    let i = 0;
    let from = tight;
    paint(from);
    if (reducedMotion()) {
      paint(wide * 0.5);
      return;
    }
    while (!stopped) {
      const to = frames[i % frames.length];
      handle = tween({
        from, to, duration: 1400,
        onUpdate: (v) => paint(v),
      });
      await handle;
      from = to;
      i += 1;
      await sleep(500);
    }
  };
  loop();

  return {
    el,
    destroy() {
      stopped = true;
      handle?.cancel?.();
    },
  };
}

/**
 * Side-by-side market vs limit: market crosses the ask immediately;
 * limit sits on the book and fills only if price trades down to it.
 */
export function orderCompareVisual({ ask = 100.12, bid = 100.0, limitPx = 99.85 } = {}) {
  const W = 520;
  const H = 160;
  const marketGroup = svg('g', { class: 'ord-cmp__market' });
  const limitGroup = svg('g', { class: 'ord-cmp__limit' });
  const mLabel = h('p', { class: 'ord-cmp__status mono', 'aria-live': 'polite' }, 'Market buy → waiting…');
  const lLabel = h('p', { class: 'ord-cmp__status mono', 'aria-live': 'polite' }, 'Limit buy → resting…');

  const lane = (x0, title, group) => svg('g', null,
    svg('text', { class: 'ord-cmp__title', x: x0 + 110, y: 18, 'text-anchor': 'middle' }, title),
    svg('line', { class: 'ord-cmp__rail', x1: x0 + 20, y1: 70, x2: x0 + 200, y2: 70 }),
    svg('line', { class: 'ord-cmp__ask', x1: x0 + 20, y1: 48, x2: x0 + 200, y2: 48, 'stroke-dasharray': '4 3' }),
    svg('text', { class: 'ord-cmp__px', x: x0 + 210, y: 52 }, `Ask ${money(ask)}`),
    svg('line', { class: 'ord-cmp__bid', x1: x0 + 20, y1: 92, x2: x0 + 200, y2: 92, 'stroke-dasharray': '4 3' }),
    svg('text', { class: 'ord-cmp__px', x: x0 + 210, y: 96 }, `Bid ${money(bid)}`),
    group,
  );

  const mDot = svg('circle', { class: 'ord-cmp__dot ord-cmp__dot--mkt', cx: 40, cy: 70, r: 8 });
  const lDot = svg('circle', { class: 'ord-cmp__dot ord-cmp__dot--lmt', cx: 300, cy: 118, r: 8 });
  const lRest = svg('rect', {
    class: 'ord-cmp__rest', x: 285, y: 108, width: 30, height: 20, rx: 4, opacity: 0.35,
  });
  marketGroup.append(mDot);
  limitGroup.append(lRest, lDot,
    svg('text', { class: 'ord-cmp__px', x: 320, y: 130 }, `Limit ${money(limitPx)}`));

  const picture = svg('svg', {
    ...NS, class: 'ord-cmp__svg', viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
    role: 'img', 'aria-label': 'Market order versus limit order animation',
  },
    lane(10, 'Market order', marketGroup),
    lane(270, 'Limit order', limitGroup),
  );

  const el = h('div', { class: 'ord-cmp' },
    picture,
    h('div', { class: 'ord-cmp__statuses' }, mLabel, lLabel),
    h('p', { class: 'faint' }, 'Market = speed (you pay the ask). Limit = price (you may wait, or never fill).'),
  );

  let stopped = false;
  let handle = null;
  const run = async () => {
    if (reducedMotion()) {
      mDot.setAttribute('cx', 190);
      mDot.setAttribute('cy', 48);
      mLabel.textContent = `Market buy filled ≈ ${money(ask)} (crossed the spread)`;
      lLabel.textContent = `Limit buy resting at ${money(limitPx)} — fills only if traded there`;
      return;
    }
    while (!stopped) {
      mDot.setAttribute('cx', 40);
      mDot.setAttribute('cy', 70);
      lDot.setAttribute('cx', 300);
      lDot.setAttribute('cy', 118);
      mLabel.textContent = 'Market buy → crossing the spread…';
      lLabel.textContent = `Limit buy resting at ${money(limitPx)}…`;
      handle = tween({
        from: { x: 40, y: 70 }, to: { x: 190, y: 48 }, duration: 900,
        onUpdate: (v) => { mDot.setAttribute('cx', v.x); mDot.setAttribute('cy', v.y); },
      });
      await handle;
      if (stopped) return;
      mLabel.textContent = `Filled ≈ ${money(ask)} — paid the ask (spread cost)`;
      await sleep(700);
      if (stopped) return;
      // Price drifts down toward the limit
      lLabel.textContent = 'Price drifts… limit still waiting';
      handle = tween({
        from: { y: 70 }, to: { y: 118 }, duration: 1600,
        onUpdate: (v) => {
          // ghost mid marker via limit rail feel — move a faint ask line? skip; animate limit fill flash
          lRest.setAttribute('opacity', String(0.35 + (v.y - 70) / 120));
        },
      });
      await handle;
      if (stopped) return;
      lDot.setAttribute('cy', 118);
      lRest.setAttribute('opacity', '0.9');
      lLabel.textContent = `Filled at ${money(limitPx)} — got the price, waited for the tape`;
      await sleep(1400);
      lRest.setAttribute('opacity', '0.35');
    }
  };
  run();

  return {
    el,
    destroy() {
      stopped = true;
      handle?.cancel?.();
    },
  };
}

/** Simple two-sided meeting diagram (market as meeting place). */
export function marketMeetingVisual() {
  const W = 360;
  const H = 120;
  const buyers = svg('g', { class: 'meet-vis__buyers' });
  const sellers = svg('g', { class: 'meet-vis__sellers' });
  for (let i = 0; i < 4; i++) {
    buyers.append(svg('circle', {
      class: 'meet-vis__dot meet-vis__dot--bid', cx: 40, cy: 30 + i * 20, r: 7,
      style: { '--i': String(i) },
    }));
    sellers.append(svg('circle', {
      class: 'meet-vis__dot meet-vis__dot--ask', cx: 320, cy: 30 + i * 20, r: 7,
      style: { '--i': String(i) },
    }));
  }
  const flash = svg('circle', { class: 'meet-vis__trade', cx: 180, cy: 60, r: 0, opacity: 0 });
  const el = h('div', { class: 'meet-vis' },
    svg('svg', {
      ...NS, class: 'meet-vis__svg', viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
      role: 'img', 'aria-label': 'Buyers and sellers meeting in a market',
    },
      svg('rect', { class: 'meet-vis__venue', x: 120, y: 20, width: 120, height: 80, rx: 12 }),
      svg('text', { class: 'meet-vis__label', x: 180, y: 64, 'text-anchor': 'middle' }, 'Exchange'),
      buyers, sellers, flash,
      svg('text', { class: 'meet-vis__tag', x: 40, y: 14, 'text-anchor': 'middle' }, 'Buyers'),
      svg('text', { class: 'meet-vis__tag', x: 320, y: 14, 'text-anchor': 'middle' }, 'Sellers'),
    ),
    h('p', { class: 'faint' }, 'A trade prints when someone crosses — a buyer lifts an ask, or a seller hits a bid.'),
  );

  let stopped = false;
  let handle = null;
  const run = async () => {
    if (reducedMotion()) return;
    while (!stopped) {
      handle = tween({
        from: { bx: 40, sx: 320 }, to: { bx: 150, sx: 210 }, duration: 1100,
        onUpdate: (v) => {
          [...buyers.children].forEach((c, i) => c.setAttribute('cx', v.bx - i * 2));
          [...sellers.children].forEach((c, i) => c.setAttribute('cx', v.sx + i * 2));
        },
      });
      await handle;
      if (stopped) return;
      flash.setAttribute('r', '16');
      flash.setAttribute('opacity', '0.85');
      await sleep(280);
      flash.setAttribute('opacity', '0');
      flash.setAttribute('r', '0');
      handle = tween({
        from: { bx: 150, sx: 210 }, to: { bx: 40, sx: 320 }, duration: 700,
        onUpdate: (v) => {
          [...buyers.children].forEach((c, i) => c.setAttribute('cx', v.bx - i * 2));
          [...sellers.children].forEach((c, i) => c.setAttribute('cx', v.sx + i * 2));
        },
      });
      await handle;
      await sleep(600);
    }
  };
  run();
  return {
    el,
    destroy() {
      stopped = true;
      handle?.cancel?.();
    },
  };
}
