// Live Market Lab — #live. Quote board (Massive.com via market-data edge function) + detail chart
// + market-hours clock / session strip + scrolling ticker. Polls quotes every 45s; hours tick
// every second from the client clock. Educational only.
import { h, icon, svg } from '../core/ui.js';
import { getMarketHoursSnapshot } from '../core/market-hours.js';
import { sma } from '../core/indicators.js';

const POLL_MS = 45_000;
const HOURS_TICK_MS = 1_000;
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

function hoursCard(st) {
  const sessions = st.sessions.join(', ');
  const boundary = st.boundary?.atLabel || '';
  return h('article', {
    class: ['live-hours-card', st.open ? 'is-open' : 'is-closed'],
    'aria-label': `${st.short}: ${st.open ? 'open' : 'closed'}`,
  },
    h('div', { class: 'live-hours-card__head' },
      h('span', { class: 'live-hours-card__name' }, st.short),
      h('span', {
        class: ['live-pill', st.open ? 'live-pill--open' : 'live-pill--closed'],
        'aria-hidden': 'true',
      },
        h('span', { class: 'live-pill__dot' }),
        st.open ? 'Open' : 'Closed')),
    h('p', { class: 'live-hours-card__clock mono' }, st.localTime),
    h('p', { class: 'live-hours-card__tz faint' }, `${st.city} · ${st.tzAbbrev}`),
    h('p', { class: 'live-hours-card__sess faint' }, sessions),
    boundary ? h('p', { class: 'live-hours-card__next faint' }, boundary) : null,
  );
}

function overlapChip(o) {
  return h('span', {
    class: ['live-overlap', o.active && 'is-active'],
    title: o.blurb,
  },
    h('span', { class: 'live-overlap__dot', 'aria-hidden': 'true' }),
    o.label,
    o.active ? h('span', { class: 'live-overlap__tag' }, 'live') : null);
}

function tickerItem(q) {
  const up = (q.change ?? 0) >= 0;
  const dec = q.symbol?.includes('EUR') ? 4 : 2;
  return h('span', { class: ['live-ticker__item', up ? 'is-up' : 'is-down'] },
    h('span', { class: 'live-ticker__sym mono' }, q.symbol),
    h('span', { class: 'live-ticker__px mono' }, fmtPrice(q.price, dec)),
    h('span', { class: 'live-ticker__chg mono' }, fmtPct(q.changePct)));
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
    let liveMaId = null;
    let pollTimer = null;
    let hoursTimer = null;
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

    // —— Market hours / sessions UI ——————————————————————————————————————————
    const hoursEquity = h('div', { class: 'live-hours__grid', role: 'list', 'aria-label': 'Equity market hours' });
    const hoursForex = h('div', { class: 'live-hours__grid', role: 'list', 'aria-label': 'Forex session hours' });
    const sessionContext = h('p', { class: 'live-session__context' });
    const overlapRow = h('div', { class: 'live-session__overlaps', role: 'list', 'aria-label': 'Session overlaps' });
    const clientTzEl = h('p', { class: 'faint live-hours__note' });
    const sessionActive = h('p', { class: 'live-session__active' });

    const tickerTrack = h('div', { class: 'live-ticker__track', 'aria-hidden': 'true' });
    const ticker = h('div', {
      class: 'live-ticker',
      role: 'marquee',
      'aria-label': 'Scrolling quote ticker',
    }, tickerTrack);

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

    const paintTicker = () => {
      const list = lastQuotes.filter((q) => q.ok !== false && q.price != null);
      if (!list.length) {
        tickerTrack.replaceChildren(
          h('span', { class: 'live-ticker__item live-ticker__item--muted' }, 'Waiting for quotes…'),
        );
        ticker.classList.remove('is-running');
        return;
      }
      // Duplicate strip for seamless CSS loop
      const items = [...list, ...list].map(tickerItem);
      tickerTrack.replaceChildren(...items);
      ticker.classList.add('is-running');
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
      paintTicker();
    };

    const paintHours = () => {
      if (destroyed) return;
      const snap = getMarketHoursSnapshot();
      hoursEquity.replaceChildren(...snap.equities.map(hoursCard));
      hoursForex.replaceChildren(...snap.forex.map(hoursCard));
      overlapRow.replaceChildren(...snap.overlaps.map(overlapChip));

      const eq = snap.activeEquities.length
        ? `Equities: ${snap.activeEquities.join(', ')}`
        : 'Equities: none open';
      const fx = snap.activeForex.length
        ? `Forex: ${snap.activeForex.join(', ')}`
        : 'Forex: no major session open';
      sessionActive.textContent = `${eq} · ${fx}`;
      sessionContext.textContent = snap.context;
      clientTzEl.textContent = `Times use each venue’s local zone (DST-aware via your browser). Your clock: ${snap.clientTz}. Exchange holidays not tracked.`;
    };

    /** Yellow SMA 20 only on real Massive-backed daily bars (not simulated fallback). */
    const syncLiveIndicator = (candles, isReal) => {
      if (!chart) return;
      if (liveMaId) {
        chart.remove(liveMaId);
        liveMaId = null;
      }
      if (!isReal || !candles?.length) return;
      liveMaId = chart.addSeries({
        values: sma(candles.map((c) => c.c), 20),
        color: 'live-indicator',
        width: 1.75,
        label: 'SMA 20',
      });
    };

    const loadChart = async (symbol) => {
      if (!chartMod) return;
      chartHost.classList.add('is-switching');
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
      let isRealMassive = !!(candles?.length);
      if (!candles?.length && dataMod) {
        candles = dataMod.randomWalk({ seed: symbol.length * 99, count: 90, drift: 0.0003, vol: 0.012 });
        attrib.textContent = [attribution, 'Chart: simulated (real daily history unavailable)'].filter(Boolean).join(' · ');
        isRealMassive = false;
      }
      if (!candles?.length) {
        syncLiveIndicator(null, false);
        chartHost.classList.remove('is-switching');
        return;
      }
      if (!chart) {
        chart = new chartMod.CandleChart(chartHost, {
          candles, height: 360, showVolume: true, ariaLabel: `${symbol} daily chart`,
        });
      } else {
        chart.setCandles(candles);
      }
      syncLiveIndicator(candles, isRealMassive);
      // Allow CSS fade to settle
      requestAnimationFrame(() => {
        if (!destroyed) chartHost.classList.remove('is-switching');
      });
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

      ticker,

      h('section', { class: 'live-hours card', 'aria-label': 'Market hours and sessions' },
        h('div', { class: 'live-hours__head row' },
          h('h2', { class: 't-18' }, 'Market hours'),
          h('span', { class: 'live-hours__live row' },
            h('span', { class: 'live-dot', 'data-state': 'live', 'aria-hidden': 'true' }),
            h('span', { class: 'faint' }, 'Live schedule'))),
        h('h3', { class: 'live-hours__sub' }, 'Equity floors'),
        hoursEquity,
        h('h3', { class: 'live-hours__sub' }, 'Forex sessions'),
        hoursForex,
        clientTzEl),

      h('section', { class: 'live-session card', 'aria-label': 'Active market sessions' },
        h('h2', { class: 't-18' }, 'Active sessions'),
        sessionActive,
        h('div', { class: 'live-session__body' },
          h('p', { class: 'live-session__label faint' }, 'Overlaps'),
          overlapRow),
        sessionContext),

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
    paintHours();
    await refreshQuotes();
    if (!destroyed) await loadChart(selected);
    if (!destroyed) {
      pollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refreshQuotes();
      }, POLL_MS);
      hoursTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        paintHours();
      }, HOURS_TICK_MS);
    }

    return () => {
      destroyed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (hoursTimer) clearInterval(hoursTimer);
      try { chart?.destroy(); } catch (err) { console.error(err); }
    };
  },
};
