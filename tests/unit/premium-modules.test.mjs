import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES, LESSONS, TOOLS } from '../../js/registry.js';
import { FREE_IDS } from '../../js/config.js';
import { requiredPlan } from '../../js/core/access.js';
import { premiumModules } from '../../scripts/premium-modules.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('premium module manifest excludes the free game and includes same-folder helpers', async () => {
  const modules = await premiumModules();
  const paths = modules.map((m) => m.storagePath);
  assert.equal(modules.length, 40);
  assert.ok(paths.includes('beginner/lessons/candle-anatomy.js'));
  assert.ok(paths.includes('beginner/lessons/discipline-basics.js'));
  assert.ok(paths.includes('beginner/tools/pre-trade-checklist.js'));
  assert.ok(paths.includes('advanced/games/fib-sniper.js'));
  assert.ok(paths.includes('advanced/tools/journal-review.js'));
  assert.ok(paths.includes('beginner/lessons/markets-orders-visuals.js'));
  assert.equal(paths.some((p) => p.endsWith('/games/daily-challenge.js')), false);
  assert.equal(paths.some((p) => p.includes('/games/checklist-discipline.js')), false);
  assert.equal(paths.some((p) => p.includes('/games/journal-review.js')), false);
});

test('premium manifest plans match access tiers: free, beginner, advanced', async () => {
  const modules = await premiumModules();
  const paths = modules.map((m) => m.storagePath);
  assert.equal(requiredPlan({ id: 'daily-challenge', tier: 'both' }), 'free');
  assert.equal(requiredPlan({ id: 'candle-anatomy', tier: 'beginner' }), 'beginner');
  assert.equal(requiredPlan({ id: 'pre-trade-checklist', tier: 'beginner', type: 'tool' }), 'beginner');
  assert.equal(requiredPlan({ id: 'fib-sniper', tier: 'advanced' }), 'advanced');
  assert.equal(requiredPlan({ id: 'journal-review', tier: 'advanced', type: 'tool' }), 'advanced');
  assert.equal(paths.some((p) => p.includes('daily-challenge')), false);
  assert.ok(paths.some((p) => p.startsWith('beginner/lessons/')));
  assert.ok(paths.some((p) => p.startsWith('advanced/games/')));
});

test('paid module relative imports are either public shared code or covered same-folder helpers', async () => {
  const manifest = new Set((await premiumModules()).map((m) => m.publicPath));
  const paid = [...LESSONS, ...GAMES, ...TOOLS].filter((entry) => !FREE_IDS.includes(entry.id));
  const re = /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  for (const entry of paid) {
    const rel = entry.path.replace(/^\.\//, 'js/');
    let source = '';
    try {
      source = await readFile(join(ROOT, rel), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw err;
    }
    const dir = rel.replace(/[^/]*$/, '');
    for (const match of source.matchAll(re)) {
      const specifier = match[1] || match[2] || match[3];
      if (specifier.startsWith('../')) {
        assert.match(specifier, /^\.\.\/core\//, `${rel} imports non-core public dependency ${specifier}`);
      } else {
        const dep = `${dir}${specifier.slice(2)}`;
        assert.ok(manifest.has(dep), `${rel} same-folder helper ${dep} missing from premium manifest`);
      }
    }
  }
});
