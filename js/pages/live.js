// Live Market Lab — #live. Quote board (Massive.com via market-data edge function) + detail chart.
// Polls every 45s; keeps last good data on failure and marks it stale. Educational only.
import { h, icon, svg } from '../core/ui.js';

const POLL_MS = 45_000;
const BOARD = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'BTC-USD', 'EUR-USD'];

function fmtPrice(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function sparklineSvg(values, { up = true } = {}) {
  const vals = (values || []).filter((v) => Number.isFinite(v));
  if (vals.length < 2) {
    return h('span', { class: 'live-spark live-spark--empty', 'aria-hidden': 'true' });
  }
  const w = 96;
  const ht = 36;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 4) + 2;
    const y = ht - 4 - ((v - min) / span) * (ht - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return svg('svg', {
    class: ['live-spark', up ? 'is-up' : 'is-down'],
    width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, 'aria-hidden': 'true', focusable: 'false',
  }, svg('polyline', { points: pts, fill: 'none', 'stroke-width': 1.75 }));
}

function quoteCard(q, { selected, onSelect }) {
  const up = (q.change ?? 0) >= 0;
  const dec = q.symbol?.includes('EUR') ? 4 : 2;
  return h('button', {
    type: 'button',
    class: ['live-quote card', selected && 'is-selected', q.ok === false && 'is-dead'],
    'aria-pressed': selected ? 'true' : 'false',
    'aria-label': `${q.name || q.symbol}, ${fmtPrice(q.price, dec)}, ${fmtPct(q.changePct)}`,
    on: { click: () => onSelect(q.symbol) },
  },
    h('div', { class: 'live-quote__top' },
      h('span', { class: 'live-quote__sym mono' }, q.symbol),
      sparklineSvg(q.sparkline, { up })),
    h('p', { class: 'live-quote__name faint' }, q.name || q.symbol),
    h('p', { class: ['live-quote__px', 'mono', up ? 'is-up' : 'is-down'] }, fmtPrice(q.price, dec)),
    h('p', { class: ['live-quote__chg', 'mono', up ? 'is-up' : 'is-down'] },
      q.change == null ? '—' : `${up ? '+' : ''}${fmtPrice(q.change, dec)} (${fmtPct(q.changePct)})`),
  );
}

export default {
  id: 'live',
  async mount(root) {
    const [chartMod, dataMod, marketMod] = await Promise.all([
      import('../core/chart.js').catch(() => null),
      import('../core/data.js').catch(() => null),
      import('../core/market.js').catch(() => null),
    ]);

    let selected = 'SPY';
    let lastQuotes = [];
    let lastFetchedAt = 0;
    let stale = false;
    let attribution = '';
    let chart = null;
    let pollTimer = null;
    let destroyed = false;

    const statusEl = h('span', { class: 'live-status__text' });
    const dot = h('span', { class: 'live-dot live-dot--lg', 'aria-hidden': 'true' });
    const updatedEl = h('span', { class: 'live-updated mono faint' });
    const board = h('div', { class: 'live-board', role: 'list', 'aria-label': 'Market quotes' });
    const chartHost = h('div', { class: 'chart-frame live__chart' });
    const attrib = h('p', { class: 'faint live-attrib' });
    const note = h('p', { class: 'faint live-footnote' },
      'Quotes arrive through our server (Massive.com / Polygon-compatible REST) so the browser never sees the API key. ',
      'On the free tier quotes are end-of-day (~5 requests/min upstream) with a ~55s server cache. ',
      'If a refresh fails we keep the last good numbers and mark them stale. Educational use — not for live trading decisions.');

    const setStatus = (key, text) => {
      statusEl.textContent = text || key;
      dot.dataset.state = key;
    };

    const paintUpdated = () => {
      if (!lastFetchedAt) {
        updatedEl.textContent = 'Not updated yet';
        return;
      }
      const t = new Date(lastFetchedAt);
      const label = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      updatedEl.textContent = stale ? `Last updated ${label} · stale` : `Last updated ${label}`;
    };

    const paintBoard = () => {
      const list = lastQuotes.length
        ? lastQuotes
        : BOARD.map((id) => ({ symbol: id, name: id, price: null, change: null, changePct: null, sparkline: [], ok: false }));
      board.replaceChildren(...list.map((q) => quoteCard(q, {
        selected: q.symbol === selected,
        onSelect: (id) => {
          selected = id;
          paintBoard();
          loadChart(id);
        },
      })));
    };

    const loadChart = async (symbol) => {
      if (!chartMod) return;
      let candles = null;
      if (marketMod?.getCandles) {
        try {
          const res = await marketMod.getCandles({ symbol, interval: '1d', limit: 90 });
          candles = res?.candles?.length ? res.candles : null;
          if (res?.attribution) {
            attrib.textContent = [
              attribution,
              res.attribution,
              res.stale ? 'Chart cache stale' : null,
            ].filter(Boolean).join(' · ');
          }
        } catch {
          candles = null;
        }
      }
      if (!candles?.length && dataMod) {
        candles = dataMod.randomWalk({ seed: symbol.length * 99, count: 90, drift: 0.0003, vol: 0.012 });
        attrib.textContent = [attribution, 'Chart: simulated (real daily history unavailable)'].filter(Boolean).join(' · ');
      }
      if (!candles?.length) return;
      if (!chart) {
        chart = new chartMod.CandleChart(chartHost, {
          candles, height: 360, showVolume: true, ariaLabel: `${symbol} daily chart`,
        });
      } else {
        chart.setCandles(candles);
      }
    };

    const refreshQuotes = async () => {
      if (destroyed || !marketMod?.getQuotes) {
        setStatus('offline', 'Quotes module unavailable');
        return;
      }
      setStatus(lastQuotes.length ? (stale ? 'stale' : 'live') : 'connecting',
        lastQuotes.length ? (stale ? 'Refreshing… (showing last good)' : 'Refreshing…') : 'Connecting…');
      try {
        const res = await marketMod.getQuotes({ symbols: BOARD });
        if (destroyed) return;
        if (res.quotes?.some((q) => q.ok)) {
          lastQuotes = res.quotes;
          lastFetchedAt = res.fetchedAt || Date.now();
          stale = !!res.stale;
          attribution = res.attribution || '';
          setStatus(stale ? 'stale' : 'live', stale ? 'Live board · stale data' : 'Live board');
          attrib.textContent = attribution;
        } else if (lastQuotes.length) {
          stale = true;
          setStatus('stale', 'Refresh failed — showing last good quotes');
        } else {
          setStatus('offline', res.error || 'Quotes unavailable');
          attrib.textContent = res.error || '';
        }
      } catch (err) {
        if (lastQuotes.length) {
          stale = true;
          setStatus('stale', 'Network error — showing last good quotes');
        } else {
          setStatus('offline', err?.message || 'Network error');
        }
      }
      paintUpdated();
      paintBoard();
    };

    root.append(h('div', { class: 'container live' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Live Market Lab'),
        h('h1', null, 'Read a market as it moves'),
        h('p', { class: 'lead' },
          'Major ETFs, stocks, Bitcoin and EUR/USD with last price, daily change and a tiny sparkline. ',
          'Tap a card to load a daily chart. Beginner-friendly — practice reading, not placing orders.')),
      h('div', { class: 'live__bar row' },
        h('p', { class: 'live-status', role: 'status' }, dot, statusEl),
        updatedEl,
        h('span', { class: 'grow' }),
        h('button', {
          type: 'button', class: 'btn btn--ghost',
          on: { click: () => refreshQuotes() },
        }, icon('restart', { size: 14 }), 'Refresh')),
      board,
      h('section', { class: 'live-detail card', 'aria-label': 'Selected market chart' },
        h('h2', { class: 't-18 live-detail__title' }, 'Daily chart'),
        chartHost,
        attrib),
      note,
      h('p', { class: 'faint' }, 'Educational only — not financial advice. Prices may be delayed.')));

    paintBoard();
    await refreshQuotes();
    if (!destroyed) await loadChart(selected);
    if (!destroyed) {
      pollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refreshQuotes();
      }, POLL_MS);
    }

    return () => {
      destroyed = true;
      if (pollTimer) clearInterval(pollTimer);
      try { chart?.destroy(); } catch (err) { console.error(err); }
    };
  },
};
