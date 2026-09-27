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
