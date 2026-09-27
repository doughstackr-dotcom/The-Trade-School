// Home: the one bold moment (a live teaching chart), the two tracks, the arcade and your level.
import { h, icon, starRow, meter, tierChip, fmt, reducedMotion } from '../core/ui.js';
import { TIERS, UNITS, GAMES, BADGES, findEntry, unitsOf, hashFor, learningPath } from '../registry.js';
import { makeRng } from '../core/rng.js';
import { fromPath, randomWalk, trendSeries, aggregate } from '../core/data.js';
import { sma } from '../core/indicators.js';

const KIND_LABEL = { quiz: 'Quiz', draw: 'Draw', predict: 'Predict', simulation: 'Simulation', calc: 'Calculate' };

const HERO_STEPS = [
  { key: 'support', label: 'Support', caption: 'Support — buyers stepped in at the same price twice. That zone matters.' },
  { key: 'bounce', label: 'Bounce', caption: 'Bounce — the second test held, and price rejected the level.' },
  { key: 'trend', label: 'Trend line', caption: 'Trend line — higher lows connect into a rising line. The trend is up.' },
  { key: 'fib', label: 'Fibonacci', caption: 'Fibonacci — the pullback eases into the 50–61.8% zone of the last swing.' },
];

// ------------------------------------------------------------------ hero

function heroScenario(seed) {
  const rng = makeRng(seed);
  const j = (v, amt) => v + rng.float(-amt, amt);
  const support = j(101, 0.4);
  const points = [
    [0, j(106.5, 0.8)],
    [j(0.14, 0.02), support + rng.float(0, 0.25)],
    [j(0.27, 0.02), j(104.8, 0.5)],
    [j(0.4, 0.02), support - rng.float(0, 0.2)],
    [j(0.54, 0.02), j(106.4, 0.5)],
    [j(0.66, 0.015), support + j(2.7, 0.35)],
    [j(0.84, 0.015), j(110.6, 0.6)],
  ];
  const lo = points[5][1];
  const hi = points[6][1];
  points.push([1, hi - (hi - lo) * rng.float(0.52, 0.6)]);
  const { candles, anchors } = fromPath(points, { seed: seed ^ 0x9e37, count: 84, start: points[0][1], noise: 0.3, wick: 0.55, volume: false });
  return { candles, anchors, support };
}

function mountHero(host, chartMod) {
  const reduce = reducedMotion();
  const tickerPrice = h('span', { class: 'hero__px mono' }, '—');
  const tickerChange = h('span', { class: 'hero__chg mono' }, '');
  const canvas = h('div', { class: 'hero__canvas' });
  const stepEls = HERO_STEPS.map((s, i) =>
    h('li', { class: 'hero__step', 'data-step': s.key },
      h('span', { class: 'hero__step-bar', 'aria-hidden': 'true' }, h('span')),
      h('span', { class: 'hero__step-label' }, h('span', { class: 'mono' }, `0${i + 1}`), s.label)));
  const caption = h('p', { class: 'hero__caption', 'aria-live': 'off' }, 'Watch a chart get read, one idea at a time.');

  host.append(
    h('div', { class: 'hero__ticker' },
      h('span', { class: 'hero__sym mono' }, 'TTS / SIM'),
      h('span', { class: 'chip chip--sm chip--outline mono' }, '1H'),
      h('span', { class: 'hero__spacer' }),
      tickerPrice,
      tickerChange),
    canvas,
    h('ol', { class: 'hero__steps' }, stepEls),
    caption);

  const { CandleChart } = chartMod;
  let alive = true;
  let visible = true;
  let chart = null;
  let seed = 20240917;
  let wake = null;

  const setStep = (idx, progress = 1) => {
    stepEls.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-done', i < idx || (i === idx && progress >= 1 && reduce));
      el.querySelector('.hero__step-bar > span').style.transform = `scaleX(${i < idx ? 1 : i === idx ? progress : 0})`;
    });
    if (idx >= 0 && HERO_STEPS[idx]) caption.textContent = HERO_STEPS[idx].caption;
  };

  const updateTicker = (candles, n) => {
    const last = candles[Math.max(0, n - 1)];
    const first = candles[0];
    if (!last) return;
    tickerPrice.textContent = last.c.toFixed(2);
    const chg = ((last.c - first.o) / first.o) * 100;
    tickerChange.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    tickerChange.className = `hero__chg mono ${chg >= 0 ? 'up' : 'down'}`;
  };

  const STOP = Symbol('stop');
  const gate = () => {
    if (!alive) return Promise.reject(STOP);
    if (visible && !document.hidden) return Promise.resolve();
    return new Promise((res, rej) => {
      wake = () => (alive ? res() : rej(STOP));
    });
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms)).then(gate);
  const tween = (ms, fn) => new Promise((res, rej) => {
    const t0 = performance.now();
    const step = (now) => {
      if (!alive) return rej(STOP);
      const t = Math.min(1, (now - t0) / ms);
      fn(1 - Math.pow(1 - t, 3), t);
      if (t < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  }).then(gate);

  const heightFor = () => (window.innerWidth < 720 ? 250 : 360);

  function build(sc) {
    const { candles } = sc;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
    }
    // Extra room under the lows so the 'Bounce' marker and its label clear the time axis.
    const pad = (hi - lo) * 0.1;
    const padBottom = (hi - lo) * 0.18;
    if (chart) {
      try {
        chart.destroy();
      } catch (err) {
        console.error(err);
      }
      canvas.replaceChildren();
    }
    chart = new CandleChart(canvas, {
      candles,
      height: heightFor(),
      visible: reduce ? candles.length : 0,
      autoscale: [lo - padBottom, hi + pad],
      showVolume: false,
      crosshair: true,
      ariaLabel: 'Animated example chart: support, a bounce, a rising trend line and a Fibonacci retracement',
    });
    return chart;
  }

  const addSupport = (sc, opacity) =>
    chart.addZone({ from: sc.support - 0.45, to: sc.support + 0.45, color: 'support', opacity, label: 'Support' });

  async function loop() {
    for (;;) {
      const sc = heroScenario(seed);
      const { candles, anchors } = sc;
      build(sc);
      setStep(-1, 0);
      if (reduce) {
        finalFrame(sc);
        return;
      }
      caption.textContent = 'Watch a chart get read, one idea at a time.';
      let n = 0;
      const revealTo = async (to, interval) => {
        while (n < to) {
          n += 1;
          chart.setVisible(n);
          updateTicker(candles, n);
          await wait(interval);
        }
      };
      // 1 · support
      await revealTo(anchors[3].idx + 2, 55);
      setStep(0, 0);
      const zone = addSupport(sc, 0);
      await tween(700, (e) => {
        chart.update(zone, { opacity: 0.16 * e });
        setStep(0, e);
      });
      await wait(900);
      // 2 · bounce
      setStep(1, 0);
      chart.addMarker({ idx: anchors[3].idx, price: candles[anchors[3].idx].l, position: 'below', shape: 'arrow', text: 'Bounce', color: 'support' });
      chart.flash?.(anchors[3].idx, 'support');
      await revealTo(anchors[4].idx + 1, 55);
      await tween(500, (e) => setStep(1, e));
      await wait(500);
      // 3 · trend line through the higher lows
      await revealTo(anchors[5].idx + 4, 55);
      setStep(2, 0);
      const A = { idx: anchors[3].idx, price: candles[anchors[3].idx].l };
      const B = { idx: anchors[5].idx, price: candles[anchors[5].idx].l };
      const seg = chart.addSegment({ a: A, b: A, color: 'info', width: 2, label: '' });
      await tween(800, (e) => {
        chart.update(seg, { b: { idx: A.idx + (B.idx - A.idx) * e, price: A.price + (B.price - A.price) * e } });
        setStep(2, e * 0.8);
      });
      chart.update(seg, { b: B, extend: 'right', label: 'Higher lows' });
      chart.addMarker({ idx: B.idx, price: B.price, position: 'below', shape: 'dot', color: 'info' });
      setStep(2, 1);
      // 4 · fib on the last swing
      await revealTo(anchors[6].idx + 1, 55);
      await wait(250);
      setStep(3, 0);
      const H = { idx: anchors[6].idx, price: candles[anchors[6].idx].h };
      chart.addFib({ a: B, b: H, ratios: [0, 0.382, 0.5, 0.618, 1], zone: [0.5, 0.618], color: 'fib' });
      await revealTo(candles.length, 80);
      await tween(700, (e) => setStep(3, e));
      stepEls.forEach((el) => el.classList.add('is-done'));
      await wait(3800);
      seed = (seed * 1664525 + 1013904223) >>> 0;
    }
  }

  function finalFrame(sc) {
    const { candles, anchors } = sc;
    chart.setVisible(candles.length);
    updateTicker(candles, candles.length);
    addSupport(sc, 0.16);
    chart.addMarker({ idx: anchors[3].idx, price: candles[anchors[3].idx].l, position: 'below', shape: 'arrow', text: 'Bounce', color: 'support' });
    const A = { idx: anchors[3].idx, price: candles[anchors[3].idx].l };
    const B = { idx: anchors[5].idx, price: candles[anchors[5].idx].l };
    chart.addSegment({ a: A, b: B, color: 'info', width: 2, extend: 'right', label: 'Higher lows' });
    const H = { idx: anchors[6].idx, price: candles[anchors[6].idx].h };
    chart.addFib({ a: B, b: H, ratios: [0, 0.382, 0.5, 0.618, 1], zone: [0.5, 0.618], color: 'fib' });
    stepEls.forEach((el) => {
      el.classList.add('is-done');
      el.querySelector('.hero__step-bar > span').style.transform = 'scaleX(1)';
    });
    caption.textContent = 'Support held, price bounced, higher lows formed a trend line, and the pullback reached the Fibonacci golden zone.';
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && wake) {
        const w = wake;
        wake = null;
        w();
      }
    }, { threshold: 0.15 })
    : null;
  io?.observe(host);
  const onVis = () => {
    if (!document.hidden && visible && wake) {
      const w = wake;
      wake = null;
      w();
    }
  };
  document.addEventListener('visibilitychange', onVis);

  loop().catch((err) => {
    if (err !== STOP) console.error('[home] hero animation failed:', err);
  });

  return () => {
    alive = false;
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
    io?.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    try {
      chart?.destroy();
    } catch (err) {
      console.error(err);
    }
  };
}

// ------------------------------------------------------------------ arcade previews

/** Small seeded miniChart teaser for a game (used by the arcade grid). */
export function gamePreview(id, seed, { miniChart }, pat = null, size = { width: 280, height: 120 }) {
  const opts = { width: size.width, height: size.height, padding: 8 };
  switch (id) {
    case 'candle-builder': {
      const candles = randomWalk({ seed, count: 9, vol: 0.022, volume: false });
      return miniChart(candles, { ...opts, overlays: [{ type: 'box', from: 7.56, to: 8.44, color: 'accent' }] });
    }
    case 'pattern-flash': {
      if (pat?.candleScenario) {
        const sc = pat.candleScenario('hammer', { seed, leadIn: 12, after: 3 });
        return miniChart(sc.candles, { ...opts, overlays: [{ type: 'box', from: sc.start - 0.5, to: sc.end + 0.5, color: 'accent', label: 'Hammer' }] });
      }
      const { candles } = fromPath([[0, 106], [0.8, 99], [1, 101.5]], { seed, count: 22, volume: false });
      return miniChart(candles, { ...opts, overlays: [{ type: 'box', from: 16.5, to: 18.5, color: 'accent' }] });
    }
    case 'trend-spotter': {
      const ts = trendSeries({ seed, count: 64, direction: 'up', swings: 4, volume: false });
      return miniChart(ts.candles, { ...opts, overlays: [{ type: 'path', points: ts.swings.map((s) => ({ idx: s.idx, price: s.price })), labels: ts.swings.map((s) => s.label), color: 'info' }] });
    }
    case 'level-hunter': {
      const { candles } = fromPath([[0, 101], [0.16, 98], [0.34, 102], [0.52, 98.1], [0.7, 101.9], [0.86, 98.3], [1, 100.6]], { seed, count: 70, volume: false });
      return miniChart(candles, { ...opts, overlays: [
        { type: 'hline', price: 98, color: 'support', label: 'S' },
        { type: 'hline', price: 102, color: 'resistance', label: 'R' },
      ] });
    }
    case 'trendline-challenge': {
      const ts = trendSeries({ seed: seed + 3, count: 64, direction: 'up', swings: 4, volume: false });
      const lows = ts.swings.filter((s) => s.type === 'low');
      const ov = lows.length >= 2
        ? [{ type: 'segment', a: { idx: lows[0].idx, price: lows[0].price }, b: { idx: lows[lows.length - 1].idx, price: lows[lows.length - 1].price }, color: 'info', extend: 'right' }]
        : [];
      return miniChart(ts.candles, { ...opts, overlays: ov });
    }
    case 'cross-catcher': {
      const { candles } = fromPath([[0, 104], [0.45, 97.5], [1, 106]], { seed, count: 90, noise: 0.6, volume: false });
      const cl = candles.map((c) => c.c);
      return miniChart(candles, { ...opts, overlays: [
        { type: 'series', values: sma(cl, 9), color: 'ma1' },
        { type: 'series', values: sma(cl, 26), color: 'ma2' },
      ] });
    }
    case 'what-next': {
      const { candles } = fromPath([[0, 100], [0.3, 104], [0.5, 101.5], [0.8, 105.5], [1, 103.6]], { seed, count: 60, volume: false });
      const last = candles[candles.length - 1];
      return miniChart(candles, { ...opts, overlays: [{ type: 'marker', idx: candles.length - 1, price: last.h, position: 'above', shape: 'tag', text: '?', color: 'accent' }] });
    }
    case 'pattern-detective': {
      if (pat?.chartScenario) {
        const sc = pat.chartScenario('head-and-shoulders', { seed, count: 90, after: 12 });
        const ov = sc.neckline ? [{ type: 'segment', a: { idx: sc.neckline.x1, price: sc.neckline.y1 }, b: { idx: sc.neckline.x2, price: sc.neckline.y2 }, color: 'accent', dashed: true, extend: 'right' }] : [];
        return miniChart(sc.candles, { ...opts, overlays: ov });
      }
      const { candles } = fromPath([[0, 96], [0.2, 102], [0.32, 99], [0.5, 105], [0.66, 99.2], [0.82, 102], [1, 96.5]], { seed, count: 80, volume: false });
      return miniChart(candles, { ...opts, overlays: [{ type: 'hline', price: 99, color: 'accent', dashed: true }] });
    }
    case 'fib-sniper': {
      const { candles, anchors } = fromPath([[0, 97], [0.12, 96], [0.62, 108], [1, 103.5]], { seed, count: 64, volume: false });
      const a = { idx: anchors[1].idx, price: candles[anchors[1].idx].l };
      const b = { idx: anchors[2].idx, price: candles[anchors[2].idx].h };
      return miniChart(candles, { ...opts, overlays: [{ type: 'fib', a, b, ratios: [0, 0.382, 0.5, 0.618, 1], zone: [0.5, 0.618], labels: false }] });
    }
    case 'divergence-detective': {
      const { candles, anchors } = fromPath([[0, 98], [0.3, 104], [0.5, 101], [0.8, 105.2], [1, 101.5]], { seed, count: 64, volume: false });
      const p1 = { idx: anchors[1].idx, price: candles[anchors[1].idx].h };
      const p2 = { idx: anchors[3].idx, price: candles[anchors[3].idx].h };
      return miniChart(candles, { ...opts, overlays: [
        { type: 'segment', a: p1, b: p2, color: 'bear', width: 2 },
        { type: 'marker', idx: p2.idx, price: p2.price, position: 'above', shape: 'dot', color: 'bear' },
      ] });
    }
    case 'timeframe-stack': {
      const base = randomWalk({ seed, count: 160, drift: 0.0012, vol: 0.01, volume: false });
      const hi = aggregate(base, 5);
      return miniChart(hi, { ...opts, overlays: [{ type: 'series', values: sma(hi.map((c) => c.c), 8), color: 'ma2' }] });
    }
    case 'risk-manager': {
      const { candles } = fromPath([[0, 100], [0.4, 97.5], [0.7, 101], [1, 100.2]], { seed, count: 56, volume: false });
      const entry = candles[candles.length - 1].c;
      return miniChart(candles, { ...opts, overlays: [
        { type: 'zone', from: entry, to: entry + 3.2, color: 'bull', opacity: 0.16 },
        { type: 'zone', from: entry - 1.6, to: entry, color: 'bear', opacity: 0.16 },
        { type: 'hline', price: entry, color: 'text', dashed: true },
      ] });
    }
    case 'trade-simulator':
    default: {
      const { candles, anchors } = fromPath([[0, 101], [0.22, 97.6], [0.4, 100.4], [0.52, 98.6], [0.8, 105.5], [1, 104.2]], { seed, count: 110, noise: 0.45, volume: false });
      const buy = anchors[3];
      const sell = anchors[4];
      const entry = candles[buy.idx].l;
      const ov = [
        { type: 'zone', from: entry - 1.1, to: entry, color: 'bear', opacity: 0.12, x1: buy.idx, x2: sell.idx },
        { type: 'zone', from: entry, to: candles[sell.idx].h, color: 'bull', opacity: 0.1, x1: buy.idx, x2: sell.idx },
        { type: 'marker', idx: buy.idx, price: entry, position: 'below', shape: 'arrow', text: 'Buy', color: 'bull' },
        { type: 'marker', idx: sell.idx, price: candles[sell.idx].h, position: 'above', shape: 'arrow', text: 'Sell', color: 'bear' },
      ];
      return miniChart(candles, { ...opts, overlays: ov });
    }
  }
}

// ------------------------------------------------------------------ sections

function continueStrip(store) {
  const last = store.state.last;
  if (!last) return null;
  const e = findEntry(last.id);
  if (!e) return null;
  let detail = '';
  if (e.type === 'lesson') {
    const st = store.getLessonStep(e.id);
    detail = store.isLessonDone(e.id) ? 'Lesson · completed — review or play its game' : `Lesson · step ${Math.min((st.step || 0) + 1, 99)}`;
  } else {
    const g = store.gameStats(e.id);
    detail = g?.plays ? `Game · best ${fmt(g.best)}` : 'Game · not finished yet';
  }
  return h('section', { class: 'container continue-wrap', 'aria-label': 'Continue where you left off' },
    h('a', { class: 'continue card card--link', href: `#${hashFor(e.id)}` },
      h('span', { class: 'continue__icon', 'aria-hidden': 'true' }, icon(e.type === 'lesson' ? 'book' : 'gamepad', { size: 22 })),
      h('span', { class: 'continue__text' },
        h('span', { class: 'eyebrow' }, 'Continue where you left off'),
        h('strong', null, e.title),
        h('span', { class: 'muted' }, detail)),
      h('span', { class: 'continue__go' }, 'Resume', icon('arrow-right'))));
}

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

function trackCard(store, tier) {
  const p = store.tierProgress(tier.id);
  const units = unitsOf(tier.id);
  return h('article', { class: `track-card track-card--${tier.id}` },
    h('header', { class: 'track-card__head' },
      h('div', { class: 'row row--between' },
        tierChip(tier.id),
        h('span', { class: 'track-card__count mono' }, `${p.done}/${p.total}`)),
      h('h3', { class: 'track-card__title' }, tier.title, h('span', { class: 'track-card__sub' }, ` — ${tier.subtitle}`)),
      h('p', { class: 'muted track-card__blurb' }, tier.blurb),
      meter(p.pct, { label: `${tier.title} track progress` })),
    h('ol', { class: 'track-card__units' },
      units.map((u, i) => {
        const target = u.lesson ? `l.${u.lesson}` : `g.${u.games[0]}`;
        return h('li', null,
          h('a', { class: 'unit-row', href: `#${target}` },
            h('span', { class: 'unit-row__n mono' }, String(i + 1).padStart(2, '0')),
            h('span', { class: 'unit-row__title' }, u.title),
            unitStatus(store, u)));
      })),
    h('a', { class: 'btn track-card__cta', href: `#${tier.id}` }, `Open the ${tier.title} track`, icon('arrow-right')));
}

function arcadeTile(store, g, feature = false) {
  const st = store.gameStats(g.id);
  const art = h('div', { class: 'game-tile__art', 'aria-hidden': 'true', 'data-art': g.id });
  const tile = h('a', { class: ['game-tile card card--link', feature && 'game-tile--feature'], href: `#g.${g.id}` },
    art,
    h('div', { class: 'game-tile__body' },
      feature ? h('p', { class: 'eyebrow eyebrow--accent' }, 'Capstone simulation') : null,
      h('div', { class: 'game-tile__top' },
        h('h3', { class: 'game-tile__title' }, g.title),
        st?.plays ? starRow(st.stars || 0, { size: 14 }) : null),
      h('p', { class: 'game-tile__blurb' }, g.blurb),
      h('div', { class: 'game-tile__meta' },
        tierChip(g.tier, { small: true }),
        h('span', { class: 'faint' }, `${KIND_LABEL[g.kind] || 'Game'} · ${g.minutes} min`))));
  return { tile, art };
}

function levelStrip(store) {
  const lv = store.level();
  const earned = store.state.badges.map((id) => BADGES.find((b) => b.id === id)).filter(Boolean);
  const shown = earned.slice(-6).reverse();
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const b = shown[i];
    slots.push(b
      ? h('span', { class: 'level-strip__badge', title: `${b.title} — ${b.description}` }, icon(b.icon, { size: 18, label: b.title }))
      : h('span', { class: 'level-strip__badge is-empty', 'aria-hidden': 'true' }, icon('lock', { size: 14 })));
  }
  return h('section', { class: 'container section section--tight', 'aria-label': 'Your level' },
    h('div', { class: 'level-strip card' },
      h('div', { class: 'level-strip__lv' },
        h('span', { class: 'level-strip__num' }, h('small', { class: 'mono' }, 'LV'), String(lv.number)),
        h('div', { class: 'level-strip__info' },
          h('span', { class: 'eyebrow' }, 'Your level'),
          h('strong', { class: 'level-strip__title' }, lv.title),
          meter(lv.progress, { size: 'sm', label: 'XP to next level' }),
          h('span', { class: 'level-strip__xp mono faint' }, lv.next != null ? `${fmt(lv.xp)} / ${fmt(lv.next)} XP` : `${fmt(lv.xp)} XP · max level`))),
      h('div', { class: 'level-strip__badges' },
        h('span', { class: 'eyebrow' }, `Badges · ${earned.length}/${BADGES.length}`),
        h('div', { class: 'level-strip__row' }, slots)),
      h('a', { class: 'btn', href: '#progress' }, 'View progress', icon('arrow-right'))));
}

// ------------------------------------------------------------------ page

export default {
  id: 'home',
  mount(root, ctx) {
    const { store } = ctx;
    const cleanups = [];
    const totalLessons = UNITS.filter((u) => u.lesson).length;

    const chartHost = h('figure', { class: 'hero__chart' });
    const hero = h('section', { class: 'hero' },
      h('div', { class: 'container hero__inner' },
        h('div', { class: 'hero__copy' },
          h('p', { class: 'eyebrow eyebrow--accent hero__eyebrow' }, 'The Trade School · learn by playing'),
          h('h1', { class: 'hero__title' },
            h('span', { class: 'hero__line' }, 'Learn to read'), ' ',
            h('span', { class: 'hero__line' }, 'the market,'), ' ',
            h('span', { class: 'hero__line' }, h('span', { class: 'hero__em' }, 'one candle')), ' ',
            h('span', { class: 'hero__line' }, 'at a time.')),
          h('p', { class: 'hero__lead' },
            'Short, visual lessons and hands-on games for candlesticks, support and resistance, trend lines, chart patterns, Fibonacci, indicators and risk. Every chart is simulated, so you can practise without risking a cent.'),
          h('div', { class: 'hero__ctas' },
            h('a', { class: 'btn btn--primary btn--lg', href: '#beginner' }, 'Start Beginner', icon('arrow-right')),
            h('a', { class: 'btn btn--lg hero__btn2', href: '#advanced' }, 'Jump to Advanced')),
          h('dl', { class: 'hero__facts' },
            h('div', null, h('dt', null, 'Lessons'), h('dd', { class: 'mono' }, String(totalLessons))),
            h('div', null, h('dt', null, 'Games'), h('dd', { class: 'mono' }, String(GAMES.length))),
            h('div', null, h('dt', null, 'Tracks'), h('dd', { class: 'mono' }, String(TIERS.length))))),
        chartHost));

    const arcadeGrid = h('div', { class: 'arcade__grid' });
    const arcade = h('section', { class: 'container section arcade', 'aria-labelledby': 'arcade-h' },
      h('div', { class: 'section-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'The arcade'),
          h('h2', { id: 'arcade-h' }, `${GAMES.length} games that train your eye`)),
        h('p', { class: 'muted' }, 'Quick rounds, streak multipliers and three stars to chase. Each game drills one skill from its lesson — then the capstones put them together.')),
      arcadeGrid);

    root.append(
      h('div', { class: 'home' },
        hero,
        continueStrip(store),
        h('section', { class: 'container section tracks', 'aria-labelledby': 'tracks-h' },
          h('div', { class: 'section-head' },
            h('div', null,
              h('p', { class: 'eyebrow' }, 'The curriculum'),
              h('h2', { id: 'tracks-h' }, 'Two tracks, one skill set')),
            h('p', { class: 'muted' }, 'Start with reading the chart. Move on to planning trades: patterns, Fibonacci, indicators, timeframes and risk.')),
          h('div', { class: 'tracks__grid' }, TIERS.map((t) => trackCard(store, t)))),
        arcade,
        levelStrip(store)));

    const FEATURE = 'trade-simulator';
    const arts = GAMES.map((g) => {
      const { tile, art } = arcadeTile(store, g, g.id === FEATURE);
      arcadeGrid.append(tile);
      return art;
    });

    // Lazy-load the chart engine so the page renders even while it loads.
    let heroCleanup = null;
    let dead = false;
    Promise.allSettled([import('../core/chart.js'), import('../core/patterns.js')]).then(([chartRes, patRes]) => {
      if (dead) return;
      const chartMod = chartRes.status === 'fulfilled' ? chartRes.value : null;
      const pat = patRes.status === 'fulfilled' ? patRes.value : null;
      if (!chartMod) {
        console.error('[home] chart engine failed to load:', chartRes.reason);
        return;
      }
      try {
        heroCleanup = mountHero(chartHost, chartMod);
      } catch (err) {
        console.error('[home] hero failed:', err);
      }
      GAMES.forEach((g, i) => {
        try {
          const size = g.id === FEATURE ? { width: 640, height: 220 } : undefined;
          arts[i].append(gamePreview(g.id, 1000 + i * 7919, chartMod, pat, size));
        } catch (err) {
          console.error(`[home] preview for ${g.id} failed:`, err);
        }
      });
    });

    return () => {
      dead = true;
      cleanups.forEach((fn) => fn());
      heroCleanup?.();
    };
  },
};
