// Unit tests for js/core/market-hours.js — DST-aware open/closed and session overlaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUITY_MARKETS,
  FOREX_SESSIONS,
  parseHm,
  zonedParts,
  isMarketOpen,
  marketStatus,
  getMarketHoursSnapshot,
  tzAbbrev,
  formatLocalTime,
  sessionProgressBars,
  overallSessionProgress,
  venueForSymbol,
  assetSessionStatus,
  unifiedTimeline,
  wallTimeToUtc,
  zonedYmd,
  startOfDayUtc,
} from '../../js/core/market-hours.js';

const byId = (id) => [...EQUITY_MARKETS, ...FOREX_SESSIONS].find((m) => m.id === id);

test('parseHm converts HH:MM to minutes', () => {
  assert.equal(parseHm('09:30'), 9 * 60 + 30);
  assert.equal(parseHm('16:00'), 16 * 60);
  assert.equal(parseHm('00:00'), 0);
});

test('zonedParts returns weekday and clock in target zone', () => {
  // 2026-06-15 14:00 UTC = 10:00 America/New_York (EDT)
  const d = new Date('2026-06-15T14:00:00Z');
  const p = zonedParts(d, 'America/New_York');
  assert.equal(p.weekday, 'Mon');
  assert.equal(p.hour, 10);
  assert.equal(p.minute, 0);
  assert.equal(p.minutes, 600);
});

test('NYSE open on a summer weekday mid-session', () => {
  const nyse = byId('nyse');
  // Monday 2026-06-15 15:00 UTC = 11:00 EDT → open
  assert.equal(isMarketOpen(nyse, new Date('2026-06-15T15:00:00Z')), true);
  // Monday 2026-06-15 12:00 UTC = 08:00 EDT → closed (pre-open)
  assert.equal(isMarketOpen(nyse, new Date('2026-06-15T12:00:00Z')), false);
  // Monday 2026-06-15 21:00 UTC = 17:00 EDT → closed
  assert.equal(isMarketOpen(nyse, new Date('2026-06-15T21:00:00Z')), false);
});

test('NYSE closed on weekend', () => {
  const nyse = byId('nyse');
  // Saturday 2026-06-13 15:00 UTC
  assert.equal(isMarketOpen(nyse, new Date('2026-06-13T15:00:00Z')), false);
});

test('NYSE respects US DST (winter EST vs summer EDT)', () => {
  const nyse = byId('nyse');
  // Winter: 2026-01-14 15:00 UTC = 10:00 EST → open
  assert.equal(isMarketOpen(nyse, new Date('2026-01-14T15:00:00Z')), true);
  // Same UTC in summer is 11:00 EDT — still open; contrast pre-open:
  // Winter 14:00 UTC = 09:00 EST → closed; Summer 14:00 UTC = 10:00 EDT → open
  assert.equal(isMarketOpen(nyse, new Date('2026-01-14T14:00:00Z')), false);
  assert.equal(isMarketOpen(nyse, new Date('2026-06-15T14:00:00Z')), true);
});

test('LSE open during UK regular hours', () => {
  const lse = byId('lse');
  // 2026-06-15 10:00 UTC = 11:00 BST → open
  assert.equal(isMarketOpen(lse, new Date('2026-06-15T10:00:00Z')), true);
  // 2026-06-15 06:30 UTC = 07:30 BST → closed
  assert.equal(isMarketOpen(lse, new Date('2026-06-15T06:30:00Z')), false);
});

test('TSE lunch break is closed', () => {
  const tse = byId('tse');
  // 2026-06-16 02:00 UTC = 11:00 JST → morning open
  assert.equal(isMarketOpen(tse, new Date('2026-06-16T02:00:00Z')), true);
  // 2026-06-16 03:00 UTC = 12:00 JST → lunch closed
  assert.equal(isMarketOpen(tse, new Date('2026-06-16T03:00:00Z')), false);
  // 2026-06-16 04:00 UTC = 13:00 JST → afternoon open
  assert.equal(isMarketOpen(tse, new Date('2026-06-16T04:00:00Z')), true);
});

test('London–NY forex overlap is active mid-morning NY', () => {
  // 2026-06-15 14:00 UTC = 10:00 EDT and 15:00 BST → both FX sessions open
  const snap = getMarketHoursSnapshot(new Date('2026-06-15T14:00:00Z'));
  const lonNy = snap.overlaps.find((o) => o.id === 'london-ny');
  assert.ok(lonNy);
  assert.equal(lonNy.active, true);
  assert.ok(snap.activeForex.includes('London'));
  assert.ok(snap.activeForex.includes('New York'));
  assert.match(snap.context, /London–New York|overlap/i);
});

test('weekend snapshot reports closed equities', () => {
  const snap = getMarketHoursSnapshot(new Date('2026-06-13T15:00:00Z'));
  assert.equal(snap.activeEquities.length, 0);
  assert.ok(snap.equities.every((e) => e.open === false));
});

test('marketStatus includes local time and tz abbrev', () => {
  const st = marketStatus(byId('nasdaq'), new Date('2026-06-15T15:00:00Z'));
  assert.equal(st.open, true);
  assert.ok(st.localTime);
  assert.ok(st.tzAbbrev);
  assert.equal(st.short, 'NASDAQ');
});

test('tzAbbrev and formatLocalTime are non-empty strings', () => {
  const d = new Date('2026-06-15T15:00:00Z');
  assert.ok(tzAbbrev('America/New_York', d).length >= 2);
  assert.ok(formatLocalTime('Europe/London', d).length >= 4);
});

test('snapshot has all eight venues', () => {
  const snap = getMarketHoursSnapshot(Date.now());
  assert.equal(snap.equities.length, 4);
  assert.equal(snap.forex.length, 4);
  assert.equal(snap.overlaps.length, 3);
  assert.ok(snap.clientTz);
});


test('session progress bars fill during an open NYSE session', () => {
  const at = new Date('2026-06-15T15:00:00Z');
  const bars = sessionProgressBars(byId('nyse'), at);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].active, true);
  assert.ok(bars[0].progress > 0.1 && bars[0].progress < 0.9);
  const st = marketStatus(byId('nyse'), at);
  assert.ok(st.sessionBars);
  assert.ok(st.progress > 0);
  assert.ok(st.dayProgress > 0 && st.dayProgress < 1);
  assert.ok(overallSessionProgress(byId('nyse'), at) > 0);
});

test('session progress is zero before open and one after close', () => {
  const before = sessionProgressBars(byId('nyse'), new Date('2026-06-15T12:00:00Z'));
  assert.equal(before[0].active, false);
  assert.equal(before[0].progress, 0);
  const after = sessionProgressBars(byId('nyse'), new Date('2026-06-15T21:00:00Z'));
  assert.equal(after[0].done, true);
  assert.equal(after[0].progress, 1);
});


test('venueForSymbol maps US ETFs and stocks to NASDAQ hours', () => {
  assert.equal(venueForSymbol('SPY').id, 'nasdaq');
  assert.equal(venueForSymbol('QQQ').id, 'nasdaq');
  assert.equal(venueForSymbol('IWM').id, 'nasdaq');
  assert.equal(venueForSymbol('DIA').id, 'nasdaq');
  assert.equal(venueForSymbol('AAPL').id, 'nasdaq');
});

test('venueForSymbol maps FX and crypto', () => {
  assert.equal(venueForSymbol('EUR-USD').kind, 'forex');
  assert.equal(venueForSymbol('GBP-USD').kind, 'forex');
  assert.equal(venueForSymbol('BTC-USD').alwaysOpen, true);
});

test('assetSessionStatus crypto is always open', () => {
  const st = assetSessionStatus('BTC-USD', new Date('2026-06-13T15:00:00Z')); // Saturday
  assert.equal(st.open, true);
});

test('assetSessionStatus SPY follows NYSE/NASDAQ hours', () => {
  // Monday mid-session ET
  assert.equal(assetSessionStatus('SPY', new Date('2026-06-15T15:00:00Z')).open, true);
  // Monday pre-open ET
  assert.equal(assetSessionStatus('SPY', new Date('2026-06-15T12:00:00Z')).open, false);
  // Weekend
  assert.equal(assetSessionStatus('SPY', new Date('2026-06-13T15:00:00Z')).open, false);
});


test('wallTimeToUtc maps NYSE open to known UTC in summer', () => {
  // 2026-06-15 09:30 America/New_York (EDT, UTC-4) → 13:30 UTC
  const utc = wallTimeToUtc(2026, 6, 15, '09:30', 'America/New_York');
  assert.equal(utc.toISOString(), '2026-06-15T13:30:00.000Z');
});

test('wallTimeToUtc maps LSE open to known UTC in summer', () => {
  // 2026-06-15 08:00 Europe/London (BST, UTC+1) → 07:00 UTC
  const utc = wallTimeToUtc(2026, 6, 15, '08:00', 'Europe/London');
  assert.equal(utc.toISOString(), '2026-06-15T07:00:00.000Z');
});

test('unifiedTimeline places NYSE and LSE bars on a UTC display axis', () => {
  // Monday mid-session: 2026-06-15 15:00 UTC
  const at = new Date('2026-06-15T15:00:00Z');
  const tl = unifiedTimeline(at, 'UTC');
  assert.equal(tl.displayTz, 'UTC');
  assert.ok(tl.nowMin > 14 * 60 && tl.nowMin < 16 * 60); // ~15:00
  assert.equal(tl.rows.length, 8);

  const nyse = tl.rows.find((r) => r.id === 'nyse');
  assert.ok(nyse);
  assert.equal(nyse.open, true);
  assert.equal(nyse.segments.length, 1);
  // NYSE 09:30–16:00 EDT = 13:30–20:00 UTC
  assert.ok(nyse.segments[0].startMin > 13 * 60 && nyse.segments[0].startMin < 14 * 60);
  assert.ok(nyse.segments[0].endMin > 19 * 60 && nyse.segments[0].endMin < 21 * 60);
  assert.equal(nyse.segments[0].active, true);

  const lse = tl.rows.find((r) => r.id === 'lse');
  assert.ok(lse);
  assert.equal(lse.open, true);
  // LSE 08:00–16:30 BST = 07:00–15:30 UTC
  assert.ok(lse.segments[0].startMin > 6 * 60 && lse.segments[0].startMin < 8 * 60);
  assert.ok(lse.segments[0].endMin > 15 * 60 && lse.segments[0].endMin < 16 * 60);
  assert.equal(lse.segments[0].active, true); // 15:00 UTC still before 15:30 close
});

test('unifiedTimeline TSE lunch yields two segments on UTC axis', () => {
  // 2026-06-16 02:00 UTC = 11:00 JST (morning session)
  const at = new Date('2026-06-16T02:00:00Z');
  const tl = unifiedTimeline(at, 'UTC');
  const tse = tl.rows.find((r) => r.id === 'tse');
  assert.ok(tse);
  assert.equal(tse.segments.length, 2);
  // Morning 09:00–11:30 JST = 00:00–02:30 UTC
  assert.ok(tse.segments[0].startMin < 30);
  assert.ok(tse.segments[0].endMin > 2 * 60 && tse.segments[0].endMin < 3 * 60);
  assert.equal(tse.segments[0].active, true);
  // Afternoon 12:30–15:00 JST = 03:30–06:00 UTC
  assert.ok(tse.segments[1].startMin > 3 * 60 && tse.segments[1].startMin < 4 * 60);
  assert.equal(tse.segments[1].active, false);
  assert.equal(tse.segments[1].done, false);
});

test('unifiedTimeline nowMin tracks display-tz clock', () => {
  const at = new Date('2026-06-15T18:30:00Z');
  const tl = unifiedTimeline(at, 'America/New_York');
  // 18:30 UTC = 14:30 EDT
  assert.ok(tl.nowMin > 14 * 60 && tl.nowMin < 15 * 60);
  assert.match(tl.displayTzAbbrev, /EDT|GMT-4|UTC-4/i);
});

test('zonedYmd and startOfDayUtc are consistent for New York', () => {
  const d = new Date('2026-06-15T14:00:00Z');
  const ymd = zonedYmd(d, 'America/New_York');
  assert.deepEqual(ymd, { y: 2026, m: 6, d: 15 });
  const start = startOfDayUtc(d, 'America/New_York');
  // Midnight EDT = 04:00 UTC
  assert.equal(start.toISOString(), '2026-06-15T04:00:00.000Z');
});
