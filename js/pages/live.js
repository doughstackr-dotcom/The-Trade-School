// Live Market Lab — #live. Quote board (Massive.com via market-data edge function) + detail chart
// + unified market-hours timeline + scrolling ticker. Auto-polls quotes (~45s); hours tick
// every second. Open-session cards rotate. No manual refresh control. Educational only.
import { h } from '../core/ui.js';
import { getMarketHoursSnapshot, unifiedTimeline } from '../core/market-hours.js';
import { sma } from '../core/indicators.js';
import {
  POLL_MS,
  HOURS_TICK_MS,
  BOARD_ROTATE_MS,
  BOARD_VISIBLE_MAX,
  DEFAULT_BOARD,
  fmtPrice,
  fmtPct,
  quoteCard,
  mountUnifiedHoursTimeline,
  paintUnifiedHoursTimeline,
  openBoardQuotes,
  rotateBoardWindow,
  fallbackBoardQuotes,
  setLiveQuotes,
  getLiveFeedSnapshot,
  getCachedCandles,
  setCachedCandles,
  applyQuoteToCandles,
  subscribeLiveFeed,
  startVisibleIntervals,
} from '../core/live-board.js';

const BOARD = [...DEFAULT_BOARD];

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
    const cachedFeed = getLiveFeedSnapshot();
    let lastQuotes = cachedFeed.quotes?.length ? [...cachedFeed.quotes] : [];
    let lastFetchedAt = cachedFeed.fetchedAt || 0;
    let stale = !!cachedFeed.stale;
    let delayed = true;
    let liveFeed = false;
    let unconfigured = false;
    let attribution = cachedFeed.attribution || '';
    let chart = null;
    let lastCandles = getCachedCandles(selected);
    let liveMaId = null;
    let stopTimers = null;
    let rotateOffset = 0;
    let boardFallback = false;
    let destroyed = false;

    const statusEl = h('span', { class: 'live-status__text' });
    const dot = h('span', { class: 'live-dot live-dot--lg', 'aria-hidden': 'true' });
    const updatedEl = h('span', { class: 'live-updated mono faint' });
    const feedEl = h('span', { class: 'live-feed-badge faint' });
    const board = h('div', { class: 'live-board', role: 'list', 'aria-label': 'Market quotes' });
    const boardNote = h('p', { class: 'faint live-board__note', hidden: true });
    const chartHost = h('div', { class: 'chart-frame live__chart' });

    // —— Unified market hours timeline ——————————————————————————————————————
    const hoursHost = h('div', { class: 'live-hours__timeline-host' });
    const timelineRoot = mountUnifiedHoursTimeline(hoursHost);

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

    const paintFeedBadge = () => {
      if (unconfigured) {
        feedEl.textContent = 'Feed: not configured';
        feedEl.dataset.kind = 'off';
        return;
      }
      if (liveFeed && !delayed) {
        feedEl.textContent = 'Feed: realtime';
        feedEl.dataset.kind = 'live';
        return;
      }
      feedEl.textContent = 'Feed: Massive';
      feedEl.dataset.kind = 'live';
    };

    const paintUpdated = () => {
      if (!lastFetchedAt) {
        updatedEl.textContent = 'Waiting for first quote…';
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
          h('span', { class: 'live-ticker__item live-ticker__item--muted' },
            'Waiting for quotes…'),
        );
        ticker.classList.remove('is-running');
        return;
      }
      const items = [...list, ...list].map(tickerItem);
      tickerTrack.replaceChildren(...items);
      ticker.classList.add('is-running');
    };

    const allBoardQuotes = () => (
      lastQuotes.length
        ? lastQuotes
        : BOARD.map((id) => ({
          symbol: id, name: id, price: null, change: null, changePct: null, sparkline: [], ok: false,
        }))
    );

    const paintBoard = ({ animate = false } = {}) => {
      const all = allBoardQuotes();
      let open = openBoardQuotes(all);
      boardFallback = false;
      if (!open.length) {
        open = fallbackBoardQuotes(all);
        boardFallback = true;
      }

      if (!open.some((q) => q.symbol === selected)) {
        const next = open[0]?.symbol;
        if (next && next !== selected) {
          selected = next;
          loadChart(selected);
        }
      }

      const { visible, offset } = rotateBoardWindow(open, {
        offset: rotateOffset,
        max: BOARD_VISIBLE_MAX,
      });
      rotateOffset = offset;

      board.classList.toggle('is-fallback', boardFallback);
      boardNote.hidden = !boardFallback;
      boardNote.textContent = boardFallback
        ? 'No equity/FX floors open — showing 24/7 markets'
        : '';

      const cards = visible.map((q) => {
        const card = quoteCard(q, {
          selected: q.symbol === selected,
          onSelect: (id) => {
            selected = id;
            paintBoard();
            loadChart(id);
          },
        });
        if (boardFallback) card.classList.add('is-muted');
        if (animate) card.classList.add('is-enter');
        return card;
      });
      board.replaceChildren(...cards);
      if (animate) {
        requestAnimationFrame(() => {
          board.querySelectorAll('.live-quote.is-enter').forEach((el) => {
            // force reflow then let CSS animation run; class can stay for reduced-motion no-ops
            void el.offsetWidth;
          });
        });
      }
      paintTicker();
    };

    const advanceBoardRotation = () => {
      if (destroyed) return;
      const open = openBoardQuotes(allBoardQuotes());
      if (open.length <= BOARD_VISIBLE_MAX) return;
      rotateOffset = (rotateOffset + 1) % open.length;
      paintBoard({ animate: true });
    };

    const paintHours = () => {
      if (destroyed) return;
      const snap = getMarketHoursSnapshot();
      const data = unifiedTimeline(snap.at, snap.clientTz);
      paintUnifiedHoursTimeline(timelineRoot, data);
      // Re-check open set when hours tick (session open/close boundaries)
      const open = openBoardQuotes(allBoardQuotes());
      const showing = [...board.querySelectorAll('.live-quote')].map((el) => {
        const sym = el.querySelector('.live-quote__sym')?.textContent;
        return sym;
      });
      const openIds = new Set(open.map((q) => q.symbol));
      const needRepaint = boardFallback
        ? open.length > 0
        : (open.length === 0 || showing.some((id) => id && !openIds.has(id)));
      if (needRepaint) paintBoard();
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

    /** Patch the chart’s forming daily bar from the latest quote OHLC (board + chart stay aligned). */
    const patchChartFromQuote = (q) => {
      if (!chart || !lastCandles?.length || !q) return;
      const next = applyQuoteToCandles(lastCandles, q);
      if (next === lastCandles) return;
      lastCandles = next;
      setCachedCandles(selected, lastCandles);
      try {
        chart.setCandles(lastCandles);
        syncLiveIndicator(lastCandles, true);
      } catch (err) {
        console.error(err);
      }
    };

    const loadChart = async (symbol) => {
      if (!chartMod) return;
      chartHost.classList.add('is-switching');
      let candles = getCachedCandles(symbol);
      let fromNetwork = false;
      if (marketMod?.getCandles) {
        try {
          const res = await marketMod.getCandles({ symbol, interval: '1d', limit: 90 });
          if (res?.candles?.length) {
            candles = res.candles;
            fromNetwork = true;
          }
        } catch {
          candles = null;
        }
      }
      let isRealMassive = fromNetwork || (!!candles?.length && !!getCachedCandles(symbol));
      if (!candles?.length && dataMod && !unconfigured) {
        candles = dataMod.randomWalk({ seed: symbol.length * 99, count: 90, drift: 0.0003, vol: 0.012 });
        isRealMassive = false;
      }
      if (!candles?.length) {
        lastCandles = null;
        syncLiveIndicator(null, false);
        chartHost.classList.remove('is-switching');
        return;
      }
      const q = lastQuotes.find((x) => x.symbol === symbol && x.ok !== false)
        || getLiveFeedSnapshot().quotes.find((x) => x.symbol === symbol && x.ok !== false);
      lastCandles = applyQuoteToCandles(candles, q) || candles;
      setCachedCandles(symbol, lastCandles);
      if (!chart) {
        chart = new chartMod.CandleChart(chartHost, {
          candles: lastCandles, height: 360, showVolume: true, ariaLabel: `${symbol} daily chart`,
        });
      } else {
        chart.setCandles(lastCandles);
      }
      syncLiveIndicator(lastCandles, isRealMassive);
      requestAnimationFrame(() => {
        if (!destroyed) chartHost.classList.remove('is-switching');
      });
    };

    const refreshQuotes = async () => {
      if (destroyed || !marketMod?.getQuotes) {
        setStatus('offline', 'Quotes module unavailable');
        return;
      }
      setStatus(lastQuotes.some((q) => q.ok) ? (stale ? 'stale' : 'live') : 'connecting',
        lastQuotes.some((q) => q.ok) ? (stale ? 'Refreshing… (showing last good)' : 'Refreshing…') : 'Connecting…');
      try {
        const res = await marketMod.getQuotes({ symbols: BOARD });
        if (destroyed) return;
        const quotes = Array.isArray(res.quotes) ? res.quotes : [];
        const anyOk = quotes.some((q) => q.ok);
        unconfigured = !!(res.unconfigured || /MASSIVE_API_KEY/i.test(res.error || ''));
        delayed = res.delayed !== false;
        liveFeed = !!res.live;
        if (anyOk) {
          lastQuotes = quotes;
          lastFetchedAt = res.fetchedAt || Date.now();
          stale = !!res.stale;
          attribution = res.attribution || '';
          setLiveQuotes({
            quotes, fetchedAt: lastFetchedAt, attribution, stale,
          });
          setStatus(
            stale ? 'stale' : 'live',
            stale ? 'Live board · stale data' : 'Live board',
          );
          const sel = quotes.find((q) => q.symbol === selected && q.ok);
          if (sel) patchChartFromQuote(sel);
        } else if (lastQuotes.some((q) => q.ok)) {
          stale = true;
          setStatus('stale', 'Refresh failed — showing last good quotes');
        } else {
          lastQuotes = quotes.length ? quotes : BOARD.map((id) => ({
            symbol: id, name: id, price: null, change: null, changePct: null, sparkline: [], ok: false,
            error: res.error || (unconfigured ? 'MASSIVE_API_KEY is not set' : 'unavailable'),
          }));
          setStatus(
            'offline',
            unconfigured ? 'Live quotes unavailable' : (res.error || 'Quotes unavailable'),
          );
        }
      } catch (err) {
        if (lastQuotes.some((q) => q.ok)) {
          stale = true;
          setStatus('stale', 'Network error — showing last good quotes');
        } else {
          setStatus('offline', err?.message || 'Network error');
        }
      }
      paintFeedBadge();
      paintUpdated();
      paintBoard();
    };

    root.append(h('div', { class: 'container live' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Live Market Lab'),
        h('h1', null, 'Read a market as it moves'),
        h('p', { class: 'lead' },
          'Major ETFs, stocks, Bitcoin and EUR/USD with last price, daily change and a tiny sparkline. ',
          'Open-session cards rotate on the board — tap one to load a daily chart. ',
          'Beginner-friendly — practice reading, not placing orders.')),

      ticker,

      h('section', { class: 'live-hours card', 'aria-label': 'Market hours timeline' },
        h('div', { class: 'live-hours__head row' },
          h('h2', { class: 't-18' }, 'Market hours'),
          h('span', { class: 'live-hours__live row' },
            h('span', { class: 'live-dot', 'data-state': 'live', 'aria-hidden': 'true' }),
            h('span', { class: 'faint' }, 'Live schedule'))),
        hoursHost),

      h('div', { class: 'live__bar row' },
        h('p', { class: 'live-status', role: 'status' }, dot, statusEl),
        feedEl,
        updatedEl),
      boardNote,
      board,
      h('section', { class: 'live-detail card', 'aria-label': 'Selected market chart' },
        h('h2', { class: 't-18 live-detail__title' }, 'Daily chart'),
        chartHost),
      h('p', { class: 'faint' }, 'Educational only — not financial advice.')));

    paintBoard();
    paintHours();
    paintFeedBadge();
    paintUpdated();
    const unsubFeed = subscribeLiveFeed((reason) => {
      if (destroyed || reason !== 'quotes') return;
      const snap = getLiveFeedSnapshot();
      if (snap.quotes?.length) {
        lastQuotes = snap.quotes;
        lastFetchedAt = snap.fetchedAt || lastFetchedAt;
        stale = !!snap.stale;
        if (snap.attribution) attribution = snap.attribution;
        paintBoard();
        paintUpdated();
        const sel = snap.quotes.find((q) => q.symbol === selected && q.ok);
        if (sel) patchChartFromQuote(sel);
      }
    });

    await refreshQuotes();
    if (!destroyed) await loadChart(selected);
    if (!destroyed) {
      stopTimers = startVisibleIntervals([
        [() => { refreshQuotes(); loadChart(selected); }, POLL_MS],
        [paintHours, HOURS_TICK_MS],
        [advanceBoardRotation, BOARD_ROTATE_MS],
      ]);
    }

    return () => {
      destroyed = true;
      unsubFeed?.();
      stopTimers?.();
      try { chart?.destroy(); } catch (err) { console.error(err); }
    };
  },
};
