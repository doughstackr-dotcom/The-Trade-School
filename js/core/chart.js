// CandleChart — interactive SVG candlestick chart — plus miniChart() thumbnails and candleSVG().
// Standalone engine: imports only anim.js. No DOM access at import time.
// Styling lives in css/chart.css (.tc-* classes); colours come from design tokens.
//
// Public facade. The engine lives in js/core/chart/:
//   util.js          constants + pure helpers (ticks, colour tokens, Heikin-Ashi)
//   scene.js         SVG scene renderers for candles and every overlay type
//   candle-chart.js  CandleChart core (API, viewport, overlays, panes, layout)
//   render.js        CandleChart rendering internals (grid, axes, volume, panes, legend)
//   interaction.js   CandleChart crosshair, pointer and keyboard handling
//   drawing.js       CandleChart drawing tools and draggable overlays
//   mini.js          miniChart() and candleSVG()
// Import from this file; the split is an implementation detail.

export { colorOf, niceStep, niceTicks, logTicks, heikinAshiCandles, CHART_TYPES } from './chart/util.js';
export { CandleChart } from './chart/candle-chart.js';
export { miniChart, candleSVG } from './chart/mini.js';
