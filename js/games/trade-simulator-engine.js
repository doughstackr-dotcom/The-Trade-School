// Trade Simulator — account, execution and grading engine (private helper of
// js/games/trade-simulator.js). Pure logic, no DOM, so node can test it.
//
// Execution rules (also shown in the in-game help):
//  - Orders are market orders filled at the close of the latest bar.
//  - A stop or target triggers when a LATER bar's range reaches it. A bar that opens beyond the
//    level (a gap) fills at that open — worse than the stop, or better than the target.
//  - If one bar reaches both the stop and the target, the stop is assumed to fill first
//    (conservative: a single candle does not show which came first).
//  - One position at a time. No commissions; gaps are the only slippage.
//  - Position size = (equity × risk %) ÷ (entry − stop), capped by buying power (2× equity).

export const START_BALANCE = 10000;
export const BUYING_POWER = 2;
export const DEFAULT_RISK = 1;
export const STOP_ATR = 1.5;
export const DEFAULT_RR = 2;
export const MAX_SAFE_RISK = 2;

export const REASONS = [
  { id: 'pullback', label: 'Trend pullback' },
  { id: 'breakout', label: 'Breakout' },
  { id: 'reversal', label: 'Reversal' },
  { id: 'range', label: 'Range fade' },
  { id: 'other', label: 'Other' },
];
export const reasonLabel = (id) => REASONS.find((r) => r.id === id)?.label || 'Other';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const EPS = 1e-9;

/**
 * Where a bar closes a position: gaps at the open first, then the stop (checked before the target:
 * if one bar reaches both, the stop counts first). → { price, type: 'stop'|'target', gap, both } | null
 */
export function exitFor(pos, k) {
  const long = pos.side > 0;
  const s = pos.stop;
  const t = pos.target;
  if (isNum(s) && (long ? k.o <= s : k.o >= s)) return { price: k.o, type: 'stop', gap: k.o !== s, both: false };
  if (isNum(t) && (long ? k.o >= t : k.o <= t)) return { price: k.o, type: 'target', gap: k.o !== t, both: false };
  const hitS = isNum(s) && (long ? k.l <= s : k.h >= s);
  const hitT = isNum(t) && (long ? k.h >= t : k.l <= t);
  if (hitS) return { price: s, type: 'stop', gap: false, both: hitT };
  if (hitT) return { price: t, type: 'target', gap: false, both: false };
  return null;
}

export class TradeSession {
  /**
   * @param {object} o
   * @param {Array} o.candles  the whole market (the session only ever reads bars ≤ cursor)
   * @param {number} o.start   index of the last bar visible at the start
   * @param {Array} o.atr      ATR(14) aligned with candles (causal)
   * @param {Array} o.sma50    SMA 50 aligned with candles (causal; trend filter for grading)
   */
  constructor({ candles, start = 79, atr = [], sma50 = [], balance = START_BALANCE, buyingPower = BUYING_POWER } = {}) {
    this.candles = candles;
    this.cursor = Math.min(start, candles.length - 1);
    this.startIdx = this.cursor;
    this.atr = atr;
    this.sma50 = sma50;
    this.startBalance = balance;
    this.balance = balance;
    this.buyingPower = buyingPower;
    this.position = null;
    this.trades = [];
    this.curve = [{ idx: this.cursor, equity: balance }];
    this.nextId = 1;
    this.ended = false;
  }

  get bar() {
    return this.candles[this.cursor];
  }
  get price() {
    return this.bar.c;
  }
  get done() {
    return this.cursor >= this.candles.length - 1;
  }
  get barsLeft() {
    return this.candles.length - 1 - this.cursor;
  }

  /** ATR at bar i (falls back to the average range of the bars so far). */
  atrAt(i = this.cursor) {
    const a = this.atr[i];
    if (isNum(a) && a > 0) return a;
    const cs = this.candles.slice(Math.max(0, i - 13), i + 1);
    return Math.max(0.01, mean(cs.map((k) => k.h - k.l)));
  }

  /** 'up' | 'down' | 'flat' from the 50 SMA (price vs the average and its 5-bar slope). */
  trendAt(i = this.cursor) {
    const s = this.sma50[i];
    const s5 = this.sma50[i - 5];
    const c = this.candles[i]?.c;
    if (!isNum(s) || !isNum(s5) || !isNum(c)) return 'flat';
    if (c > s && s > s5) return 'up';
    if (c < s && s < s5) return 'down';
    return 'flat';
  }

  defaultStop(side) {
    return r2(this.price - side * STOP_ATR * this.atrAt());
  }

  defaultTarget(side, stop, rr = DEFAULT_RR) {
    const risk = isNum(stop) ? Math.abs(this.price - stop) : STOP_ATR * this.atrAt();
    return r2(this.price + side * rr * risk);
  }

  get openPnl() {
    const p = this.position;
    return p ? (this.price - p.entry) * p.size * p.side : 0;
  }
  get openR() {
    const p = this.position;
    return p && p.risk > 0 ? this.openPnl / p.risk : 0;
  }
  get equity() {
    return this.balance + this.openPnl;
  }

  /**
   * Sizes an order at the current close. → { ok, side, entry, size, riskPerUnit, risk, riskPct,
   * notional, capped, rr, stop, target, errors: [text], warnings: [{ id, text }] }
   */
  quote({ side, riskPct = DEFAULT_RISK, stop, target, useStop = true, useTarget = true } = {}) {
    const errors = [];
    const warnings = [];
    if (isNum(stop)) stop = r2(stop);
    if (isNum(target)) target = r2(target);
    const entry = this.price;
    const eq = this.equity;
    const s = side > 0 ? 1 : -1;
    const a = this.atrAt();
    if (this.position) errors.push('One position at a time: close the open trade first.');
    if (this.done) errors.push('The session is over.');
    const rp = clamp(Number(riskPct) || 0, 0, 100);
    if (!(rp > 0)) errors.push('Choose a risk above 0%.');
    let riskPerUnit = STOP_ATR * a;
    if (useStop) {
      if (!isNum(stop)) errors.push('Set a stop price.');
      else if (s > 0 && stop >= entry - 0.005) errors.push('For a buy, the stop must be below the entry.');
      else if (s < 0 && stop <= entry + 0.005) errors.push('For a sell, the stop must be above the entry.');
      else riskPerUnit = Math.abs(entry - stop);
    }
    let rr = null;
    if (useTarget) {
      if (!isNum(target)) errors.push('Set a target price.');
      else if (s > 0 && target <= entry + 0.005) errors.push('For a buy, the target must be above the entry.');
      else if (s < 0 && target >= entry - 0.005) errors.push('For a sell, the target must be below the entry.');
      else rr = Math.abs(target - entry) / riskPerUnit;
    }
    let size = riskPerUnit > 0 ? Math.floor((eq * rp) / 100 / riskPerUnit) : 0;
    const maxSize = Math.floor((eq * this.buyingPower) / entry);
    const capped = size > maxSize;
    if (capped) size = maxSize;
    if (size < 1 && !errors.length) errors.push('Risk too small to buy even one unit. Raise the risk or widen the stop.');
    const risk = size * riskPerUnit;
    const riskPctActual = eq > 0 ? (risk / eq) * 100 : 0;

    // Coach warnings (shown in Practice; graded in every style).
    if (!useStop) warnings.push({ id: 'no-stop', text: 'No stop: the loss is not limited. Sized as if the stop were 1.5 ATR away.' });
    if (riskPctActual > MAX_SAFE_RISK + 1e-6) warnings.push({ id: 'risk', text: `Risking ${riskPctActual.toFixed(1)}% of the account. Most plans cap one trade at 1–2%.` });
    if (useStop && riskPerUnit < 0.5 * a) warnings.push({ id: 'tight', text: 'Stop is inside normal noise (under half an ATR). Expect to be stopped out often.' });
    if (rr != null && rr < 1.5) warnings.push({ id: 'rr', text: `Reward is only ${rr.toFixed(1)}× the risk. A win must pay for the losses.` });
    const tr = this.trendAt();
    if ((s > 0 && tr === 'down') || (s < 0 && tr === 'up')) warnings.push({ id: 'trend', text: `Against the 50 SMA trend (price is ${tr === 'down' ? 'below a falling' : 'above a rising'} average).` });
    if (capped) warnings.push({ id: 'capped', text: `Size capped by buying power (${this.buyingPower}× equity), so you risk less than you asked.` });
    return {
      ok: errors.length === 0, side: s, entry, size, riskPerUnit, risk, riskPct: riskPctActual, riskPctAsked: rp,
      notional: size * entry, capped, rr, stop: useStop ? stop : null, target: useTarget ? target : null,
      useStop, useTarget, errors, warnings, trend: tr,
    };
  }

  /** Opens a position at the current close. → { ok, trade, error } */
  open({ side, riskPct = DEFAULT_RISK, stop, target, useStop = true, useTarget = true, reason = 'other' } = {}) {
    const q = this.quote({ side, riskPct, stop, target, useStop, useTarget });
    if (!q.ok) return { ok: false, error: q.errors[0] };
    const prev = this.trades[this.trades.length - 1];
    const revenge = !!(prev && prev.pnl < 0 && this.cursor - prev.exitIdx <= 3 && q.riskPct > prev.riskPct + 0.05);
    const p = {
      id: this.nextId++,
      side: q.side,
      size: q.size,
      entry: q.entry,
      entryIdx: this.cursor,
      stop: q.stop,
      initialStop: q.stop,
      target: q.target,
      reason: REASONS.some((r) => r.id === reason) ? reason : 'other',
      riskPct: q.riskPct,
      riskPctAsked: q.riskPctAsked,
      risk: q.risk,
      riskPerUnit: q.riskPerUnit,
      stopUsed: q.useStop,
      targetUsed: q.useTarget,
      plannedRR: q.rr,
      trend: q.trend,
      againstTrend: (q.side > 0 && q.trend === 'down') || (q.side < 0 && q.trend === 'up'),
      tightStop: q.warnings.some((w) => w.id === 'tight'),
      capped: q.capped,
      revenge,
      widened: 0,
      tightened: 0,
      protectedAt: null,
    };
    this.position = p;
    return { ok: true, trade: p, quote: q };
  }

  /** Moves (or adds) the open position's stop. → { ok, widened, tightened, error } */
  setStop(price) {
    const p = this.position;
    if (!p) return { ok: false, error: 'No open position.' };
    if (!isNum(price)) return { ok: false, error: 'Invalid price.' };
    const cur = this.price;
    if (p.side > 0 && price >= cur) return { ok: false, error: 'A buy stop must stay below the current price (use Close to exit now).' };
    if (p.side < 0 && price <= cur) return { ok: false, error: 'A sell stop must stay above the current price (use Close to exit now).' };
    const old = p.stop;
    let widened = false;
    let tightened = false;
    if (isNum(old)) {
      const d = (price - old) * p.side; // > 0: towards profit (tighter), < 0: further away (more risk)
      if (d < -EPS) {
        widened = true;
        p.widened += 1;
      } else if (d > EPS) {
        tightened = true;
        p.tightened += 1;
      }
    }
    p.stop = r2(price);
    if (p.protectedAt == null && (p.stop - p.entry) * p.side >= -EPS) p.protectedAt = this.cursor;
    return { ok: true, widened, tightened };
  }

  /** Moves (or adds) the open position's target. */
  setTarget(price) {
    const p = this.position;
    if (!p) return { ok: false, error: 'No open position.' };
    if (!isNum(price)) return { ok: false, error: 'Invalid price.' };
    const cur = this.price;
    if (p.side > 0 && price <= cur) return { ok: false, error: 'A buy target must stay above the current price.' };
    if (p.side < 0 && price >= cur) return { ok: false, error: 'A sell target must stay below the current price.' };
    p.target = r2(price);
    return { ok: true };
  }

  _close(price, idx, type, gap = false, both = false) {
    const p = this.position;
    if (!p) return null;
    const pnl = (price - p.entry) * p.size * p.side;
    const t = {
      ...p,
      exit: price,
      exitIdx: idx,
      exitType: type,
      gap,
      both,
      pnl,
      r: p.risk > 0 ? pnl / p.risk : 0,
      bars: idx - p.entryIdx,
    };
    this.balance += pnl;
    this.position = null;
    this.trades.push(t);
    return t;
  }

  /** Closes the open position at the latest close. type: 'manual' | 'end'. */
  close(type = 'manual') {
    if (!this.position) return null;
    const t = this._close(this.price, this.cursor, type);
    this._mark();
    return t;
  }

  _mark() {
    const last = this.curve[this.curve.length - 1];
    const pt = { idx: this.cursor, equity: this.equity };
    if (last && last.idx === pt.idx) this.curve[this.curve.length - 1] = pt;
    else this.curve.push(pt);
  }

  /** Reveals the next bar and fills a stop / target it reaches. → { idx, fill: trade | null } */
  step() {
    if (this.done) return { idx: this.cursor, fill: null };
    this.cursor += 1;
    let fill = null;
    if (this.position) {
      const x = exitFor(this.position, this.bar);
      if (x) fill = this._close(x.price, this.cursor, x.type, x.gap, x.both);
    }
    this._mark();
    return { idx: this.cursor, fill };
  }

  /** Ends the session: an open position closes at the last close. */
  end() {
    if (this.ended) return null;
    const t = this.position ? this.close('end') : null;
    this.ended = true;
    this._mark();
    return t;
  }

  // ------------------------------------------------------------------ statistics

  stats() {
    const T = this.trades;
    const n = T.length;
    const wins = T.filter((t) => t.pnl > 0);
    const losses = T.filter((t) => t.pnl < 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
    let peak = this.startBalance;
    let maxDD = 0;
    let maxDDAbs = 0;
    for (const p of this.curve) {
      if (p.equity > peak) peak = p.equity;
      const dd = peak > 0 ? (peak - p.equity) / peak : 0;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDAbs = peak - p.equity;
      }
    }
    const eq = this.equity;
    return {
      trades: n,
      wins: wins.length,
      losses: losses.length,
      winRate: n ? wins.length / n : 0,
      avgWinR: wins.length ? mean(wins.map((t) => t.r)) : 0,
      avgLossR: losses.length ? mean(losses.map((t) => t.r)) : 0,
      expectancyR: n ? mean(T.map((t) => t.r)) : 0,
      totalR: T.reduce((s, t) => s + t.r, 0),
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
      netPnl: eq - this.startBalance,
      returnPct: ((eq - this.startBalance) / this.startBalance) * 100,
      maxDrawdownPct: maxDD * 100,
      maxDrawdown: maxDDAbs,
      equity: eq,
      balance: this.balance,
    };
  }

  /**
   * Behaviour-based feedback. → { score 0–1, flags: [{ id, title, detail, count, severity }],
   * notes: [{ id, title, detail }] (neutral advice), positives: [{ id, title, detail }] }
   */
  discipline() {
    const T = this.trades;
    const n = T.length;
    const flags = [];
    const positives = [];
    const notes = [];
    if (!n) {
      return {
        score: 0, flags: [], positives: [],
        notes: [{ id: 'no-trades', title: 'No trades taken', detail: 'There is nothing to grade yet. Waiting is a skill, but a plan only counts once you execute it: take the setups your rules allow.' }],
      };
    }
    const count = (fn) => T.filter(fn).length;
    const pct = (k) => `${k} of ${n} trade${n === 1 ? '' : 's'}`;
    const add = (id, weight, k, title, detail) => {
      if (k <= 0) return;
      flags.push({ id, weight, count: k, severity: Math.min(1, k / n), title, detail });
    };
    const noStop = count((t) => !t.stopUsed);
    add('no-stop', 0.35, noStop, 'No stop used', `${pct(noStop)} had no stop, so the loss was not limited. Decide where you are wrong before you enter.`);
    const overRisk = count((t) => t.riskPct > MAX_SAFE_RISK + 1e-6);
    add('over-risk', 0.3, overRisk, 'Risked more than 2%', `${pct(overRisk)} risked over 2% of the account. A losing streak at that size digs a deep hole.`);
    const widened = count((t) => t.widened > 0);
    add('widened', 0.25, widened, 'Moved a stop further away', `You widened the stop on ${pct(widened)}. That turns a planned small loss into a bigger one; move stops only towards profit.`);
    const against = count((t) => t.againstTrend);
    if (against >= 2 && against / n >= 0.34) {
      add('against-trend', 0.2, against, 'Traded against the 50 SMA trend repeatedly', `${pct(against)} went against the trend (buying under a falling 50 SMA or selling over a rising one). Counter-trend trades need extra evidence.`);
    }
    const revenge = count((t) => t.revenge);
    add('revenge', 0.15, revenge, 'Raised the risk right after a loss', `${pct(revenge)} came within 3 bars of a loss with a bigger risk. That is revenge trading; stick to your normal size.`);
    const poorRR = count((t) => t.targetUsed && t.plannedRR != null && t.plannedRR < 1);
    add('poor-rr', 0.1, poorRR, 'Targets closer than stops', `${pct(poorRR)} aimed for less than it risked (R:R under 1). You then need a very high win rate just to break even.`);
    if (n > 30) flags.push({ id: 'overtrading', weight: 0.15, count: n, severity: Math.min(1, (n - 30) / 30), title: 'Overtrading', detail: `${n} trades in one session. More trades are not more edge; wait for your setups.` });
    const penalty = flags.reduce((s, f) => s + f.weight * f.severity, 0);
    const score = clamp(1 - penalty, 0, 1);

    // Positive reinforcement.
    if (!noStop) positives.push({ id: 'stops', title: 'A stop on every trade', detail: 'Every loss was limited by a plan made before entry.' });
    if (!overRisk) positives.push({ id: 'risk', title: 'Risk kept at 2% or less', detail: 'Consistent, survivable position sizes.' });
    if (!widened && T.some((t) => t.tightened > 0 || t.protectedAt != null)) positives.push({ id: 'trail', title: 'Stops only moved towards profit', detail: 'You protected open gains without adding risk.' });
    else if (!widened && noStop < n) positives.push({ id: 'no-widen', title: 'Never widened a stop', detail: 'Your exits stayed where you planned them.' });
    if (against === 0 && n >= 2) positives.push({ id: 'with-trend', title: 'Traded with the 50 SMA trend', detail: 'Every trade went the way of the bigger trend (or the trend was flat).' });
    const tagged = count((t) => t.reason !== 'other');
    if (tagged === n) positives.push({ id: 'journal', title: 'Every trade had a reason', detail: 'A tagged journal shows which setups actually work for you.' });

    // Neutral advice from the results.
    const st = this.stats();
    if (st.wins >= 2 && st.avgWinR < 1) notes.push({ id: 'cut-winners', title: 'Winners cut short', detail: `Your winners averaged ${st.avgWinR.toFixed(2)}R. Letting them reach the target lifts expectancy more than a higher win rate does.` });
    if (st.expectancyR > 0.05 && st.netPnl < 0) notes.push({ id: 'sizing', title: 'Positive R, negative dollars', detail: 'Your trades averaged a positive R, yet the account lost money: the losers were sized bigger than the winners. Keep the risk per trade the same.' });
    const big = T.filter((t) => t.r < -1.25);
    if (big.length) notes.push({ id: 'big-loss', title: 'Losses bigger than planned', detail: `${pct(big.length)} lost more than 1.25R${big.some((t) => t.gap) ? ' (a gap jumped the stop — it fills at the open)' : ''}.` });
    const byReason = {};
    for (const t of T) (byReason[t.reason] ||= []).push(t.r);
    const best = Object.entries(byReason).filter(([, rs]) => rs.length >= 2).map(([id, rs]) => ({ id, avg: mean(rs), n: rs.length })).sort((a, b) => b.avg - a.avg)[0];
    if (best && Object.keys(byReason).length > 1) notes.push({ id: 'best-setup', title: `Best setup: ${reasonLabel(best.id)}`, detail: `${best.n} trades averaging ${best.avg >= 0 ? '+' : ''}${best.avg.toFixed(2)}R in this session (a small sample, not proof).` });
    return { score, flags, positives, notes };
  }

  /**
   * Session score (0–1000): 55% discipline + 45% expectancy, times an activity factor (fewer than 4
   * trades is too small a sample) and a discipline multiplier (0.6 + 0.4 × discipline), so a lucky
   * but sloppy session cannot outscore a careful one. Expectancy +0.25R with clean discipline ≈ 900
   * (3 stars); clean discipline at breakeven ≈ 730 (2 stars).
   */
  score() {
    const st = this.stats();
    const d = this.discipline();
    const n = st.trades;
    const activity = n ? Math.min(1, 0.4 + 0.15 * n) : 0;
    const expectancy = n ? clamp(0.4 + 1.6 * st.expectancyR, 0, 1) : 0;
    const total = Math.round(1000 * activity * (0.55 * d.score + 0.45 * expectancy) * (0.6 + 0.4 * d.score));
    return { total, discipline: d.score, expectancy, activity, stats: st, feedback: d };
  }
}
