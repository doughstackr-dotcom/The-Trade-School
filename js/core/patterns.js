// Candlestick-pattern and chart-pattern definitions, generators and scenarios.
// Candlestick geometry follows Nison; chart patterns follow Edwards & Magee / Bulkowski.
// Pure module (no DOM).
//
// Public facade. The library lives in js/core/patterns/:
//   candles.js         candle geometry, CANDLE_PATTERNS, detection and candleScenario()
//   candle-rules.js    real-market CANDLE_RULES, typicalRange / contextTrend, candleConfirm()
//   chart-patterns.js  CHART_PATTERNS and chartScenario()
// Import from this file; the split is an implementation detail.

export {
  body, span, upperWick, lowerWick, isBull, isBear,
  CANDLE_THRESHOLDS, CANDLE_PATTERNS, CANDLE_PATTERN_IDS,
  checkCandlePattern, trendBefore, findCandlePatterns, candleScenario,
} from './patterns/candles.js';
export { typicalRange, contextTrend, CANDLE_RULES, candleConfirm } from './patterns/candle-rules.js';
export { CHART_PATTERNS, CHART_PATTERN_IDS, chartScenario } from './patterns/chart-patterns.js';
