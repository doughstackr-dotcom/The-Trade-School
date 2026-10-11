// Pattern playback: Home-hero-style stepped CandleChart reveal for Playbook + Library.
// Candle-by-candle (or chunked) setVisible, step progress bars, captions, ticker strip,
// overlays (zone / marker / segment / fib / hlines). Honors reduced motion. No ChartStory.
// Styles: .pps-* in css/components.css.

import { h, icon, reducedMotion } from './ui.js';
import {
  CANDLE_PATTERNS, CHART_PATTERNS, candleScenario, chartScenario,
} from './patterns.js';

const FIB_RATIOS = [0, 0.382, 0.5, 0.618, 1];
const FIB_ZONE = [0.5, 0.618];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function padRange(candles) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  const span = Math.max(1e-9, hi - lo);
  return [lo - span * 0.18, hi + span * 0.12];
}

/** Prior swing for fib on candle lead-in: extreme against bias in the lead, then pattern extreme. */
function priorSwing(candles, start, end, bullish) {
  if (start < 4) return null;
  const lead = candles.slice(0, start);
  if (bullish) {
    let hiIdx = 0;
    let hi = -Infinity;
    for (let i = 0; i < lead.length; i++) {
      if (lead[i].h > hi) { hi = lead[i].h; hiIdx = i; }
    }
    let loIdx = start;
    let lo = Infinity;
    for (let i = start; i <= end; i++) {
      if (candles[i].l < lo) { lo = candles[i].l; loIdx = i; }
    }
    if (!(hi > lo) || hiIdx >= loIdx) return null;
    return { a: { idx: hiIdx, price: hi }, b: { idx: loIdx, price: lo } };
  }
  let loIdx = 0;
  let lo = Infinity;
  for (let i = 0; i < lead.length; i++) {
    if (lead[i].l < lo) { lo = lead[i].l; loIdx = i; }
  }
  let hiIdx = start;
  let hi = -Infinity;
  for (let i = start; i <= end; i++) {
    if (candles[i].h > hi) { hi = candles[i].h; hiIdx = i; }
  }
  if (!(hi > lo) || loIdx >= hiIdx) return null;
  return { a: { idx: loIdx, price: lo }, b: { idx: hiIdx, price: hi } };
}

function tradeLevelsCandle(sc, bias) {
  const { candles, start, end, confirm } = sc;
  const pat = candles.slice(start, end + 1);
  const patHigh = Math.max(...pat.map((k) => k.h));
  const patLow = Math.min(...pat.map((k) => k.l));
  const range = Math.max(1e-9, patHigh - patLow);
  const confIdx = Math.min(candles.length - 1, end + 1);
  const conf = candles[confIdx];
  const bull = bias === 'bullish' || (bias !== 'bearish' && (sc.direction ?? 1) > 0);
  let entry;
  let stop;
  let target;
  let entryIdx = confIdx;
  if (bull) {
    entry = Number.isFinite(confirm) ? Math.max(confirm, conf?.c ?? confirm) : (conf?.c ?? patHigh);
    stop = patLow - range * 0.08;
    const risk = Math.max(range * 0.2, entry - stop);
    target = entry + risk * 1.75;
  } else {
    entry = Number.isFinite(confirm) ? Math.min(confirm, conf?.c ?? confirm) : (conf?.c ?? patLow);
    stop = patHigh + range * 0.08;
    const risk = Math.max(range * 0.2, stop - entry);
    target = entry - risk * 1.75;
  }
  return { entry, stop, target, entryIdx, bull };
}

function tradeLevelsChart(sc) {
  const { candles, breakoutIdx, direction, target: tgt, level, patternStart } = sc;
  const bull = direction > 0;
  const entryIdx = breakoutIdx;
  const entry = candles[entryIdx]?.c ?? level;
  const win = candles.slice(patternStart, Math.min(candles.length, breakoutIdx + 1));
  let stop;
  if (bull) {
    stop = Math.min(...win.map((k) => k.l));
    if (Number.isFinite(level)) stop = Math.min(stop, level);
  } else {
    stop = Math.max(...win.map((k) => k.h));
    if (Number.isFinite(level)) stop = Math.max(stop, level);
  }
  const risk = Math.max(1e-9, Math.abs(entry - stop));
  const target = Number.isFinite(tgt) ? tgt : (bull ? entry + risk * 2 : entry - risk * 2);
  return { entry, stop, target, entryIdx, bull };
}

/** Failed-breakout fade: enter on the first close back inside, stop beyond the fakeout extreme, target the far side. */
function fadeLevelsChart(sc) {
  const { candles, breakoutIdx, direction, level, patternStart, patternEnd } = sc;
  const up = direction > 0; // the breakout that failed went up → the fade is a short
  const lvl = Number.isFinite(level) ? level : candles[breakoutIdx]?.o;
  let entryIdx = candles.length - 1;
  for (let i = breakoutIdx + 1; i < candles.length; i++) {
    if (up ? candles[i].c < lvl : candles[i].c > lvl) { entryIdx = i; break; }
  }
  const pat = candles.slice(patternStart, patternEnd + 1);
  const trap = candles.slice(breakoutIdx, entryIdx + 1);
  const patHigh = Math.max(...pat.map((k) => k.h));
  const patLow = Math.min(...pat.map((k) => k.l));
  const buffer = (patHigh - patLow) * 0.03;
  const entry = candles[entryIdx].c;
  const stop = up ? Math.max(...trap.map((k) => k.h)) + buffer : Math.min(...trap.map((k) => k.l)) - buffer;
  const target = up ? patLow : patHigh;
  return { entry, stop, target, entryIdx, bull: !up, fade: true };
}

function buildCandlePlan(patternId, opts = {}) {
  const meta = CANDLE_PATTERNS[patternId];
  if (!meta) throw new Error(`Unknown candle pattern: ${patternId}`);
  const seed = opts.seed ?? 101;
  const sc = candleScenario(patternId, {
    seed,
    leadIn: opts.leadIn ?? 18,
    after: opts.after ?? 8,
    outcome: opts.outcome || 'success',
  });
  const bias = opts.bias || sc.bias || meta.bias;
  const levels = tradeLevelsCandle(sc, bias);
  if (Number.isFinite(opts.entry)) levels.entry = opts.entry;
  if (Number.isFinite(opts.stop)) levels.stop = opts.stop;
  if (Number.isFinite(opts.target)) levels.target = opts.target;

  const name = meta.name;
  const swing = priorSwing(sc.candles, sc.start, sc.end, levels.bull);
  const useFib = !!opts.fib || (opts.fib !== false && !!swing && meta.kind === 'reversal');

  const steps = [
    {
      key: 'context',
      label: 'Context',
      caption: bias === 'bullish'
        ? 'Price has been declining into a level. Scalpers watch the short timeframe for rejection.'
        : bias === 'bearish'
          ? 'Price has been rallying into a level. Scalpers watch for rejection on the short timeframe.'
          : 'Price is pausing. A doji or indecision print needs context and confirmation.',
      to: sc.start,
      apply(chart) {
        if (!useFib || !swing) return;
        // Trend segment through the prior swing into the pattern.
        chart.addSegment({
          a: swing.a, b: swing.b, color: 'info', width: 2, dashed: true, label: 'Prior swing',
        });
      },
    },
    {
      key: 'pattern',
      label: 'Pattern',
      caption: `${name} prints — watch the shape against the prior move.`,
      to: sc.end + 1,
      apply(chart) {
        chart.addBox({
          from: sc.start, to: sc.end,
          color: levels.bull ? 'bull' : bias === 'bearish' ? 'bear' : 'accent',
          label: name,
        });
        if (useFib && swing) {
          chart.addFib({
            a: swing.a, b: swing.b, ratios: FIB_RATIOS, zone: FIB_ZONE, color: 'fib',
          });
        }
      },
    },
    {
      key: 'confirm',
      label: 'Confirm',
      caption: Number.isFinite(sc.confirm)
        ? `Confirmation: next candle pushes through ${sc.confirm.toFixed(2)}. Tight stop beyond the wick extreme.`
        : 'Confirmation candle prints. Wait for the close before acting.',
      to: Math.min(sc.candles.length, sc.end + 2),
      apply(chart) {
        const idx = Math.min(sc.candles.length - 1, sc.end + 1);
        chart.addMarker({
          idx,
          position: levels.bull ? 'below' : 'above',
          shape: 'arrow',
          text: 'Confirm',
          color: 'accent',
        });
        if (Number.isFinite(sc.confirm)) {
          chart.addHLine({ price: sc.confirm, color: 'accent', dashed: true, label: 'Confirm' });
        }
      },
    },
    {
      key: 'plan',
      label: 'Trade plan',
      caption: levels.bull
        ? `Entry near ${levels.entry.toFixed(2)}, stop under the low (${levels.stop.toFixed(2)}), quick scalp target ~1.5–2R (${levels.target.toFixed(2)}).`
        : `Entry near ${levels.entry.toFixed(2)}, stop above the high (${levels.stop.toFixed(2)}), quick scalp target ~1.5–2R (${levels.target.toFixed(2)}).`,
      to: Math.min(sc.candles.length, levels.entryIdx + 3),
      apply(chart) {
        chart.addMarker({
          idx: levels.entryIdx,
          position: levels.bull ? 'below' : 'above',
          shape: 'arrow',
          text: 'Entry',
          color: 'accent',
        });
        chart.addHLine({ price: levels.stop, color: 'bear', label: 'Stop' });
        chart.addHLine({ price: levels.target, color: 'bull', label: 'Target' });
      },
    },
    {
      key: 'follow',
      label: 'Follow-through',
      caption: 'Follow-through is never guaranteed — the stop was set before the entry for that reason.',
      to: sc.candles.length,
      apply() {},
    },
  ];

  return {
    kind: 'candle',
    patternId,
    name,
    bias,
    candles: sc.candles,
    steps,
    levels,
    symbol: opts.symbol || 'TTS / SIM',
    interval: opts.interval || '5M',
  };
}

function buildChartPlan(patternId, opts = {}) {
  const meta = CHART_PATTERNS[patternId];
  if (!meta) throw new Error(`Unknown chart pattern: ${patternId}`);
  const seed = opts.seed ?? 202;
  const sc = chartScenario(patternId, {
    seed,
    count: opts.count ?? 96,
    after: opts.after ?? 16,
    outcome: opts.outcome || 'success',
  });
  // Playbook fades (outcome 'fail' with a bias against the breakout) trade the failure, not the break.
  const fade = opts.outcome === 'fail' && (opts.bias === 'bullish' || opts.bias === 'bearish')
    && (opts.bias === 'bullish') !== (sc.direction > 0);
  const levels = fade ? fadeLevelsChart(sc) : tradeLevelsChart(sc);
  if (Number.isFinite(opts.entry)) levels.entry = opts.entry;
  if (Number.isFinite(opts.stop)) levels.stop = opts.stop;
  if (Number.isFinite(opts.target)) levels.target = opts.target;

  const name = meta.name;
  const mid = Math.round((sc.patternStart + sc.patternEnd) / 2);

  const steps = [
    {
      key: 'context',
      label: 'Context',
      caption: 'Prior structure sets the stage for the pattern.',
      to: Math.max(1, sc.patternStart),
      apply() {},
    },
    {
      key: 'forming',
      label: 'Forming',
      caption: `${name} is taking shape. Volume often fades as the range compresses.`,
      to: mid + 1,
      apply(chart) {
        if (sc.neckline) {
          chart.addSegment({
            a: { idx: sc.neckline.x1, price: sc.neckline.y1 },
            b: { idx: sc.neckline.x2, price: sc.neckline.y2 },
            color: 'accent', dashed: true, label: 'Neckline',
          });
        } else if (sc.boundaries) {
          const { upper, lower } = sc.boundaries;
          chart.addSegment({
            a: { idx: upper.x1, price: upper.y1 },
            b: { idx: upper.x2, price: upper.y2 },
            color: 'accent', dashed: true, label: 'Upper',
          });
          chart.addSegment({
            a: { idx: lower.x1, price: lower.y1 },
            b: { idx: lower.x2, price: lower.y2 },
            color: 'accent', dashed: true, label: 'Lower',
          });
        }
        chart.addBox({
          from: sc.patternStart, to: sc.patternEnd,
          color: levels.bull ? 'bull' : 'bear',
          label: name,
        });
      },
    },
    {
      key: 'breakout',
      label: 'Breakout',
      caption: `Breakout close through the level near ${Number.isFinite(sc.level) ? sc.level.toFixed(2) : 'the line'}.`,
      to: sc.breakoutIdx + 1,
      apply(chart) {
        if (Number.isFinite(sc.level)) {
          chart.addHLine({ price: sc.level, color: 'accent', dashed: true, label: 'Level' });
        }
        chart.addMarker({
          idx: sc.breakoutIdx,
          position: levels.bull ? 'above' : 'below',
          shape: 'dot',
          text: 'Break',
          color: 'accent',
        });
      },
    },
    {
      key: 'plan',
      label: 'Trade plan',
      caption: fade
        ? `Fade: ${levels.bull ? 'buy' : 'sell'} the close back inside at ${levels.entry.toFixed(2)}, stop beyond the fakeout ${levels.bull ? 'low' : 'high'} (${levels.stop.toFixed(2)}), target the other side of the range (${levels.target.toFixed(2)}).`
        : `Entry ${levels.entry.toFixed(2)}, stop ${levels.stop.toFixed(2)}, measured target ${levels.target.toFixed(2)}.`,
      to: Math.min(sc.candles.length, levels.entryIdx + 4),
      apply(chart) {
        chart.addMarker({
          idx: levels.entryIdx,
          position: levels.bull ? 'above' : 'below',
          shape: 'arrow',
          text: 'Entry',
          color: 'accent',
        });
        chart.addHLine({ price: levels.stop, color: 'bear', label: 'Stop' });
        chart.addHLine({ price: levels.target, color: 'bull', label: 'Target' });
      },
    },
    {
      key: 'follow',
      label: 'Follow-through',
      caption: fade
        ? 'The breakout failed: trapped breakout traders exit and fuel the move back across the range.'
        : sc.outcome === 'success'
          ? 'Follow-through toward the measured move. Not every pattern gets there — manage risk.'
          : 'This outcome failed — traps happen; the stop was there for a reason.',
      to: sc.candles.length,
      apply() {},
    },
  ];

  return {
    kind: 'chart',
    patternId,
    name,
    bias: fade ? opts.bias : sc.bias,
    candles: sc.candles,
    steps,
    levels,
    symbol: opts.symbol || 'TTS / SIM',
    interval: opts.interval || '1H',
  };
}

/**
 * Build a playback plan (candles + stepped captions/overlays) without mounting.
 * buildPatternPlan({ kind, patternId, bias, entry, stop, target, seed, fib, outcome, … })
 */
export function buildPatternPlan({ kind = 'candle', patternId, ...rest } = {}) {
  if (kind === 'chart') return buildChartPlan(patternId, rest);
  return buildCandlePlan(patternId, rest);
}

/**
 * Mount a Home-hero-style pattern simulation into `container`.
 * Returns { destroy, play, pause, replay, plan }.
 *
 * mountPatternPlayback(container, {
 *   kind: 'candle'|'chart', patternId, bias?, seed?, height?, autoplay?,
 *   fib?, entry?, stop?, target?, symbol?, interval?, outcome?,
 * })
 */
export function mountPatternPlayback(container, opts = {}) {
  if (!container) throw new Error('mountPatternPlayback: container required');
  const {
    patternId,
    height: heightOpt,
    autoplay = true,
    CandleChart: ChartCtor,
  } = opts;

  if (!patternId) throw new Error('mountPatternPlayback: patternId required');

  let plan;
  try {
    plan = buildPatternPlan(opts);
  } catch (err) {
    container.append(h('p', { class: 'callout callout--warn' }, `Simulation unavailable: ${err.message || err}`));
    return { destroy() {}, play() {}, pause() {}, replay() {}, plan: null };
  }

  const reduce = reducedMotion();
  const tickerPrice = h('span', { class: 'pps__px mono' }, '—');
  const tickerChange = h('span', { class: 'pps__chg mono' }, '');
  const canvas = h('div', { class: 'pps__canvas' });
  const stepEls = plan.steps.map((s, i) =>
    h('li', { class: 'pps__step', 'data-step': s.key },
      h('span', { class: 'pps__step-bar', 'aria-hidden': 'true' }, h('span')),
      h('span', { class: 'pps__step-label' },
        h('span', { class: 'mono' }, String(i + 1).padStart(2, '0')),
        s.label)));
  const caption = h('p', { class: 'pps__caption', 'aria-live': 'polite' },
    'Press Play to walk through the setup, one step at a time.');
  const playBtn = h('button', {
    type: 'button', class: 'btn btn--sm btn--primary pps__play', 'aria-label': 'Play simulation',
  }, icon('play', { size: 14 }), ' Play');
  const replayBtn = h('button', {
    type: 'button', class: 'btn btn--sm btn--ghost pps__replay', 'aria-label': 'Replay from start',
  }, icon('restart', { size: 14 }), ' Replay');

  const root = h('div', {
    class: 'pps',
    role: 'group',
    'aria-label': `${plan.name} animated walk-through`,
  },
    h('div', { class: 'pps__ticker' },
      h('span', { class: 'pps__sym mono' }, plan.symbol),
      h('span', { class: 'chip chip--sm chip--outline mono' }, plan.interval),
      h('span', { class: `chip chip--sm ${plan.bias === 'bearish' ? 'chip--bear' : plan.bias === 'bullish' ? 'chip--bull' : 'chip--outline'}` },
        plan.bias === 'bearish' ? 'Short' : plan.bias === 'bullish' ? 'Long' : 'Watch'),
      h('span', { class: 'pps__spacer' }),
      tickerPrice,
      tickerChange),
    canvas,
    h('ol', { class: 'pps__steps', 'aria-hidden': 'true' }, stepEls),
    caption,
    h('div', { class: 'pps__controls' }, playBtn, replayBtn));

  container.append(root);

  let Chart = ChartCtor;
  let chart = null;
  let alive = true;
  let playing = false;
  let running = false;
  let runToken = 0;
  let visible = true;
  let wake = null;

  const STOP = Symbol('stop');
  const gate = () => {
    if (!alive) return Promise.reject(STOP);
    if (visible && (typeof document === 'undefined' || !document.hidden)) return Promise.resolve();
    return new Promise((res, rej) => {
      wake = () => (alive ? res() : rej(STOP));
    });
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms)).then(gate);
  const tween = (ms, fn) => new Promise((res, rej) => {
    const t0 = performance.now();
    const tick = (now) => {
      if (!alive) return rej(STOP);
      const t = Math.min(1, (now - t0) / ms);
      fn(1 - Math.pow(1 - t, 3), t);
      if (t < 1) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  }).then(gate);

  const setStep = (idx, progress = 1) => {
    stepEls.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-done', i < idx || (i === idx && progress >= 1));
      const bar = el.querySelector('.pps__step-bar > span');
      if (bar) bar.style.transform = `scaleX(${i < idx ? 1 : i === idx ? progress : 0})`;
    });
    if (idx >= 0 && plan.steps[idx]) caption.textContent = plan.steps[idx].caption;
  };

  const updateTicker = (n) => {
    const { candles } = plan;
    const last = candles[Math.max(0, n - 1)];
    const first = candles[0];
    if (!last) return;
    tickerPrice.textContent = last.c.toFixed(2);
    const chg = ((last.c - first.o) / first.o) * 100;
    tickerChange.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    tickerChange.className = `pps__chg mono ${chg >= 0 ? 'up' : 'down'}`;
  };

  const heightFor = () => {
    if (heightOpt) return heightOpt;
    return (typeof window !== 'undefined' && window.innerWidth < 720) ? 240 : 320;
  };

  async function ensureChart() {
    if (!Chart) {
      const mod = await import('./chart.js');
      Chart = mod.CandleChart;
    }
  }

  function buildChart() {
    const { candles } = plan;
    const [lo, hi] = padRange(candles);
    if (chart) {
      try { chart.destroy(); } catch (err) { console.error(err); }
      canvas.replaceChildren();
    }
    chart = new Chart(canvas, {
      candles,
      height: heightFor(),
      visible: reduce ? candles.length : 0,
      autoscale: [lo, hi],
      showVolume: false,
      crosshair: true,
      ariaLabel: `${plan.name} simulation`,
    });
    return chart;
  }

  function finalFrame() {
    buildChart();
    chart.setVisible(plan.candles.length);
    updateTicker(plan.candles.length);
    for (const step of plan.steps) {
      try { step.apply?.(chart, plan); } catch (err) { console.error(err); }
    }
    stepEls.forEach((el) => {
      el.classList.add('is-done');
      el.classList.remove('is-active');
      const bar = el.querySelector('.pps__step-bar > span');
      if (bar) bar.style.transform = 'scaleX(1)';
    });
    caption.textContent = `${plan.name}: context → pattern → confirmation → entry / stop / target.`;
    playBtn.replaceChildren(icon('play', { size: 14 }), ' Play');
    playBtn.setAttribute('aria-label', 'Play simulation');
    playing = false;
  }

  async function runSequence(token) {
    await ensureChart();
    if (!alive || token !== runToken) return;
    running = true;
    if (reduce) {
      finalFrame();
      running = false;
      return;
    }
    buildChart();
    setStep(-1, 0);
    caption.textContent = 'Watch the setup form, one candle at a time.';
    updateTicker(0);
    let n = 0;
    const revealTo = async (to, interval) => {
      const target = clamp(to, 0, plan.candles.length);
      while (n < target) {
        if (!alive || token !== runToken) throw STOP;
        while (!playing && alive && token === runToken) await wait(80);
        if (!alive || token !== runToken) throw STOP;
        n += 1;
        chart.setVisible(n);
        updateTicker(n);
        await wait(interval);
      }
    };

    playing = true;
    playBtn.replaceChildren(icon('pause', { size: 14 }), ' Pause');
    playBtn.setAttribute('aria-label', 'Pause simulation');

    try {
      for (let i = 0; i < plan.steps.length; i++) {
        if (!alive || token !== runToken) throw STOP;
        while (!playing && alive && token === runToken) await wait(120);
        if (!alive || token !== runToken) throw STOP;
        const step = plan.steps[i];
        const interval = plan.kind === 'chart' ? 28 : 48;
        setStep(i, 0);
        await revealTo(step.to, interval);
        try { step.apply?.(chart, plan); } catch (err) { console.error(err); }
        chart.flash?.(Math.max(0, step.to - 1), 'accent');
        await tween(420, (e) => setStep(i, e));
        await wait(i === plan.steps.length - 1 ? 600 : 700);
      }
      stepEls.forEach((el) => el.classList.add('is-done'));
      caption.textContent = `${plan.name} walk-through complete. Hit Replay to watch again.`;
    } catch (err) {
      if (err !== STOP) console.error('[pattern-playback]', err);
    } finally {
      if (token === runToken) {
        playing = false;
        running = false;
        playBtn.replaceChildren(icon('play', { size: 14 }), ' Play');
        playBtn.setAttribute('aria-label', 'Play simulation');
      }
    }
  }

  function play() {
    if (playing) return;
    // Resume a paused run; otherwise start (or restart after completion).
    if (running) {
      playing = true;
      playBtn.replaceChildren(icon('pause', { size: 14 }), ' Pause');
      playBtn.setAttribute('aria-label', 'Pause simulation');
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
      return;
    }
    replay();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    playBtn.replaceChildren(icon('play', { size: 14 }), ' Play');
    playBtn.setAttribute('aria-label', 'Play simulation');
  }

  function replay() {
    runToken += 1;
    playing = true;
    const token = runToken;
    runSequence(token).catch(() => {});
  }

  function togglePlay() {
    if (playing) pause();
    else play();
  }

  playBtn.addEventListener('click', togglePlay);
  replayBtn.addEventListener('click', () => replay());

  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && wake) {
        const w = wake;
        wake = null;
        w();
      }
    }, { threshold: 0.12 })
    : null;
  io?.observe(root);

  const onVis = () => {
    if (typeof document !== 'undefined' && !document.hidden && visible && wake) {
      const w = wake;
      wake = null;
      w();
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

  // Initial paint: reduced motion → final frame; else idle at 0 or autoplay.
  ensureChart().then(() => {
    if (!alive) return;
    if (reduce) {
      finalFrame();
      return;
    }
    buildChart();
    updateTicker(0);
    if (autoplay) replay();
  }).catch((err) => console.error('[pattern-playback] chart load failed:', err));

  return {
    destroy() {
      alive = false;
      playing = false;
      runToken += 1;
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
      io?.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      try { chart?.destroy(); } catch (err) { console.error(err); }
      chart = null;
      root.remove();
    },
    play,
    pause,
    replay,
    plan,
  };
}

export default { mountPatternPlayback, buildPatternPlan };
