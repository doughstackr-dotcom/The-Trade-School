// Live Market Lab (stub) — #live. The full page (ARCHITECTURE §12.6) streams a live (or replayed)
// real chart via market.subscribeLive with indicator toggles and a plain-English read from the
// scanner. This stub shows a simulated chart and connects to market data only on request (or
// automatically in mock mode), so loading the page never fetches anything by itself.
import { h, icon } from '../core/ui.js';

const STATUS_TEXT = {
  live: 'Live',
  replay: 'Replay: a real historical stretch played in real time',
  offline: 'Offline: showing a simulated market',
  sim: 'Simulated market',
  connecting: 'Connecting…',
};

export default {
  id: 'live',
  async mount(root) {
    const [chartMod, dataMod, marketMod] = await Promise.all([
      import('../core/chart.js').catch(() => null),
      import('../core/data.js').catch(() => null),
      import('../core/market.js').catch(() => null),
    ]);
    const statusEl = h('span', { class: 'live-status__text' });
    const dot = h('span', { class: 'live-dot live-dot--lg', 'aria-hidden': 'true' });
    const status = h('p', { class: 'live-status', role: 'status' }, dot, statusEl);
    const attrib = h('p', { class: 'faint live-attrib' });
    const chartHost = h('div', { class: 'chart-frame live__chart' });
    const symbolSel = h('select', { class: 'input live__symbol', 'aria-label': 'Market' },
      (marketMod?.SYMBOLS || [{ id: 'BTC-USD', name: 'Bitcoin' }]).map((s) => h('option', { value: s.id }, `${s.id} · ${s.name || s.id}`)));
    const connectBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'connect' }, icon('bolt'), 'Connect to market data');

    root.append(h('div', { class: 'container live' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Live Market Lab'),
        h('h1', null, 'Read a market as it moves'),
        h('p', { class: 'lead' }, 'A live chart with indicator toggles and a plain-English read of the trend, the nearest levels and recent candle patterns. Coming soon: the automatic read.')),
      h('div', { class: 'live__bar row' }, status, h('span', { class: 'grow' }), symbolSel, connectBtn),
      chartHost,
      attrib,
      h('p', { class: 'faint' }, 'Educational only — not financial advice. Real prices are delayed unless marked Live.')));

    let chart = null;
    let unsub = null;
    const setStatus = (key, text) => {
      statusEl.textContent = text || STATUS_TEXT[key] || key;
      dot.dataset.state = key;
    };
    const draw = (candles) => {
      if (!chartMod || !candles?.length) return;
      if (!chart) chart = new chartMod.CandleChart(chartHost, { candles, height: 380, showVolume: true, ariaLabel: 'Market chart' });
      else chart.setCandles(candles);
    };

    if (dataMod) {
      const sim = dataMod.randomWalk({ seed: 7, count: 120, drift: 0.0004, vol: 0.011 });
      draw(sim);
      setStatus('sim');
    }

    const connect = () => {
      if (!marketMod?.subscribeLive) {
        setStatus('offline');
        return;
      }
      unsub?.();
      setStatus('connecting');
      connectBtn.disabled = true;
      unsub = marketMod.subscribeLive({ symbol: symbolSel.value, interval: '1d', bars: 120 }, (u) => {
        if (!root.isConnected) return;
        if (u.candles?.length) draw(u.candles);
        setStatus(u.status, u.status === 'live' ? `Live · ${u.symbol}` : null);
        attrib.textContent = u.attribution ? `${u.attribution}${u.delayed ? ' · Delayed / end of day' : ''}${u.mock ? ' · Test data' : ''}` : '';
        connectBtn.disabled = false;
      });
    };
    connectBtn.addEventListener('click', connect);
    symbolSel.addEventListener('change', () => {
      if (unsub) connect();
    });
    if (marketMod?.isMockMode?.()) connect();

    return () => {
      unsub?.();
      try {
        chart?.destroy();
      } catch (err) {
        console.error(err);
      }
    };
  },
};
