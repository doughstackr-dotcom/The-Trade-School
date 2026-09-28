// Shared game polish: candle previews, decision charts, swipe, memory, order desk.
import { h, icon, sfx, reducedMotion } from './ui.js';
import { CandleChart, miniChart, candleSVG } from './chart.js';
import { trendSeries } from './data.js';
import { makeRng } from './rng.js';

export function candlePreview(el, { seed = 42, count = 28, direction = 'up', height = 140, width = 260 } = {}) {
  if (!el) return () => {};
  const ts = trendSeries({ seed, count, direction, swings: 3, start: 100 });
  const svgEl = miniChart(ts.candles, { width, height, yPad: 0.1, showAxis: width >= 200, ariaLabel: 'Sample candlestick chart preview' });
  svgEl.classList.add('game-preview-chart');
  el.append(svgEl);
  return () => svgEl.remove();
}

export function gameplayPreview(el, {
  seed = 42, direction = 'up', count = 36, title = 'Arcade',
  score = 420, streak = 3, round = '2/8',
  width = 280, height = 128,
} = {}) {
  if (!el) return () => {};
  const ts = trendSeries({ seed, count, direction, swings: 3, start: 100 });
  const chart = miniChart(ts.candles, { width, height, yPad: 0.1, showAxis: true, ariaLabel: `${title} gameplay preview` });
  chart.classList.add('game-preview-chart');
  const frame = h('div', { class: 'game-preview', 'aria-hidden': 'true' },
    h('div', { class: 'game-preview__hud' },
      h('span', { class: 'game-preview__pill' }, h('small', null, 'Round'), h('strong', { class: 'mono' }, round)),
      h('span', { class: 'game-preview__pill game-preview__pill--score' }, h('small', null, 'Score'), h('strong', { class: 'mono' }, String(score))),
      h('span', { class: 'game-preview__pill game-preview__pill--hot' }, h('small', null, 'Streak'), h('strong', { class: 'mono' }, String(streak)))),
    h('div', { class: 'game-preview__chart' }, chart),
    h('div', { class: 'game-preview__actions' },
      h('span', { class: 'game-preview__chip game-preview__chip--bull' }, 'Bull'),
      h('span', { class: 'game-preview__chip game-preview__chip--bear' }, 'Bear'),
      h('span', { class: 'game-preview__chip' }, '…')));
  el.append(frame);
  return () => frame.remove();
}

export function defaultGamePreview(el, gameId = '') {
  const seed = [...String(gameId)].reduce((a, c) => a + c.charCodeAt(0), 17) || 42;
  return gameplayPreview(el, {
    seed, direction: seed % 2 ? 'up' : 'down', count: 34, title: gameId,
    score: 200 + (seed % 700), streak: 1 + (seed % 5), round: `${1 + (seed % 4)}/8`,
  });
}

export function decisionChart(stage, {
  candles, visible, slots, height = 340, decimals = 2, yPad = 0.14,
  showVolume = false, ariaLabel = 'Decision chart', question = '', className = '', before = null,
} = {}) {
  const host = h('div', { class: 'chart-frame game-chart' });
  const wrap = h('div', { class: ['game-round', className] });
  if (question) wrap.append(h('p', { class: 'quiz__q' }, question));
  if (before) wrap.append(before);
  wrap.append(host);
  stage.append(wrap);
  if (!reducedMotion()) wrap.classList.add('is-enter');
  const chart = new CandleChart(host, {
    candles, visible: visible ?? candles.length, slots: slots ?? candles.length,
    height, decimals, yPad, showVolume, ariaLabel,
  });
  return {
    host, chart, wrap,
    destroy: () => chart.destroy(),
    reveal: (to = candles.length, interval = 40) => { chart.reveal({ to, interval }); wrap.classList.add('is-revealed'); },
  };
}

export function sampleCandle(kind = 'bull', { width = 44, height = 72 } = {}) {
  const templates = {
    bull: { o: 100, h: 112, l: 98, c: 110 }, bear: { o: 110, h: 112, l: 96, c: 98 },
    doji: { o: 100, h: 108, l: 92, c: 100.2 }, hammer: { o: 104, h: 106, l: 90, c: 105 },
    star: { o: 100, h: 114, l: 98, c: 99 }, marubozu: { o: 98, h: 112, l: 98, c: 112 },
  };
  return candleSVG(templates[kind] || templates.bull, { width, height, ariaLabel: `${kind} candle` });
}

export function bindRoundMeter(game) {
  if (!game?.hudExtra) return () => {};
  const fill = h('span', { class: 'game-meter__fill' });
  const label = h('span', { class: 'game-meter__label mono', 'aria-hidden': 'true' });
  const el = h('div', { class: 'game-meter', role: 'progressbar', 'aria-label': 'Round progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' },
    h('span', { class: 'game-meter__track' }, fill), label);
  game.hudExtra.replaceChildren(el);
  const paint = () => {
    const total = game.rounds, cur = game.round || 0;
    let pct;
    if (total == null) {
      pct = Math.min(1, cur / (game.survivalOpts?.stars?.[2] || 15));
      label.textContent = `${cur}`;
      el.setAttribute('aria-valuetext', `${cur} rounds`);
    } else {
      pct = total ? cur / total : 0;
      label.textContent = `${cur}/${total}`;
      el.setAttribute('aria-valuetext', `Round ${cur} of ${total}`);
    }
    fill.style.transform = `scaleX(${pct})`;
    el.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
  };
  paint();
  const prevRender = game._renderRound?.bind(game);
  if (prevRender) game._renderRound = () => { prevRender(); paint(); };
  return () => { if (prevRender) game._renderRound = prevRender; el.remove(); };
}

export function swipeCard({ chartNode, title, body, onTake, onSkip, takeLabel = 'Take', skipLabel = 'Skip', takeClass = 'btn--bull', skipClass = 'btn--ghost' } = {}) {
  const card = h('div', { class: 'swipe-card' });
  if (chartNode) card.append(h('div', { class: 'swipe-card__chart' }, chartNode));
  if (title) card.append(h('h3', { class: 'swipe-card__title' }, title));
  if (body) card.append(h('p', { class: 'swipe-card__body muted' }, body));
  const actions = h('div', { class: 'swipe-card__actions' },
    h('button', { type: 'button', class: ['btn', skipClass, 'btn--lg'], onclick: () => { card.classList.add('is-skip'); onSkip?.(); } }, skipLabel),
    h('button', { type: 'button', class: ['btn', takeClass, 'btn--lg'], onclick: () => { card.classList.add('is-take'); onTake?.(); } }, takeLabel));
  card.append(actions);
  return card;
}

export function memoryBoard({ faces, onMatch, onMismatch, onDone, columns = 4 } = {}) {
  const board = h('div', { class: 'memory-board', style: { '--cols': String(columns) } });
  let first = null, lock = false, matched = 0;
  const totalPairs = faces.length / 2;
  faces.forEach((face, i) => {
    const front = h('div', { class: 'memory-card__face memory-card__face--front' }, icon('spark', { size: 22 }));
    const back = h('div', { class: 'memory-card__face memory-card__face--back' });
    if (typeof face.node === 'function') back.append(face.node());
    else if (face.node) back.append(face.node);
    else back.append(h('span', { class: 'mono' }, face.label || '?'));
    const card = h('button', { type: 'button', class: 'memory-card', 'aria-label': 'Hidden card', 'data-key': face.key, 'data-i': String(i) }, front, back);
    card.addEventListener('click', () => {
      if (lock || card.classList.contains('is-flipped') || card.classList.contains('is-matched')) return;
      card.classList.add('is-flipped'); sfx.click();
      if (!first) { first = card; return; }
      lock = true;
      if (first.dataset.key === card.dataset.key) {
        first.classList.add('is-matched'); card.classList.add('is-matched');
        matched += 1; sfx.correct(); onMatch?.(first.dataset.key); first = null; lock = false;
        if (matched >= totalPairs) onDone?.();
      } else {
        sfx.wrong(); onMismatch?.(first.dataset.key, card.dataset.key);
        const a = first, b = card; first = null;
        setTimeout(() => { a.classList.remove('is-flipped'); b.classList.remove('is-flipped'); lock = false; }, reducedMotion() ? 200 : 700);
      }
    });
    board.append(card);
  });
  return board;
}

export function orderLadder({ mid = 100, tick = 0.25, levels = 7, seed = 1, onPick } = {}) {
  const rng = makeRng(seed);
  const wrap = h('div', { class: 'order-desk' });
  const book = h('div', { class: 'order-desk__book', role: 'list' });
  const rows = [];
  for (let i = levels; i >= 1; i--) {
    const price = +(mid + i * tick).toFixed(2);
    const size = 2 + Math.floor(rng.next() * 18);
    rows.push({ side: 'ask', price, size });
  }
  rows.push({ side: 'mid', price: +mid.toFixed(2), size: 0 });
  for (let i = 1; i <= levels; i++) {
    const price = +(mid - i * tick).toFixed(2);
    const size = 2 + Math.floor(rng.next() * 18);
    rows.push({ side: 'bid', price, size });
  }
  rows.forEach((r) => {
    if (r.side === 'mid') {
      book.append(h('div', { class: 'order-desk__mid', role: 'listitem' },
        h('span', { class: 'muted' }, 'Last'), h('strong', { class: 'mono' }, r.price.toFixed(2))));
      return;
    }
    const bar = h('span', { class: 'order-desk__bar', style: { width: `${Math.min(100, r.size * 5)}%` } });
    const btn = h('button', { type: 'button', class: [`order-desk__row`, `order-desk__row--${r.side}`], role: 'listitem',
      onclick: () => {
        book.querySelectorAll('.is-picked').forEach((n) => n.classList.remove('is-picked'));
        btn.classList.add('is-picked'); onPick?.(r);
      } },
      h('span', { class: 'order-desk__side' }, r.side.toUpperCase()),
      h('span', { class: 'order-desk__price mono' }, r.price.toFixed(2)),
      h('span', { class: 'order-desk__size mono' }, String(r.size)),
      h('span', { class: 'order-desk__depth' }, bar));
    book.append(btn);
  });
  wrap.append(
    h('div', { class: 'order-desk__legend' },
      h('span', null, 'Side'), h('span', null, 'Price'), h('span', null, 'Size'), h('span', null, 'Depth')),
    book);
  return wrap;
}

export function pickBankIndex(bank, used, rng) {
  if (!bank.length) return 0;
  if (used.size >= bank.length) used.clear();
  let idx = Math.floor((typeof rng === 'function' ? rng() : rng.next()) * bank.length), guard = 0;
  while (used.has(idx) && guard++ < 40) idx = Math.floor((typeof rng === 'function' ? rng() : rng.next()) * bank.length);
  used.add(idx);
  return idx;
}

export function verdictFlourish(stage, { ok, title, detail, scoreDelta } = {}) {
  const node = h('div', { class: ['game-flourish', ok ? 'is-win' : 'is-lose'], role: 'status' },
    h('div', { class: 'game-flourish__badge' }, ok ? icon('check', { size: 22 }) : icon('x', { size: 22 })),
    h('div', null,
      h('strong', null, title || (ok ? 'Nailed it' : 'Not quite')),
      detail ? h('p', { class: 'muted' }, detail) : null,
      scoreDelta != null ? h('p', { class: ['mono', ok ? 'bull' : 'bear'] }, `${scoreDelta >= 0 ? '+' : ''}${scoreDelta}`) : null));
  stage.append(node);
  if (!reducedMotion()) requestAnimationFrame(() => node.classList.add('is-in'));
  else node.classList.add('is-in');
  return node;
}

export function tinySeries(seed, direction = 'up', count = 18) {
  return trendSeries({ seed, count, direction, swings: 2, start: 100 }).candles;
}

