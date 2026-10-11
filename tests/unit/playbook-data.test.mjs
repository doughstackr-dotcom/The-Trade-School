// Playbook data integrity — setups reference real patterns; guides stay complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES,
  SETUPS,
  RISK_RULES,
  ENTRY_EXIT_FRAMEWORKS,
  TRADE_CHECKLISTS,
  SCENARIOS,
  difficultyMeta,
  setupById,
  setupsByDifficulty,
} from '../../js/core/playbook-data.js';
import { CANDLE_PATTERNS, CHART_PATTERNS } from '../../js/core/patterns.js';

test('difficulties cover easy / medium / hard', () => {
  assert.deepEqual(DIFFICULTIES.map((d) => d.id), ['easy', 'medium', 'hard']);
});

test('every setup has required fields and a known pattern', () => {
  assert.ok(SETUPS.length >= 20, `expected ≥20 setups, got ${SETUPS.length}`);
  const ids = new Set();
  for (const s of SETUPS) {
    assert.ok(s.id && s.name && s.difficulty && s.bias && s.kind && s.pattern, `incomplete setup ${s.id}`);
    assert.ok(['easy', 'medium', 'hard'].includes(s.difficulty), s.id);
    assert.ok(['candle', 'chart'].includes(s.kind), s.id);
    assert.ok(Array.isArray(s.rules) && s.rules.length >= 3, s.id);
    assert.ok(s.entry && s.stop && s.target, s.id);
    assert.equal(ids.has(s.id), false, `duplicate id ${s.id}`);
    ids.add(s.id);
    const map = s.kind === 'candle' ? CANDLE_PATTERNS : CHART_PATTERNS;
    assert.ok(map[s.pattern], `${s.id} unknown pattern ${s.pattern}`);
  }
});

test('each difficulty has setups; helpers resolve', () => {
  for (const d of DIFFICULTIES) {
    const list = setupsByDifficulty(d.id);
    assert.ok(list.length >= 3, `${d.id} too thin`);
    assert.equal(difficultyMeta(d.id).label, d.label);
  }
  assert.equal(setupById('hammer')?.name, 'Hammer at support');
  assert.equal(setupById('nope'), null);
});

test('guide sections are populated', () => {
  assert.ok(RISK_RULES.length >= 5);
  assert.ok(ENTRY_EXIT_FRAMEWORKS.length >= 3);
  assert.ok(TRADE_CHECKLISTS.pre.items.length >= 5);
  assert.ok(TRADE_CHECKLISTS.post.items.length >= 5);
  assert.ok(SCENARIOS.length >= 3);
  for (const sc of SCENARIOS) {
    assert.ok(setupById(sc.setupId), `scenario ${sc.id} → missing setup ${sc.setupId}`);
    assert.ok(sc.steps.length >= 3);
  }
});

test('every catalog pattern is represented by at least one setup', () => {
  const candleIds = Object.keys(CANDLE_PATTERNS);
  const chartIds = Object.keys(CHART_PATTERNS);
  assert.equal(candleIds.length + chartIds.length, 42, 'catalog should have 42 patterns');
  const used = new Set(SETUPS.map((s) => s.pattern));
  const missing = [...candleIds, ...chartIds].filter((id) => !used.has(id));
  assert.deepEqual(missing, [], `orphaned patterns: ${missing.join(', ')}`);
});
