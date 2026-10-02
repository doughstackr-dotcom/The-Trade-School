// Home: the one bold moment (a live teaching chart), today's Daily Challenge and Live Market Lab,
// the two tracks, the three play styles, the arcade (filterable by kind) and your level.
import { h, svg, icon, starRow, meter, tierChip, fmt, reducedMotion, modal } from '../core/ui.js';
import {
  TIERS, UNITS, GAMES, BADGES, STYLES, ARCADE_FILTERS, findEntry, findKind, findStyle, stylesOf, sourcesOf, hashFor,
} from '../registry.js';
import { makeRng } from '../core/rng.js';
import { fromPath, randomWalk, trendSeries, aggregate } from '../core/data.js';
import { sma } from '../core/indicators.js';
import { styleIcon } from '../core/game-kit.js';
import { CAMPAIGN_LEVEL_COUNT } from '../core/game-levels.js';
import { trackCard as sharedTrackCard } from '../core/curriculum.js';
import * as access from '../core/access.js';

const KIND_LABEL = { quiz: 'Quiz', draw: 'Draw', predict: 'Predict', simulation: 'Simulation', calc: 'Calculate', memory: 'Memory', swipe: 'Swipe', story: 'Story', live: 'Live' };

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
        return miniChart(sc.candles, { ...opts, overlays: [{ type: 'box', from: sc.start - 0.5, to: sc.end + 0.5, color: 'accent', label: size.width >= 200 ? 'Hammer' : undefined }] });
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
    case 'order-desk': {
      const candles = randomWalk({ seed, count: 40, vol: 0.006, volume: false });
      const last = candles[candles.length - 1].c;
      const spread = Math.max(0.12, last * 0.0016);
      return miniChart(candles, { ...opts, yPad: 0.16, overlays: [
        { type: 'zone', from: last - spread / 2, to: last + spread / 2, color: 'accent', opacity: 0.18 },
        { type: 'hline', price: last + spread / 2, color: 'bear', label: size.width >= 200 ? 'Ask' : undefined },
        { type: 'hline', price: last - spread / 2, color: 'bull', label: size.width >= 200 ? 'Bid' : undefined },
      ] });
    }
    case 'chart-match':
      return memoryArt(seed, size);
    case 'volume-verdict': {
      if (pat?.chartScenario) {
        const sc = pat.chartScenario('ascending-triangle', { seed, count: 90, after: 10, outcome: 'fail' });
        return withVolume(miniChart, sc.candles.slice(20), size, [{ type: 'hline', price: sc.level, color: 'accent', dashed: true }], sc.breakoutIdx - 20);
      }
      const candles = randomWalk({ seed, count: 60, vol: 0.012 });
      return withVolume(miniChart, candles, size, []);
    }
    case 'setup-swipe':
      return swipeArt(seed, size, miniChart);
    case 'daily-challenge':
      return dailyArt(size);
    case 'trap-or-trade': {
      if (pat?.chartScenario) {
        const sc = pat.chartScenario('ascending-triangle', { seed: seed + 5, count: 96, after: 14, outcome: 'fail' });
        const c = sc.candles.slice(24);
        return miniChart(c, { ...opts, yPad: 0.16, overlays: [
          { type: 'hline', price: sc.level, color: 'resistance', dashed: true },
          { type: 'marker', idx: sc.breakoutIdx - 24, position: 'above', shape: 'tag', text: '?', color: 'accent' },
        ] });
      }
      const { candles } = fromPath([[0, 98], [0.5, 101.8], [0.7, 100.2], [0.88, 102.4], [1, 100.6]], { seed, count: 60, volume: false });
      return miniChart(candles, { ...opts, overlays: [{ type: 'hline', price: 102, color: 'resistance', dashed: true }] });
    }
    case 'tilt-control':
      return storyArt(size);
    case 'live-predict': {
      const candles = randomWalk({ seed, count: 60, drift: 0.0008, vol: 0.01, volume: false });
      const last = candles[candles.length - 1];
      return miniChart(candles, { ...opts, yPad: 0.16, overlays: [
        { type: 'hline', price: last.c, color: 'accent', dashed: true },
        { type: 'marker', idx: candles.length - 1, price: last.c, position: 'at', shape: 'ring', color: 'accent' },
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

/** Nest a miniChart above a row of volume bars (last bar marked) in one SVG. */
function withVolume(miniChart, candles, size, overlays, markIdx = null) {
  const W = size.width;
  const H = size.height;
  const top = miniChart(candles, { width: W, height: Math.round(H * 0.74), padding: 8, overlays, yPad: 0.1 });
  top.setAttribute('x', '0');
  top.setAttribute('y', '0');
  // Nested SVGs: inline sizes beat the tile's `svg { width: 100% }` rule.
  top.style.width = `${W}px`;
  top.style.height = `${Math.round(H * 0.74)}px`;
  const vols = candles.map((c) => c.v || 0);
  const maxV = Math.max(1, ...vols);
  const n = candles.length;
  const bw = (W - 16) / n;
  const baseY = H - 4;
  const bars = candles.map((c, i) => {
    const hgt = Math.max(1, ((c.v || 0) / maxV) * H * 0.22);
    const cls = i === markIdx ? 'art-vol is-mark' : c.c >= c.o ? 'art-vol is-up' : 'art-vol is-down';
    return svg('rect', { x: 8 + i * bw + bw * 0.15, y: baseY - hgt, width: Math.max(0.8, bw * 0.7), height: hgt, class: cls });
  });
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'art art--volume', 'aria-hidden': 'true' }, top, ...bars);
}

/** Chart Match: a grid of memory cards, a few flipped to show candles. */
function memoryArt(seed, size) {
  const rng = makeRng(seed);
  const W = size.width;
  const H = size.height;
  const cols = 4;
  const rows = 2;
  const gap = 8;
  const cw = (W - 16 - gap * (cols - 1)) / cols;
  const ch = (H - 16 - gap * (rows - 1)) / rows;
  const up = new Set(rng.sample([0, 1, 2, 3, 4, 5, 6, 7], 3));
  const kids = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = 8 + c * (cw + gap);
      const y = 8 + r * (ch + gap);
      const face = up.has(i);
      kids.push(svg('rect', { x, y, width: cw, height: ch, rx: 6, class: face ? 'art-card is-face' : 'art-card' }));
      if (face) {
        const bull = rng.chance(0.5);
        const cx = x + cw / 2;
        const bodyH = ch * rng.float(0.25, 0.45);
        const by = y + (ch - bodyH) / 2 + rng.float(-4, 4);
        kids.push(svg('line', { x1: cx, x2: cx, y1: y + ch * 0.14, y2: y + ch * 0.86, class: bull ? 'art-wick is-up' : 'art-wick is-down' }));
        kids.push(svg('rect', { x: cx - cw * 0.12, y: by, width: cw * 0.24, height: bodyH, rx: 1.5, class: bull ? 'art-body is-up' : 'art-body is-down' }));
      } else {
        kids.push(svg('text', { x: x + cw / 2, y: y + ch / 2 + 5, 'text-anchor': 'middle', class: 'art-q' }, '?'));
      }
    }
  }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'art', 'aria-hidden': 'true' }, ...kids);
}

/** Setup Swipe: a tilted card with a chart, Skip on the left and Take on the right. */
function swipeArt(seed, size, miniChart) {
  const W = size.width;
  const H = size.height;
  const cw = Math.min(W * 0.52, 170);
  const ch = H - 20;
  const x = (W - cw) / 2;
  const y = 10;
  const ts = trendSeries({ seed, count: 40, direction: 'up', swings: 3, volume: false });
  const inner = miniChart(ts.candles, { width: cw - 12, height: ch - 12, padding: 4 });
  inner.setAttribute('x', String(x + 6));
  inner.setAttribute('y', String(y + 6));
  inner.style.width = `${cw - 12}px`;
  inner.style.height = `${ch - 12}px`;
  const card = svg('g', { transform: `rotate(6 ${W / 2} ${H / 2})` },
    svg('rect', { x, y, width: cw, height: ch, rx: 8, class: 'art-card is-face' }),
    inner);
  const pill = (px, label, cls) => svg('g', { class: `art-pill ${cls}` },
    svg('rect', { x: px - 24, y: H / 2 - 11, width: 48, height: 22, rx: 11 }),
    svg('text', { x: px, y: H / 2 + 4, 'text-anchor': 'middle' }, label));
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'art', 'aria-hidden': 'true' },
    svg('rect', { x: x - 10, y: y + 4, width: cw, height: ch, rx: 8, class: 'art-card is-back', transform: `rotate(-5 ${W / 2} ${H / 2})` }),
    card,
    W >= 200 ? pill(30, 'SKIP', 'is-down') : null,
    W >= 200 ? pill(W - 30, 'TAKE', 'is-up') : null);
}

/** Daily Challenge: a week strip with a streak of completed days and today highlighted. */
function dailyArt(size) {
  const W = size.width;
  const H = size.height;
  const n = 7;
  const gap = 6;
  const cw = Math.min(34, (W - 16 - gap * (n - 1)) / n);
  const total = n * cw + gap * (n - 1);
  const x0 = (W - total) / 2;
  const y = H / 2 - cw / 2 + 6;
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const kids = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (cw + gap);
    const state = i < 4 ? 'is-done' : i === 4 ? 'is-today' : '';
    kids.push(svg('rect', { x, y, width: cw, height: cw, rx: 7, class: `art-day ${state}` }));
    kids.push(svg('text', { x: x + cw / 2, y: y - 6, 'text-anchor': 'middle', class: 'art-day-label' }, days[i]));
    if (i < 4) kids.push(svg('path', { d: `M${x + cw * 0.28} ${y + cw * 0.52} l${cw * 0.16} ${cw * 0.16} l${cw * 0.3} -${cw * 0.32}`, class: 'art-check' }));
    if (i === 4) kids.push(svg('text', { x: x + cw / 2, y: y + cw / 2 + 5, 'text-anchor': 'middle', class: 'art-today' }, '?'));
  }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'art', 'aria-hidden': 'true' }, ...kids);
}

/** Tilt Control: a branching decision tree with the disciplined path highlighted. */
function storyArt(size) {
  const W = size.width;
  const H = size.height;
  const nodes = [
    [0.1, 0.5], [0.4, 0.28], [0.4, 0.72], [0.7, 0.14], [0.7, 0.42], [0.7, 0.62], [0.7, 0.88], [0.92, 0.3],
  ].map(([x, y]) => [x * W, y * H]);
  const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6], [4, 7]];
  const path = new Set(['0-1', '1-4', '4-7']);
  const kids = edges.map(([a, b]) => svg('line', {
    x1: nodes[a][0], y1: nodes[a][1], x2: nodes[b][0], y2: nodes[b][1],
    class: path.has(`${a}-${b}`) ? 'art-edge is-path' : 'art-edge',
  }));
  nodes.forEach(([x, y], i) => {
    const on = i === 0 || i === 1 || i === 4 || i === 7;
    kids.push(svg('circle', { cx: x, cy: y, r: i === 7 ? 9 : 6.5, class: on ? 'art-node is-path' : 'art-node' }));
  });
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'art', 'aria-hidden': 'true' }, ...kids);
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

function trackCard(store, tier) {
  return sharedTrackCard(store, tier, { cta: 'dashboard' });
}

function authFirstTrackLink(returnHash, attrs = {}) {
  if (!returnHash || !access.isEnforcing() || access.getAccess().user) return attrs;
  return {
    ...attrs,
    href: '#account.signup',
    'data-auth-return': returnHash,
    on: {
      ...(attrs.on || {}),
      click: () => access.rememberReturn(returnHash),
    },
  };
}

function styleIcons(g) {
  const ids = stylesOf(g);
  const labels = ids.map((id) => findStyle(id)?.label || id);
  return h('span', { class: 'style-icons', role: 'img', 'aria-label': `Styles: ${labels.join(', ')}`, title: `Play styles: ${labels.join(', ')}` },
    ids.map((id) => h('span', { class: `style-icons__i style-icons__i--${id}` }, styleIcon(id, { size: 13 }))));
}

/** Arcade game tile (home + games hub). Third arg may be `feature` boolean or options. */
export function arcadeTile(store, g, featureOrOpts = false) {
  const opts = (featureOrOpts && typeof featureOrOpts === 'object')
    ? featureOrOpts
    : { feature: !!featureOrOpts };
  const feature = !!opts.feature;
  const locked = !!opts.locked;
  const free = !!opts.free;
  const href = opts.href || `#g.${g.id}`;
  const st = store.gameStats(g.id);
  const campaign = store.levelProgress?.(g.id);
  const kind = findKind(g.kind);
  const real = sourcesOf(g).includes('real');
  const art = h('div', { class: 'game-tile__art', 'aria-hidden': 'true', 'data-art': g.id });
  const tile = h('a', {
    class: [
      'game-tile', 'card', 'card--link',
      feature && 'game-tile--feature',
      locked && 'game-tile--locked',
      free && 'game-tile--free',
    ],
    href,
    'data-kind': g.kind,
    'aria-label': locked
      ? `${g.title} (locked — subscribe to play)`
      : `${g.title}${free ? ' — free to play' : ''}`,
  },
    art,
    h('div', { class: 'game-tile__body' },
      feature ? h('p', { class: 'eyebrow eyebrow--accent' }, 'Capstone simulation') : null,
      h('div', { class: 'game-tile__top' },
        h('h3', { class: 'game-tile__title' }, g.title),
        st?.plays ? starRow(st.stars || 0, { size: 14 }) : null),
      h('p', { class: 'game-tile__blurb' }, g.blurb),
      h('div', { class: 'game-tile__meta' },
        free
          ? h('span', { class: 'chip chip--sm chip--accent' }, icon('spark', { size: 12 }), 'Free')
          : null,
        campaign
          ? h('span', { class: 'chip chip--sm chip--accent', title: 'Highest playable stage' },
            'Stage ', h('strong', { class: 'mono' }, `${campaign.unlocked}/${CAMPAIGN_LEVEL_COUNT}`))
          : null,
        locked
          ? h('span', { class: 'chip chip--sm chip--outline' }, icon('lock', { size: 12 }), 'Locked')
          : null,
        tierChip(g.tier, { small: true }),
        h('span', { class: 'game-tile__kind faint' }, kind ? icon(kind.icon, { size: 13 }) : null, `${KIND_LABEL[g.kind] || 'Game'} · ${g.minutes} min`),
        g.kind === 'live'
          ? h('span', { class: 'chip chip--sm source-chip is-real' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Live data')
          : real ? h('span', { class: 'chip chip--sm source-chip is-real', title: 'Offers real market charts' }, h('span', { class: 'source-chip__dot', 'aria-hidden': 'true' }), 'Real charts') : null,
        styleIcons(g))));
  return { tile, art };
}

/** Today: the Daily Challenge (streak) and the Live Market Lab (market status). */
function todaySection(store, cleanups) {
  const daily = findEntry('daily-challenge');
  const d = store.dailyStatus ? store.dailyStatus() : { done: false, streak: 0, best: 0 };
  const dateText = (() => {
    try {
      return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return 'Today';
    }
  })();
  const dailyCard = daily ? h('a', { class: ['today-card card card--link today-card--daily', d.done && 'is-done'], href: '#g.daily-challenge' },
    h('div', { class: 'today-card__top' },
      h('span', { class: 'today-card__icon', 'aria-hidden': 'true' }, icon('flame', { size: 22 })),
      h('div', { class: 'today-card__head' },
        h('span', { class: 'eyebrow eyebrow--accent' }, 'Daily Challenge'),
        h('strong', { class: 'today-card__title' }, dateText)),
      h('span', { class: 'today-card__streak', title: `Best streak: ${d.best || 0} days` },
        h('span', { class: 'today-card__num mono' }, String(d.streak || 0)),
        h('small', null, 'day streak'))),
    h('p', { class: 'today-card__text muted' }, daily.blurb),
    h('div', { class: 'today-card__foot' },
      d.done
        ? h('span', { class: 'chip chip--bull chip--sm' }, icon('check', { size: 13 }), `Done today · ${fmt(d.score || 0)} pts`)
        : h('span', { class: 'chip chip--sm chip--outline' }, d.streak ? 'Keep your streak alive' : 'Not played yet today'),
      h('span', { class: 'today-card__go' }, d.done ? 'Replay' : 'Play today’s five', icon('arrow-right', { size: 16 })))) : null;

  const statusChip = h('span', { class: 'chip chip--sm source-chip is-real' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Live & replay');
  const statusText = h('p', { class: 'today-card__text muted' }, 'Real market prices on a moving chart, with an automatic plain-English read of the trend, the nearest levels and fresh candle patterns.');
  const liveCard = h('a', { class: 'today-card card card--link today-card--live', href: '#live' },
    h('div', { class: 'today-card__top' },
      h('span', { class: 'today-card__icon today-card__icon--live', 'aria-hidden': 'true' }, icon('bolt', { size: 22 })),
      h('div', { class: 'today-card__head' },
        h('span', { class: 'eyebrow eyebrow--accent' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), ' Live now'),
        h('strong', { class: 'today-card__title' }, 'Live Market Lab')),
      null),
    statusText,
    h('div', { class: 'today-card__foot' }, statusChip, h('span', { class: 'today-card__go' }, 'Open the lab', icon('arrow-right', { size: 16 }))));

  // Market status from market.js when it is available. Nothing is fetched from here: the status
  // reflects the last request this session (or mock mode); the lab itself connects on demand.
  import('../core/market.js').then((m) => {
    if (cleanups.dead) return;
    const render = () => {
      let st = 'online';
      try {
        st = m.marketStatus?.() || 'online';
      } catch {
        st = 'online';
      }
      const mock = !!m.isMockMode?.();
      const label = mock ? 'Test data' : st === 'offline' ? 'Offline · simulated' : st === 'unconfigured' ? 'Replay mode' : 'Live & replay';
      statusChip.className = `chip chip--sm source-chip ${st === 'offline' ? 'is-fallback' : 'is-real'}`;
      statusChip.replaceChildren(h('span', { class: 'live-dot', 'aria-hidden': 'true', 'data-state': st === 'offline' ? 'offline' : 'live' }), label);
    };
    render();
    const off = m.onMarketStatus?.(render);
    if (typeof off === 'function') cleanups.push(off);
  }).catch(() => {
    /* market module unavailable: keep the static card */
  });

  return h('section', { class: 'container today', 'aria-label': 'Today' },
    h('div', { class: 'today__grid' }, dailyCard, liveCard));
}

const STYLE_RULES = {
  practice: ['No clock', 'Hints: a hinted round scores up to 50%', 'Try again after a miss', 'Pick Easy, Normal or Hard', 'Half XP'],
  arcade: ['40 short stages per game', 'Clear stages to unlock the next one', 'Streaks multiply your score (×1.5, ×2)', 'Earn up to three stars on each stage'],
  survival: ['Three lives', 'Rounds keep coming and get harder', 'The clock speeds up as you go', 'Stars at 5, 10 and 15 rounds'],
};

function playYourWay() {
  return h('section', { class: 'container section section--tight play-way', 'aria-labelledby': 'play-way-h' },
    h('div', { class: 'section-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Play your way'),
        h('h2', { id: 'play-way-h' }, 'Three styles, every game')),
      h('p', { class: 'muted' }, 'Pick a style on any game’s start screen; it is remembered per game. Many games also let you switch between clean textbook charts and real market history.')),
    h('div', { class: 'play-way__grid' },
      STYLES.map((st) => h('article', { class: `play-way__card play-way__card--${st.id}` },
        h('div', { class: 'play-way__head' },
          h('span', { class: 'play-way__icon', 'aria-hidden': 'true' }, styleIcon(st.id, { size: 22 })),
          h('h3', { class: 'play-way__title' }, st.label)),
        h('p', { class: 'play-way__blurb' }, st.blurb),
        h('ul', { class: 'play-way__rules' }, (STYLE_RULES[st.id] || []).map((r) => h('li', null, icon('check', { size: 14 }), h('span', null, r))))))));
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
      h('a', { class: 'btn', href: '#dashboard' }, 'View dashboard', icon('arrow-right'))));
}

// ------------------------------------------------------------------ page

function showWelcome(store) {
  if (store.getSetting('welcomed')) return;
  const body = h('div', { class: 'welcome-modal' },
    h('p', null, 'Short visual lessons and games teach chart reading — then you can test your eye on textbook or real-market charts.'),
    h('ol', { class: 'welcome-modal__steps' },
      h('li', null, h('strong', null, 'Start here:'), ' Candlestick anatomy opens the Beginner track; Markets, orders & the spread comes late, then Put it together (Daily Challenge stays free).'),
      h('li', null, h('strong', null, 'Play styles:'), ' Practice, Arcade, or Survival on every game.'),
      h('li', null, h('strong', null, 'Dashboard:'), ' See the full map anytime under Dashboard.')),
    h('p', { class: 'faint' }, 'Educational only — not financial advice. You can skip this tour.'),
  );
  modal({
    title: 'Welcome to The Trade School',
    body,
    dismissible: true,
    actions: [
      {
        label: 'Start Beginner',
        primary: true,
        onClick: () => {
          store.setSetting('welcomed', true);
          location.hash = '#l.candle-anatomy';
        },
      },
      {
        label: 'Skip for now',
        onClick: () => store.setSetting('welcomed', true),
      },
    ],
    onClose: () => store.setSetting('welcomed', true),
  });
}


export default {
  id: 'home',
  mount(root, ctx) {
    const { store } = ctx;
    const cleanups = [];
    // First-visit welcome (skippable, a11y modal) waits until the auth-first gate is not active.
    if (!access.isEnforcing()) {
      try { showWelcome(store); } catch (err) { console.error(err); }
    }
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
            'Short, visual lessons and hands-on games for candlesticks, support and resistance, trend lines, chart patterns, Fibonacci, indicators and risk. Practise on clean textbook charts, then test your eye on real market history, without risking a cent.'),
          h('div', { class: 'hero__ctas' },
            h('a', authFirstTrackLink('beginner', { class: 'btn btn--primary btn--lg', href: '#beginner' }), 'Start Beginner', icon('arrow-right')),
            h('a', authFirstTrackLink('advanced', { class: 'btn btn--lg hero__btn2', href: '#advanced' }), 'Jump to Advanced'),
            h('a', { class: 'btn btn--lg btn--ghost', href: '#dashboard' }, 'Open Dashboard')),
          h('dl', { class: 'hero__facts' },
            h('div', null, h('dt', null, 'Lessons'), h('dd', { class: 'mono' }, String(totalLessons))),
            h('div', null, h('dt', null, 'Games'), h('dd', { class: 'mono' }, String(GAMES.length))),
            h('div', null, h('dt', null, 'Tracks'), h('dd', { class: 'mono' }, String(TIERS.length))))),
        chartHost));

    const arcadeGrid = h('div', { class: 'arcade__grid', id: 'arcade-grid' });
    const emptyNote = h('p', { class: 'faint arcade__empty', hidden: true }, 'No games of this kind yet.');
    const filterBtns = [];
    const counts = Object.fromEntries(ARCADE_FILTERS.map((f) => [f.id, f.kinds ? GAMES.filter((g) => f.kinds.includes(g.kind)).length : GAMES.length]));
    const filterRow = h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Filter games by kind' },
      ARCADE_FILTERS.filter((f) => counts[f.id] > 0).map((f) => {
        const b = h('button', {
          type: 'button', class: 'filter-chip', 'aria-pressed': String(f.id === 'all'), 'aria-controls': 'arcade-grid', 'data-filter': f.id,
          on: { click: () => applyFilter(f.id) },
        }, h('span', null, f.label), h('span', { class: 'filter-chip__n mono' }, String(counts[f.id])));
        filterBtns.push(b);
        return b;
      }));
    const arcade = h('section', { class: 'container section arcade', 'aria-labelledby': 'arcade-h' },
      h('div', { class: 'section-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'The arcade'),
          h('h2', { id: 'arcade-h' }, `${GAMES.length} games that train your eye`)),
        h('p', { class: 'muted' }, 'Quizzes, drawing, predictions, memory, swipe, story and live games. Each drills one skill from its lesson, then the capstones put them together.')),
      filterRow,
      arcadeGrid,
      emptyNote);
    let tiles = [];
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

    const tracksHost = h('div', { class: 'tracks__grid', id: 'home-tracks' });
    const paintTracks = () => {
      tracksHost.replaceChildren(...TIERS.map((tier) => trackCard(store, tier)));
    };
    paintTracks();
    const unsubAccess = access.onChange(() => paintTracks());
    access.ready.then(() => paintTracks()).catch(() => {});

    root.append(
      h('div', { class: 'home' },
        hero,
        continueStrip(store),
        todaySection(store, cleanups),
        h('section', { class: 'container section tracks', 'aria-labelledby': 'tracks-h' },
          h('div', { class: 'section-head' },
            h('div', null,
              h('p', { class: 'eyebrow' }, 'The curriculum'),
              h('h2', { id: 'tracks-h' }, 'Two tracks, one skill set')),
            h('p', { class: 'muted' }, 'Start with how markets work and reading the chart. Move on to planning trades: patterns, Fibonacci, indicators, breakouts, risk and psychology. Locked lessons stay visible - sign in or create an account to keep your place.')),
          tracksHost),
        playYourWay(),
        arcade,
        levelStrip(store)));

    const FEATURE = 'trade-simulator';
    // The wide feature tile goes last so it never strands a single tile below it.
    const ordered = [...GAMES.filter((g) => g.id !== FEATURE), ...GAMES.filter((g) => g.id === FEATURE)];
    const arts = ordered.map((g) => {
      const { tile, art } = arcadeTile(store, g, g.id === FEATURE);
      arcadeGrid.append(tile);
      tiles.push(tile);
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
      // Phones show the arcade as compact rows with a squarer thumbnail beside the text.
      let compact = false;
      try {
        compact = matchMedia('(max-width: 559.98px)').matches;
      } catch {
        /* old browsers */
      }
      ordered.forEach((g, i) => {
        try {
          const size = g.id === FEATURE ? { width: 640, height: 220 } : compact ? { width: 150, height: 140 } : undefined;
          arts[i].append(gamePreview(g.id, 1000 + i * 7919, chartMod, pat, size));
        } catch (err) {
          console.error(`[home] preview for ${g.id} failed:`, err);
        }
      });
    });

    return () => {
      dead = true;
      cleanups.dead = true;
      cleanups.forEach((fn) => fn());
      heroCleanup?.();
      unsubAccess?.();
    };
  },
};
